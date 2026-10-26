import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

class ExternalContextFixture {
  readonly root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'an-context-'))
  );
  readonly bin = path.join(this.root, 'bin');
  readonly calls = path.join(this.root, 'gh.jsonl');
  readonly config = path.join(this.root, 'user-config');
  readonly env: NodeJS.ProcessEnv;

  constructor() {
    fs.mkdirSync(this.bin);
    fs.writeFileSync(this.config, JSON.stringify({ tips: false }));
    this.env = {
      ...process.env,
      HOME: this.root,
      TMPDIR: this.root,
      XDG_CONFIG_HOME: path.join(this.root, 'xdg'),
      GH_CONFIG_DIR: path.join(this.root, 'gh-config'),
      GRAPHITE_USER_CONFIG_PATH: this.config,
      GRAPHITE_PROFILE: '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      PATH: `${this.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      NO_COLOR: '1',
    };
    for (const key of [
      'DEBUG',
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GRAPHITE_INTERACTIVE',
      'GIT_OPTIONAL_LOCKS',
    ])
      delete this.env[key];
    this.gh();
  }

  gh(version = '2.50.0', authorized = false, loginStatus = 0): void {
    const state = JSON.stringify(path.join(this.root, 'authorized'));
    fs.writeFileSync(
      path.join(this.bin, 'gh'),
      `#!${
        process.execPath
      }\nconst fs=require('fs');\nconst args=process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(
        this.calls
      )},JSON.stringify({args,cwd:process.cwd()})+'\\n');\nif(args[0]==='--version')process.stdout.write(${JSON.stringify(
        `gh version ${version}\n`
      )});\nelse if(args[0]==='auth'&&args[1]==='status')process.exitCode=${
        authorized ? '0' : `(fs.existsSync(${state}) ? 0 : 1)`
      };\nelse if(args[0]==='auth'&&args[1]==='login') {process.stdout.write('controlled-login-outcome\\n');if(${loginStatus}===0)fs.writeFileSync(${state},'authorized');process.exitCode=${loginStatus};}\nelse process.exitCode=99;\n`,
      { mode: 0o755 }
    );
  }

  forbidGitMutations(): void {
    fs.writeFileSync(
      path.join(this.bin, 'git'),
      `#!${
        process.execPath
      }\nconst fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(
        path.join(this.root, 'git-sentinel.jsonl')
      )},JSON.stringify({args,cwd:process.cwd()})+'\\n');if(args[0]==='config'){if(args.includes('user.email'))process.stdout.write('context@example.invalid\\n');else process.exitCode=1;}else {process.stderr.write('forbidden-external-git\\n');process.exitCode=99;}\n`,
      { mode: 0o755 }
    );
  }

  environment(): Readonly<Record<string, string | null>> {
    return Object.fromEntries(
      [
        'HOME',
        'CODEX_HOME',
        'TMPDIR',
        'XDG_CONFIG_HOME',
        'GH_CONFIG_DIR',
        'GRAPHITE_USER_CONFIG_PATH',
        'GRAPHITE_PROFILE',
        'GIT_CONFIG_NOSYSTEM',
        'GIT_CONFIG_GLOBAL',
        'GIT_OPTIONAL_LOCKS',
        'GRAPHITE_INTERACTIVE',
        'ANTHRACITE_TEST_BINARY',
        'DEBUG',
        'PATH',
      ].map((key) => [key, this.env[key] ?? null])
    );
  }

  run(args: readonly string[]): {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  } {
    const [executable, ...argv] = getTestCliCommand(args);
    const raw = spawnSync(executable, argv, {
      cwd: this.root,
      env: this.env,
      timeout: 10000,
    });
    if (raw.error) throw raw.error;
    if (raw.signal) throw new Error(`CLI killed: ${raw.signal}`);
    const result = {
      status: raw.status,
      stdout: raw.stdout.toString('utf8'),
      stderr: raw.stderr.toString('utf8'),
    };
    fs.appendFileSync(
      path.join(this.root, 'cli.jsonl'),
      JSON.stringify({
        args,
        executable,
        argv,
        cwd: this.root,
        environment: this.environment(),
        ...result,
        stdoutBase64: raw.stdout.toString('base64'),
        stderrBase64: raw.stderr.toString('base64'),
      }) + '\n'
    );
    return result;
  }

  pty(args: readonly string[]): ReturnType<typeof runCliInPty> {
    const command = getTestCliCommand(args);
    const result = runCliInPty(command, { cwd: this.root, env: this.env });
    fs.appendFileSync(
      path.join(this.root, 'cli.jsonl'),
      JSON.stringify({
        command,
        cwd: this.root,
        environment: this.environment(),
        ...result,
      }) + '\n'
    );
    return result;
  }

  ghCalls(): readonly unknown[] {
    return fs.existsSync(this.calls)
      ? fs
          .readFileSync(this.calls, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  }

  cleanup(): void {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      const destination = path.join(evidence, path.basename(this.root));
      fs.mkdirSync(destination, { recursive: true });
      for (const name of [
        'cli.jsonl',
        'gh.jsonl',
        'git-sentinel.jsonl',
        'user-config',
        'authorized',
      ])
        if (fs.existsSync(path.join(this.root, name)))
          fs.copyFileSync(
            path.join(this.root, name),
            path.join(destination, name)
          );
      fs.writeFileSync(
        path.join(destination, 'environment.json'),
        JSON.stringify(this.environment(), null, 2)
      );
    }
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

// Independent public process scenarios, not a production operation.
// eslint-disable-next-line max-lines-per-function
describe('external and direct contexts through the public CLI', function () {
  this.timeout(120000);
  let fixture: ExternalContextFixture;
  beforeEach(() => {
    fixture = new ExternalContextFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('fails dependency checks without attempting auth or login', () => {
    for (const version of ['missing', 'invalid', '1.99.0']) {
      if (version === 'missing') {
        fs.unlinkSync(path.join(fixture.bin, 'gh'));
        fs.symlinkSync(
          execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
          path.join(fixture.bin, 'git')
        );
        fixture.env.PATH = fixture.bin;
      } else fixture.gh(version);
      const result = fixture.run(['auth', '--quiet']);
      expect(result.status, version).to.equal(1);
      expect(result.stdout, version).to.equal('');
      expect(result.stderr, version).to.include('GitHub CLI version');
    }
    expect(fixture.ghCalls()).to.deep.equal([
      { args: ['--version'], cwd: fixture.root },
      { args: ['--version'], cwd: fixture.root },
    ]);
  });

  it('reports a controlled interactive login failure as failure', () => {
    fixture.gh('2.50.0', false, 7);
    const result = fixture.pty(['auth', '--interactive']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('controlled-login-outcome');
    expect(result.output).to.include('Failed to authenticate');
    expect(fixture.ghCalls()).to.deep.equal([
      { args: ['--version'], cwd: fixture.root },
      { args: ['auth', 'status'], cwd: fixture.root },
      { args: ['auth', 'login'], cwd: fixture.root },
    ]);
  });

  it('checks an already authenticated status quietly without login', () => {
    fixture.gh('2.50.0', true);
    const result = fixture.run(['auth', '--quiet']);
    expect(result.status).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    expect(fixture.ghCalls()).to.deep.equal([
      { args: ['--version'], cwd: fixture.root },
      { args: ['auth', 'status'], cwd: fixture.root },
    ]);
  });

  it('accepts a supported two-digit gh major version without login', () => {
    fixture.gh('10.0.0', true);
    const result = fixture.run(['auth']);
    expect(result.status).to.equal(0);
    expect(result.stdout).to.include('Already authenticated');
    expect(result.stderr).to.equal('');
    expect(fixture.ghCalls()).to.deep.equal([
      { args: ['--version'], cwd: fixture.root },
      { args: ['auth', 'status'], cwd: fixture.root },
    ]);
  });

  it('applies quiet to the direct cache context in the selected repository', () => {
    const repo = new RelationCliFixture(fixture.env);
    try {
      const before = repo.refs();
      const result = fixture.run([
        'dev',
        'cache',
        '--cwd',
        repo.repo,
        '--quiet',
      ]);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
      expect(repo.refs()).to.equal(before);
      expect(fixture.ghCalls()).to.deep.equal([]);
    } finally {
      repo.cleanup();
    }
  });

  it('refuses the intrinsically interactive demo before external actions', () => {
    fixture.forbidGitMutations();
    const result = fixture.run(['demo', '--quiet', '--interactive']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('interactive');
    expect(result.stderr).not.to.include('forbidden-external-git');
    expect(
      fs.readFileSync(path.join(fixture.root, 'git-sentinel.jsonl'), 'utf8')
    ).not.to.include('init');
    expect(fixture.ghCalls()).to.deep.equal([]);
  });

  it('completes controlled interactive login and checks the resulting status in a fresh process', () => {
    const result = fixture.pty(['auth']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('controlled-login-outcome');
    expect(result.output).to.include('Successfully authenticated');
    const check = fixture.run(['auth', '--quiet']);
    expect(check.status).to.equal(0);
    expect(check.stdout).to.equal('');
    expect(check.stderr).to.equal('');
    expect(fixture.ghCalls()).to.deep.equal([
      { args: ['--version'], cwd: fixture.root },
      { args: ['auth', 'status'], cwd: fixture.root },
      { args: ['auth', 'login'], cwd: fixture.root },
      { args: ['--version'], cwd: fixture.root },
      { args: ['auth', 'status'], cwd: fixture.root },
    ]);
  });

  it('keeps login unavailable under explicit pipe interaction, quiet, no-interactive and legacy constraints', () => {
    for (const flags of [
      ['--interactive'],
      ['--quiet', '--interactive'],
      ['--interactive', '--quiet'],
      ['--no-interactive'],
    ]) {
      const result = fixture.run(['auth', ...flags]);
      expect(result.status, flags.join(' ')).to.equal(1);
      expect(result.stdout, flags.join(' ')).to.equal('');
      expect(result.stderr).to.include('authenticate');
    }
    for (const flags of [['--quiet', '--interactive'], ['--no-interactive']]) {
      const result = fixture.pty(['auth', ...flags]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).not.to.include('controlled-login-outcome');
    }
    fixture.env.GRAPHITE_INTERACTIVE = 'false';
    const legacy = fixture.pty(['auth', '--interactive']);
    expect(legacy.status, legacy.output).to.equal(1);
    expect(legacy.output).not.to.include('controlled-login-outcome');
    expect(JSON.stringify(fixture.ghCalls())).not.to.include('"login"');
  });

  it('changes user configuration outside Git quietly and reads it through a fresh public process', () => {
    const written = fixture.run([
      'user',
      'pager',
      '--set',
      'owned-pager --literal',
      '--quiet',
    ]);
    expect(written.status).to.equal(0);
    expect(written.stdout).to.equal('');
    expect(written.stderr).to.equal('');
    const read = fixture.run(['user', 'pager']);
    expect(read.status).to.equal(0);
    expect(read.stdout).to.equal('owned-pager --literal\n');
    expect(read.stderr).to.equal('');
    const disable = fixture.run(['user', 'tips', '--enable', '--quiet']);
    expect(disable.status).to.equal(0);
    expect(disable.stdout).to.equal('');
    expect(fixture.run(['user', 'tips']).stdout).to.equal('tips enabled\n');
    expect(fixture.ghCalls()).to.deep.equal([]);
  });

  it('reports invalid user configuration arguments on stderr without changing settings', () => {
    const before = fs.readFileSync(fixture.config);
    const result = fixture.run([
      'user',
      'pager',
      '--unknown-setting',
      '--quiet',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).not.to.equal('');
    expect(fs.readFileSync(fixture.config)).to.deep.equal(before);
    expect(fixture.ghCalls()).to.deep.equal([]);
  });

  it('preserves the direct cache clear lifecycle and normal presentation', () => {
    const repo = new RelationCliFixture(fixture.env);
    try {
      const before = repo.refs();
      const displayed = fixture.run(['dev', 'cache', '--cwd', repo.repo]);
      expect(displayed.status).to.equal(0);
      expect(displayed.stdout).not.to.equal('');
      expect(displayed.stderr).to.equal('');
      const cleared = fixture.run([
        'dev',
        'cache',
        '--clear',
        '--cwd',
        repo.repo,
        '--quiet',
      ]);
      expect(cleared.status).to.equal(0);
      expect(cleared.stdout).to.equal('');
      expect(cleared.stderr).to.equal('');
      expect(
        fs.existsSync(path.join(repo.repo, '.git', '.graphite_cache_persist'))
      ).to.equal(false);
      expect(repo.refs()).to.equal(before);
      expect(fixture.ghCalls()).to.deep.equal([]);
    } finally {
      repo.cleanup();
    }
  });

  it('keeps every forbidden demo mode guarded with actual external Git sentinels', () => {
    fixture.forbidGitMutations();
    for (const flags of [[], ['--interactive'], ['--no-interactive']]) {
      const result = fixture.run(['demo', ...flags]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('interactive');
      expect(result.stderr).not.to.include('forbidden-external-git');
    }
    for (const flags of [['--no-interactive'], ['--interactive', '--quiet']]) {
      const result = fixture.pty(['demo', ...flags]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).not.to.include('forbidden-external-git');
    }
    fixture.env.GRAPHITE_INTERACTIVE = '1';
    const legacy = fixture.pty(['demo', '--interactive']);
    expect(legacy.status, legacy.output).to.equal(1);
    expect(legacy.output).not.to.include('forbidden-external-git');
    expect(
      fs.readFileSync(path.join(fixture.root, 'git-sentinel.jsonl'), 'utf8')
    ).not.to.include('init');
    expect(fixture.ghCalls()).to.deep.equal([]);
  });

  it('keeps direct cache debug on stderr even when ordinary cache output is quiet', () => {
    const repo = new RelationCliFixture(fixture.env);
    try {
      const result = fixture.run([
        'dev',
        'cache',
        '--cwd',
        repo.repo,
        '--quiet',
        '--debug',
      ]);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(result.stderr).to.include('base');
      expect(fixture.ghCalls()).to.deep.equal([]);
    } finally {
      repo.cleanup();
    }
  });

  it('checks authentication in the cwd-selected repository and preserves its refs', () => {
    const repo = new RelationCliFixture(fixture.env);
    try {
      fixture.gh('2.50.0', true);
      const before = repo.refs();
      const result = fixture.run(['auth', '--cwd', repo.repo, '--quiet']);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
      expect(fixture.ghCalls()).to.deep.equal([
        { args: ['--version'], cwd: fs.realpathSync(repo.repo) },
        { args: ['auth', 'status'], cwd: fs.realpathSync(repo.repo) },
      ]);
      expect(repo.refs()).to.equal(before);
    } finally {
      repo.cleanup();
    }
  });

  it('refuses unauthenticated pipe auth before starting login', () => {
    const before = fs.readFileSync(fixture.config);
    const result = fixture.run(['auth']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('authenticate');
    expect(fixture.ghCalls()).to.deep.equal([
      { args: ['--version'], cwd: fixture.root },
      { args: ['auth', 'status'], cwd: fixture.root },
    ]);
    expect(fs.readFileSync(fixture.config)).to.deep.equal(before);
  });
});
