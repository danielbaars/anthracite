import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

import { LogStepsCliFixture } from '../lib/fixtures/log_steps_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('long log presentation through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  beforeEach(() => {
    fixture = new LogStepsCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('retains unknown-option refusals, global policies and one pager delivery', () => {
    const before = fixture.logSnapshot();
    for (const args of [
      ['ll', '--invented-log-option'],
      ['ll', '-c'],
      ['log', '-c'],
      ['log', '--all'],
      ['ls', '-a'],
    ]) {
      const refused = fixture.run(args);
      expect(refused.status, args.join(' ')).not.to.equal(0);
      expect(refused.stdout).to.equal('');
      expect(refused.stderr).to.include('Unknown argument');
    }
    const baseline = fixture.run(['ll', '--no-interactive']);
    const input = path.join(fixture.root, 'pager-input');
    const log = path.join(fixture.root, 'pager-log');
    const script = path.join(fixture.root, 'pager.js');
    fs.writeFileSync(
      script,
      `const fs = require('fs');
fs.appendFileSync(${JSON.stringify(log)}, 'PAGED\\n');
fs.writeFileSync(${JSON.stringify(input)}, fs.readFileSync(0));
process.stdout.write('PAGED_ONCE\\n');`
    );
    fixture.env.CH_PAGER = `'${process.execPath}' '${script}'`;
    const terminal = (args: readonly string[]) =>
      runCliInPty(getTestCliCommand(args), {
        cwd: fixture.repo,
        env: fixture.env,
      });
    const quiet = terminal(['ll', '--reverse', '--interactive', '--quiet']);
    expect(quiet.status, quiet.output).to.equal(0);
    expect(quiet.output).to.equal('');
    const direct = terminal(['ll', '--stack', '--no-interactive']);
    expect(direct.status, direct.output).to.equal(0);
    expect(direct.output).to.include(
      'Own change mentions main and maintenance'
    );
    expect(fs.existsSync(log)).to.equal(false);
    const cwd = fixture.run(
      ['ll', '--cwd', fixture.repo, '--debug', '--no-interactive'],
      fixture.root
    );
    expect(cwd.status, cwd.stderr).to.equal(0);
    expect(cwd.stdout).to.equal(baseline.stdout);
    expect(cwd.stderr).not.to.equal('');
    const paged = terminal(['log', 'long', '--all', '--interactive']);
    expect(paged.status, paged.output).to.equal(0);
    expect(paged.output).to.include('PAGED_ONCE');
    expect(paged.output).not.to.include('Own change');
    expect(fs.readFileSync(log, 'utf8')).to.equal('PAGED\n');
    expect(fs.readFileSync(input, 'utf8')).to.equal(baseline.stdout);
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('documents aliases once and completes the supported long options outside Git', () => {
    const before = fixture.logSnapshot();
    const restore = fixture.refuseExternalTools();
    try {
      for (const route of [['log'], ['log', 'short'], ['ls']]) {
        const help = fixture.run([...route, '--help'], fixture.root);
        expect(help.status, help.stderr).to.equal(0);
        for (const alias of ['r', 's', 'n', 'u'])
          expect(
            help.stdout.match(new RegExp(`-${alias}(?=[, ])`, 'g'))
          ).to.have.length(1);
        expect(help.stdout).to.include('separate section');
        expect(help.stdout).not.to.include('interactive selection');
      }
      for (const route of [['log', 'long'], ['ll']]) {
        const help = fixture.run([...route, '--help'], fixture.root);
        const completion = fixture.run(
          ['--get-yargs-completions', 'an', ...route, '--'],
          fixture.root
        );
        expect(help.status, help.stderr).to.equal(0);
        expect(completion.status, completion.stderr).to.equal(0);
        expect(help.stdout).to.include('ignored in long mode');
        for (const flag of [
          'classic',
          'reverse',
          'stack',
          'steps',
          'show-untracked',
          'all',
        ]) {
          expect(help.stdout).to.include(`--${flag}`);
          expect(completion.stdout).to.include(`--${flag}`);
        }
        expect(help.stdout).not.to.match(/-c[, ]/);
      }
    } finally {
      restore();
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('delivers the complete non-paged graph without an added final LF', () => {
    const largeSubject = 'Large delivery ' + 'x'.repeat(96 * 1024) + ' END';
    fixture.git(['commit', '--allow-empty', '-m', largeSubject]);
    const before = fixture.logSnapshot();
    const result = fixture.run(['log', 'long', '--no-interactive']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.include(largeSubject);
    expect(result.stdout).to.include(
      'Own change mentions main and maintenance'
    );
    expect(result.stdout).to.include('main');
    expect(Buffer.from(result.stdout).subarray(-1).toString()).not.to.equal(
      '\n'
    );
    expect(result.stderr).to.equal('');
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });

  it('accepts known display selectors without changing the ancestry graph across long routes', () => {
    const before = fixture.logSnapshot();
    const baseline = fixture.run(['ll', '--no-interactive']);
    expect(baseline.status, baseline.stderr).to.equal(0);
    for (const args of [
      [
        'log',
        'long',
        '--classic',
        '--reverse',
        '--stack',
        '--steps',
        '0',
        '--show-untracked',
        '--all',
      ],
      ['log', 'l', '-r', '-s', '-n', '1', '-u', '-a'],
      ['l', 'long', '--classic'],
      ['l', 'l', '--steps=0'],
      ['ll', '-r', '-s', '-n', '0', '-u', '-a'],
    ]) {
      const result = fixture.run([...args, '--no-interactive']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(baseline.stdout);
      expect(result.stderr).to.equal('');
    }
    expect(fixture.logSnapshot()).to.deep.equal(before);
  });
});
