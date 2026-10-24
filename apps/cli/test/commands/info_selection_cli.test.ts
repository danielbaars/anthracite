import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { readSubmitPrs } from '../lib/fixtures/submit_gh';

// eslint-disable-next-line max-lines-per-function
describe('info branch selection through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.env.CH_PAGER = '';
  });
  afterEach(() => {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.cleanup();
  });

  it('selects the same other branch with positional, named, equal selectors and alias without checkout', () => {
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['info', 'child'],
      ['info', '--branch', 'child'],
      ['info', 'child', '--branch', 'child'],
      ['i', 'child'],
      ['info', '--', 'child'],
      ['info', '--branch', 'child', '--', 'child'],
    ]) {
      const result = fixture.run(['--no-interactive', ...args]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^child\s/)
        .and.include('Parent: base');
      expect(stripAnsi(result.stdout)).to.include(
        fixture.git(['rev-parse', 'child'])
      );
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot(), args.join(' ')).to.deep.equal(
        before
      );
    }
  });
  it('rejects ambiguous, empty and unused arguments before content or external tools', () => {
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['child', '--branch', 'other'],
      ['--branch', 'child', '--branch', 'child'],
      ['--branch=child', '--branch=other'],
      ['--branch'],
      ['--branch='],
      ['--branch', ''],
      [''],
      ['child', 'other'],
      ['--', 'child', 'other'],
      ['child', '--', 'other'],
      ['--branch', 'child', '--', 'other'],
      ['--patch=invalid'],
      ['--diff=invalid'],
      ['--body=invalid'],
      ['-p=invalid'],
      ['-pd=invalid'],
      ['--no-patch=invalid'],
      ['--quiet=invalid'],
      ['-q=invalid'],
      ['--interactive=invalid'],
      ['--unknown'],
      ['--branchName', 'child'],
      ['--branch-name=child'],
    ]) {
      const result = fixture.run(['--no-interactive', 'info', ...args]);
      expect(result.status, JSON.stringify(args)).to.equal(1);
      expect(result.stdout, JSON.stringify(args)).to.equal('');
      expect(result.stderr, JSON.stringify(args)).not.to.equal('');
      expect(fixture.inspectionSnapshot(), JSON.stringify(args)).to.deep.equal(
        before
      );
    }
  });

  it('keeps literal branch identity and selected content even with a same-named tag', () => {
    for (const name of [
      'topic/λ#hash',
      '\u2003wide\u2003',
      '$(touch${IFS}info-selector-sentinel)',
      '123',
    ]) {
      fixture.branch(name, 'main');
      const revision = fixture.git(['rev-parse', `refs/heads/${name}`]);
      const expected = fixture.git(['diff', 'main', `refs/heads/${name}`]);
      fixture.git(['switch', 'base']);
      fixture.git(['tag', name, 'base']);
      const before = fixture.inspectionSnapshot();
      for (const args of [
        [name, '--patch'],
        ['--branch', name, '--diff'],
        ['--patch', '--diff', '--', name],
      ]) {
        const result = fixture.run(['--no-interactive', 'info', ...args]);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const output = stripAnsi(result.stdout);
        expect(output.startsWith(`${name} `), name).to.equal(true);
        expect(output).to.include(revision).and.include(expected);
        expect(result.stderr).to.equal('');
        expect(fixture.inspectionSnapshot(), name).to.deep.equal(before);
      }
    }
    expect(
      fs.existsSync(path.join(fixture.repo, 'info-selector-sentinel'))
    ).to.equal(false);
  });

  it('refuses nonlocal, missing and untracked targets without resolving them as Git revisions', () => {
    fixture.git(['tag', 'tag-only', 'child']);
    fixture.git(['update-ref', 'refs/remotes/origin/remote-only', 'child']);
    fixture.git(['branch', 'untracked', 'child']);
    fixture.git(['branch', '-D', 'tip']);
    const before = fixture.inspectionSnapshot();
    for (const name of [
      'missing',
      'tip',
      'tag-only',
      'remote-only',
      'origin/remote-only',
      'refs/heads/child',
      fixture.git(['rev-parse', 'child']),
      'child~',
      'main..child',
      'untracked',
    ]) {
      const result = fixture.run([
        'info',
        '--branch',
        name,
        '--no-interactive',
      ]);
      expect(result.status, name).to.equal(1);
      expect(result.stdout, name).to.equal('');
      expect(result.stderr, name).to.match(
        /(?:branch.*(?:not|exist|track)|(?:not|exist|track).*branch)/i
      );
      expect(fixture.inspectionSnapshot(), name).to.deep.equal(before);
    }
  });

  it('selects an attached other-worktree branch from untracked and detached checkouts while preserving both dirty worktrees', () => {
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    fixture.git(['switch', '-c', 'untracked']);
    fixture.git(['branch', '-D', 'tip']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged');
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged');
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked staged');
    fixture.git(['add', 'child.txt'], linked);
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked unstaged');
    fs.writeFileSync(path.join(linked, 'untracked.bin'), Buffer.from([0, 255]));
    for (const detached of [false, true]) {
      if (detached) fixture.git(['checkout', '--detach']);
      const before = [
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ];
      const result = fixture.run([
        'info',
        'child',
        '--diff',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^child\s/)
        .and.include('Parent: base');
      expect(stripAnsi(result.stdout)).to.include(
        fixture.git(['diff', 'base', 'child'])
      );
      expect(result.stderr).to.equal('');
      expect([
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ]).to.deep.equal(before);
    }
  });

  it('preserves the registered parent range after its live tip advances and keeps empty branch identity', () => {
    const selected = fixture.git(['rev-parse', 'child']);
    const registered = fixture.git(['rev-parse', 'base']);
    const expected = fixture.git(['diff', registered, selected]);
    fixture.commit('parent-advance');
    fixture.branch('empty', 'base', true);
    fixture.git(['switch', 'other']);
    fixture.git(['branch', '-D', 'tip']);
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--patch'], ['--diff'], ['--patch', '--diff']]) {
      const result = fixture.run([
        'info',
        '--branch',
        'child',
        ...flags,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      const output = stripAnsi(result.stdout);
      expect(output)
        .to.match(/^child \(needs restack\)/)
        .and.include(selected)
        .and.not.include('parent-advance');
      if (flags.length) expect(output).to.include(expected);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    const empty = fixture.run([
      'info',
      'empty',
      '--patch',
      '--diff',
      '--no-interactive',
    ]);
    expect(empty.status, empty.stderr).to.equal(0);
    expect(stripAnsi(empty.stdout))
      .to.match(/^empty\s/)
      .and.include('Parent: base')
      .and.not.include('commit ')
      .and.not.include('diff --git');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses missing or unusable selected bases without repairing tracking', () => {
    fixture.git(['switch', 'other']);
    for (const invalidRevision of [true, false]) {
      if (invalidRevision)
        fixture.git(['update-ref', 'refs/heads/child', 'main']);
      else fixture.git(['branch', '-D', 'base']);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'info',
        'child',
        '--diff',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('inspects an explicit target during a raw Git conflict without Charcoal continuation', () => {
    const commit = (contents: string): void => {
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
      fixture.git(['add', 'main.txt']);
      fixture.git(['commit', '-m', contents]);
    };
    fixture.branch('raw-base', 'main', true);
    commit('onto version');
    fixture.branch('raw-child', 'main', true);
    commit('raw version');
    const conflict = fixture.run(['rebase', 'raw-base']);
    expect(conflict.status, conflict.stdout + conflict.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.gtcontinue'))
    ).to.equal(false);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'info',
      '--branch',
      'other',
      '--patch',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(stripAnsi(result.stdout))
      .to.match(/^other\s/)
      .and.include('+other');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['rebase', '--abort']);
  });

  it('lets the explicit subject override own logical departure and preserves fresh continuation', () => {
    const commit = (contents: string): void => {
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
      fixture.git(['add', 'main.txt']);
      fixture.git(['commit', '-m', contents]);
    };
    fixture.branch('conflict-base', 'main', true);
    commit('base version');
    fixture.branch('conflict-child', 'conflict-base', true);
    commit('child version');
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
    const conflict = fixture.run(['reorder', '--stack', '--interactive']);
    expect(conflict.status, conflict.stdout + conflict.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const before = fixture.inspectionSnapshot();
    expect(stripAnsi(fixture.ok(['info']))).to.match(/^conflict-base\s/);
    const selected = fixture.run([
      'info',
      'other',
      '--diff',
      '--no-interactive',
    ]);
    expect(selected.status, selected.stderr).to.equal(0);
    expect(stripAnsi(selected.stdout))
      .to.match(/^other\s/)
      .and.include('+other');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child version');
    fixture.git(['add', 'main.txt']);
    expect(fixture.run(['continue', '--no-interactive']).status).to.equal(1);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base version');
    fixture.git(['add', 'main.txt']);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child version\nbase version');
  });

  it('shows only the selected locally submitted PR identity and body with no query service activity', () => {
    const bin = path.join(fixture.root, 'gh-bin');
    fs.mkdirSync(bin);
    const state = path.join(fixture.root, 'prs.json');
    const calls = path.join(fixture.root, 'gh.jsonl');
    fs.writeFileSync(state, '[]');
    fs.writeFileSync(calls, '');
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!${process.execPath}\n${fs.readFileSync(
        path.join(__dirname, '../lib/fixtures/submit_gh.js'),
        'utf8'
      )}`,
      { mode: 0o755 }
    );
    fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
    fixture.env.CHARCOAL_TEST_GH_STATE = state;
    fixture.env.CHARCOAL_TEST_GH_LOG = calls;
    const remote = path.join(fixture.root, 'remote.git');
    fixture.git(['init', '--bare', remote]);
    fixture.git(['remote', 'add', 'origin', remote]);
    fixture.git(['push', '-u', 'origin', 'main']);
    fixture.ok(['repo', 'owner', '--set', 'fixture']);
    fixture.ok(['repo', 'name', '--set', 'submit']);
    for (const name of ['pr-selected', 'pr-checkout']) {
      fixture.branch(name, 'main');
      fs.mkdirSync(path.join(fixture.repo, '.github'), { recursive: true });
      fs.writeFileSync(
        path.join(fixture.repo, '.github', 'pull_request_template.md'),
        `Body for ${name}`
      );
      fixture.git(['add', '.github/pull_request_template.md']);
      fixture.git(['commit', '-m', `Template for ${name}`]);
      fixture.ok(['submit', '--publish']);
    }
    fs.writeFileSync(
      state,
      JSON.stringify(
        readSubmitPrs(state).map((pr) =>
          pr.headRefName === 'pr-selected'
            ? { ...pr, reviewDecision: 'CHANGES_REQUESTED' }
            : pr
        )
      )
    );
    fixture.ok(['sync', '--no-pull', '--no-delete', '--no-restack']);
    const prs = readSubmitPrs(state);
    const selectedPr = prs.find((pr) => pr.headRefName === 'pr-selected');
    const checkoutPr = prs.find((pr) => pr.headRefName === 'pr-checkout');
    if (!selectedPr || !checkoutPr)
      throw new Error('Both public submissions must create a PR.');
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.copyFileSync(
        calls,
        path.join(evidence, 'selection-pr-setup-gh.jsonl')
      );
      fs.copyFileSync(
        state,
        path.join(evidence, 'selection-pr-external-state.json')
      );
    }
    fs.writeFileSync(calls, '');
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(
        calls
      )}, 'forbidden');process.exitCode=99;`,
      { mode: 0o755 }
    );
    for (const hook of ['post-checkout', 'post-rewrite', 'pre-commit'])
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'hooks', hook),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          path.join(fixture.root, 'unexpected-tool')
        )}, 'hook');`,
        { mode: 0o755 }
      );
    const before = fixture.inspectionSnapshot();
    const remoteBefore = fixture.git(
      ['for-each-ref', '--format=%(refname) %(objectname)'],
      remote
    );
    const prsBefore = fs.readFileSync(state);
    for (const args of [
      ['info', 'pr-selected', '--body'],
      ['info', '--branch', 'pr-selected', '--body', '--patch'],
      ['i', 'pr-selected', '--body', '--diff'],
      ['info', '--branch', 'pr-selected', '--body', '--patch', '--diff'],
    ].flatMap((args) => [args, [...args, '--stat']])) {
      const result = fixture.run([...args, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^pr-selected\s/)
        .and.include(`PR #${selectedPr.number}`)
        .and.include(selectedPr.title)
        .and.include(selectedPr.url)
        .and.include('(Changes Requested)')
        .and.include('Body for pr-selected')
        .and.not.include('Body for pr-checkout')
        .and.not.include(`PR #${checkoutPr.number}`);
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    const attached = stripAnsi(fixture.ok(['info', '--body']));
    expect(attached)
      .to.match(/^pr-checkout\s/)
      .and.include('Body for pr-checkout')
      .and.not.include('Body for pr-selected');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(state)).to.deep.equal(prsBefore);
    expect(
      fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'], remote)
    ).to.equal(remoteBefore);
    expect(fs.readFileSync(calls, 'utf8')).to.equal('');
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
  it('keeps implicit selection and bare terminator while explicit trunk preserves ordinary and merge ranges', () => {
    const before = fixture.inspectionSnapshot();
    const implicit = stripAnsi(fixture.ok(['info']));
    const bare = fixture.run(['info', '--no-interactive', '--']);
    expect(bare.status, bare.stderr).to.equal(0);
    expect(implicit).to.match(/^base\s/);
    expect(stripAnsi(bare.stdout))
      .to.match(/^base\s/)
      .and.include(fixture.git(['rev-parse', 'base']));
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const root = fixture.run(['info', 'main', '--diff', '--no-interactive']);
    expect(root.status).to.equal(1);
    expect(root.stdout).to.equal('');
    expect(root.stderr).to.include('previous commit');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['switch', 'main']);
    fixture.commit('trunk-next');
    fixture.git(['switch', 'base']);
    for (const merged of [false, true]) {
      if (merged) {
        fixture.git(['switch', 'main']);
        fixture.git(['merge', '--no-ff', 'other', '-m', 'trunk merge']);
        fixture.git(['switch', 'base']);
      }
      const snapshot = fixture.inspectionSnapshot();
      const expected = fixture
        .git(['log', '--format=%H', 'main~..main'])
        .split('\n');
      expect(expected.length).to.equal(merged ? 2 : 1);
      const result = fixture.run([
        'info',
        '--branch',
        'main',
        '--patch',
        '--diff',
        '--no-interactive',
      ]);
      expect(result.status, result.stderr).to.equal(0);
      const output = stripAnsi(result.stdout);
      expect(output)
        .to.match(/^main\s/)
        .and.include(fixture.git(['diff', 'main~', 'main']));
      for (const revision of expected) expect(output).to.include(revision);
      expect(fixture.inspectionSnapshot()).to.deep.equal(snapshot);
    }
  });
  it('documents selection outside Git and accepts explicitly disabled content flags', () => {
    const help = fixture.run(['info', '--help'], fixture.root);
    expect(help.status, help.stderr).to.equal(0);
    expect(help.stdout).to.include('info [branchName]').and.include('--branch');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'info',
      'child',
      '--patch=false',
      '--diff=false',
      '--body=false',
      '--no-interactive',
    ]);
    expect(result.status, result.stderr).to.equal(0);
    expect(stripAnsi(result.stdout))
      .to.match(/^child\s/)
      .and.include(fixture.git(['rev-parse', 'child']))
      .and.not.include('diff --git');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
