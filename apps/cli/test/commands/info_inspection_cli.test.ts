import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { preparePublicPrRemote } from '../lib/fixtures/public_pr';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { readSubmitPrs } from '../lib/fixtures/submit_gh';

// eslint-disable-next-line max-lines-per-function
describe('read-only info inspection', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.env.CH_PAGER = '';
  });
  afterEach(() => fixture?.cleanup());

  function expectPreserved(cwds: ReadonlyArray<string>, label: string): void {
    const before = cwds.map((cwd) => fixture.inspectionSnapshot(cwd));
    const result = fixture.run(['info', '--no-interactive'], cwds[0]);
    const after = cwds.map((cwd) => fixture.inspectionSnapshot(cwd));
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'info-inspection.jsonl'),
        JSON.stringify({
          label,
          result: {
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          before,
          after,
        }) + '\n'
      );
    }
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.match(/^other\s/);
    expect(result.stderr).to.equal('');
    expect(after, label).to.deep.equal(before);
  }

  it('preserves a primary conflict from an attached linked worktree and resumes in fresh processes', () => {
    const resolve = (contents: string): void => {
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
      fixture.git(['add', 'main.txt']);
    };
    fixture.branch('conflict-base', 'main', true);
    resolve('base version');
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    resolve('child version');
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'other']);
    const first = fixture.run(['reorder', '--stack', '--interactive']);
    expect(first.status, first.stdout + first.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expectPreserved([linked, fixture.repo], 'linked inspection at first stop');
    resolve('child version');
    const second = fixture.run(['continue', '--no-interactive']);
    expect(second.status, second.stdout + second.stderr).to.equal(1);
    expect(second.stdout + second.stderr).to.include(
      'Remaining branches: conflict-base'
    );
    expectPreserved([linked, fixture.repo], 'linked inspection at second stop');
    resolve('base version');
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child own\nbase own');
    expect(fixture.git(['show', 'conflict-child:main.txt'])).to.equal(
      'child version'
    );
    expect(fixture.git(['show', 'conflict-base:main.txt'])).to.equal(
      'base version'
    );
    expect(fixture.git(['diff', '--exit-code'])).to.equal('');
    expect(fixture.git(['diff', '--cached', '--exit-code'])).to.equal('');
  });
  it('preserves an opaque damaged cache across info, parent and children', () => {
    const cache = path.resolve(
      fixture.repo,
      fixture.git(['rev-parse', '--git-common-dir']),
      '.graphite_cache_persist'
    );
    const damaged = Buffer.from([0, 255, 123, 13, 10]);
    fs.writeFileSync(cache, damaged);
    const before = fixture.inspectionSnapshot();
    for (const command of ['info', 'parent', 'children']) {
      const result = fixture.run([command, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.inspectionSnapshot(), command).to.deep.equal(before);
      expect(fs.readFileSync(cache), command).to.deep.equal(damaged);
    }
  });

  it('inspects a valid selected branch despite an unrelated tracking cycle without changing opaque state', () => {
    const args = ['info', 'other', '--stat', '--no-interactive'];
    const expected = fixture.run(args);
    expect(expected.status, expected.stderr).to.equal(0);
    // Reuse real opaque tracking created by public init/track; do not invent fields.
    const tracking = fixture.git(['rev-parse', 'refs/branch-metadata/tip']);
    fixture.git(['update-ref', 'refs/branch-metadata/base', tracking]);
    const before = fixture.inspectionSnapshot();
    const actual = fixture.run(args);
    expect(actual.status, actual.stderr).to.equal(0);
    expect(stripAnsi(actual.stdout)).to.match(/^other\s/);
    // Relative commit age may tick between the two subprocesses.
    expect(actual.stdout.split('\n').slice(2)).to.deep.equal(
      expected.stdout.split('\n').slice(2)
    );
    expect(actual.stderr).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps parent and children inspection usable outside a cycle and refuses selected cycles and mutators', () => {
    fixture.branch('other-tip', 'other');
    fixture.git(['switch', 'other']);
    const tracking = fixture.git(['rev-parse', 'refs/branch-metadata/tip']);
    fixture.git(['update-ref', 'refs/branch-metadata/base', tracking]);
    const before = fixture.inspectionSnapshot();
    expect(fixture.ok(['parent'])).to.equal('main\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.ok(['children'])).to.equal('other-tip\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    for (const branch of ['base', 'child', 'tip']) {
      const result = fixture.run([
        'info',
        branch,
        '--stat',
        '--no-interactive',
      ]);
      expect(result.status, branch).to.equal(1);
      expect(result.stdout, branch).to.equal('');
      expect(result.stderr, branch).to.include('ERROR:');
      expect(fixture.inspectionSnapshot(), branch).to.deep.equal(before);
    }
    fixture.git(['switch', 'child']);
    const cyclicBefore = fixture.inspectionSnapshot();
    for (const command of ['info', 'parent', 'children']) {
      const result = fixture.run([command, '--no-interactive']);
      expect(result.status, command).to.equal(1);
      expect(result.stdout, command).to.equal('');
      expect(result.stderr, command).to.include('ERROR:');
      expect(fixture.inspectionSnapshot(), command).to.deep.equal(cyclicBefore);
    }
    const mutation = fixture.run([
      'track',
      'other',
      '--parent',
      'main',
      '--no-interactive',
    ]);
    expect(mutation.status).to.equal(1);
    expect(mutation.stdout + mutation.stderr).to.include(
      'Cycle detected in Charcoal metadata'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(cyclicBefore);
  });

  it('rejects a root trunk before emitting any branch content', () => {
    fixture.git(['switch', 'main']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_persist'),
      Buffer.from([255, 0, 123])
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['info', '--diff', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('previous commit');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('preserves raw dirty state and opaque persistence for every existing content mode', () => {
    const stable = path.join(fixture.repo, 'stable.txt');
    fs.writeFileSync(stable, 'stable');
    fixture.git(['add', 'stable.txt']);
    fixture.git(['commit', '-m', 'stable own']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged');
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged');
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.bin'),
      Buffer.from([0, 255, 13])
    );
    fs.symlinkSync('untracked.bin', path.join(fixture.repo, 'untracked-link'));
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nignored.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored.bin'),
      Buffer.from([255, 0, 10])
    );
    const stat = fs.statSync(stable);
    fs.utimesSync(stable, stat.atime, new Date(stat.mtimeMs + 10000));
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_lock'),
      'external coordination'
    );
    fixture.git(['branch', '-D', 'tip']);
    const cache = path.join(fixture.repo, '.git', '.graphite_cache_persist');
    // Public tracking now persists a real cache; this scenario deliberately tests absence.
    fs.rmSync(cache, { force: true });
    const before = fixture.inspectionSnapshot();
    expect(fs.existsSync(cache)).to.equal(false);
    for (const flags of [
      [],
      ['--patch'],
      ['--diff'],
      ['--body'],
      ['--patch', '--body'],
      ['--diff', '--body'],
      ['--patch', '--diff', '--body'],
    ]) {
      const result = fixture.run(['info', ...flags, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^base\s/)
        .and.include('Parent: main');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot(), flags.join(' ')).to.deep.equal(
        before
      );
      expect(fs.existsSync(cache)).to.equal(false);
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('refuses an uninitialized repository without onboarding or configuration writes', () => {
    const repo = path.join(fixture.root, 'uninitialized');
    fs.mkdirSync(repo);
    fixture.git(['init', '--initial-branch=main'], repo);
    fixture.git(['config', 'user.name', 'Info fixture'], repo);
    fixture.git(['config', 'user.email', 'info@example.test'], repo);
    fixture.git(
      [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        'uninitialized',
      ],
      repo
    );
    const before = fixture.inspectionSnapshot(repo);
    const result = fixture.run(['info', '--no-interactive'], repo);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('initialized repository');
    expect(fixture.inspectionSnapshot(repo)).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('refuses an ordinary detached HEAD without choosing an identity or repairing state', () => {
    fixture.git(['checkout', '--detach']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['info', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('without a branch checked out');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('rejects untracked and missing-parent subjects with empty stdout before paging', () => {
    for (const branch of ['untracked', 'child']) {
      if (branch === 'untracked') fixture.git(['switch', '-c', branch, 'main']);
      else {
        fixture.git(['switch', 'child']);
        fixture.git(['branch', '-D', 'base']);
      }
      const before = fixture.inspectionSnapshot();
      fixture.env.CH_PAGER = path.join(fixture.root, 'sentinel-bin', 'pager');
      const result = fixture.run(['info', '--diff', '--no-interactive']);
      expect(result.status, branch).to.equal(1);
      expect(result.stdout, branch).to.equal('');
      expect(result.stderr, branch).not.to.equal('');
      expect(fixture.inspectionSnapshot(), branch).to.deep.equal(before);
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    }
  });

  it('keeps the actual attached subject and stale context after a real raw abort', () => {
    fixture.branch('conflict-base', 'main', true);
    const file = path.join(fixture.repo, 'main.txt');
    const commit = (contents: string): void => {
      fs.writeFileSync(file, contents);
      fixture.git(['add', 'main.txt']);
      fixture.git(['commit', '-m', contents]);
    };
    commit('base own');
    fixture.branch('conflict-child', 'conflict-base', true);
    commit('child own');
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
    expect(
      fixture.run(['reorder', '--stack', '--interactive']).status
    ).to.equal(1);
    fixture.git(['rebase', '--abort']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'conflict-child'
    );
    const continuation = path.join(fixture.repo, '.git', '.gtcontinue');
    expect(fs.existsSync(continuation)).to.equal(true);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['info', '--no-interactive']);
    expect(result.status, result.stderr).to.equal(0);
    expect(stripAnsi(result.stdout)).to.match(/^conflict-child\s/);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const recovery = fixture.run(['continue', '--no-interactive']);
    expect(recovery.status).to.equal(1);
    expect(recovery.stdout + recovery.stderr).to.include(
      'No Charcoal operation to continue.'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'conflict-child'
    );
  });

  it('keeps normal trunk and standard merge-log ranges against independent Git output', () => {
    fixture.git(['switch', 'main']);
    fixture.commit('trunk-next');
    const before = fixture.inspectionSnapshot();
    const output = stripAnsi(fixture.ok(['info', '--patch']));
    expect(output).to.include(
      fixture.git(['log', '-1', '--format=%H', 'main'])
    );
    expect(output).to.include('trunk-next').and.include('+trunk-next');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['merge', '--no-ff', 'other', '-m', 'trunk merge']);
    const mergeBefore = fixture.inspectionSnapshot();
    const expected = fixture
      .git(['log', '--format=%H', 'main~..main'])
      .split('\n');
    expect(expected.length).to.equal(2);
    const merged = stripAnsi(fixture.ok(['info', '--patch', '--diff']));
    for (const sha of expected) expect(merged).to.include(sha);
    expect(merged).to.include(fixture.git(['diff', 'main~', 'main']));
    expect(fixture.inspectionSnapshot()).to.deep.equal(mergeBefore);
  });

  it('prints help outside Git and sends parser errors and debug only to stderr', () => {
    const help = fixture.run(['info', '--help'], fixture.root);
    expect(help.status, help.stderr).to.equal(0);
    expect(help.stdout)
      .to.include('info')
      .and.include('--patch')
      .and.include('--diff')
      .and.include('--body');
    const before = fixture.inspectionSnapshot();
    fixture.env.CH_PAGER = path.join(fixture.root, 'sentinel-bin', 'pager');
    const invalid = fixture.run(['info', '--unexpected-info-option']);
    expect(invalid.status).to.equal(1);
    expect(invalid.stdout).to.equal('');
    expect(invalid.stderr).not.to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.env.CH_PAGER = '';
    const debug = fixture.run(['info', '--debug', '--no-interactive']);
    expect(debug.status, debug.stderr).to.equal(0);
    expect(stripAnsi(debug.stdout)).to.match(/^base\s/);
    expect(debug.stdout).not.to.include('Reading cache');
    expect(debug.stderr).to.include('Reading cache');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('renders locally known PR body in all existing modes without service, editor or hook activity', () => {
    const { state, calls, refuseQueries } = preparePublicPrRemote(fixture);
    fixture.ok(['submit', '--publish']);
    fs.writeFileSync(
      state,
      JSON.stringify(
        readSubmitPrs(state).map((pr) => ({
          ...pr,
          title: 'Known local title',
          body: 'Known local body',
        }))
      )
    );
    fixture.ok(['sync', '--no-pull', '--no-delete', '--no-restack']);
    refuseQueries();
    for (const hook of ['post-checkout', 'post-rewrite', 'pre-commit']) {
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'hooks', hook),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          path.join(fixture.root, 'unexpected-tool')
        )},'hook');`,
        { mode: 0o755 }
      );
    }
    const before = fixture.inspectionSnapshot();
    const prs = fs.readFileSync(state);
    for (const flags of [
      ['--body'],
      ['--body', '--patch'],
      ['--body', '--diff'],
      ['--body', '--patch', '--diff'],
    ]) {
      const result = fixture.run(['info', ...flags, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.include('PR #1')
        .and.include('Known local title')
        .and.include('Known local body');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(fs.readFileSync(calls, 'utf8')).to.equal('');
    expect(fs.readFileSync(state)).to.deep.equal(prs);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
  it('keeps ordinary mutator cache cleanup separate from inspection', () => {
    const cache = path.join(fixture.repo, '.git', '.graphite_cache_persist');
    const damaged = Buffer.from([0, 255, 123, 13, 10]);
    fs.writeFileSync(cache, damaged);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['info', '--no-interactive']);
    expect(result.status, result.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.editor();
    fixture.edit(['reorder', '--stack']);
    expect(fs.existsSync(cache)).to.equal(false);
    expect(fixture.ok(['parent'])).to.equal('main\n');
  });
});
