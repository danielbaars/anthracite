import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

const CREATE_SELECTED = [
  'create',
  'inserted',
  '--onto',
  'base',
  '--insert',
  '--insert-child',
  'child',
  '-m',
  'inserted shared work',
] as const;

function prepareConflict(fixture: CreateCliFixture): {
  readonly output: string;
  readonly ownHistory: string;
  readonly untouched: ReturnType<typeof branchState>;
} {
  fixture.branch('sibling', 'base');
  fixture.branch('sibling-tip', 'sibling');
  fixture.branch('conflicting', 'tip');
  fixture.stage('main.txt', 'conflicting shared work');
  fixture.git([
    'commit',
    '--author',
    'Selected author <selected@example.test>',
    '-m',
    'conflicting shared work',
    '-m',
    'Retained full message body.',
  ]);
  fixture.branch('tail', 'conflicting');
  for (const branch of ['child', 'tip', 'conflicting', 'tail']) {
    updateMetadata(fixture, branch, {
      prInfo: { number: 42, title: `Original ${branch} PR` },
      opaque: { identity: branch },
    });
  }
  const ownHistory = fixture.git([
    'log',
    '--reverse',
    '--format=%an <%ae>%n%B',
    'base..tail',
  ]);
  const untouched = branchState(fixture, ['sibling', 'sibling-tip']);
  fixture.git(['switch', 'other']);
  fixture.stage('main.txt', 'inserted shared work');
  const start = fixture.run(CREATE_SELECTED);
  expect(start.status, start.stdout + start.stderr).to.equal(1);
  expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
    'main.txt'
  );
  expect(
    fs
      .readFileSync(
        path.join(fixture.repo, '.git/rebase-merge/head-name'),
        'utf8'
      )
      .trim()
  ).to.equal('refs/heads/conflicting');
  return { output: start.stdout + start.stderr, ownHistory, untouched };
}

function branchState(fixture: CreateCliFixture, names: readonly string[]) {
  return names.map((name) => ({
    name,
    revision: fixture.git(['rev-parse', name]),
    tree: fixture.git(['rev-parse', `${name}^{tree}`]),
    metadata: fixture.git(['cat-file', '-p', `refs/branch-metadata/${name}`]),
  }));
}

function recovery(fixture: CreateCliFixture): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (name: string): void => {
    const file = path.join(fixture.repo, '.git', name);
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const child of fs.readdirSync(file)) visit(path.join(name, child));
    } else files[name] = fs.readFileSync(file).toString('base64');
  };
  for (const name of ['.gtcontinue', 'rebase-merge', 'rebase-apply'])
    visit(name);
  return files;
}

function updateMetadata(
  fixture: CreateCliFixture,
  branch: string,
  fields: Readonly<Record<string, unknown>>
): void {
  const meta: unknown = JSON.parse(
    fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
  );
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta))
    throw new Error('Expected branch metadata');
  const file = path.join(fixture.root, 'metadata.json');
  fs.writeFileSync(file, JSON.stringify({ ...meta, ...fields }));
  fixture.git([
    'update-ref',
    `refs/branch-metadata/${branch}`,
    fixture.git(['hash-object', '-w', file]),
  ]);
}

