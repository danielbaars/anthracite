import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { LogStepsCliFixture } from '../lib/fixtures/log_steps_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('short log parent edges through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  afterEach(() => fixture?.cleanup());

  function inspect(args: readonly string[]): string {
    const before = fixture.logSnapshot();
    const result = fixture.run([...args, '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    expect(fixture.logSnapshot()).to.deep.equal(before);
    return result.stdout;
  }

  it('connects every visible parent in a linear stack through short routes', () => {
    fixture = new LogStepsCliFixture();
    fixture.branch('tip', 'child');
    for (const route of [
      ['ls'],
      ['log', 'short'],
      ['log', 's'],
      ['l', 'short'],
      ['l', 's'],
    ])
      expect(inspect(route)).to.equal('◉  tip\n│\n◯  child\n│\n◯  main\n');
  });

  it('reverses the chain without adding a stem at either end', () => {
    fixture = new LogStepsCliFixture();
    fixture.branch('tip', 'child');
    expect(inspect(['ls', '--reverse'])).to.equal(
      '◯  main\n│\n◯  child\n│\n◉  tip\n'
    );
  });

  it('connects only the visible edges at bounded and zero depth', () => {
    fixture = new LogStepsCliFixture();
    fixture.branch('tip', 'child');
    fixture.branch('hidden-tip', 'tip');
    fixture.git(['switch', 'child']);
    expect(inspect(['ls', '--steps', '1'])).to.equal(
      '◯  tip\n│\n◉  child\n│\n◯  main\n'
    );
    expect(inspect(['ls', '--steps', '1', '--reverse'])).to.equal(
      '◯  main\n│\n◉  child\n│\n◯  tip\n'
    );
    for (const flags of [[], ['--reverse']])
      expect(inspect(['ls', '--steps', '0', ...flags])).to.equal('◉  child\n');
  });

  it('terminates at trunk and the last visible child when run from trunk', () => {
    fixture = new LogStepsCliFixture();
    fixture.branch('tip', 'child');
    fixture.git(['switch', 'main']);
    expect(inspect(['ls', '--steps', '1'])).to.equal('◯  child\n│\n◉  main\n');
    expect(inspect(['ls', '--steps', '1', '--reverse'])).to.equal(
      '◉  main\n│\n◯  child\n'
    );
    expect(inspect(['ls', '--steps', '0'])).to.equal('◉  main\n');
  });

  it('preserves existing fanout connectors without connecting siblings', () => {
    fixture = new LogStepsCliFixture();
    fixture.branch('sibling', 'main');
    expect(inspect(['ls'])).to.equal('◯    child\n│ ◉  sibling\n◯─┘  main\n');
  });

  it('keeps branch-only choices and exact selection in an interactive menu', () => {
    fixture = new LogStepsCliFixture();
    fixture.branch('tip', 'child');
    const refs = fixture.refs();
    const selected = runCliInPty(
      getTestCliCommand(['checkout', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Checkout a branch', input: 'child' },
          { prompt: '› child', input: '\r' },
        ],
      }
    );
    expect(selected.status, selected.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.refs()).to.equal(refs);
    expect(stripAnsi(selected.output)).not.to.match(/(?:^|[\r\n])\s*│\s*$/m);
  });

  it('keeps conflict status branch-only and leaves recovery usable', () => {
    fixture = new LogStepsCliFixture();
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child change\n');
    fixture.git(['commit', '-am', 'child conflict']);
    fixture.git(['switch', 'main']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'trunk change\n');
    fixture.git(['commit', '-am', 'trunk conflict']);
    const conflict = fixture.run(['restack', '--no-interactive']);
    expect(conflict.status, conflict.stdout + conflict.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(conflict.stderr).to.include('◯  child\n◯  main\n');
    expect(conflict.stderr).not.to.match(/^\s*│\s*$/m);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'resolved changes\n');
    fixture.git(['add', 'main.txt']);
    fixture.ok(['continue', '--no-interactive']);
    expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
    expect(fixture.ok(['info', '--branch', 'child'])).to.include(
      'Parent: main'
    );
  });
});
