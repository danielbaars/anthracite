import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

const SYNTHETIC_TOKEN = 'fixture-not-a-real-auth-token';

type AuthToolOptions = {
  readonly version?: string;
  readonly authorized?: boolean;
  readonly loginStatus?: number;
};

function configureGh(
  fixture: CwdCliFixture,
  options: AuthToolOptions = {}
): void {
  const bin = path.join(fixture.root, 'auth-bin');
  fs.mkdirSync(bin, { recursive: true });
  const authorized = JSON.stringify(path.join(fixture.root, 'authorized'));
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!${
      process.execPath
    }\nconst fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(
      path.join(fixture.root, 'gh-calls.jsonl')
    )},JSON.stringify({args,cwd:process.cwd()})+'\\n');if(args[0]==='--version')process.stdout.write(${JSON.stringify(
      `gh version ${options.version ?? '2.80.0'}\n`
    )});else if(args[0]==='auth'&&args[1]==='status')process.exitCode=${
      options.authorized === false ? `(fs.existsSync(${authorized})?0:1)` : '0'
    };else if(args[0]==='auth'&&args[1]==='login'){process.stdout.write('controlled-auth-login\\n');if(${
      options.loginStatus ?? 0
    }===0)fs.writeFileSync(${authorized},'authorized');process.exitCode=${
      options.loginStatus ?? 0
    };}else process.exitCode=99;\n`,
    { mode: 0o755 }
  );
  fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
}

function outsideState(fixture: CwdCliFixture): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory)) {
      if (name === '.git' || name === 'cli.jsonl') continue;
      const full = path.join(directory, name);
      const relative = path.relative(fixture.root, full);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        result[relative] = 'directory';
        walk(full);
      } else
        result[relative] = stat.isSymbolicLink()
          ? `link:${fs.readlinkSync(full)}`
          : fs.readFileSync(full).toString('base64');
    }
  };
  walk(fixture.root);
  const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
  if (evidence)
    fs.appendFileSync(
      path.join(evidence, 'modern-auth-outside-snapshots.jsonl'),
      JSON.stringify({ root: fixture.root, files: result }) + '\n'
    );
  return result;
}

function ghCalls(fixture: CwdCliFixture): string {
  const file = path.join(fixture.root, 'gh-calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function inTerminal(
  fixture: CwdCliFixture,
  args: readonly string[]
): ReturnType<typeof runCliInPty> {
  return runCliInPty(getTestCliCommand(args), {
    cwd: fixture.repo,
    env: fixture.env,
  });
}

// Independent public processes, not a production operation.
// eslint-disable-next-line max-lines-per-function
describe('modern auth input through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    configureGh(fixture);
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-auth-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          root: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      const destination = path.join(evidence, path.basename(fixture.root));
      fs.mkdirSync(destination, { recursive: true });
      for (const name of ['gh-calls.jsonl', 'authorized', 'user-config']) {
        const file = path.join(fixture.root, name);
        if (fs.existsSync(file))
          fs.copyFileSync(file, path.join(destination, name));
      }
      const tool = path.join(fixture.root, 'auth-bin', 'gh');
      if (fs.existsSync(tool))
        fs.copyFileSync(tool, path.join(destination, 'gh-fixture.js'));
      fs.writeFileSync(
        path.join(destination, 'auth-state.json'),
        JSON.stringify({
          kind: 'controlled external gh fixture state, not a real account',
          calls: ghCalls(fixture),
          authorized: fs.existsSync(path.join(fixture.root, 'authorized')),
          userConfigExists: fs.existsSync(
            fixture.env.GRAPHITE_USER_CONFIG_PATH ?? ''
          ),
        })
      );
    }
    fixture.cleanup();
  });

  it('refuses offered token input before gh or configuration changes without echoing it', () => {
    const before = fixture.inspectionSnapshot();
    const files = outsideState(fixture);
    const result = fixture.run(['auth', '--token', SYNTHETIC_TOKEN, '--debug']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('Token input is not supported');
    expect(result.stderr).to.include('an auth');
    expect(result.stderr).not.to.include(SYNTHETIC_TOKEN);
    expect(ghCalls(fixture)).to.equal('');
    expect(outsideState(fixture)).to.deep.equal(files);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const [name, args] of [
    ['short separated', ['-t', SYNTHETIC_TOKEN]],
    ['long equals', ['--token=' + SYNTHETIC_TOKEN]],
    ['short equals', ['-t=' + SYNTHETIC_TOKEN]],
    ['short attached', ['-t' + SYNTHETIC_TOKEN]],
    ['empty long', ['--token=']],
    ['empty short', ['-t=']],
    ['missing long', ['--token']],
    ['missing short', ['-t']],
    ['repeated', ['--token', SYNTHETIC_TOKEN, '-t', 'second-fixture-token']],
    ['negated', ['--no-token']],
    ['false string', ['--token=false']],
    ['policy-looking value', ['--token=--quiet=invalid']],
    ['cwd-looking value', ['--token=--cwd=fixture-private-path']],
  ] as const) {
    it(`refuses ${name} token spelling outside Git before tools or storage`, () => {
      const outside = path.join(fixture.root, 'outside');
      fs.mkdirSync(outside);
      const before = outsideState(fixture);
      const result = fixture.run(['auth', ...args, '--quiet'], outside);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('Token input is not supported');
      for (const value of [
        SYNTHETIC_TOKEN,
        'second-fixture-token',
        'invalid',
        'fixture-private-path',
      ])
        expect(result.stderr).not.to.include(value);
      expect(ghCalls(fixture)).to.equal('');
      expect(outsideState(fixture)).to.deep.equal(before);
    });
  }

  it('preserves both dirty repositories and a selected linked worktree when refusing a token', () => {
    const target = new CwdCliFixture();
    try {
      const linked = path.join(target.root, 'linked δ auth');
      target.git(['worktree', 'add', linked, 'other']);
      for (const current of [fixture, target]) {
        fs.writeFileSync(path.join(current.repo, 'base.txt'), 'staged');
        current.git(['add', 'base.txt']);
        fs.appendFileSync(path.join(current.repo, 'base.txt'), '\nworking');
        fs.writeFileSync(path.join(current.repo, 'untracked.txt'), 'keep');
        current.git(['status', '--porcelain']);
      }
      const before = [
        fixture.inspectionSnapshot(),
        target.inspectionSnapshot(),
        target.inspectionSnapshot(linked),
      ];
      const files = outsideState(fixture);
      const result = fixture.run([
        '--cwd',
        linked,
        'auth',
        '-t',
        SYNTHETIC_TOKEN,
        '--debug',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('Token input is not supported');
      expect(result.stderr).not.to.include(SYNTHETIC_TOKEN);
      expect(ghCalls(fixture)).to.equal('');
      expect(outsideState(fixture)).to.deep.equal(files);
      expect([
        fixture.inspectionSnapshot(),
        target.inspectionSnapshot(),
        target.inspectionSnapshot(linked),
      ]).to.deep.equal(before);
    } finally {
      target.cleanup();
    }
  });

  it('keeps earlier cwd and global-policy failures private and side-effect free', () => {
    const before = fixture.inspectionSnapshot();
    const files = outsideState(fixture);
    const missing = path.join(fixture.root, 'missing-directory');
    for (const args of [
      ['auth', '--token', SYNTHETIC_TOKEN, '--cwd', missing],
      ['--cwd', missing, 'auth', '-t', SYNTHETIC_TOKEN],
      ['auth', '--token', SYNTHETIC_TOKEN, '--quiet=invalid'],
      ['--cwd', fixture.repo, 'auth', '-t', SYNTHETIC_TOKEN, '--quiet=invalid'],
    ]) {
      const result = fixture.run(args);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(result.stderr).not.to.include(SYNTHETIC_TOKEN);
      expect(ghCalls(fixture)).to.equal('');
      expect(outsideState(fixture)).to.deep.equal(files);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('refuses token input before reading or repairing absent and damaged configuration', () => {
    const config = fixture.env.GRAPHITE_USER_CONFIG_PATH;
    if (!config) throw new Error('Missing fixture user config path');
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    for (const value of ['{invalid fixture json', null]) {
      if (value === null) fs.unlinkSync(config);
      else fs.writeFileSync(config, value);
      const before = outsideState(fixture);
      const result = fixture.run(
        ['auth', '--token', SYNTHETIC_TOKEN, '--debug'],
        outside
      );
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('Token input is not supported');
      expect(result.stderr).not.to.include(SYNTHETIC_TOKEN);
      expect(ghCalls(fixture)).to.equal('');
      expect(outsideState(fixture)).to.deep.equal(before);
    }
  });

  it('refuses token input in a real terminal without invoking login', () => {
    configureGh(fixture, { authorized: false });
    const before = fixture.inspectionSnapshot();
    const files = outsideState(fixture);
    const result = inTerminal(fixture, [
      'auth',
      '--interactive',
      '-t',
      SYNTHETIC_TOKEN,
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Token input is not supported');
    expect(result.output).not.to.include(SYNTHETIC_TOKEN);
    expect(ghCalls(fixture)).to.equal('');
    expect(outsideState(fixture)).to.deep.equal(files);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('offers the real gh-auth help without token options in help or completion', () => {
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    const before = fixture.inspectionSnapshot();
    for (const flags of [
      ['--help', '--quiet'],
      ['--token', SYNTHETIC_TOKEN, '--help', '--quiet'],
    ]) {
      const help = fixture.run(['auth', ...flags], outside);
      expect(help.status).to.equal(0);
      expect(help.stdout).to.include('an auth');
      expect(help.stdout).to.include('GitHub CLI');
      expect(help.stdout).not.to.include('--token');
      expect(help.stdout).not.to.include(SYNTHETIC_TOKEN);
      expect(help.stderr).to.equal('');
    }
    for (const tail of ['--', '-']) {
      const completion = fixture.run(
        ['--get-yargs-completions', 'an', 'auth', tail],
        outside
      );
      expect(completion.status).to.equal(0);
      expect(completion.stdout).not.to.match(/--?(?:token|t)(?=[:\s]|$)/m);
      expect(completion.stderr).to.equal('');
    }
    expect(ghCalls(fixture)).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps ordinary authenticated status and quiet checks available without login', () => {
    const before = fixture.inspectionSnapshot();
    const status = fixture.run(['auth']);
    expect(status.status).to.equal(0);
    expect(status.stdout).to.include('Already authenticated');
    expect(status.stderr).to.equal('');
    const quiet = fixture.run(['auth', '--quiet']);
    expect(quiet.status).to.equal(0);
    expect(quiet.stdout).to.equal('');
    expect(quiet.stderr).to.equal('');
    expect(ghCalls(fixture)).to.include('"--version"');
    expect(ghCalls(fixture)).to.include('"status"');
    expect(ghCalls(fixture)).not.to.include('"login"');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('retains dependency failures without starting login', () => {
    for (const version of ['invalid', '1.99.0']) {
      configureGh(fixture, { version });
      const result = fixture.run(['auth', '--quiet']);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('GitHub CLI version');
    }
    fs.unlinkSync(path.join(fixture.root, 'auth-bin', 'gh'));
    fs.symlinkSync(
      execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
      path.join(fixture.root, 'auth-bin', 'git')
    );
    fixture.env.PATH = path.join(fixture.root, 'auth-bin');
    const missing = fixture.run(['auth', '--quiet']);
    expect(missing.status).to.equal(1);
    expect(missing.stdout).to.equal('');
    expect(missing.stderr).to.include('GitHub CLI version');
    expect(ghCalls(fixture)).not.to.include('"login"');
  });

  it('keeps unauthenticated pipes and quiet terminals from attempting login', () => {
    configureGh(fixture, { authorized: false });
    for (const flags of [
      [],
      ['--interactive'],
      ['--no-interactive'],
      ['--quiet', '--interactive'],
    ]) {
      const result = fixture.run(['auth', ...flags]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('authenticate');
    }
    const terminal = inTerminal(fixture, ['auth', '--quiet', '--interactive']);
    expect(terminal.status, terminal.output).to.equal(1);
    expect(terminal.output).not.to.include('controlled-auth-login');
    expect(ghCalls(fixture)).not.to.include('"login"');
    expect(fs.existsSync(path.join(fixture.root, 'authorized'))).to.equal(
      false
    );
  });

  it('completes controlled terminal login and observes it in a fresh auth process', () => {
    configureGh(fixture, { authorized: false });
    const result = inTerminal(fixture, ['auth']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('controlled-auth-login');
    expect(result.output).to.include('Successfully authenticated');
    expect(
      fs.readFileSync(path.join(fixture.root, 'authorized'), 'utf8')
    ).to.equal('authorized');
    const check = fixture.run(['auth', '--quiet']);
    expect(check.status).to.equal(0);
    expect(check.stdout).to.equal('');
    expect(check.stderr).to.equal('');
  });

  it('reports a controlled login failure as nonzero with no authenticated state', () => {
    configureGh(fixture, { authorized: false, loginStatus: 7 });
    const result = inTerminal(fixture, ['auth']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('controlled-auth-login');
    expect(result.output).to.include('Failed to authenticate');
    expect(fs.existsSync(path.join(fixture.root, 'authorized'))).to.equal(
      false
    );
  });
});
