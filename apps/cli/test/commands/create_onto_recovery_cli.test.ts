import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

const CREATE_INSERT = [
  'create',
  'inserted',
  '--onto',
  'base',
  '--insert',
  '-m',
  'inserted work',
] as const;

function prepareConflict(
  fixture: CreateCliFixture,
  conflictOnTail = false
): {
  readonly parent: string;
  readonly source: string;
  readonly conflicting: string;
  readonly child: string;
  readonly tip: string;
} {
  const parent = fixture.git(['rev-parse', 'base']);
  const source = fixture.git(['rev-parse', 'other']);
  const child = fixture.git(['rev-parse', 'child']);
  const tip = fixture.git(['rev-parse', 'tip']);
  fixture.branch('conflicting', 'tip');
  fixture.stage('main.txt', 'conflicting shared work');
  fixture.git(['commit', '-m', 'conflicting shared work']);
  const conflicting = fixture.git(['rev-parse', 'conflicting']);
  fixture.branch('tail', 'conflicting');
  if (conflictOnTail) {
    fixture.stage('main.txt', 'tail shared work');
    fixture.git(['commit', '-m', 'tail shared work']);
  }
  fixture.git(['switch', 'other']);
  fixture.stage('main.txt', 'inserted shared work');
  return { parent, source, conflicting, child, tip };
}

function expectActiveConflict(fixture: CreateCliFixture): void {
  expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
    'main.txt'
  );
  expect(fixture.git(['rev-parse', '--verify', 'REBASE_HEAD'])).to.have.length(
    40
  );
}

function expectCompletedPrefix(fixture: CreateCliFixture): void {
  for (const branch of ['child', 'tip']) {
    fixture.git(['merge-base', '--is-ancestor', 'inserted', branch]);
  }
}

function expectNoRebase(fixture: CreateCliFixture): void {
  for (const state of ['rebase-merge', 'rebase-apply']) {
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', state])
        )
      )
    ).to.equal(false);
  }
  expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal('');
}

function stableRefs(fixture: CreateCliFixture): string {
  return fixture
    .refs()
    .split('\n')
    .filter(
      (line) =>
        !['child', 'tip', 'conflicting', 'tail', 'inserted'].some((branch) =>
          line.startsWith(`refs/heads/${branch} `)
        )
    )
    .join('\n');
}

function expectParent(
  fixture: CreateCliFixture,
  child: string,
  parent: string
): void {
  fixture.ok(['checkout', child]);
  fixture.ok(['down']);
  expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
}

