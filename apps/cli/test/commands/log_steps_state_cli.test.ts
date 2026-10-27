import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import {
  getFullLogNodes,
  getShortLogNodes,
  LogStepsCliFixture,
} from '../lib/fixtures/log_steps_cli';

// eslint-disable-next-line max-lines-per-function
describe('zero-depth log state preservation through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  beforeEach(function () {
    fixture = new LogStepsCliFixture('branched');
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'state-log-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          fixture: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture.cleanup());

  function inspectCurrentOnly(
    branch: string,
    status?: string,
    parent?: string
  ): void {
    const before = fixture.logSnapshot();
    expect(fixture.git(['branch', '--show-current'])).to.equal(branch);
    const commits = fixture
      .git([
        'log',
        '--format=%h%n%s',
        ...(parent ? [`${parent}..${branch}`] : ['-1', branch]),
      ])
      .split('\n')
      .filter(Boolean);
    for (const route of [['log'], ['log', 'short']]) {
      const result = fixture.run([
        ...route,
        '--steps',
        '0',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      const nodes = route.length === 1 ? getFullLogNodes : getShortLogNodes;
      expect(nodes(result.stdout)).to.deep.equal([branch]);
      expect(result.stdout).to.include(
        route.length === 1 ? `${branch} (current)` : branch
      );
      if (route.length !== 1)
        expect(result.stdout.match(/^◉/gm)).to.have.length(1);
      else
        for (const commit of commits) expect(result.stdout).to.include(commit);
      if (status) expect(result.stdout).to.include(status);
      expect(result.stderr).to.equal('');
      expect(fixture.logSnapshot()).to.deep.equal(before);
    }
  }

  it('shows only the checked-out trunk without changing the graph', () => {
    fixture.git(['switch', 'main']);
    inspectCurrentOnly('main');
  });

  it('keeps an empty branch identity even when it shares its parent commit', () => {
    fixture.git(['switch', 'empty-tip']);
    expect(fixture.git(['rev-parse', 'empty-tip'])).to.equal(
      fixture.git(['rev-parse', 'ui'])
    );
    expect(fixture.ok(['parent'])).to.equal('ui\n');
    inspectCurrentOnly('empty-tip', undefined, 'ui');
    expect(fixture.ok(['parent'])).to.equal('ui\n');
  });

  it('retains a long Unicode branch name and its own commits', () => {
    const name = 'feature/café-long-branch-name-for-terminal-width';
    fixture.git(['switch', name]);
    expect(fixture.ok(['parent'])).to.equal('search\n');
    inspectCurrentOnly(name, undefined, 'search');
    expect(fixture.ok(['parent'])).to.equal('search\n');
  });

  it('shows a stale child without restacking it or changing its stored parent', () => {
    fixture.git(['switch', 'api-followup']);
    expect(fixture.git(['merge-base', 'api', 'api-followup'])).not.to.equal(
      fixture.git(['rev-parse', 'api'])
    );
    expect(fixture.ok(['parent'])).to.equal('api\n');
    expect(fixture.ok(['info'])).to.include('(needs restack)');
    inspectCurrentOnly('api-followup', '(needs restack)', 'api');
    expect(fixture.ok(['parent'])).to.equal('api\n');
    expect(fixture.ok(['info'])).to.include('(needs restack)');
  });

  it('shows frozen status without thawing the branch or its frozen ancestors', () => {
    fixture.ok(['freeze', 'search']);
    expect(fixture.ok(['parent'])).to.equal('base\n');
    for (const branch of ['search', 'base'])
      expect(fixture.ok(['info', '--branch', branch])).to.include('(frozen)');
    inspectCurrentOnly('search', '(frozen)', 'base');
    expect(fixture.ok(['parent'])).to.equal('base\n');
    for (const branch of ['search', 'base'])
      expect(fixture.ok(['info', '--branch', branch])).to.include('(frozen)');
  });

  function inspectRefusal(message: RegExp): void {
    const before = fixture.logSnapshot();
    for (const route of [['log'], ['log', 'short']]) {
      for (const quiet of [[], ['--quiet']]) {
        const result = fixture.run([
          ...route,
          '--steps',
          '0',
          '--no-interactive',
          ...quiet,
        ]);
        expect(result.status, result.stdout + result.stderr).not.to.equal(0);
        expect(result.stderr).to.match(message);
        expect(result.stdout).to.equal('');
        expect(fixture.logSnapshot()).to.deep.equal(before);
      }
    }
  }

  it('refuses an untracked current branch and retains diagnostics under quiet', () => {
    fixture.git(['switch', 'scratch']);
    inspectRefusal(/untracked branch scratch/);
  });

  it('refuses detached HEAD and retains diagnostics under quiet', () => {
    fixture.git(['switch', '--detach', 'search']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    inspectRefusal(/without a branch checked out/);
  });

  function dirtyWork(selected: LogStepsCliFixture, cwd = selected.repo): void {
    fs.writeFileSync(path.join(cwd, 'main.txt'), 'staged local content\n');
    selected.git(['add', 'main.txt'], cwd);
    fs.writeFileSync(path.join(cwd, 'main.txt'), 'unstaged local content\n');
    fs.writeFileSync(
      path.join(cwd, 'untracked.bin'),
      Buffer.from([0, 255, 13])
    );
    fs.symlinkSync('untracked.bin', path.join(cwd, 'untracked-link'));
    const common = path.resolve(
      cwd,
      selected.git(['rev-parse', '--git-common-dir'], cwd)
    );
    fs.appendFileSync(path.join(common, 'info', 'exclude'), '\nignored.bin\n');
    fs.writeFileSync(path.join(cwd, 'ignored.bin'), Buffer.from([255, 0, 10]));
    expect(selected.git(['diff', '--cached', '--name-only'], cwd)).to.include(
      'main.txt'
    );
    expect(selected.git(['diff', '--name-only'], cwd)).to.include('main.txt');
  }

  it('preserves staged, unstaged, ignored and untracked local work', () => {
    dirtyWork(fixture);
    expect(fixture.ok(['parent'])).to.equal('base\n');
    inspectCurrentOnly('search', undefined, 'base');
    expect(fixture.ok(['parent'])).to.equal('base\n');
  });

  it('uses the cwd target and preserves dirty caller, target and linked worktree', () => {
    const caller = new LogStepsCliFixture();
    const linked = path.join(fixture.root, 'linked');
    try {
      fixture.git(['worktree', 'add', linked, 'ui']);
      caller.commit('caller-only-change');
      dirtyWork(caller);
      dirtyWork(fixture);
      dirtyWork(fixture, linked);
      expect(fixture.ok(['parent'])).to.equal('base\n');
      expect(fixture.ok(['parent'], linked)).to.equal('search\n');
      const observe = () => [
        caller.logSnapshot(),
        fixture.logSnapshot(),
        fixture.logSnapshot(linked),
      ];
      const before = observe();
      for (const [cwd, branch] of [
        [fixture.repo, 'search'],
        [linked, 'ui'],
      ]) {
        expect(fixture.git(['branch', '--show-current'], cwd)).to.equal(branch);
        const commits = fixture
          .git(['log', '-1', '--format=%h%n%s'], cwd)
          .split('\n');
        for (const route of [['log'], ['log', 'short']]) {
          const result = caller.run([
            '--cwd',
            cwd,
            ...route,
            '--steps',
            '0',
            '--no-interactive',
          ]);
          expect(result.status, result.stdout + result.stderr).to.equal(0);
          const nodes = route.length === 1 ? getFullLogNodes : getShortLogNodes;
          expect(nodes(result.stdout)).to.deep.equal([branch]);
          if (route.length === 1)
            for (const commit of commits)
              expect(result.stdout).to.include(commit);
          else expect(result.stdout.match(/^◉/gm)).to.have.length(1);
          expect(result.stdout).not.to.include('caller-only-change');
          expect(result.stderr).to.equal('');
          expect(observe()).to.deep.equal(before);
        }
      }
      expect(fixture.ok(['parent'])).to.equal('base\n');
      expect(fixture.ok(['parent'], linked)).to.equal('search\n');
    } finally {
      caller.cleanup();
    }
  });

  function prepareConflict(): string {
    fixture.branch('recovery-parent', 'main');
    fixture.branch('recovery-child', 'recovery-parent');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child conflict\n');
    fixture.git(['commit', '-am', 'recovery child conflict']);
    fixture.git(['switch', 'recovery-parent']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'parent conflict\n');
    fixture.git(['commit', '--amend', '-am', 'recovery parent conflict']);
    const conflict = fixture.run(['restack', '--quiet', '--no-interactive']);
    expect(conflict.status, conflict.stdout + conflict.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    const continuation = path.join(
      fixture.repo,
      fixture.git(['rev-parse', '--git-path', '.gtcontinue'])
    );
    expect(fs.existsSync(continuation)).to.equal(true);
    return continuation;
  }

  it('preserves genuine conflict recovery data and leaves continue usable', () => {
    const continuation = prepareConflict();
    const before = fs.readFileSync(continuation).toString('base64');
    inspectRefusal(/without a branch checked out/);
    expect(fs.readFileSync(continuation).toString('base64')).to.equal(before);
    const unresolved = fixture.run(['continue', '--quiet', '--no-interactive']);
    expect(unresolved.status).to.equal(1);
    expect(unresolved.stderr).to.include('not yet resolved');
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'resolved both changes\n'
    );
    fixture.git(['add', 'main.txt']);
    const continued = fixture.run(['continue', '--no-interactive']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'recovery-parent'
    );
    expect(
      fixture.git(['log', '--format=%s', 'main..recovery-child'])
    ).to.include('recovery child conflict');
    expect(fixture.ok(['info', '--branch', 'recovery-child'])).to.include(
      'Parent: recovery-parent'
    );
  });

  it('preserves saved continuation bytes after Git abort restores an attached branch', () => {
    const continuation = prepareConflict();
    fixture.git(['rebase', '--abort']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'recovery-child'
    );
    const before = fs.readFileSync(continuation).toString('base64');
    expect(fixture.ok(['parent'])).to.equal('recovery-parent\n');
    inspectCurrentOnly('recovery-child');
    expect(fs.readFileSync(continuation).toString('base64')).to.equal(before);
    expect(fixture.ok(['parent'])).to.equal('recovery-parent\n');
  });
});
