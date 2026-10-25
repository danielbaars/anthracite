import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Public subprocesses with separate pipe bytes and real Git observations.
// eslint-disable-next-line max-lines-per-function
describe('interaction output through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
  });
  afterEach(() => fixture?.cleanup());

  it('performs a quiet commit without internal Git status and keeps ordinary output available', () => {
    for (const [name, flags] of [
      ['silent', ['--quiet']],
      ['ordinary', ['--quiet=false']],
    ] as const) {
      fs.writeFileSync(path.join(fixture.repo, `${name}.txt`), name);
      fixture.git(['add', `${name}.txt`]);
      const result = fixture.run(['create', name, '--message', name, ...flags]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(name);
      expect(fixture.git(['show', `HEAD:${name}.txt`])).to.equal(name);
      if (name === 'silent') {
        expect(result.stdout).to.equal('');
        expect(result.stderr).to.equal('');
      } else expect(result.stdout).to.include(name);
    }
  });

  it('keeps explicit debug and environment stack traces on stderr during quiet failure', () => {
    for (const environmentDebug of [false, true]) {
      if (environmentDebug) fixture.env.DEBUG = '1';
      const result = fixture.run([
        'rename',
        '--quiet',
        ...(environmentDebug ? [] : ['--debug']),
      ]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('supply a new branch name');
      expect(result.stderr).to.match(/\n\s+at /);
    }
  });

  it('reports a real quiet conflict and unresolved continuation without destroying replay state', () => {
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child version');
    fixture.git(['commit', '-am', 'child conflict']);
    fixture.git(['switch', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base version');
    fixture.git(['commit', '--amend', '-am', 'base changed']);
    const result = fixture.run(['restack', '--quiet']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('conflict').and.include('ch continue');
    const replay = fixture.git(['rev-parse', '--git-path', 'rebase-merge']);
    const continuation = fixture.git([
      'rev-parse',
      '--git-path',
      '.gtcontinue',
    ]);
    expect(fs.existsSync(path.resolve(fixture.repo, replay))).to.equal(true);
    expect(fs.existsSync(path.resolve(fixture.repo, continuation))).to.equal(
      true
    );
    const refs = fixture.refs();
    const head = fixture.git(['rev-parse', 'HEAD']);
    const unmerged = fixture.git(['ls-files', '--unmerged']);
    expect(unmerged).not.to.equal('');
    const continued = fixture.run(['continue', '--quiet']);
    expect(continued.status).to.equal(1);
    expect(continued.stdout).to.equal('');
    expect(continued.stderr)
      .to.include('not yet resolved')
      .and.include('ch continue');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
    expect(fixture.git(['ls-files', '--unmerged'])).to.equal(unmerged);
    expect(fs.existsSync(path.resolve(fixture.repo, replay))).to.equal(true);
    expect(fs.existsSync(path.resolve(fixture.repo, continuation))).to.equal(
      true
    );
  });

  it('runs an explicit shell child under quiet pipes and preserves its real output logs and cwd', () => {
    const calls = path.join(fixture.root, 'child-calls.jsonl');
    const script = path.join(fixture.root, 'child.js');
    fs.writeFileSync(
      script,
      [
        "const fs = require('fs');",
        "const cp = require('child_process');",
        "const branch = cp.execFileSync('git', ['branch', '--show-current'], {encoding:'utf8'}).trim();",
        `fs.appendFileSync(${JSON.stringify(
          calls
        )}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),branch})+'\\n');`,
        "process.stdout.write('child-payload:' + branch);",
      ].join('\n')
    );
    fixture.env.TMPDIR = fixture.root;
    const command = `'${process.execPath}' '${script}' literal-argument`;
    const result = fixture.run(['test', command, '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    const received: unknown = fs
      .readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(received).to.have.deep.members(
      ['base', 'child', 'tip'].map((branch) => ({
        cwd: fs.realpathSync(fixture.repo),
        args: ['literal-argument'],
        branch,
      }))
    );
    const logs = fs
      .readdirSync(fixture.root)
      .filter((name) => name.startsWith('tmp-'));
    expect(logs).to.have.length(1);
    for (const branch of ['base', 'child', 'tip'])
      expect(
        fs.readFileSync(path.join(fixture.root, logs[0], branch), 'utf8')
      ).to.equal(`child-payload:${branch}`);
    fs.appendFileSync(
      path.join(fixture.root, 'cli.jsonl'),
      JSON.stringify({
        kind: 'shell-child-observations',
        command,
        cwd: fixture.repo,
        received,
        logs: Object.fromEntries(
          ['base', 'child', 'tip'].map((branch) => [
            branch,
            fs
              .readFileSync(path.join(fixture.root, logs[0], branch))
              .toString('base64'),
          ])
        ),
      }) + '\n'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('keeps real hook bytes and verify choices while suppressing only quiet commit status', () => {
    const marker = path.join(fixture.root, 'hook-calls');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-commit'),
      `#!/bin/sh\nprintf 'hook-stdout\\n'\nprintf 'hook-stderr\\n' >&2\nprintf x >> '${marker}'\n`,
      { mode: 0o755 }
    );
    for (const [name, flags] of [
      ['hook-ordinary', []],
      ['hook-quiet', ['--quiet']],
      ['hook-skip', ['--quiet', '--no-verify']],
    ] as const) {
      fs.writeFileSync(path.join(fixture.repo, `${name}.txt`), name);
      fixture.git(['add', `${name}.txt`]);
      const result = fixture.run(['create', name, '--message', name, ...flags]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['show', `HEAD:${name}.txt`])).to.equal(name);
      if (name === 'hook-skip')
        expect(result.stdout + result.stderr).to.equal('');
      else {
        expect(result.stderr)
          .to.include('hook-stdout')
          .and.include('hook-stderr');
        if (name === 'hook-quiet') expect(result.stdout).to.equal('');
      }
    }
    expect(fs.readFileSync(marker, 'utf8')).to.equal('xx');
  });

  it('preserves hook failure and its safety warning on stderr with the reached work intact', () => {
    fs.writeFileSync(path.join(fixture.repo, 'new.txt'), 'selected');
    fixture.git(['add', 'new.txt']);
    const head = fixture.git(['rev-parse', 'HEAD']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-commit'),
      "#!/bin/sh\nprintf 'hook failed\\n' >&2\nprintf 'hook work' > hook-work.txt\nexit 7\n",
      { mode: 0o755 }
    );
    const result = fixture.run([
      'create',
      'retained',
      '--onto',
      'base',
      '--message',
      'selected',
      '--quiet',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr)
      .to.include('hook failed')
      .and.include('Commit failed after a hook');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
    expect(fixture.git(['branch', '--show-current'])).to.equal('retained');
    expect(fixture.git(['show', ':new.txt'])).to.equal('selected');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
  });

  it('keeps parser, inspection, normal and context errors off stdout without mandatory stacks', () => {
    for (const [args, cwd] of [
      [['rename', '--not-an-option', '--quiet'], fixture.repo],
      [['rename', '--quiet'], fixture.repo],
      [['info', 'not-a-real-branch', '--quiet'], fixture.repo],
      [['parent', '--quiet'], fixture.root],
    ] as const) {
      const result = fixture.run(args, cwd);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(result.stderr).not.to.match(/\n\s+at /);
    }
    fs.writeFileSync(path.join(fixture.root, 'user-config'), 'invalid json');
    const invalid = fixture.run(['user', 'pager', '--quiet']);
    expect(invalid.status).to.equal(1);
    expect(invalid.stdout).to.equal('');
    expect(invalid.stderr).not.to.equal('');
    expect(invalid.stderr).not.to.match(/\n\s+at /);
    fs.writeFileSync(path.join(fixture.root, 'user-config'), '{}');
  });

  it('keeps explicitly requested quiet help and version as stdout data without starting tools', () => {
    const restore = fixture.refuseExternalTools();
    try {
      for (const args of [
        ['create', '--help', '--quiet'],
        ['--version', '--quiet'],
      ]) {
        const result = fixture.run(args, fixture.root);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).not.to.equal('');
        expect(result.stderr).to.equal('');
      }
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
  });

  it('suppresses ordinary message-style success while retaining it when quiet is false', () => {
    const gh = path.join(fixture.root, 'sentinel-bin/gh');
    fs.writeFileSync(
      gh,
      `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==='--version')process.stdout.write('gh version 2.1.0');else if(args.join(' ')!=='auth status')process.exitCode=99;`,
      { mode: 0o755 }
    );
    const quiet = fixture.run(['auth', '--quiet']);
    expect(quiet.status, quiet.stderr).to.equal(0);
    expect(quiet.stdout).to.equal('');
    expect(quiet.stderr).to.equal('');
    const ordinary = fixture.run(['auth', '--quiet=false']);
    expect(ordinary.status, ordinary.stderr).to.equal(0);
    expect(ordinary.stdout).to.include('Already authenticated');
    expect(ordinary.stderr).to.equal('');
  });

  it('preserves real push hook bytes, no-verify and remote progress in ordinary and quiet modes', () => {
    const submit = new SubmitCliFixture();
    try {
      submit.branch('pushed', 'main');
      submit.succeed('submit');
      const marker = path.join(submit.root, 'push-hooks');
      fs.writeFileSync(
        path.join(submit.repo, '.git/hooks/pre-push'),
        `#!/bin/sh\nprintf 'push-hook-stdout\\n'\nprintf 'push-hook-stderr\\n' >&2\nprintf x >> '${marker}'\n`,
        { mode: 0o755 }
      );
      for (const [name, flags] of [
        ['ordinary-push', []],
        ['quiet-push', ['--quiet']],
        ['skipped-push', ['--quiet', '--no-verify']],
      ] as const) {
        const head = submit.commit(name);
        const result = submit.cli('submit', ...flags);
        fs.appendFileSync(
          path.join(fixture.root, 'cli.jsonl'),
          JSON.stringify({
            args: ['submit', ...flags, '--no-interactive'],
            cwd: submit.repo,
            environment: submit.env,
            status: result.status,
            stdoutBase64: Buffer.from(result.stdout).toString('base64'),
            stderrBase64: Buffer.from(result.stderr).toString('base64'),
            remote: submit.remoteSha('pushed'),
            prs: submit.prs(),
          }) + '\n'
        );
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(submit.remoteSha('pushed')).to.equal(head);
        if (name === 'skipped-push')
          expect(result.stdout + result.stderr).to.equal('');
        else {
          expect(result.stdout).to.include('push-hook-stdout');
          expect(result.stderr).to.include('push-hook-stderr');
          if (name === 'quiet-push') {
            expect(result.stdout).to.equal('push-hook-stdout\n');
            expect(result.stderr).not.to.include('-> pushed');
          }
        }
      }
      expect(fs.readFileSync(marker, 'utf8')).to.equal('xx');
      const shiftedRemote = submit.git('rev-parse', 'main');
      submit.git(
        '--git-dir',
        submit.remote,
        'update-ref',
        'refs/heads/pushed',
        shiftedRemote
      );
      submit.commit('must-not-overwrite');
      const rejected = submit.cli('submit', '--quiet');
      fs.appendFileSync(
        path.join(fixture.root, 'cli.jsonl'),
        JSON.stringify({
          args: ['submit', '--quiet', '--no-interactive'],
          cwd: submit.repo,
          environment: submit.env,
          ...rejected,
          remote: submit.remoteSha('pushed'),
        }) + '\n'
      );
      expect(rejected.status).to.equal(1);
      expect(rejected.stdout).to.equal('push-hook-stdout\n');
      expect(rejected.stderr).to.include('stale info');
      expect(submit.remoteSha('pushed')).to.equal(shiftedRemote);
    } finally {
      submit.cleanup();
    }
  });

  it('reports parser usage on stderr and never starts the rejected mutation or its tools', () => {
    const before = fixture.snapshot();
    for (const flags of [[], ['--quiet']]) {
      const restore = fixture.refuseExternalTools();
      const result = fixture.run([
        'create',
        'never-created',
        '--message',
        'literal',
        '--not-an-option',
        ...flags,
      ]);
      restore();
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr)
        .to.include('ch create')
        .and.include('Unknown argument');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
      expect(fixture.snapshot()).to.deep.equal(before);
    }
  });
});
