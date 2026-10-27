import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import {
  getFullLogNodes,
  getShortLogNodes,
  LogStepsCliFixture,
} from '../lib/fixtures/log_steps_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

const routes = [['log'], ['log', 'short']] as const;

// eslint-disable-next-line max-lines-per-function
describe('zero-depth log options and transports through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  beforeEach(function () {
    fixture = new LogStepsCliFixture('branched');
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'log-options-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          fixture: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      const target = path.join(evidence, path.basename(fixture.root));
      fs.mkdirSync(target, { recursive: true });
      for (const name of ['zero-pager.js', 'pager-input', 'pager-log']) {
        const source = path.join(fixture.root, name);
        if (fs.existsSync(source))
          fs.copyFileSync(source, path.join(target, name));
      }
    }
    fixture.cleanup();
  });

  function pager(mode: 'consume' | 'fail' | 'stop' = 'consume') {
    const script = path.join(fixture.root, 'zero-pager.js');
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
              "process.stdout.write('ZERO_PAGED_ONCE\\n');",
            ]
          : [
              "process.stdout.write('ZERO_PAGER_STOPPED\\n');",
              `process.exitCode=${mode === 'fail' ? 23 : 0};`,
            ]),
      ].join('\n')
    );
    const command = `'${process.execPath}' '${script}' --zero-argument`;
    for (const key of ['CH_PAGER', 'GIT_PAGER', 'PAGER'])
      fixture.env[key] = command;
    return { input, log };
  }

  function terminal(args: readonly string[]) {
    const result = runCliInPty(getTestCliCommand(args), {
      cwd: fixture.repo,
      env: fixture.env,
    });
    fixture.savePty(result);
    return result;
  }

  function expectCurrentOnly(output: string, route: readonly string[]): void {
    const current = fixture.git(['branch', '--show-current']);
    if (route.length === 1) {
      expect(getFullLogNodes(output)).to.deep.equal([current]);
      expect(output).to.include(`${current} (current)`);
      expect(output)
        .to.include(fixture.git(['rev-parse', '--short', 'HEAD']))
        .and.include(fixture.git(['log', '-1', '--format=%s']));
    } else {
      expect(getShortLogNodes(output)).to.deep.equal([current]);
      expect(output.match(/^◉/gm)).to.have.length(1);
      expect(output).not.to.include('(current)');
    }
  }

  it('keeps current-only selection with true and false stack options in either order', () => {
    const before = fixture.logSnapshot();
    for (const route of routes) {
      for (const flags of [
        ['--steps', '0'],
        ['--steps', '0', '--stack'],
        ['--steps', '0', '--no-stack'],
        ['--no-stack', '--steps', '0'],
        ['--steps=0', '--stack=false'],
        ['--stack=false', '-n0'],
      ]) {
        const result = fixture.run([...route, ...flags, '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expectCurrentOnly(result.stdout, route);
        expect(result.stderr).to.equal('');
      }
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('keeps exactly the same selected node when reversed', () => {
    const before = fixture.logSnapshot();
    for (const route of routes) {
      const result = fixture.run([
        ...route,
        '--steps',
        '0',
        '--reverse',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expectCurrentOnly(result.stdout, route);
      expect(result.stderr).to.equal('');
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('retains the explicitly requested untracked section separately from the graph', () => {
    const before = fixture.logSnapshot();
    for (const route of routes) {
      const hidden = fixture.run([...route, '-n0', '--no-interactive']);
      expect(hidden.status, hidden.stderr).to.equal(0);
      expect(hidden.stdout).not.to.include('Untracked branches:');
      for (const flag of ['--show-untracked', '-u']) {
        const result = fixture.run([...route, '-n0', flag, '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const [graph, untracked] = result.stdout.split('Untracked branches:');
        expectCurrentOnly(graph, route);
        expect(untracked.trim().split('\n')).to.deep.equal(['scratch']);
        expect(result.stderr).to.equal('');
      }
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('preserves omitted, positive and already accepted negative and fractional depths', () => {
    const before = fixture.logSnapshot();
    const selectedStack = [
      'main',
      'base',
      'search',
      'ui',
      'empty-tip',
      'feature/café-long-branch-name-for-terminal-width',
    ];
    const limited = [
      'base',
      'search',
      'ui',
      'feature/café-long-branch-name-for-terminal-width',
    ];
    const cases = [
      {
        flags: [],
        expected: [...selectedStack, 'api', 'api-followup', 'maintenance'],
      },
      { flags: ['--stack'], expected: selectedStack },
      { flags: ['--steps', '1'], expected: limited },
      { flags: ['--steps', '2'], expected: selectedStack },
      { flags: ['--steps', '-1'], expected: [...limited, 'empty-tip'] },
      { flags: ['--steps', '1.5'], expected: [...limited, 'empty-tip'] },
    ];
    for (const route of routes) {
      for (const { flags, expected } of cases) {
        const result = fixture.run([...route, ...flags, '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const nodes =
          route.length === 1
            ? getFullLogNodes(result.stdout)
            : getShortLogNodes(result.stdout);
        expect(nodes)
          .to.have.members(expected)
          .and.have.length(expected.length);
        expect(result.stderr).to.equal('');
      }
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('preserves classic precedence and uses corrected selection when classic is false', () => {
    const before = fixture.logSnapshot();
    for (const route of [...routes, ['l'], ['ls']]) {
      const classic = fixture.run([
        ...route,
        '--steps',
        '0',
        '--classic',
        '--reverse',
        '--stack',
        '--show-untracked',
        '--no-interactive',
      ]);
      expect(classic.status, classic.stderr).to.equal(0);
      for (const branch of [
        'main',
        'base',
        'search',
        'ui',
        'api',
        'maintenance',
      ])
        expect(classic.stdout).to.include(`↱ $ ${branch}`);
      expect(classic.stdout).not.to.include('Untracked branches:');
      expect(classic.stderr).to.equal('');
    }
    for (const route of routes) {
      const ordinary = fixture.run([
        ...route,
        '--steps',
        '0',
        '--classic=false',
        '--no-interactive',
      ]);
      expect(ordinary.status, ordinary.stderr).to.equal(0);
      expectCurrentOnly(ordinary.stdout, route);
      expect(ordinary.stderr).to.equal('');
    }
    const shortClassic = fixture.run(['ls', '-c', '-n0', '--no-interactive']);
    expect(shortClassic.status, shortClassic.stderr).to.equal(0);
    expect(shortClassic.stdout)
      .to.include('↱ $ main')
      .and.include('↱ $ search');
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('preserves the long commit graph while ignoring accepted display selectors', () => {
    const before = fixture.logSnapshot();
    for (const route of [['log', 'long'], ['log', 'l'], ['ll']]) {
      const result = fixture.run([...route, '--no-interactive']);
      expect(result.status, result.stderr).to.equal(0);
      for (const branch of [
        'main',
        'base',
        'search',
        'ui',
        'api',
        'maintenance',
      ]) {
        expect(result.stdout).to.include(branch);
        expect(result.stdout).to.include(
          fixture.git(['rev-parse', '--short', branch])
        );
        expect(result.stdout).to.include(
          fixture.git(['log', '-1', '--format=%s', branch])
        );
      }
      expect(result.stdout).not.to.include('↱ $');
      expect(result.stderr).to.equal('');
      const ignored = fixture.run([
        ...route,
        '--steps',
        '0',
        '--no-interactive',
      ]);
      expect(ignored.status, ignored.stderr).to.equal(0);
      expect(ignored.stdout).to.equal(result.stdout);
      expect(ignored.stderr).to.equal('');
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('delivers actual current-only full and short content to the configured terminal pager', () => {
    const selected = pager();
    const before = fixture.logSnapshot();
    for (const route of routes) {
      const direct = fixture.run([...route, '-n0', '--no-interactive']);
      expect(direct.status, direct.stderr).to.equal(0);
      expectCurrentOnly(direct.stdout, route);
      const result = terminal([...route, '-n0', '--interactive']);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include('ZERO_PAGED_ONCE');
      expect(result.output).not.to.include('search');
      const input = fs.readFileSync(selected.input, 'utf8');
      expectCurrentOnly(input, route);
      expect(input).to.equal(direct.stdout.replace(/\n$/, ''));
      const invocations = fs
        .readFileSync(selected.log, 'utf8')
        .trim()
        .split('\n');
      expect(invocations).to.have.length(1);
      expect(JSON.parse(invocations[0])).to.deep.equal({
        args: ['--zero-argument'],
        cwd: fs.realpathSync(fixture.repo),
      });
      fs.unlinkSync(selected.log);
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('keeps pipe, quiet and non-interactive output from launching external tools', () => {
    const selected = pager();
    const before = fixture.logSnapshot();
    for (const route of routes) {
      for (const flag of ['--interactive', '--no-interactive']) {
        const result = fixture.run([...route, '-n0', flag]);
        expect(result.status, result.stderr).to.equal(0);
        expectCurrentOnly(result.stdout, route);
        expect(result.stderr).to.equal('');
      }
      const quiet = fixture.run([...route, '-n0', '--interactive', '--quiet']);
      expect(quiet.status, quiet.stderr).to.equal(0);
      expect(quiet.stdout + quiet.stderr).to.equal('');
      const terminalQuiet = terminal([
        ...route,
        '-n0',
        '--interactive',
        '--quiet',
      ]);
      expect(terminalQuiet.status, terminalQuiet.output).to.equal(0);
      expect(terminalQuiet.output).to.equal('');
      const terminalDirect = terminal([...route, '-n0', '--no-interactive']);
      expect(terminalDirect.status, terminalDirect.output).to.equal(0);
      expectCurrentOnly(terminalDirect.output.replace(/\r\n/g, '\n'), route);
      expect(fs.existsSync(selected.log)).to.equal(false);
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  for (const mode of ['fail', 'stop'] as const) {
    it(`retains ${
      mode === 'fail' ? 'failure reporting' : 'early normal exit'
    } for a zero-depth pager`, () => {
      const selected = pager(mode);
      const before = fixture.logSnapshot();
      for (const route of routes) {
        const result = terminal([...route, '-n0', '--interactive']);
        expect(result.status, result.output).to.equal(mode === 'fail' ? 1 : 0);
        expect(result.output).to.include('ZERO_PAGER_STOPPED');
        if (mode === 'fail') expect(result.output).to.include('ERROR:');
        expect(result.output).not.to.include('search');
        expect(
          fs.readFileSync(selected.log, 'utf8').trim().split('\n')
        ).to.have.length(1);
        fs.unlinkSync(selected.log);
      }
      expect(fixture.logSnapshot()).to.deep.equal(before);
    });
  }
});
