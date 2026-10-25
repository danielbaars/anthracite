import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

describe('noninteractive route defaults through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.git(['status', '--porcelain=v1']);
  });
  afterEach(() => fixture?.cleanup());

  it('navigates a unique child but refuses ambiguous navigation and stack choices', () => {
    expect(fixture.run(['up']).status).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.run(['down']).status).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    fixture.branch('side', 'base');
    fixture.git(['switch', 'base']);
    const before = fixture.snapshot();
    for (const args of [['up'], ['fold', '--stack'], ['reorder', '--stack']]) {
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).not.to.include('Checkout a branch');
      expect(fixture.snapshot()).to.deep.equal(before);
    }
  });

  it('tracks unique parents but requires an explicit parent for ambiguity', () => {
    fixture.git(['switch', '-c', 'untracked', 'main']);
    fixture.commit('new');
    const tracked = fixture.run(['tr']);
    expect(tracked.status, tracked.stdout + tracked.stderr).to.equal(0);
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
    fixture.git(['branch', 'twin', 'untracked']);
    fixture.ok(['track', 'twin', '--parent', 'main']);
    fixture.git(['switch', '-c', 'ambiguous', 'untracked']);
    fixture.commit('ambiguous');
    const before = fixture.snapshot();
    const denied = fixture.run(['track']);
    expect(denied.status, denied.stdout + denied.stderr).to.equal(1);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.run(['info', 'ambiguous']).status).to.equal(1);
    expect(fixture.run(['track', '--parent', 'untracked']).status).to.equal(0);
    expect(fixture.run(['parent']).stdout).to.equal('untracked\n');
  });

  it('tracks only new downstack ancestors and stops at the existing tracked branch', () => {
    fixture.git(['switch', '-c', 'new-parent', 'child']);
    fixture.commit('new-parent');
    fixture.git(['switch', '-c', 'new-leaf']);
    fixture.commit('new-leaf');
    const refs = fixture.refs();
    const tracked = fixture.run(['track', '--downstack']);
    expect(tracked.status, tracked.stdout + tracked.stderr).to.equal(0);
    expect(fixture.run(['parent']).stdout).to.equal('new-parent\n');
    expect(fixture.run(['info', 'new-parent']).stdout).to.include(
      'Parent: child'
    );
    expect(fixture.run(['info', 'child']).stdout).to.include('Parent: base');
    expect(fixture.run(['info', 'other']).stdout).to.include('Parent: main');
    expect(fixture.refs()).to.equal(refs);
  });

  it('declines untracking children without force and keeps explicit force separate', () => {
    const before = fixture.snapshot();
    const declined = fixture.run(['untrack', 'base']);
    expect(declined.status, declined.stdout + declined.stderr).to.equal(0);
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
    expect(fixture.run(['info', 'child']).stdout).to.include('Parent: base');
    expect(fixture.snapshot()).to.deep.equal(before);
    const forced = fixture.run(['untrack', 'base', '--force']);
    expect(forced.status, forced.stdout + forced.stderr).to.equal(0);
    expect(fixture.run(['info', 'base']).status).to.equal(1);
    expect(fixture.run(['info', 'child']).status).to.equal(1);
    expect(fixture.run(['info', 'other']).status).to.equal(0);
    expect(fixture.refs()).to.equal(before.refs);
  });

  it('refuses split before writes and initializes only with supported trunk input', () => {
    const before = fixture.snapshot();
    for (const args of [['split'], ['split', '--interactive']]) {
      const split = fixture.run(args);
      expect(split.status, split.stdout + split.stderr).to.equal(1);
      expect(fixture.snapshot()).to.deep.equal(before);
    }

    const repo = path.join(fixture.root, 'fresh');
    fs.mkdirSync(repo);
    fixture.git(['init', '--initial-branch=unusual'], repo);
    fixture.git(['config', 'user.name', 'Interaction fixture'], repo);
    fixture.git(['config', 'user.email', 'interaction@example.invalid'], repo);
    fixture.git(['config', 'commit.gpgsign', 'false'], repo);
    for (const name of ['one', 'two']) {
      fs.writeFileSync(path.join(repo, name), name);
      fixture.git(['add', name], repo);
      fixture.git(['commit', '-m', name], repo);
    }
    const refs = fixture.git(['show-ref', '--heads'], repo);
    const missing = fixture.run(['init', '--interactive'], repo);
    expect(missing.status, missing.stdout + missing.stderr).to.equal(1);
    expect(fixture.git(['show-ref', '--heads'], repo)).to.equal(refs);
    const initialized = fixture.run(
      ['repo', 'init', '--trunk', 'unusual', '--interactive'],
      repo
    );
    expect(
      initialized.status,
      initialized.stdout + initialized.stderr
    ).to.equal(0);
    expect(initialized.stdout).not.to.include('onboarding');
    expect(fixture.run(['info'], repo).stdout).to.include('unusual');
    expect(fixture.git(['show-ref', '--heads'], repo)).to.equal(refs);
    const inferred = path.join(fixture.root, 'inferred');
    fixture.git(['clone', repo, inferred]);
    fixture.git(['branch', '-m', 'main'], inferred);
    fixture.git(['remote', 'remove', 'origin'], inferred);
    const automatic = fixture.run(['init', '--interactive'], inferred);
    expect(automatic.status, automatic.stdout + automatic.stderr).to.equal(0);
    expect(fixture.run(['info'], inferred).stdout).to.include('main');
  });
});

