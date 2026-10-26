import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { runCliInPty as executeCliInPty } from '../lib/utils/run_cli_in_pty';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('effective interaction policy through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.git(['status', '--porcelain=v1']);
  });
  afterEach(() => fixture?.cleanup());

  function runCliInPty(
    command: readonly string[],
    options: Parameters<typeof executeCliInPty>[1]
  ): ReturnType<typeof executeCliInPty> {
    const result = executeCliInPty(command, options);
    const receipt = {
      ...result,
      command,
      cwd: options.cwd,
      responses: options.responses ?? [],
      environment: Object.fromEntries(
        [
          'GRAPHITE_INTERACTIVE',
          'GIT_OPTIONAL_LOCKS',
          'HOME',
          'CODEX_HOME',
          'CHARCOAL_TEST_BINARY',
          'BUN_BE_BUN',
          'CH_PAGER',
        ].map((key) => [key, options.env[key] ?? null])
      ),
    };
    fixture.savePty(receipt);
    return result;
  }

  it('refuses a missing rename choice without a prompt in quiet mode', () => {
    const before = fixture.snapshot();
    const result = fixture.run(['rename', '--quiet']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('supply a new branch name');
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('rejects an invalid policy boolean before help, tools or mutation', () => {
    const before = fixture.snapshot();
    const restore = fixture.refuseExternalTools();
    const result = fixture.run([
      'create',
      'unwanted',
      '--quiet=invalid',
      '--help',
    ]);
    restore();
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('quiet');
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('renames after an actual terminal answer and never treats EOF as success', () => {
    const before = fixture.snapshot();
    const eof = runCliInPty(getTestCliCommand(['rename']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Branch Name', input: '\u0004' }],
    });

    expect(eof.status).to.equal(1);
    expect(fixture.snapshot()).to.deep.equal(before);

    const answered = runCliInPty(getTestCliCommand(['rename']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Branch Name', input: 'answered\n' }],
    });

    expect(answered.status).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('answered');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(before.head);
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
  });

  it('navigates an ambiguous top after an actual terminal branch choice', () => {
    fixture.branch('side', 'child');
    fixture.git(['switch', 'base']);
    const refs = fixture.refs();
    const answered = runCliInPty(getTestCliCommand(['top']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Select a branch', input: 'side' },
        { prompt: '❯   side', input: '\r' },
      ],
    });
    expect(answered.status, answered.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('side');
    expect(answered.output).to.include('Checked out side.');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('retains initialized trunk when terminal onboarding is cancelled', () => {
    fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_repo_config'));
    const before = fixture.snapshot();
    const cancelled = runCliInPty(
      getTestCliCommand(['init', '--trunk', 'main']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Would you like to start tracking', input: '\u0003' },
        ],
      }
    );
    expect(cancelled.status, cancelled.output).to.equal(1);
    expect(cancelled.output).to.include('Trunk set to main');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.inspectionSnapshot();
  });

  it('honors effective booleans and terminal defaults without silently choosing', () => {
    const before = fixture.snapshot();
    for (const args of [
      ['rename'],
      ['rename', '--quiet', '--interactive'],
      ['--interactive', '--quiet', 'rn'],
      ['rename', '-q'],
      ['rename', '--quiet=false', '--no-interactive'],
      ['rename', '--no-quiet', '--interactive=false'],
      ['checkout'],
      ['move'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, args.join(' ')).to.equal(1);
      expect(result.stdout, args.join(' ')).to.equal('');
      expect(result.stderr, args.join(' ')).not.to.equal('');
      expect(fixture.snapshot()).to.deep.equal(before);
    }
  });

  it('never opens a required prompt with half a terminal, even when explicitly requested', () => {
    const wrapper = `
import json, os, subprocess, sys
command = json.loads(sys.argv[1])
if sys.argv[2] == 'stdin-pipe':
    result = subprocess.run(command, input=b'', timeout=4)
elif sys.argv[2] == 'stdout-pipe':
    result = subprocess.run(command, stdout=subprocess.PIPE, timeout=4)
    sys.stdout.buffer.write(result.stdout)
else:
    result = subprocess.run(command, preexec_fn=lambda: os.close(0), timeout=4)
sys.exit(result.returncode)
`;
    const before = fixture.snapshot();
    for (const descriptor of ['stdin-pipe', 'stdout-pipe', 'closed-stdin']) {
      for (const flags of [[], ['--interactive']]) {
        const result = runCliInPty(
          [
            '/usr/bin/python3',
            '-c',
            wrapper,
            JSON.stringify(getTestCliCommand(['rename', ...flags])),
            descriptor,
          ],
          { cwd: fixture.repo, env: fixture.env }
        );

        expect(result.status, result.output).to.equal(1);
        expect(result.output).not.to.include('Enter new name');
        expect(result.output).not.to.include('Branch Name');
        expect(fixture.snapshot()).to.deep.equal(before);
      }
    }
  });

  it('uses the last same-option value while quiet and legacy environment dominate', () => {
    for (const [offset, flags] of [
      ['1', ['--no-interactive', '--interactive']],
      ['2', ['--quiet', '--quiet=false']],
      ['3', ['-q=false', '--interactive=true']],
    ] as const) {
      const name = `answered-${offset}`;
      const result = runCliInPty(getTestCliCommand(['rn', ...flags]), {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Branch Name', input: `${name}\n` }],
      });

      expect(result.status, result.output).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal(name);
    }
    const before = fixture.snapshot();
    for (const flags of [
      ['--interactive', '--no-interactive'],
      ['--quiet', '--interactive'],
      ['--interactive', '--quiet'],
    ]) {
      const result = runCliInPty(getTestCliCommand(['rename', ...flags]), {
        cwd: fixture.repo,
        env: fixture.env,
      });

      expect(result.status).to.equal(1);
      expect(result.output).not.to.include('Branch Name');
      expect(fixture.snapshot()).to.deep.equal(before);
    }
    for (const value of ['1', 'false']) {
      fixture.env.GRAPHITE_INTERACTIVE = value;
      const result = runCliInPty(
        getTestCliCommand(['rename', '--interactive']),
        { cwd: fixture.repo, env: fixture.env }
      );

      expect(result.status).to.equal(1);
      expect(result.output).not.to.include('Branch Name');
      expect(fixture.snapshot()).to.deep.equal(before);
    }
  });

  it('rejects malformed options but preserves literal string values and Git tails', () => {
    const before = fixture.snapshot();
    for (const flag of [
      '--quiet=invalid',
      '--interactive=0',
      '--no-quiet=invalid',
      '--q=invalid',
      '-q=invalid',
      '-aq=invalid',
      '-mq=invalid',
      '-qq=invalid',
      '-q.enabled=true',
      '--quiet.enabled=true',
      '--no-interactive.enabled=false',
      '--quiet[0]=true',
    ]) {
      const restore = fixture.refuseExternalTools();
      const result = fixture.run(['create', 'unwanted', flag, '--help']);
      restore();
      expect(result.status, flag).to.equal(1);
      expect(result.stdout, flag).to.equal('');
      expect(result.stderr, flag).not.to.equal('');
      expect(fixture.snapshot()).to.deep.equal(before);
    }
    fs.writeFileSync(path.join(fixture.repo, 'literal'), 'literal');
    fixture.git(['add', 'literal']);
    const created = fixture.run([
      'create',
      'literal',
      '--message=--quiet=invalid',
      '--no-interactive',
    ]);
    expect(created.status, created.stdout + created.stderr).to.equal(0);
    expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(
      '--quiet=invalid'
    );
    fs.writeFileSync(path.join(fixture.repo, 'short-literal'), 'short literal');
    fixture.git(['add', 'short-literal']);
    const short = fixture.run([
      'create',
      'short-literal',
      '-m=--interactive=invalid',
      '--no-interactive',
    ]);
    expect(short.status, short.stdout + short.stderr).to.equal(0);
    expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(
      '--interactive=invalid'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '--interactive=invalid'),
      'payload'
    );
    const added = fixture.run(['add', '--', '--interactive=invalid']);
    expect(added.status, added.stdout + added.stderr).to.equal(0);
    expect(fixture.git(['show', ':--interactive=invalid'])).to.equal('payload');
    const raw = fixture.run(['status', '--quiet=invalid']);
    expect(raw.status).to.equal(129);
    expect(raw.stderr).to.include('unknown option');
  });

  it('preserves a quiet short cluster whose message option owns the value', () => {
    fs.writeFileSync(path.join(fixture.repo, 'cluster'), 'cluster');
    fixture.git(['add', 'cluster']);
    const created = fixture.run(['create', 'cluster', '-qm=literal']);
    expect(created.status, created.stdout + created.stderr).to.equal(0);
    expect(fixture.git(['log', '-1', '--format=%B'])).to.equal('literal');
    expect(fixture.git(['branch', '--show-current'])).to.equal('cluster');
    fs.writeFileSync(path.join(fixture.repo, 'cluster-again'), 'cluster again');
    fixture.git(['add', 'cluster-again']);
    const repeated = fixture.run([
      'create',
      'cluster-again',
      '-aqm=--interactive=invalid',
    ]);
    expect(repeated.status, repeated.stdout + repeated.stderr).to.equal(0);
    expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(
      '--interactive=invalid'
    );
  });

  it('applies quiet and input validation only to the selected cwd repository', () => {
    const target = new CwdCliFixture();
    delete target.env.GRAPHITE_INTERACTIVE;
    try {
      target.commit('only-target');
      target.git(['status', '--porcelain=v1']);
      const start = fixture.snapshot();
      const revision = target.git(['rev-parse', 'HEAD']);
      const renamed = fixture.run([
        '--cwd',
        target.repo,
        'rename',
        'selected-target',
        '--quiet',
      ]);
      expect(renamed.status, renamed.stdout + renamed.stderr).to.equal(0);
      expect(renamed.stdout).to.equal('');
      expect(target.git(['branch', '--show-current'])).to.equal(
        'selected-target'
      );
      expect(target.git(['rev-parse', 'HEAD'])).to.equal(revision);
      expect(fixture.snapshot()).to.deep.equal(start);
      const before = target.snapshot();
      const invalid = fixture.run([
        'create',
        'never-created',
        '--cwd',
        target.repo,
        '--interactive=invalid',
      ]);
      expect(invalid.status).to.equal(1);
      expect(invalid.stdout).to.equal('');
      expect(invalid.stderr).to.include('interactive');
      expect(fixture.snapshot()).to.deep.equal(start);
      expect(target.snapshot()).to.deep.equal(before);
    } finally {
      target.cleanup();
    }
  });

  it('validates policy options before special completion without executing its callbacks', () => {
    for (const flags of [
      ['--get-yargs-completions'],
      ['--get-yargs-completions=false'],
      ['--no-get-yargs-completions'],
      ['--get-yargs-completions.child=false'],
    ]) {
      const restore = fixture.refuseExternalTools();
      const result = fixture.run([
        '--version=true',
        ...flags,
        'an',
        'checkout',
        '',
        '--quiet=invalid',
      ]);
      restore();
      expect(result.status, JSON.stringify(flags) + result.stdout).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('quiet');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    }
  });
});
