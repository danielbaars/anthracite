import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { LogPresentationCliFixture } from '../lib/fixtures/log_presentation_cli';
import { LogStepsCliFixture } from '../lib/fixtures/log_steps_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('single-trunk log graph presentation through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  afterEach(() => fixture?.cleanup());

  // Literal branch rows from the retained Graphite 1.8.6 capture. This fixture
  // has no linked worktree; worktree labels and header whitespace are separate.
  const shortGraph = [
    '◯      api-followup (needs restack)',
    '◯      api',
    '│ ◯    feature/café-long-branch-name-for-terminal-width',
    '│ │ ◯  empty-tip',
    '│ │ ◯  ui',
    '│ ◉─┘  search',
    '◯─┘    base',
    '│ ◯    maintenance',
    '◯─┘    main',
    '',
  ].join('\n');

  function inspect(args: readonly string[]): string {
    const before = fixture.logSnapshot();
    const result = fixture.run([...args, '--no-interactive']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    expect(fixture.logSnapshot()).to.deep.equal(before);
    return result.stdout;
  }

  function graphRows(output: string): string[] {
    return output
      .split('\n')
      .filter((line) => /[◉◯├]/.test(line))
      .map((line) => line.replace(/ +$/, ''));
  }

  it('matches the reference short graph for independent stacks and fanout', () => {
    fixture = new LogPresentationCliFixture();
    expect(inspect(['log', 'short'])).to.equal(shortGraph);
    expect(graphRows(inspect(['log']))).to.deep.equal([
      '◯ api-followup (needs restack)',
      '◯ api',
      '│  ◯ feature/café-long-branch-name-for-terminal-width',
      '│  │  ◯ empty-tip',
      '│  │  ◯ ui',
      '│  ├──┘',
      '│  ◉ search (current)',
      '├──┘',
      '◯ base',
      '│  ◯ maintenance',
      '├──┘',
      '◯ main',
    ]);
  });

  it('matches reverse direction, sibling sequence and graph columns', () => {
    fixture = new LogPresentationCliFixture();
    expect(graphRows(inspect(['log', '--reverse']))).to.deep.equal([
      '◯ main',
      '├──┐',
      '│  ◯ base',
      '│  ├──┐',
      '│  │  ◯ api',
      '│  │  ◯ api-followup (needs restack)',
      '│  ◉ search (current)',
      '│  ├──┐',
      '│  │  ◯ feature/café-long-branch-name-for-terminal-width',
      '│  ◯ ui',
      '│  ◯ empty-tip',
      '◯ maintenance',
    ]);
    expect(inspect(['ls', '--reverse'])).to.equal(
      [
        '◯─┐    main',
        '│ ◯─┐  base',
        '│ │ ◯  api',
        '│ │ ◯  api-followup (needs restack)',
        '│ ◉─┐  search',
        '│ │ ◯  feature/café-long-branch-name-for-terminal-width',
        '│ ◯    ui',
        '│ ◯    empty-tip',
        '◯      maintenance',
        '',
      ].join('\n')
    );
  });

  it('keeps the reference graph when tip dates and current checkout change', () => {
    fixture = new LogPresentationCliFixture();
    fixture.git(['switch', 'maintenance']);
    fixture.env.GIT_COMMITTER_DATE = '2026-10-26T12:00:00Z';
    fixture.git([
      'commit',
      '--amend',
      '--no-edit',
      '--date=2026-10-26T12:00:00Z',
    ]);
    expect(inspect(['ls'])).to.equal(
      shortGraph
        .replace('◉─┘  search', '◯─┘  search')
        .replace('│ ◯    maintenance', '│ ◉    maintenance')
    );
    fixture.git(['switch', 'api-followup']);
    fixture.env.GIT_COMMITTER_DATE = '2026-10-26T13:00:00Z';
    fixture.git([
      'commit',
      '--amend',
      '--no-edit',
      '--date=2026-10-26T13:00:00Z',
    ]);
    fixture.git(['switch', 'search']);
    expect(inspect(['ls'])).to.equal(shortGraph);
  });

  it('keeps the reference graph with equal sibling dates and a different tracking order', () => {
    fixture = new LogPresentationCliFixture({
      alternateTrackingOrder: true,
      equalDates: true,
    });
    expect(inspect(['ls'])).to.equal(shortGraph);
  });

  it('preserves minimal linear content through representative full and short aliases', () => {
    fixture = new LogStepsCliFixture();
    const full = inspect(['log']);
    expect(graphRows(full)).to.deep.equal(['◉ child (current)', '◯ main']);
    expect(full).to.include('Own change mentions main and maintenance');
    expect(full).to.include(fixture.git(['rev-parse', '--short', 'child']));
    expect(inspect(['l'])).to.equal(full);
    const short = inspect(['log', 'short']);
    expect(short).to.equal('◉  child\n◯  main\n');
    expect(inspect(['l', 's'])).to.equal(short);
  });

  it('preserves classic traversal and real selector branch values', () => {
    fixture = new LogPresentationCliFixture();
    const classic = [
      '  ↱ $ maintenance',
      '      ↱ $ api-followup (needs restack)',
      '    ↱ $ api',
      '      ↱ $ feature/café-long-branch-name-for-terminal-width',
      '        ↱ $ empty-tip',
      '      ↱ $ ui',
      '    ↱ $ search',
      '  ↱ $ base',
      '↱ $ main',
      '',
    ].join('\n');
    expect(inspect(['log', '--classic'])).to.equal(classic);
    expect(
      inspect(['ls', '--classic', '--reverse', '--stack', '--steps', '0'])
    ).to.equal(classic);
    const branch = 'feature/café-long-branch-name-for-terminal-width';
    const refs = fixture.refs();
    const selected = runCliInPty(
      getTestCliCommand(['checkout', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Checkout a branch', input: branch },
          { prompt: `› ${branch}`, input: '\r' },
        ],
      }
    );
    expect(selected.status, selected.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal(branch);
    expect(fixture.refs()).to.equal(refs);
  });
});
