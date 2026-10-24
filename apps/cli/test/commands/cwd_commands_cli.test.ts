import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

function preserveObservation(
  fixture: CwdCliFixture,
  name: string,
  file: string
): void {
  const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
  if (!evidence) return;
  fs.mkdirSync(evidence, { recursive: true });
  fs.copyFileSync(
    file,
    path.join(evidence, path.basename(fixture.root) + '-' + name)
  );
}

// eslint-disable-next-line max-lines-per-function
describe('cwd owned commands through the public CLI', function () {
  this.timeout(120000);
  let start: CwdCliFixture;
  let target: CwdCliFixture;
  beforeEach(() => {
    start = new CwdCliFixture();
    target = new CwdCliFixture();
    start.commit('only-start');
    target.commit('only-target');
  });
  afterEach(() => {
    start.cleanup();
    target.cleanup();
  });

  it('leaves owned command payload after its terminator intact, including apparent cwd and help flags', () => {
    const missing = path.join(target.root, 'missing');
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    for (const payload of ['--cwd=' + missing, '--no-cwd', '--help']) {
      const ordinary = target.run(['info', '--no-interactive', '--', payload]);
      const selected = start.run([
        '--cwd',
        target.repo,
        'info',
        '--no-interactive',
        '--',
        payload,
      ]);
      expect(selected.status, selected.stdout + selected.stderr)
        .to.equal(ordinary.status)
        .and.not.equal(0);
      expect(stripAnsi(selected.stdout)).to.equal(stripAnsi(ordinary.stdout));
      expect(stripAnsi(selected.stderr)).to.equal(stripAnsi(ordinary.stderr));
      expect(selected.stderr).to.include('Could not find branch ' + payload);
    }
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('keeps a root documentation request independent of non-command payload after the terminator', () => {
    const missing = path.join(target.root, 'missing-help');
    for (const documentation of ['--help', '--version']) {
      const result = start.run([
        '--cwd',
        missing,
        documentation,
        '--',
        'ordinary-payload',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stderr).to.equal('');
      if (documentation === '--help') expect(result.stdout).to.include('--cwd');
      else expect(result.stdout).to.match(/^1\.0\.1\s*$/);
    }
    expect(fs.existsSync(missing)).to.equal(false);
  });

  it('selects B through nested routes, aliases and existing owned global option combinations', () => {
    const before = start.inspectionSnapshot();
    for (const args of [
      ['--cwd', target.repo, 'log', 'short', '--classic'],
      ['log', '--cwd', target.repo, 'short', '--classic'],
      ['log', 'short', '--classic', '--cwd=' + target.repo],
      ['l', '--cwd', target.repo, 's', '--classic'],
      ['ls', '--cwd', target.repo, '--classic'],
      ['i', '--cwd', target.repo, '--stat'],
      [
        '--debug',
        '--cwd',
        target.repo,
        'info',
        '--verify=false',
        '--quiet=false',
      ],
    ]) {
      const result = start.run([...args, '--no-interactive']);
      expect(
        result.status,
        JSON.stringify(args) + result.stdout + result.stderr
      ).to.equal(0);
      if (args.includes('i') || args.includes('info'))
        expect(stripAnsi(result.stdout))
          .to.include('only-target')
          .and.not.include('only-start');
      else expect(stripAnsi(result.stdout)).to.include('base');
    }
    start.ok(['repo', '--cwd', target.repo, 'name', '--set=target-repo-name']);
    const selected = start.ok(['repo', 'name', '--cwd', target.repo]);
    expect(stripAnsi(selected)).to.include('target-repo-name');
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps literal string option values and numeric subcommand operands intact', () => {
    const before = start.inspectionSnapshot();
    const literal = '--cwd=/not-a-directory --help --version';
    start.ok(['--cwd', target.repo, 'repo', 'name', '--set=' + literal]);
    const selected = start.ok(['repo', '--cwd', target.repo, 'name']);
    expect(stripAnsi(selected)).to.include(literal);
    for (const options of [['--steps', '1'], ['-n', '1'], ['--steps=1']]) {
      const ordinary = target.run([
        'log',
        'short',
        ...options,
        '--no-interactive',
      ]);
      const result = start.run([
        'log',
        '--cwd',
        target.repo,
        'short',
        ...options,
        '--no-interactive',
      ]);
      expect(result.status).to.equal(ordinary.status).and.equal(0);
      expect(stripAnsi(result.stdout)).to.equal(stripAnsi(ordinary.stdout));
      expect(result.stderr).to.equal(ordinary.stderr);
    }
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('uses flag-looking directory names without weakening strict argument validation', () => {
    target.ok(['restack']);
    const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['--branchName=forbidden', ['info', '--stat']],
      [
        '--only=invalid',
        ['move', '--onto', 'main', '--source', 'other', '--only'],
      ],
      [
        '--stack=invalid',
        ['reorder', '--stack', '--input', target.input('tip\nchild\nbase\n')],
      ],
      ['--keep=invalid', ['fold', '--stack']],
    ];
    const before = start.inspectionSnapshot();
    for (const [name, command] of cases) {
      fs.symlinkSync(target.repo, path.join(start.root, name), 'dir');
      const result = start.run(
        [...command, '--cwd=' + name, '--no-interactive'],
        start.root
      );
      expect(
        result.status,
        JSON.stringify(command) + result.stdout + result.stderr
      ).to.equal(0);
    }
    expect(target.ok(['parent'])).to.equal('main\n');
    // A separate explicit relative component is also unambiguous.
    const result = start.run(
      [
        'info',
        '--cwd',
        './--branchName=forbidden',
        '--stat',
        '--no-interactive',
      ],
      start.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    for (const args of [
      ['info', '--stat=wrong'],
      ['info', '--branchName=forbidden'],
      ['move', '--only=wrong', '--onto', 'main'],
      ['fold', '--stack=wrong'],
      ['reorder', '--stack=wrong'],
      ['info', '--cwd-extra=' + target.repo],
      ['info', '--cwdish=' + target.repo],
    ]) {
      const selected = start.run([
        ...args,
        '--cwd',
        target.repo,
        '--no-interactive',
      ]);
      expect(
        selected.status,
        JSON.stringify(args) + selected.stdout + selected.stderr
      ).not.to.equal(0);
      expect(selected.stderr).not.to.include('Cannot use --cwd');
    }
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('initializes only the selected existing Git repository through the public init route', () => {
    const fresh = path.join(target.root, 'fresh-git');
    fs.mkdirSync(fresh);
    target.git(['init', '--initial-branch=target-trunk'], fresh);
    target.git(['config', 'user.name', 'Cwd init fixture'], fresh);
    target.git(['config', 'user.email', 'cwd@example.test'], fresh);
    target.git(['commit', '--allow-empty', '-m', 'fresh target trunk'], fresh);
    target.git(
      ['commit', '--allow-empty', '-m', 'fresh target trunk second'],
      fresh
    );
    const before = start.inspectionSnapshot();
    const result = start.run([
      'init',
      '--cwd',
      fresh,
      '--trunk',
      'target-trunk',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      fs.existsSync(path.join(fresh, '.git', '.graphite_repo_config'))
    ).to.equal(true);
    const inspected = start.run(['info', '--cwd', fresh, '--no-interactive']);
    expect(inspected.status, inspected.stdout + inspected.stderr).to.equal(0);
    expect(stripAnsi(inspected.stdout))
      .to.include('target-trunk')
      .and.include('fresh target trunk');
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('commits staged B content from its selected subdirectory with literal messages and only B hooks', () => {
    const subdirectory = path.join(target.repo, 'nested');
    fs.mkdirSync(subdirectory);
    const startMarker = path.join(start.root, 'hook-start.jsonl');
    const targetMarker = path.join(target.root, 'hook-target.jsonl');
    for (const [fixture, marker] of [
      [start, startMarker],
      [target, targetMarker],
    ] as const) {
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
        `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(
          marker
        )}, JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}) + '\\n');`,
        { mode: 0o755 }
      );
    }
    const before = start.inspectionSnapshot();
    const base = target.git(['rev-parse', 'base']);
    const message = '--cwd=/not-a-directory --help --version';
    fs.writeFileSync(
      path.join(target.repo, 'selected.txt'),
      'staged B content'
    );
    target.git(['add', 'selected.txt']);
    const result = start.run([
      'c',
      'selected-cwd',
      '--cwd',
      subdirectory,
      '--message=' + message,
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(target.git(['branch', '--show-current'])).to.equal('selected-cwd');
    expect(target.git(['rev-parse', 'HEAD^'])).to.equal(base);
    expect(target.git(['show', 'HEAD:selected.txt'])).to.equal(
      'staged B content'
    );
    expect(target.git(['log', '-1', '--format=%B'])).to.equal(message);
    expect(start.ok(['parent', '--cwd', subdirectory])).to.equal('base\n');
    expect(fs.existsSync(startMarker)).to.equal(false);
    preserveObservation(target, 'hook-target.jsonl', targetMarker);
    const hook = fs.readFileSync(targetMarker, 'utf8').trim().split('\n');
    expect(hook).to.deep.equal([
      JSON.stringify({ cwd: fs.realpathSync(target.repo), args: [] }),
    ]);
    const secondMessage = 'ordinary message with --cwd=/still-literal --help';
    fs.writeFileSync(path.join(target.repo, 'second.txt'), 'second B content');
    target.git(['add', 'second.txt']);
    start.ok([
      'create',
      'selected-second',
      '--cwd=' + target.repo,
      '-m',
      secondMessage,
    ]);
    expect(target.git(['show', 'HEAD:second.txt'])).to.equal(
      'second B content'
    );
    expect(target.git(['log', '-1', '--format=%B'])).to.equal(secondMessage);
    expect(start.ok(['parent', '--cwd', target.repo])).to.equal(
      'selected-cwd\n'
    );
    expect(fs.existsSync(startMarker)).to.equal(false);
    expect(
      fs.readFileSync(targetMarker, 'utf8').trim().split('\n')
    ).to.have.length(2);
    preserveObservation(target, 'hook-target.jsonl', targetMarker);
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('passes an atomic test command to the real child in B through a supported terminal run', () => {
    target.git(['switch', 'other']);
    const observation = path.join(target.root, 'test-child.jsonl');
    const script = path.join(target.root, 'test-child.js');
    fs.writeFileSync(
      script,
      `require('fs').appendFileSync(${JSON.stringify(
        observation
      )}, JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}) + '\\n');`
    );
    const quote = (value: string): string =>
      "'" + value.replace(/'/g, "'\\''") + "'";
    const payloadArgs = [
      '--cwd=/literal-child-option',
      '--help',
      '--version',
      'a b',
    ];
    const payload = [process.execPath, script, ...payloadArgs]
      .map(quote)
      .join(' ');
    const before = start.inspectionSnapshot();
    const command = getTestCliCommand([
      'test',
      payload,
      '--cwd',
      target.repo,
      '--upstack',
      '--no-interactive',
    ]);
    const result = runCliInPty(command, { cwd: start.repo, env: start.env });
    const receipt = {
      ...result,
      command,
      cwd: start.repo,
      environment: Object.fromEntries(
        [
          'GRAPHITE_USER_CONFIG_PATH',
          'GRAPHITE_PROFILE',
          'XDG_CONFIG_HOME',
          'GH_CONFIG_DIR',
        ].map((key) => [key, start.env[key] ?? null])
      ),
    };
    target.savePty(receipt);
    preserveObservation(target, 'test-child.jsonl', observation);
    preserveObservation(target, 'test-child.js', script);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('[success]');
    expect(
      fs.readFileSync(observation, 'utf8').trim().split('\n')
    ).to.deep.equal([
      JSON.stringify({ cwd: fs.realpathSync(target.repo), args: payloadArgs }),
    ]);
    expect(target.git(['branch', '--show-current'])).to.equal('other');
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });
});
