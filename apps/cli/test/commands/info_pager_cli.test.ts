import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('info output policy through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.env.CH_PAGER = '';
    fixture.env.TEST_CH_PAGER = '';
    fixture.env.GIT_PAGER = '';
    fixture.env.PAGER = '';
    delete fixture.env.GRAPHITE_INTERACTIVE;
    delete fixture.env.LESS;
    delete fixture.env.LV;
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'staged local change'
    );
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'unstaged local change'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked'),
      Buffer.from([0, 255, 13])
    );
    fs.symlinkSync('untracked', path.join(fixture.repo, 'local-link'));
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nignored\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'ignored'), 'ignored bytes');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_persist'),
      Buffer.from([255, 0, 123])
    );
  });
  afterEach(() => fixture?.cleanup());

  function installPager(mode = 'consume'): {
    readonly command: string;
    readonly log: string;
    readonly input: string;
  } {
    const script = path.join(fixture.root, 'pager.js');
    const log = path.join(fixture.root, 'pager.jsonl');
    const input = path.join(fixture.root, 'pager-input');
    fs.writeFileSync(
      script,
      [
        "const fs = require('fs');",
        `fs.appendFileSync(${JSON.stringify(
          log
        )}, JSON.stringify({argv:process.argv.slice(2), less:process.env.LESS, lv:process.env.LV})+'\\n');`,
        ...(mode === 'consume'
          ? [
              `fs.writeFileSync(${JSON.stringify(input)}, fs.readFileSync(0));`,
              "process.stdout.write('PAGER_CONSUMED\\n');",
            ]
          : [
              `process.stdout.write('PAGER_${
                mode === 'fail' ? 'FAILED' : 'QUIT'
              }\\n');`,
              `process.exitCode = ${mode === 'fail' ? 23 : 0};`,
            ]),
      ].join('\n')
    );
    return {
      command: `'${process.execPath}' '${script}' --fixture-argument`,
      log,
      input,
    };
  }

  function runTerminal(
    args: ReadonlyArray<string>,
    descriptor = 'both'
  ): { readonly status: number | null; readonly output: string } {
    const command = getTestCliCommand(args);
    const halfTty = `
import os, subprocess, sys, json
command = json.loads(sys.argv[1])
mode = sys.argv[2]
if mode == 'stdin-pipe':
    result = subprocess.run(command, input=b'', timeout=10)
elif mode == 'stdout-pipe':
    result = subprocess.run(command, stdout=subprocess.PIPE, timeout=10)
    sys.stdout.buffer.write(result.stdout)
else:
    result = subprocess.run(command, preexec_fn=lambda: os.close(0), timeout=10)
sys.exit(result.returncode)
`;
    const argv =
      descriptor === 'both'
        ? command
        : [
            '/usr/bin/python3',
            '-c',
            halfTty,
            JSON.stringify(command),
            descriptor,
          ];
    const result = runCliInPty(argv, { cwd: fixture.repo, env: fixture.env });
    fixture.savePty(result);
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'info-pager-pty.jsonl'),
        JSON.stringify({ command, descriptor, argv, result }) + '\n'
      );
    }
    return result;
  }

  function expectUntouched(before: Readonly<Record<string, unknown>>): void {
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      for (const name of ['pager.jsonl', 'pager-input']) {
        const source = path.join(fixture.root, name);
        if (fs.existsSync(source))
          fs.copyFileSync(
            source,
            path.join(evidence, `${path.basename(fixture.root)}-${name}`)
          );
      }
    }
  }

  it('suppresses successful quiet content but still validates and reports errors on stderr', () => {
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--patch'], ['--diff'], ['--body']]) {
      const result = fixture.run([
        'info',
        ...flags,
        '--quiet',
        '--interactive',
      ]);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    const ordinary = fixture.run(['info', '--quiet=false']);
    expect(ordinary.status, ordinary.stderr).to.equal(0);
    expect(ordinary.stdout).to.match(/^base\s/);
    fixture.git(['reset', '--hard']);
    fixture.git(['switch', 'main']);
    const errorBefore = fixture.inspectionSnapshot();
    const failure = fixture.run(['info', '--quiet']);
    expect(failure.status).to.equal(1);
    expect(failure.stdout).to.equal('');
    expect(failure.stderr).to.include('previous commit');
    expect(fixture.inspectionSnapshot()).to.deep.equal(errorBefore);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
  it('writes directly to pipes even when interactive and a pager is configured', () => {
    const pager = installPager();
    fixture.env.CH_PAGER = pager.command;
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--interactive'], ['--no-interactive']]) {
      const result = fixture.run(['info', ...flags]);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.match(/^base\s/);
      expect(result.stderr).to.equal('');
      expect(fs.existsSync(pager.log)).to.equal(false);
    }
    expectUntouched(before);
  });

  it('uses the configured external pager with arguments for interactive terminals', () => {
    const pager = installPager();
    fixture.env.CH_PAGER = pager.command;
    fixture.env.LESS = 'override-less';
    fixture.env.LV = 'override-lv';
    const before = fixture.inspectionSnapshot();
    const result = runTerminal(['info']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('PAGER_CONSUMED');
    expect(fs.readFileSync(pager.log, 'utf8'))
      .to.include('--fixture-argument')
      .and.include('override-less')
      .and.include('override-lv');
    expect(fs.readFileSync(pager.input, 'utf8')).to.match(/^base\s/);
    expectUntouched(before);
  });

  it('reports a failed pager without repeating branch content', () => {
    const pager = installPager('fail');
    fixture.env.CH_PAGER = pager.command;
    const before = fixture.inspectionSnapshot();
    const result = runTerminal(['info', '--interactive']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('PAGER_FAILED').and.include('ERROR:');
    expect(result.output).not.to.include('Parent: main');
    expect(result.output.split('PAGER_FAILED').length).to.equal(2);
    expect(
      fs.readFileSync(pager.log, 'utf8').trim().split('\n').length
    ).to.equal(1);
    expectUntouched(before);
  });

  it('treats early exit zero as success under write pressure and preserves a real nonzero failure', () => {
    fs.writeFileSync(
      path.join(fixture.repo, 'large.txt'),
      'large public diff line\n'.repeat(120000)
    );
    fixture.git(['add', 'large.txt']);
    fixture.git(['commit', '-m', 'large pager input']);
    const [executable, ...args] = getTestCliCommand([
      'info',
      '--patch',
      '--no-interactive',
    ]);
    const direct = spawnSync(executable, args, {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 20000,
    });
    if (direct.error) throw direct.error;
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'large-direct.jsonl'),
        JSON.stringify({
          executable,
          args,
          status: direct.status,
          stdout: direct.stdout,
          stderr: direct.stderr,
        }) + '\n'
      );
    }
    expect(direct.status, direct.stderr).to.equal(0);
    const expected = execFileSync(
      'git',
      ['-c', 'color.ui=always', '--no-pager', 'log', '-p', 'main..base', '--'],
      {
        cwd: fixture.repo,
        env: { ...fixture.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }
    ).trim();
    if (evidence)
      fs.writeFileSync(
        path.join(
          evidence,
          `${path.basename(fixture.root)}-large-expected.gitlog`
        ),
        expected
      );
    expect(Buffer.byteLength(direct.stdout)).to.be.greaterThan(2 * 1024 * 1024);
    expect(direct.stdout.endsWith(expected + '\n')).to.equal(true);
    const before = fixture.inspectionSnapshot();
    for (const mode of ['quit', 'fail']) {
      const pager = installPager(mode);
      fixture.env.CH_PAGER = pager.command;
      const result = runTerminal(['info', '--patch', '--interactive']);
      expect(result.status, result.output).to.equal(mode === 'quit' ? 0 : 1);
      expect(result.output).to.include(
        mode === 'quit' ? 'PAGER_QUIT' : 'PAGER_FAILED'
      );
      expect(result.output)
        .not.to.include('Parent: main')
        .and.not.to.include('large public diff line');
      if (mode === 'quit') expect(result.output).not.to.include('ERROR:');
      else expect(result.output).to.include('ERROR:');
      expectUntouched(before);
    }
  });

  it('requires both terminal descriptors and writes directly with closed stdin', () => {
    const pager = installPager();
    fixture.env.CH_PAGER = pager.command;
    const before = fixture.inspectionSnapshot();
    for (const descriptor of ['stdin-pipe', 'stdout-pipe', 'stdin-closed']) {
      const result = runTerminal(['info', '--interactive'], descriptor);
      expect(result.status, result.output).to.equal(0);
      expect(result.output)
        .to.match(/^base\s/)
        .and.include('Parent: main');
      expect(fs.existsSync(pager.log), descriptor).to.equal(false);
      expectUntouched(before);
    }
  });

  it('lets quiet and interaction preferences override a real terminal while quiet=false restores paging', () => {
    const pager = installPager();
    fixture.env.CH_PAGER = pager.command;
    const before = fixture.inspectionSnapshot();
    for (const flags of [
      ['--quiet', '--interactive'],
      ['--quiet', '--no-interactive'],
    ]) {
      const result = runTerminal(['info', ...flags]);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.equal('');
      expect(fs.existsSync(pager.log)).to.equal(false);
      expectUntouched(before);
    }
    const noninteractive = runTerminal(['info', '--no-interactive']);
    expect(noninteractive.status, noninteractive.output).to.equal(0);
    expect(noninteractive.output).to.match(/^base\s/);
    expect(fs.existsSync(pager.log)).to.equal(false);
    fixture.env.GRAPHITE_INTERACTIVE = '1';
    const contextDisabled = runTerminal(['info', '--interactive']);
    expect(contextDisabled.status, contextDisabled.output).to.equal(0);
    expect(contextDisabled.output).to.match(/^base\s/);
    expect(fs.existsSync(pager.log)).to.equal(false);
    delete fixture.env.GRAPHITE_INTERACTIVE;
    const restored = runTerminal(['info', '--quiet=false', '--interactive']);
    expect(restored.status, restored.output).to.equal(0);
    expect(restored.output).to.include('PAGER_CONSUMED');
    expect(fs.readFileSync(pager.input, 'utf8')).to.match(/^base\s/);
    expectUntouched(before);
  });

  it('honors stored pager commands, environment overrides and explicit disabling', () => {
    const pager = installPager();
    fixture.ok(['user', 'pager', '--set', pager.command]);
    delete fixture.env.CH_PAGER;
    const before = fixture.inspectionSnapshot();
    const configured = runTerminal(['info']);
    expect(configured.status, configured.output).to.equal(0);
    expect(configured.output).to.include('PAGER_CONSUMED');
    expect(fs.readFileSync(pager.log, 'utf8'))
      .to.include('FRX')
      .and.include('-c');
    expectUntouched(before);
    fs.unlinkSync(pager.log);
    fixture.env.CH_PAGER = '';
    const overridden = runTerminal(['info']);
    expect(overridden.status, overridden.output).to.equal(0);
    expect(overridden.output).to.match(/^base\s/);
    expect(fs.existsSync(pager.log)).to.equal(false);
    expectUntouched(before);
    delete fixture.env.CH_PAGER;
    fixture.ok(['user', 'pager', '--disable']);
    const disabledBefore = fixture.inspectionSnapshot();
    const disabled = runTerminal(['info']);
    expect(disabled.status, disabled.output).to.equal(0);
    expect(disabled.output).to.match(/^base\s/);
    expect(fs.existsSync(pager.log)).to.equal(false);
    expectUntouched(disabledBefore);
  });

  it('keeps debug and invalid-input diagnostics on stderr with empty error stdout', () => {
    const pager = installPager();
    fixture.env.CH_PAGER = pager.command;
    const before = fixture.inspectionSnapshot();
    const debug = fixture.run(['info', '--debug', '--interactive']);
    expect(debug.status, debug.stderr).to.equal(0);
    expect(debug.stdout)
      .to.match(/^base\s/)
      .and.not.to.include('Reading cache');
    expect(debug.stderr).to.include('Reading cache');
    const invalid = fixture.run([
      'info',
      '--unexpected-info-option',
      '--quiet',
    ]);
    expect(invalid.status).to.equal(1);
    expect(invalid.stdout).to.equal('');
    expect(invalid.stderr).not.to.equal('');
    expect(fs.existsSync(pager.log)).to.equal(false);
    expectUntouched(before);
  });
  it('preserves a real active continuation on pager failure and quiet success', () => {
    fixture.git(['reset', '--hard']);
    const resolve = (contents: string): void => {
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
      fixture.git(['add', 'main.txt']);
    };
    fixture.branch('pager-conflict-base', 'main', true);
    resolve('base own');
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('pager-conflict-child', 'pager-conflict-base', true);
    resolve('child own');
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'pager-conflict-base']);
    fixture.editor('pager-conflict-base\npager-conflict-child\n');
    const conflict = fixture.run(['reorder', '--stack', '--interactive']);
    expect(conflict.status, conflict.stdout + conflict.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const pager = installPager('fail');
    fixture.env.CH_PAGER = pager.command;
    fixture.env.CH_EDITOR = path.join(fixture.root, 'sentinel-bin', 'editor');
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
    const failure = runTerminal(['info', '--interactive']);
    expect(failure.status, failure.output).to.equal(1);
    expect(failure.output).to.include('PAGER_FAILED').and.include('ERROR:');
    expectUntouched(before);
    const quiet = runTerminal(['info', '--quiet', '--interactive']);
    expect(quiet.status, quiet.output).to.equal(0);
    expect(quiet.output).to.equal('');
    expect(
      fs.readFileSync(pager.log, 'utf8').trim().split('\n').length
    ).to.equal(1);
    expectUntouched(before);
    resolve('child own');
    const second = fixture.run(['continue', '--no-interactive']);
    expect(second.status, second.stdout + second.stderr).to.equal(1);
    expect(second.stdout + second.stderr).to.include(
      'Remaining branches: pager-conflict-base'
    );
    resolve('base own');
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'pager-conflict-base'
    );
    expect(
      fixture.git([
        'log',
        '--reverse',
        '--format=%s',
        'main..pager-conflict-base',
      ])
    ).to.equal('child own\nbase own');
  });
});
