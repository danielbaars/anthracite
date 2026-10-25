import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('modern log classic through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    for (const key of ['CH_PAGER', 'PAGER', 'GIT_PAGER']) fixture.env[key] = '';
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-classic-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          fixture: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      const target = path.join(evidence, path.basename(fixture.root));
      fs.mkdirSync(target, { recursive: true });
      for (const name of ['classic-pager.js', 'pager-input', 'pager-log']) {
        const source = path.join(fixture.root, name);
        if (fs.existsSync(source))
          fs.copyFileSync(source, path.join(target, name));
      }
    }
    fixture.cleanup();
  });

  function pager(mode: 'consume' | 'fail' | 'stop' = 'consume') {
    const script = path.join(fixture.root, 'classic-pager.js');
    const input = path.join(fixture.root, 'pager-input');
    const log = path.join(fixture.root, 'pager-log');
    fs.writeFileSync(
      script,
      [
        "const fs = require('fs');",
        `fs.appendFileSync(${JSON.stringify(
          log
        )}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n');`,
        ...(mode === 'consume'
          ? [
              `fs.writeFileSync(${JSON.stringify(input)}, fs.readFileSync(0));`,
              "process.stdout.write('CLASSIC_PAGED_ONCE\\n');",
            ]
          : [
              "process.stdout.write('CLASSIC_PAGER_STOPPED\\n');",
              `process.exitCode=${mode === 'fail' ? 23 : 0};`,
            ]),
      ].join('\n')
    );
    const command = `'${process.execPath}' '${script}' --classic-argument`;
    fixture.env.CH_PAGER = command;
    fixture.env.GIT_PAGER = command;
    fixture.env.PAGER = command;
    return { input, log };
  }

  function terminal(args: readonly string[], descriptor = 'both') {
    const command = getTestCliCommand(args);
    const wrapper = `
import os, subprocess, sys, json
command=json.loads(sys.argv[1])
mode=sys.argv[2]
if mode == 'stdin-pipe':
    result=subprocess.run(command,input=b'',timeout=10)
elif mode == 'stdout-pipe':
    result=subprocess.run(command,stdout=subprocess.PIPE,timeout=10)
    sys.stdout.buffer.write(result.stdout)
else:
    result=subprocess.run(command,preexec_fn=lambda:os.close(0),timeout=10)
sys.exit(result.returncode)
`;
    const actual =
      descriptor === 'both'
        ? command
        : [
            '/usr/bin/python3',
            '-c',
            wrapper,
            JSON.stringify(command),
            descriptor,
          ];
    const result = runCliInPty(actual, { cwd: fixture.repo, env: fixture.env });
    fixture.savePty(result);
    return result;
  }

  it('shows the existing classic stack through ordinary log and preserves its repository', () => {
    const before = fixture.inspectionSnapshot();
    const legacy = fixture.run([
      'log',
      'short',
      '--classic',
      '--no-interactive',
    ]);
    expect(legacy.status, legacy.stdout + legacy.stderr).to.equal(0);
    expect(legacy.stdout).to.include('↱ $ main').and.include('↱ $ base');
    const modern = fixture.run(['log', '--classic', '--no-interactive']);
    expect(modern.status, modern.stdout + modern.stderr).to.equal(0);
    expect(modern.stdout).to.equal(legacy.stdout);
    expect(modern.stderr).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('pages actual classic content exactly once through log and its old short form', () => {
    const before = fixture.inspectionSnapshot();
    const direct = fixture.run([
      'log',
      'short',
      '--classic',
      '--no-interactive',
    ]);
    expect(direct.status, direct.stderr).to.equal(0);
    const selected = pager();
    for (const route of [['log'], ['l'], ['log', 'short'], ['ls']]) {
      const result = terminal([...route, '--classic', '--interactive']);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include('CLASSIC_PAGED_ONCE');
      expect(result.output).not.to.include('↱ $');
      expect(fs.readFileSync(selected.input, 'utf8')).to.equal(
        direct.stdout.replace(/\n$/, '')
      );
      const lines = fs.readFileSync(selected.log, 'utf8').trim().split('\n');
      expect(lines).to.have.length(1);
      expect(JSON.parse(lines[0])).to.deep.equal({
        args: ['--classic-argument'],
        cwd: fs.realpathSync(fixture.repo),
      });
      fs.unlinkSync(selected.log);
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const alias of ['l', 'ls']) {
    it(`keeps ${alias} equivalent to its canonical classic form`, () => {
      const before = fixture.inspectionSnapshot();
      const expected = fixture.run(['log', 'short', '--classic']).stdout;
      const result = fixture.run([alias, '--classic']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.equal(expected);
      expect(result.stdout).to.include('↱ $ main').and.include('↱ $ tip');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  it('keeps FULL and SHORT defaults distinct when classic is absent or false', () => {
    const before = fixture.inspectionSnapshot();
    const revision = fixture.git(['rev-parse', '--short', 'base']);
    for (const route of [['log'], ['l']]) {
      for (const flags of [
        [],
        ['--classic=false'],
        ['--classic', '--no-classic'],
      ]) {
        const result = fixture.run([...route, ...flags]);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.include(revision).and.include('base');
        expect(result.stdout).not.to.include('↱ $');
      }
    }
    for (const route of [['log', 'short'], ['ls']]) {
      for (const flags of [[], ['--classic=false']]) {
        const result = fixture.run([...route, ...flags]);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.include('base').and.include('main');
        expect(result.stdout)
          .not.to.include(revision)
          .and.not.to.include('↱ $');
      }
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps ll and log long as the existing Git commit graph', () => {
    const before = fixture.inspectionSnapshot();
    const canonical = fixture.run(['log', 'long', '--no-interactive']);
    const alias = fixture.run(['ll', '--no-interactive']);
    expect(canonical.status, canonical.stderr).to.equal(0);
    expect(alias.status, alias.stderr).to.equal(0);
    const stable = (output: string): string =>
      output.replace(/(\b[0-9a-f]+ - )\([^)]*\)/g, '$1(commit age)');
    expect(stable(alias.stdout)).to.equal(stable(canonical.stdout));
    for (const branch of ['main', 'base', 'child', 'tip', 'other']) {
      expect(alias.stdout).to.include(branch);
      expect(alias.stdout).to.include(
        fixture.git(['rev-parse', '--short', branch])
      );
      expect(alias.stdout).to.include(
        fixture.git(['log', '-1', '--format=%s', branch])
      );
    }
    expect(alias.stdout).not.to.include('↱ $');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps ordinary log display flags local rather than changing long grammar', () => {
    const before = fixture.inspectionSnapshot();
    const restoreTools = fixture.refuseExternalTools();
    try {
      for (const args of [
        ['log', 'long', '--classic'],
        ['log', 'long', '--reverse'],
        ['ll', '--classic'],
        ['ll', '--stack'],
        ['log', '--classic', 'long'],
      ]) {
        const result = fixture.run(args, fixture.root);
        expect(result.status, args.join(' ')).not.to.equal(0);
        expect(result.stdout).to.equal('');
        expect(result.stderr).to.include('Unknown argument:');
      }
    } finally {
      restoreTools();
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('retains the classic selector rule and effective boolean value', () => {
    fixture.git(['branch', 'untracked-hidden', 'main']);
    const before = fixture.inspectionSnapshot();
    const expected = fixture.run(['ls', '--classic']).stdout;
    for (const route of [['log'], ['l'], ['log', 'short'], ['ls']]) {
      const result = fixture.run([
        ...route,
        '--no-classic',
        '--classic',
        '--reverse',
        '--stack',
        '--steps',
        '1',
        '--show-untracked',
      ]);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(expected);
      expect(result.stdout).to.include('↱ $ other').and.include('↱ $ tip');
      expect(result.stdout).not.to.include('untracked-hidden');
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('preserves the old short classic flag without adding one to ordinary log', () => {
    const before = fixture.inspectionSnapshot();
    const old = fixture.run(['ls', '-c']);
    expect(old.status, old.stderr).to.equal(0);
    expect(old.stdout).to.include('↱ $ base');
    for (const route of [['log'], ['l']]) {
      const invalid = fixture.run([...route, '-c']);
      expect(invalid.status).not.to.equal(0);
      expect(invalid.stdout).to.equal('');
      expect(invalid.stderr).to.include('Unknown argument: c');
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('writes classic content to pipes and suppresses quiet output without paging', () => {
    const selected = pager();
    const before = fixture.inspectionSnapshot();
    for (const route of [['log'], ['l'], ['log', 'short'], ['ls']]) {
      const direct = fixture.run([...route, '--classic', '--interactive']);
      expect(direct.status, direct.stderr).to.equal(0);
      expect(direct.stdout).to.include('↱ $ base');
      const quiet = fixture.run([
        ...route,
        '--classic',
        '--interactive',
        '--quiet',
      ]);
      expect(quiet.status, quiet.stderr).to.equal(0);
      expect(quiet.stdout + quiet.stderr).to.equal('');
      const restored = fixture.run([
        ...route,
        '--classic',
        '--quiet=false',
        '--interactive',
      ]);
      expect(restored.status, restored.stderr).to.equal(0);
      expect(restored.stdout).to.equal(direct.stdout);
    }
    expect(fs.existsSync(selected.log)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('does not page classic for half terminals or a closed stdin', () => {
    const selected = pager();
    const before = fixture.inspectionSnapshot();
    for (const route of [['log'], ['l'], ['ls']]) {
      for (const descriptor of ['stdin-pipe', 'stdout-pipe', 'stdin-closed']) {
        const result = terminal(
          [...route, '--classic', '--interactive'],
          descriptor
        );
        expect(result.status, result.output).to.equal(0);
        expect(result.output).to.include('↱ $ base');
        expect(fs.existsSync(selected.log), descriptor).to.equal(false);
      }
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('obeys quiet, noninteractive and legacy restrictions at a real terminal', () => {
    const selected = pager();
    const before = fixture.inspectionSnapshot();
    for (const route of [['log'], ['l'], ['ls']]) {
      const quiet = terminal([
        ...route,
        '--classic',
        '--interactive',
        '--quiet',
      ]);
      expect(quiet.status, quiet.output).to.equal(0);
      expect(quiet.output).to.equal('');
      const noInteraction = terminal([
        ...route,
        '--classic',
        '--no-interactive',
      ]);
      expect(noInteraction.status, noInteraction.output).to.equal(0);
      expect(noInteraction.output).to.include('↱ $ base');
      fixture.env.GRAPHITE_INTERACTIVE = '1';
      const legacy = terminal([...route, '--classic', '--interactive']);
      delete fixture.env.GRAPHITE_INTERACTIVE;
      expect(legacy.status, legacy.output).to.equal(0);
      expect(legacy.output).to.include('↱ $ base');
      expect(fs.existsSync(selected.log)).to.equal(false);
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('reports a real classic pager failure without replaying the stack', () => {
    const selected = pager('fail');
    const before = fixture.inspectionSnapshot();
    for (const route of [['log'], ['ls']]) {
      const failed = terminal([...route, '--classic', '--interactive']);
      expect(failed.status, failed.output).to.equal(1);
      expect(failed.output)
        .to.include('CLASSIC_PAGER_STOPPED')
        .and.include('ERROR:');
      expect(failed.output).not.to.include('↱ $');
      expect(
        fs.readFileSync(selected.log, 'utf8').trim().split('\n')
      ).to.have.length(1);
      fs.unlinkSync(selected.log);
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('accepts an early normal classic pager exit without fallback rendering', () => {
    const selected = pager('stop');
    const result = terminal(['log', '--classic', '--interactive']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('CLASSIC_PAGER_STOPPED');
    expect(result.output).not.to.include('↱ $');
    expect(
      fs.readFileSync(selected.log, 'utf8').trim().split('\n')
    ).to.have.length(1);
  });

  it('selects cwd for classic while preserving both dirty repositories and a linked worktree', () => {
    const start = new CwdCliFixture();
    try {
      start.branch('start-only', 'main', true);
      fixture.branch('target-only', 'main', true);
      const linked = path.join(fixture.root, 'linked δ classic');
      fixture.git(['worktree', 'add', linked, 'other']);
      for (const selected of [start, fixture]) {
        fs.writeFileSync(path.join(selected.repo, 'main.txt'), 'staged main');
        selected.git(['add', 'main.txt']);
        fs.appendFileSync(
          path.join(selected.repo, 'main.txt'),
          '\nworking main'
        );
        fs.writeFileSync(path.join(selected.repo, 'untracked.txt'), 'keep me');
        selected.git(['status', '--porcelain']);
      }
      fs.writeFileSync(path.join(linked, 'untracked.txt'), 'keep linked');
      const before = [
        start.inspectionSnapshot(),
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ];
      for (const args of [
        ['--cwd', path.relative(start.repo, linked), 'log', '--classic'],
        ['l', '--classic', '--cwd=' + linked],
      ]) {
        const result = start.run(args);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout)
          .to.include('↱ $ target-only')
          .and.not.to.include('start-only');
        expect([
          start.inspectionSnapshot(),
          fixture.inspectionSnapshot(),
          fixture.inspectionSnapshot(linked),
        ]).to.deep.equal(before);
      }
    } finally {
      start.cleanup();
    }
  });

  it('preserves an actual pending continuation through classic and legacy log views', () => {
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child content');
    fixture.git(['commit', '-am', 'child conflict']);
    fixture.git(['switch', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base content');
    fixture.git(['commit', '--amend', '-am', 'base conflict']);
    const conflict = fixture.run(['restack', '--quiet']);
    expect(conflict.status).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const before = fixture.inspectionSnapshot();
    for (const route of [
      ['log', '--classic'],
      ['l', '--classic'],
      ['log', 'short', '--classic'],
      ['ls', '--classic'],
      ['log'],
      ['ls'],
      ['log', 'long'],
      ['ll'],
    ]) {
      const result = fixture.run([...route, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.include('base').and.include('main');
      expect(fixture.inspectionSnapshot(), route.join(' ')).to.deep.equal(
        before
      );
    }
    const unresolved = fixture.run(['continue', '--quiet']);
    expect(unresolved.status).to.equal(1);
    expect(unresolved.stderr).to.include('not yet resolved');
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'resolved base and child'
    );
    fixture.git(['add', 'main.txt']);
    const resolved = fixture.run(['continue', '--no-interactive']);
    expect(resolved.status, resolved.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['log', '--format=%s', 'main..tip'])).to.include(
      'child conflict'
    );
  });

  it('documents and completes the real classic option outside Git without UI', () => {
    const selected = pager();
    const before = fixture.inspectionSnapshot();
    const restoreTools = fixture.refuseExternalTools();
    try {
      for (const route of [['log'], ['l']]) {
        const help = fixture.run([...route, '--help', '--quiet'], fixture.root);
        expect(help.status, help.stderr).to.equal(0);
        expect(help.stdout)
          .to.include('--classic')
          .and.include('Other log display options');
        expect(help.stderr).to.equal('');
        const completion = fixture.run(
          ['--quiet', '--get-yargs-completions', 'ch', ...route, '--'],
          fixture.root
        );
        expect(completion.status, completion.stderr).to.equal(0);
        expect(completion.stdout).to.include('--classic');
        expect(completion.stderr).to.equal('');
      }
    } finally {
      restoreTools();
    }
    expect(fs.existsSync(selected.log)).to.equal(false);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
