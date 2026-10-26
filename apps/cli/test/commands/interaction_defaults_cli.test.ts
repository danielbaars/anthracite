import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
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
    const up = fixture.run(['up']);
    expect(up.status).to.equal(0);
    expect(up.stdout).to.equal('base\n⮑  child\nChecked out child.\n');
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    const down = fixture.run(['down']);
    expect(down.status).to.equal(0);
    expect(down.stdout).to.equal('child\n⮑  base\nChecked out base.\n');
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    fixture.branch('side', 'base');
    fixture.git(['switch', 'base']);
    const before = fixture.snapshot();
    for (const args of [['up'], ['fold', '--stack'], ['reorder', '--stack']]) {
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      if (args[0] === 'up')
        expect(result.stderr).to.include('multiple choices');
      expect(fixture.snapshot()).to.deep.equal(before);
    }
  });

  it('refuses top after a deterministic prefix without printing a partial path or changing staged work', () => {
    fixture.branch('side', 'child');
    fixture.git(['switch', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged base');
    fixture.git(['add', 'base.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'base.txt'), '\nworking base');
    fixture.git(['status', '--porcelain']);
    const before = fixture.inspectionSnapshot();
    const refused = fixture.run(['top']);
    expect(refused.status).to.equal(1);
    expect(refused.stdout).to.equal('');
    expect(refused.stderr).to.include('multiple choices').and.include('side');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
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

  it('keeps ordinary enabled tips but rejects an unrelated explicit parent with empty stdout and stderr advice', () => {
    fixture.ok(['user', 'tips', '--enable']);
    const ordinary = fixture.run(['untrack', 'base']);
    expect(ordinary.status).to.equal(0);
    expect(ordinary.stdout)
      .to.include('tip:')
      .and.include('an move --source <child> --onto <new-parent>');
    expect(ordinary.stderr).to.equal('');
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--quiet']]) {
      const refused = fixture.run([
        'track',
        'base',
        '--parent',
        'other',
        ...flags,
      ]);
      expect(refused.status).to.equal(1);
      expect(refused.stdout).to.equal('');
      expect(refused.stderr)
        .to.include('not in the history')
        .and.include('git rebase other base');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('rejects modify commit with only an untracked file and enabled tips before staging or hooks with empty stdout', () => {
    fixture.ok(['user', 'tips', '--enable']);
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked-only.txt'),
      'untracked work'
    );
    const hook = path.join(fixture.root, 'unexpected-commit-hook');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        hook
      )}, 'invoked');`,
      { mode: 0o755 }
    );
    fixture.git(['status', '--porcelain']);
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--quiet']]) {
      const refused = fixture.run([
        'modify',
        '--commit',
        '--message',
        'literal',
        '--no-interactive',
        ...flags,
      ]);
      expect(refused.status).to.equal(1);
      expect(refused.stdout).to.equal('');
      expect(refused.stderr)
        .to.include('Cannot run without staged changes')
        .and.include('--all');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(fs.existsSync(hook)).to.equal(false);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
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
    fixture.git(['status', '--porcelain'], repo);
    const state = (): Record<string, unknown> => {
      const snapshot = {
        ...fixture.snapshot(repo),
        refs: fixture.git(
          ['for-each-ref', '--format=%(refname) %(objectname)'],
          repo
        ),
        config: fs.existsSync(path.join(repo, '.git', '.graphite_repo_config'))
          ? fs
              .readFileSync(path.join(repo, '.git', '.graphite_repo_config'))
              .toString('base64')
          : null,
      };
      const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
      if (evidence)
        fs.appendFileSync(
          path.join(evidence, 'init-states.jsonl'),
          JSON.stringify({ cwd: repo, snapshot }) + '\n'
        );
      return snapshot;
    };
    const beforeInit = state();
    const missing = fixture.run(['init', '--interactive'], repo);
    expect(missing.status, missing.stdout + missing.stderr).to.equal(1);
    expect(missing.stdout).to.equal('');
    expect(missing.stderr).to.include('--trunk');
    expect(state()).to.deep.equal(beforeInit);
    const missingAutomatic = fixture.run(['log', 'short'], repo);
    expect(missingAutomatic.status).to.equal(1);
    expect(missingAutomatic.stdout).to.equal('');
    expect(missingAutomatic.stderr).to.include('--trunk');
    expect(state()).to.deep.equal(beforeInit);
    expect(fixture.git(['show-ref', '--heads'], repo)).to.equal(refs);
    const initialized = fixture.run(
      ['repo', 'init', '--trunk', 'unusual', '--interactive'],
      repo
    );
    expect(
      initialized.status,
      initialized.stdout + initialized.stderr
    ).to.equal(0);
    expect(initialized.stdout)
      .to.include('Welcome to Anthracite!')
      .and.include('Trunk set to unusual');
    expect(initialized.stdout).not.to.include('onboarding');
    expect(fixture.run(['info'], repo).stdout).to.include('unusual');
    expect(fixture.git(['show-ref', '--heads'], repo)).to.equal(refs);
    const inferred = path.join(fixture.root, 'inferred');
    fixture.git(['clone', repo, inferred]);
    fixture.git(['branch', '-m', 'main'], inferred);
    fixture.git(['remote', 'remove', 'origin'], inferred);
    const automatic = fixture.run(['init', '--interactive'], inferred);
    expect(automatic.status, automatic.stdout + automatic.stderr).to.equal(0);
    expect(automatic.stdout)
      .to.include('Welcome to Anthracite!')
      .and.include('Trunk set to main');
    expect(fixture.run(['info'], inferred).stdout).to.include('main');
  });

  it('automatically initializes an inferred trunk before showing setup success and ordinary log content', () => {
    fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_repo_config'));
    const before = fixture.snapshot();
    const automatic = fixture.run(['log', 'short']);
    expect(automatic.status, automatic.stderr).to.equal(0);
    expect(automatic.stdout)
      .to.include('Welcome to Anthracite!')
      .and.include('Trunk set to main')
      .and.include('setup is now complete.')
      .and.include('child');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
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

  function localState(): Record<string, unknown> {
    const git = (args: readonly string[]): string =>
      execFileSync('git', args, {
        cwd: fixture.repo,
        env: { ...fixture.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
      });
    const bytes = (name: string): string | null =>
      fs.existsSync(name) ? fs.readFileSync(name).toString('base64') : null;
    const state = {
      head: git(['rev-parse', 'HEAD']),
      branch: git(['branch', '--show-current']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
      refs: git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
        'refs/branch-metadata',
      ]),
      index: bytes(path.join(fixture.repo, '.git', 'index')),
      staging: git(['diff', '--cached', '--raw', '-z']),
      status: git(['status', '--porcelain=v1', '-z']),
      files: Object.fromEntries(
        git(['ls-files', '--cached', '--others', '-z'])
          .split('\0')
          .filter(Boolean)
          .map((file) => [file, bytes(path.join(fixture.repo, file))])
      ),
      continuation: bytes(path.join(fixture.repo, '.git', '.gtcontinue')),
      remote: git(['ls-remote', '--heads', 'origin']),
    };
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'interaction-remote-states.jsonl'),
        JSON.stringify({ cwd: fixture.repo, state }) + '\n'
      );
    return state;
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
    fixture.git('status', '--porcelain');
    const before = localState();
    const denied = run(['get', 'child', '--quiet']);
    expect(denied.status, denied.stdout + denied.stderr).to.equal(1);
    expect(denied.stdout).to.equal('');
    expect(denied.stderr).to.include('child').and.include('diverged');
    expect(denied.stderr).to.include('--force');
    expect(localState()).to.deep.equal(before);
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

  for (const relation of ['untracked', 'different parent']) {
    it(`diagnoses quiet get overwrite refusal for a local branch with ${relation}`, () => {
      const repo = producer('child');
      fixture.succeed('untrack', 'child');
      if (relation === 'different parent')
        fixture.succeed('track', 'child', '--parent', 'main');
      const local = fixture.commit('local-child');
      const advanced = remoteCommit(repo, 'remote-child');
      fixture.git('status', '--porcelain');
      const before = localState();
      const refused = run(['get', 'child', '--quiet']);
      expect(refused.status).to.equal(1);
      expect(refused.stdout).to.equal('');
      expect(refused.stderr).to.include('child').and.include('overwrite');
      expect(refused.stderr).to.include('--force');
      expect(localState()).to.deep.equal(before);
      expect(fixture.git('rev-parse', 'child')).to.equal(local);
      expect(fixture.git('rev-parse', 'origin/child')).to.equal(advanced);
      const forced = run(['get', 'child', '--quiet', '--force']);
      expect(forced.status, forced.stderr).to.equal(0);
      expect(forced.stdout).to.equal('');
      expect(fixture.git('rev-parse', 'child')).to.equal(advanced);
      expect(run(['parent']).stdout).to.equal('parent\n');
      expect(localState().remote).to.equal(before.remote);
    });
  }

  it('preserves local work when a terminal user declines get overwrite or selects abort', () => {
    const repo = producer('child');
    fixture.commit('local-child');
    remoteCommit(repo, 'remote-child');
    for (const choice of ['overwrite', 'abort']) {
      fixture.succeed('untrack', 'child');
      if (choice === 'abort')
        fixture.succeed('track', 'child', '--parent', 'parent');
      fixture.git('status', '--porcelain');
      const before = localState();
      const command = getTestCliCommand(['get', 'child']);
      const responses = [
        choice === 'overwrite'
          ? { prompt: 'with the version from remote?', input: 'n\r' }
          : {
              prompt: 'How would you like to handle',
              input: '\u001b[B\u001b[B\r',
            },
      ];
      const refused = runCliInPty(command, {
        cwd: fixture.repo,
        env: fixture.env,
        responses,
      });
      const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
      if (evidence)
        fs.appendFileSync(
          path.join(evidence, 'interaction-get-pty.jsonl'),
          JSON.stringify({
            command,
            cwd: fixture.repo,
            responses,
            ...refused,
          }) + '\n'
        );
      expect(refused.status, refused.output).to.equal(1);
      expect(refused.output).not.to.include('ERROR:');
      expect(localState()).to.deep.equal(before);
    }
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
