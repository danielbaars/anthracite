import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { LogPresentationCliFixture } from '../lib/fixtures/log_presentation_cli';
import {
  getFullLogNodes,
  getShortLogNodes,
} from '../lib/fixtures/log_steps_cli';

// eslint-disable-next-line max-lines-per-function
describe('worktree context and styling through public log commands', function () {
  this.timeout(120000);
  let fixture: LogPresentationCliFixture;
  afterEach(() => fixture?.cleanup());

  function inspect(args: readonly string[], cwd = fixture.repo): string {
    const before = fixture.logSnapshot(cwd);
    const result = fixture.run([...args, '--no-interactive'], cwd);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    expect(fixture.logSnapshot(cwd)).to.deep.equal(before);
    return result.stdout;
  }

  it('labels other worktrees without replacing frozen or stale branch status', () => {
    fixture = new LogPresentationCliFixture();
    const linked = path.join(fixture.root, 'API café workspace');
    const stale = path.join(fixture.root, 'followup workspace');
    fixture.git(['worktree', 'add', linked, 'api']);
    fixture.git(['worktree', 'add', stale, 'api-followup']);
    fixture.git([
      'worktree',
      'add',
      '--detach',
      path.join(fixture.root, 'detached'),
      'ui',
    ]);
    fixture.ok(['freeze', 'api']);
    fs.writeFileSync(path.join(linked, 'local.txt'), 'local work\n');
    const linkedBefore = fixture.logSnapshot(linked);
    const staleBefore = fixture.logSnapshot(stale);
    const full = inspect(['log']);
    const short = inspect(['ls']);
    expect(full).to.include('◯ api (frozen) (API café workspace)\n');
    expect(full).to.include(
      '◯ api-followup (needs restack) (followup workspace)\n'
    );
    expect(short).to.include('api (frozen) (API café workspace)\n');
    expect(short).to.include(
      'api-followup (needs restack) (followup workspace)\n'
    );
    expect(full).not.to.include('(detached)');
    expect(short).not.to.include('(detached)');
    expect(full).to.include('◉ search (current)\n');
    expect(getFullLogNodes(full)).to.deep.equal(getShortLogNodes(short));
    expect(fixture.logSnapshot(linked)).to.deep.equal(linkedBefore);
    expect(fixture.logSnapshot(stale)).to.deep.equal(staleBefore);
  });

  it('labels the main worktree relative to a linked caller without changing selector values', () => {
    fixture = new LogPresentationCliFixture();
    const linked = path.join(fixture.root, 'API café workspace');
    fixture.git(['worktree', 'add', linked, 'api']);
    const full = inspect(['log'], linked);
    const short = inspect(['ls'], linked);
    expect(full).to.include(`search (${path.basename(fixture.repo)})\n`);
    expect(short).to.include(`search (${path.basename(fixture.repo)})\n`);
    expect(full).to.include('◉ api (current)\n');
    expect(short).to.include('◉      api\n');
    expect(full).not.to.include('(API café workspace)');
    expect(short).not.to.include('(API café workspace)');
    const branch = 'feature/café-long-branch-name-for-terminal-width';
    const refs = fixture.refs();
    const chosen = runCliInPty(
      getTestCliCommand(['checkout', '--interactive']),
      {
        cwd: linked,
        env: fixture.env,
        responses: [
          { prompt: 'Checkout a branch', input: branch },
          { prompt: `› ${branch}`, input: '\r' },
        ],
      }
    );
    expect(chosen.status, chosen.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal(branch);
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['branch', '--show-current'])).to.equal('search');
  });

  it('uses dim commit text and clean full headers while preserving plain output and info', () => {
    fixture = new LogPresentationCliFixture();
    const full = inspect(['log']);
    const headers = full.split('\n').filter((line) => /[◉◯]/.test(line));
    expect(headers.length).to.equal(9);
    expect(headers.every((line) => !/ +$/.test(line))).to.equal(true);
    expect(full).not.to.include('\u001b[');
    const infoBefore = fixture.ok(['info', 'search', '--no-interactive']);
    const before = fixture.logSnapshot();
    const colored = runCliInPty(
      getTestCliCommand(['log', '--no-interactive']),
      {
        cwd: fixture.repo,
        env: { ...fixture.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      }
    );
    expect(colored.status, colored.output).to.equal(0);
    const sha = fixture.git(['rev-parse', '--short', 'search']);
    expect(colored.output).to.include(`\u001b[2m${sha} - search\u001b[22m`);
    expect(colored.output).not.to.include(`\u001b[90m${sha} - search`);
    expect(colored.output).to.include('\u001b[36msearch (current)\u001b[39m');
    expect(fixture.logSnapshot()).to.deep.equal(before);
    expect(fixture.ok(['info', 'search', '--no-interactive'])).to.equal(
      infoBefore
    );
  });
});