// eslint-disable-next-line max-lines-per-function
describe('create --onto insert recovery through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('reports the created commit, completed restacks and retained progress at a real conflict', () => {
    const before = prepareConflict(fixture);
    const result = fixture.run(CREATE_INSERT);
    const output = result.stdout + result.stderr;
    const inserted = fixture.git(['rev-parse', 'inserted']);

    expect(result.status).not.to.equal(0);
    expectActiveConflict(fixture);
    expectCompletedPrefix(fixture);
    expect(fixture.git(['rev-parse', 'REBASE_HEAD'])).to.equal(
      before.conflicting
    );
    expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(before.parent);
    expect(fixture.git(['show', 'inserted:main.txt'])).to.equal(
      'inserted shared work'
    );
    expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    for (const branch of ['child', 'tip']) {
      fixture.git(['merge-base', '--is-ancestor', 'inserted', branch]);
      expect(output).to.match(new RegExp(`Restacked ${branch} on`));
    }
    expect(fixture.git(['rev-parse', 'other'])).to.equal(before.source);
    expect(output).to.match(/created branch inserted/i);
    expect(output).to.include(inserted.slice(0, 7));
    expect(output).to.match(/conflict restacking conflicting on tip/i);
    expect(output)
      .to.match(/resolve/i)
      .and.match(/add/)
      .and.match(/ch continue/);
    expect(output).to.match(/ch rebase --abort/);
    expect(output).to.match(/abort[^\n]*(keeps|retains|preserves)/i);
    expect(output).to.match(/parent[^\n]*completed restacks/i);
  });

  it('continues the remaining branches after inspection and returns to the new branch', () => {
    const before = prepareConflict(fixture);
    const stable = stableRefs(fixture);
    expect(fixture.run(CREATE_INSERT).status).not.to.equal(0);
    expectActiveConflict(fixture);
    expectCompletedPrefix(fixture);
    const inserted = fixture.git(['rev-parse', 'inserted']);
    const completedChild = fixture.git(['rev-parse', 'child']);
    const completedTip = fixture.git(['rev-parse', 'tip']);
    const pendingTail = fixture.git(['rev-parse', 'tail']);
    expect(fixture.ok(['log', 'short'])).to.include('conflicting');
    fixture.stage('main.txt', 'resolved shared work');
    fixture.ok(['log', 'short']);

    const output = fixture.ok(['continue']);

    expect(output).to.match(/Resolved rebase conflict for conflicting/);
    expect(output).to.match(/Restacked tail on conflicting/);
    expectNoRebase(fixture);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completedChild);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(completedTip);
    expect(fixture.git(['rev-parse', 'tail'])).not.to.equal(pendingTail);
    for (const branch of ['conflicting', 'tail']) {
      fixture.git(['merge-base', '--is-ancestor', 'inserted', branch]);
      expect(fixture.git(['show', `${branch}:main.txt`])).to.equal(
        'resolved shared work'
      );
    }
    expect(fixture.git(['show', 'tail:tail.txt'])).to.equal('tail');
    expect(fixture.git(['show', 'tail:conflicting.txt'])).to.equal(
      'conflicting'
    );
    expect(
      fixture.git(['log', '--format=%s', 'inserted..tail']).split('\n')
    ).to.deep.equal([
      'tail',
      'conflicting shared work',
      'conflicting',
      'tip',
      'child',
    ]);
    expect(fixture.git(['reflog', 'show', '--format=%H', 'child'])).to.include(
      before.child
    );
    expect(fixture.git(['reflog', 'show', '--format=%H', 'tip'])).to.include(
      before.tip
    );
    expect(stableRefs(fixture)).to.equal(stable);
    expectParent(fixture, 'tail', 'conflicting');
    expectParent(fixture, 'conflicting', 'tip');
    expectParent(fixture, 'inserted', 'base');
    fixture.ok(['checkout', 'inserted']);
    const topology = fixture.ok(['log', 'short']);
    const snapshot = fixture.snapshot();
    const noOperation = fixture.run(['continue']);
    expect(noOperation.status).not.to.equal(0);
    expect(noOperation.stdout + noOperation.stderr).to.match(
      /no Charcoal operation to continue/i
    );
    expect(fixture.snapshot()).to.deep.equal(snapshot);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
  });

  it('survives two successive conflict continuations with inspection and no duplicated commits', () => {
    prepareConflict(fixture, true);
    const stable = stableRefs(fixture);
    const tailBefore = fixture.git(['rev-parse', 'tail']);
    expect(fixture.run(CREATE_INSERT).status).not.to.equal(0);
    expectActiveConflict(fixture);
    expectCompletedPrefix(fixture);
    const inserted = fixture.git(['rev-parse', 'inserted']);
    const completedChild = fixture.git(['rev-parse', 'child']);
    const completedTip = fixture.git(['rev-parse', 'tip']);
    fixture.stage('main.txt', 'first resolution');
    fixture.ok(['log', 'short']);

    const secondConflict = fixture.run(['continue']);
    const output = secondConflict.stdout + secondConflict.stderr;

    expect(secondConflict.status).not.to.equal(0);
    expectActiveConflict(fixture);
    expectCompletedPrefix(fixture);
    expect(fixture.git(['rev-parse', 'REBASE_HEAD'])).to.equal(tailBefore);
    expect(fixture.git(['show', 'conflicting:main.txt'])).to.equal(
      'first resolution'
    );
    expect(output).to.match(/Resolved rebase conflict for conflicting/);
    expect(output).to.match(/conflict restacking tail on conflicting/i);
    expect(output).to.match(/abort[^\n]*only[^\n]*active rebase/i);
    expect(fixture.ok(['log', 'short'])).to.include('tail');
    fixture.stage('main.txt', 'second resolution');
    fixture.ok(['log', 'short']);

    fixture.ok(['continue']);

    expectNoRebase(fixture);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completedChild);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(completedTip);
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'second resolution'
    );
    expect(fixture.git(['show', 'tail:tail.txt'])).to.equal('tail');
    expect(fixture.git(['show', 'tail:conflicting.txt'])).to.equal(
      'conflicting'
    );
    expect(
      fixture.git(['log', '--format=%s', 'inserted..tail']).split('\n')
    ).to.deep.equal([
      'tail shared work',
      'tail',
      'conflicting shared work',
      'conflicting',
      'tip',
      'child',
    ]);
    expect(fixture.git(['rev-list', '--count', 'inserted^..tail'])).to.equal(
      '7'
    );
    expect(stableRefs(fixture)).to.equal(stable);
    expectParent(fixture, 'tail', 'conflicting');
    expectParent(fixture, 'conflicting', 'tip');
    expectParent(fixture, 'child', 'inserted');
    expectParent(fixture, 'tip', 'child');
    fixture.ok(['checkout', 'inserted']);
  });

  it('aborts only the active rebase and can retry the retained insertion', () => {
    const before = prepareConflict(fixture);
    const stable = stableRefs(fixture);
    expect(fixture.run(CREATE_INSERT).status).not.to.equal(0);
    expectActiveConflict(fixture);
    expectCompletedPrefix(fixture);
    const inserted = fixture.git(['rev-parse', 'inserted']);
    const completedChild = fixture.git(['rev-parse', 'child']);
    const completedTip = fixture.git(['rev-parse', 'tip']);
    const pendingTail = fixture.git(['rev-parse', 'tail']);
    expect(completedChild).not.to.equal(before.child);
    expect(completedTip).not.to.equal(before.tip);

    const [executable, ...args] = getTestCliCommand(['rebase', '--abort']);
    const aborted = spawnSync(executable, args, {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (aborted.error) throw aborted.error;
    expect(aborted.status, aborted.stdout + aborted.stderr).to.equal(0);

    expectNoRebase(fixture);
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
    expect(fixture.git(['show', 'inserted:main.txt'])).to.equal(
      'inserted shared work'
    );
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completedChild);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(completedTip);
    expect(fixture.git(['rev-parse', 'conflicting'])).to.equal(
      before.conflicting
    );
    expect(fixture.git(['show', 'conflicting:main.txt'])).to.equal(
      'conflicting shared work'
    );
    expect(fixture.git(['rev-parse', 'tail'])).to.equal(pendingTail);
    expect(stableRefs(fixture)).to.equal(stable);
    const log = fixture.ok(['log', 'short']);
    expect(log).to.match(/conflicting[^\n]*needs restack/);
    expect(log).not.to.match(/untracked|invalid|cycle/i);
    expectParent(fixture, 'conflicting', 'tip');
    expectParent(fixture, 'tail', 'conflicting');
    expectParent(fixture, 'child', 'inserted');
    expectParent(fixture, 'tip', 'child');
    fixture.ok(['checkout', 'inserted']);
    const topology = fixture.ok(['log', 'short']);
    const snapshot = fixture.snapshot();
    const noOperation = fixture.run(['continue']);
    expect(noOperation.status).not.to.equal(0);
    expect(noOperation.stdout + noOperation.stderr).to.match(
      /no Charcoal operation to continue/i
    );
    expect(fixture.snapshot()).to.deep.equal(snapshot);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);

    const retried = fixture.run(['restack', '--upstack']);
    expect(retried.status).not.to.equal(0);
    expectActiveConflict(fixture);
    expectCompletedPrefix(fixture);
    fixture.stage('main.txt', 'resolved after abort');
    fixture.ok(['log', 'short']);
    fixture.ok(['continue']);

    expectNoRebase(fixture);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completedChild);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(completedTip);
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'resolved after abort'
    );
    expect(fixture.git(['show', 'tail:tail.txt'])).to.equal('tail');
    expect(fixture.git(['show', 'tail:conflicting.txt'])).to.equal(
      'conflicting'
    );
    expect(
      fixture.git(['log', '--format=%s', 'inserted..tail']).split('\n')
    ).to.deep.equal([
      'tail',
      'conflicting shared work',
      'conflicting',
      'tip',
      'child',
    ]);
    expect(stableRefs(fixture)).to.equal(stable);
    expect(fixture.ok(['log', 'short'])).not.to.include('needs restack');
  });

  for (const selection of [
    { ignored: true, all: false },
    { ignored: true, all: true },
    { ignored: false, all: true },
  ]) {
    it(`retains late hook ${
      selection.ignored ? 'ignored' : 'untracked'
    } work with all ${selection.all}`, () => {
      fixture.git(['switch', 'other']);
      fixture.stage('inserted.txt', 'selected work');
      const child = fixture.git(['rev-parse', 'child']);
      const tip = fixture.git(['rev-parse', 'tip']);
      const stable = stableRefs(fixture);
      if (selection.ignored)
        fs.appendFileSync(
          path.join(fixture.repo, '.git/info/exclude'),
          '\nchild.txt\n'
        );
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/pre-commit'),
        "#!/bin/sh\nprintf 'late hook work' > child.txt\nexit 0\n",
        { mode: 0o755 }
      );

      const result = fixture.run([
        ...CREATE_INSERT,
        ...(selection.all ? ['--all'] : []),
      ]);

      expect(
        fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
      ).to.equal('late hook work');
      expect(result.status).not.to.equal(0);
      expectNoRebase(fixture);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fixture.git(['show', 'inserted:inserted.txt'])).to.equal(
        'selected work'
      );
      expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
      expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
      expect(stableRefs(fixture)).to.equal(stable);
      const output = result.stdout + result.stderr;
      expect(output).to.match(/insertion is incomplete/i);
      expect(output).to.match(/parent relationships remain/i);
      expect(output).to.match(/ch restack --upstack/);
      expect(output).not.to.include('ch continue');
      expect(fixture.ok(['log', 'short'])).to.match(/child[^\n]*needs restack/);
      const saved = path.join(fixture.root, 'retained-hook-work.txt');
      fs.renameSync(path.join(fixture.repo, 'child.txt'), saved);

      fixture.ok(['restack', '--upstack']);

      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fs.readFileSync(saved, 'utf8')).to.equal('late hook work');
      expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
      expect(fixture.git(['show', 'tip:inserted.txt'])).to.equal(
        'selected work'
      );
      expect(stableRefs(fixture)).to.equal(stable);
      expectParent(fixture, 'child', 'inserted');
    });
  }

  for (const hook of ['pre-commit', 'post-commit'] as const) {
    it(`preserves remaining ${
      hook === 'pre-commit' ? 'unstaged' : 'staged'
    } hook work after all was already selected`, () => {
      fixture.git(['switch', 'other']);
      fixture.stage('inserted.txt', 'selected work');
      const child = fixture.git(['rev-parse', 'child']);
      const tip = fixture.git(['rev-parse', 'tip']);
      const stable = stableRefs(fixture);
      const script =
        hook === 'pre-commit'
          ? "#!/bin/sh\nprintf 'late tracked work' > main.txt\nexit 0\n"
          : "#!/bin/sh\nprintf 'late staged work' > late.txt\ngit add late.txt\nexit 0\n";
      fs.writeFileSync(path.join(fixture.repo, '.git/hooks', hook), script, {
        mode: 0o755,
      });

      const result = fixture.run([...CREATE_INSERT, '--all']);

      expect(result.status).not.to.equal(0);
      expectNoRebase(fixture);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fixture.git(['show', 'inserted:inserted.txt'])).to.equal(
        'selected work'
      );
      expect(fixture.git(['show', 'inserted:main.txt'])).to.equal('main');
      expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
      expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
      expect(stableRefs(fixture)).to.equal(stable);
      if (hook === 'pre-commit') {
        expect(
          fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
        ).to.equal('late tracked work');
        expect(fixture.git(['diff', '--name-only'])).to.equal('main.txt');
        expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
      } else {
        expect(
          fs.readFileSync(path.join(fixture.repo, 'late.txt'), 'utf8')
        ).to.equal('late staged work');
        expect(fixture.git(['diff', '--name-only'])).to.equal('');
        expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal(
          'late.txt'
        );
        expect(
          fixture.git(['ls-tree', '--name-only', 'inserted'])
        ).not.to.include('late.txt');
      }
      const output = result.stdout + result.stderr;
      expect(output).to.match(/remaining tracked changes after commit/i);
      expect(output).to.match(/insertion is incomplete/i);
      expect(output).to.match(/ch restack --upstack/);
      expect(output).not.to.include('ch continue');
      expect(fixture.ok(['log', 'short'])).to.match(/child[^\n]*needs restack/);
    });
  }
});