// eslint-disable-next-line max-lines-per-function
describe('selected insert recovery through fresh public CLI processes', function () {
  this.timeout(90000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('refuses an occupied pending descendant before all stages or advances the active resolution', () => {
    prepareConflict(fixture);
    fixture.git(['worktree', 'add', fixture.linked, 'tail']);
    fixture.stage('tail.txt', 'foreign prepared work', fixture.linked);
    fixture.write('tail.txt', 'foreign unfinished work', fixture.linked);
    fixture.write('portable.txt', 'foreign portable work', fixture.linked);
    fixture.write('main.txt', 'unstaged deliberate resolution');
    const before = fixture.snapshot();
    const foreign = fixture.snapshot(fixture.linked);
    const saved = recovery(fixture);

    const refused = fixture.run(['cont', '--all']);

    expect(refused.status).to.equal(1);
    expect(refused.stderr).to.include('Cannot restack tail');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(foreign);
    expect(recovery(fixture)).to.deep.equal(saved);
    fixture.git(['switch', '--detach'], fixture.linked);
    fixture.ok(['continue', '--all']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'unstaged deliberate resolution'
    );
    expect(fixture.git(['status', '--porcelain=v1'])).to.equal('');
  });

  it('retains independently changed unselected metadata while continuing the saved selection', () => {
    prepareConflict(fixture);
    updateMetadata(fixture, 'sibling', {
      parentBranchRevision: fixture.git(['rev-parse', 'main']),
      opaque: { owner: 'independent external update' },
    });
    const sibling = fixture.git(['rev-parse', 'sibling']);
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/sibling']);
    fixture.stage('main.txt', 'deliberate resolution');

    fixture.ok(['continue']);

    expect(fixture.git(['rev-parse', 'refs/branch-metadata/sibling'])).to.equal(
      metadata
    );
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'deliberate resolution'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('continues a noninteractive selection in a terminal without a new menu and retains completed work, own history and local PR identity', () => {
    const before = prepareConflict(fixture);
    expect(before.output).to.include('an continue');
    expect(before.output).to.include('an rebase --abort');
    expect(before.output).to.match(/only cancels the active rebase/);
    expect(before.output).to.match(/parent changes and completed restacks/);
    const inserted = fixture.git(['rev-parse', 'inserted']);
    const completed = branchState(fixture, ['child', 'tip']);
    const saved: unknown = JSON.parse(
      fs.readFileSync(path.join(fixture.repo, '.git/.gtcontinue'), 'utf8')
    );
    expect(saved).to.deep.include({
      branchesToRestack: ['tail'],
      currentBranchOverride: 'inserted',
      insert: {
        branch: 'inserted',
        mandatory: ['child', 'tip', 'conflicting', 'tail'],
        completed: ['child', 'tip'],
      },
    });
    fixture.stage('main.txt', 'deliberate selected resolution');

    const env = { ...fixture.env };
    delete env.GRAPHITE_INTERACTIVE;
    const continued = runCliInPty(
      getTestCliCommand(['continue', '--interactive']),
      { cwd: fixture.repo, env, timeoutMs: 45000 }
    );
    expect(continued.status, continued.output).to.equal(0);
    const output = continued.output;

    expect(output).to.include('Resolved rebase conflict for conflicting');
    expect(output).to.include('Restacked tail on conflicting');
    expect(output).not.to.match(/Restacked (child|tip|sibling) on/);
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
    expect(branchState(fixture, ['child', 'tip'])).to.deep.equal(completed);
    expect(branchState(fixture, ['sibling', 'sibling-tip'])).to.deep.equal(
      before.untouched
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['status', '--porcelain=v1'])).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/rebase-merge'))
    ).to.equal(false);
    expect(
      fixture.git([
        'log',
        '--reverse',
        '--format=%an <%ae>%n%B',
        'inserted..tail',
      ])
    ).to.equal(before.ownHistory);
    for (const [branch, parent] of [
      ['child', 'inserted'],
      ['tip', 'child'],
      ['conflicting', 'tip'],
      ['tail', 'conflicting'],
    ]) {
      fixture.git(['merge-base', '--is-ancestor', 'inserted', branch]);
      const metadata: unknown = JSON.parse(
        fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
      );
      expect(metadata).to.deep.include({
        parentBranchName: parent,
        prInfo: { number: 42, title: `Original ${branch} PR` },
        opaque: { identity: branch },
      });
    }
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'deliberate selected resolution'
    );
    expect(fixture.git(['show', 'tail:tail.txt'])).to.equal('tail');
  });

  it('retains staged and unstaged resolutions when a pending selected descendant becomes frozen', () => {
    prepareConflict(fixture);
    updateMetadata(fixture, 'tail', { frozen: true });
    fixture.stage('main.txt', 'staged deliberate resolution');
    fixture.write('main.txt', 'staged plus unfinished resolution');
    const before = fixture.snapshot();
    const saved = recovery(fixture);
    const metadata = branchState(fixture, ['tail']);

    const refused = fixture.run(['continue', '--all']);

    expect(refused.status).to.equal(1);
    expect(refused.stderr).to.include('an unfreeze tail');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(recovery(fixture)).to.deep.equal(saved);
    expect(branchState(fixture, ['tail'])).to.deep.equal(metadata);
    updateMetadata(fixture, 'tail', { frozen: false });
    fixture.ok(['continue', '--all']);
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'staged plus unfinished resolution'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('excludes frozen occupied unselected and completed branches from pending recovery', () => {
    prepareConflict(fixture);
    updateMetadata(fixture, 'sibling', { frozen: true });
    updateMetadata(fixture, 'child', { frozen: true });
    fixture.git(['worktree', 'add', fixture.linked, 'sibling']);
    fixture.stage('sibling.txt', 'foreign staged work', fixture.linked);
    fixture.write('sibling.txt', 'foreign partial work', fixture.linked);
    fixture.write('portable.txt', 'foreign untracked work', fixture.linked);
    const completedWorktree = path.join(fixture.root, 'completed-worktree');
    fixture.git(['worktree', 'add', completedWorktree, 'child']);
    fixture.write('child.txt', 'completed branch work', completedWorktree);
    const foreign = fixture.snapshot(fixture.linked);
    const completedWork = fixture.snapshot(completedWorktree);
    const unchanged = branchState(fixture, [
      'sibling',
      'sibling-tip',
      'child',
      'tip',
    ]);
    fixture.stage('main.txt', 'selected resolution');

    fixture.ok(['continue']);

    expect(
      branchState(fixture, ['sibling', 'sibling-tip', 'child', 'tip'])
    ).to.deep.equal(unchanged);
    expect({ ...fixture.snapshot(fixture.linked), refs: '' }).to.deep.equal({
      ...foreign,
      refs: '',
    });
    expect({ ...fixture.snapshot(completedWorktree), refs: '' }).to.deep.equal({
      ...completedWork,
      refs: '',
    });
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'selected resolution'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('continues a legacy saved queue without an insert role or ownership field', () => {
    prepareConflict(fixture);
    const file = path.join(fixture.repo, '.git/.gtcontinue');
    const saved: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved))
      throw new Error('Expected saved continuation');
    fs.writeFileSync(
      file,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(saved).filter(
            ([name]) => name !== 'insert' && name !== 'rebaseOwnership'
          )
        )
      )
    );
    const completed = branchState(fixture, ['child', 'tip']);
    const untouched = branchState(fixture, ['sibling', 'sibling-tip']);
    fixture.stage('main.txt', 'legacy selected resolution');

    fixture.ok(['continue']);

    expect(branchState(fixture, ['child', 'tip'])).to.deep.equal(completed);
    expect(branchState(fixture, ['sibling', 'sibling-tip'])).to.deep.equal(
      untouched
    );
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'legacy selected resolution'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['status', '--porcelain=v1'])).to.equal('');
  });
});