// Independent public CLI scenarios share one local remote fixture.
// eslint-disable-next-line max-lines-per-function
describe('noninteractive local remote decisions through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    fixture.env.CH_PAGER = '';
    fixture.branch('parent', 'main');
    fixture.branch('child', 'parent');
    fixture.succeed('submit');
  });
  afterEach(() => fixture?.cleanup());

  function run(args: readonly string[]): {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  } {
    const [command, ...argv] = getTestCliCommand(args);
    const result = spawnSync(command, argv, {
      cwd: fixture.repo,
      env: fixture.env,
      input: Buffer.alloc(0),
      timeout: 20000,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Unexpected signal: ${result.signal}`);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'interaction-remote-cli.jsonl'),
        JSON.stringify({
          command,
          argv,
          cwd: fixture.repo,
          environment: Object.fromEntries(
            [
              'GRAPHITE_INTERACTIVE',
              'GIT_OPTIONAL_LOCKS',
              'HOME',
              'CODEX_HOME',
              'CHARCOAL_TEST_BINARY',
              'BUN_BE_BUN',
              'CH_PAGER',
            ].map((key) => [key, fixture.env[key] ?? null])
          ),
          status: result.status,
          stdoutBase64: result.stdout.toString('base64'),
          stderrBase64: result.stderr.toString('base64'),
        }) + '\n'
      );
    return {
      status: result.status,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
    };
  }

  function producer(branch: string): string {
    const repo = path.join(fixture.root, `producer-${branch}`);
    fixture.git('clone', '--branch', branch, fixture.remote, repo);
    fixture.git('-C', repo, 'config', 'user.name', 'Interaction fixture');
    fixture.git(
      '-C',
      repo,
      'config',
      'user.email',
      'interaction@example.invalid'
    );
    fixture.git('-C', repo, 'config', 'commit.gpgsign', 'false');
    return repo;
  }

  function remoteCommit(repo: string, name: string): string {
    fs.writeFileSync(path.join(repo, name), name);
    fixture.git('-C', repo, 'add', name);
    fixture.git('-C', repo, 'commit', '-m', name);
    fixture.git('-C', repo, 'push', 'origin', 'HEAD');
    return fixture.git('-C', repo, 'rev-parse', 'HEAD');
  }

  it('gets a real fast-forward but preserves divergent local work without force', () => {
    const repo = producer('child');
    const revision = remoteCommit(repo, 'remote-child');
    const fetched = run(['get', 'child']);
    expect(fetched.status, fetched.stdout + fetched.stderr).to.equal(0);
    expect(fixture.git('rev-parse', 'child')).to.equal(revision);
    expect(run(['get', 'child']).status).to.equal(0);
    const local = fixture.commit('local-child');
    const refs = fixture.git(
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads'
    );
    const advanced = remoteCommit(repo, 'remote-divergence');
    const denied = run(['get', 'child', '--quiet']);
    expect(denied.status, denied.stdout + denied.stderr).to.equal(1);
    expect(fixture.git('rev-parse', 'child')).to.equal(local);
    expect(
      fixture.git(
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads'
      )
    ).to.equal(refs);
    expect(fixture.git('rev-parse', 'origin/child')).to.equal(advanced);
    expect(fixture.git('status', '--porcelain')).to.equal('');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'local-child.txt'), 'utf8')
    ).to.equal('local-child');
  });

  it('refuses a non-fast-forward trunk reset unless force was requested', () => {
    const repo = producer('main');
    fixture.git('checkout', 'main');
    const local = fixture.commit('local-main');
    fixture.git('checkout', 'child');
    const advanced = remoteCommit(repo, 'remote-main');
    const denied = run(['sync', '--no-delete']);
    expect(denied.status, denied.stdout + denied.stderr).to.equal(1);
    expect(fixture.git('rev-parse', 'main')).to.equal(local);
    expect(fixture.git('rev-parse', 'origin/main')).to.equal(advanced);
    expect(fixture.git('status', '--porcelain')).to.equal('');
  });
});
