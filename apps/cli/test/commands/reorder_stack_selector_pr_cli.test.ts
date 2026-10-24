import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('chosen stack reorder keeps its local PR boundary', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  let calls: string;
  let state: string;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
    const bin = path.join(fixture.root, 'bin');
    fs.mkdirSync(bin);
    calls = path.join(fixture.root, 'gh.jsonl');
    state = path.join(fixture.root, 'prs.json');
    fs.writeFileSync(calls, '');
    fs.writeFileSync(state, '[]');
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!${process.execPath}\n${fs.readFileSync(
        path.join(__dirname, '../lib/fixtures/submit_gh.js'),
        'utf8'
      )}`,
      { mode: 0o755 }
    );
    fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
    fixture.env.CHARCOAL_TEST_GH_STATE = state;
    fixture.env.CHARCOAL_TEST_GH_LOG = calls;
    fixture.git(['init', '--bare', path.join(fixture.root, 'remote.git')]);
    fixture.git([
      'remote',
      'add',
      'origin',
      path.join(fixture.root, 'remote.git'),
    ]);
    fixture.git(['push', '-u', 'origin', 'main']);
    fixture.ok(['repo', 'owner', '--set', 'fixture']);
    fixture.ok(['repo', 'name', '--set', 'submit']);
  });
  afterEach(() => fixture?.cleanup());

  for (const chosen of ['pr-leaf', 'tip']) {
    it(`refuses a known PR on ${
      chosen === 'pr-leaf' ? 'the selected tip' : 'a changed unselected subtree'
    } after real selection without remote effects`, () => {
      fixture.branch('pr-leaf', 'main');
      fixture.ok(['submit', '--publish']);
      const info = fixture.ok(['info']);
      expect(info).to.include('PR #1');
      fixture.ok(['move', 'child', '--source', 'pr-leaf']);
      fixture.git(['switch', 'child']);
      fixture.editor(
        chosen === 'tip' ? 'base\ntip\nchild\n' : 'base\npr-leaf\nchild\n'
      );
      const before = fixture.snapshot();
      const refs = fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
      ]);
      const remote = fixture.git(['ls-remote', '--heads', 'origin']);
      const prs = fs.readFileSync(state, 'utf8');
      fs.writeFileSync(calls, '');
      const result = choose(chosen);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output)
        .to.include('Cannot reorder pr-leaf')
        .and.include('locally known PR');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
      ).to.equal(refs);
      expect(fs.readFileSync(calls, 'utf8')).to.equal('');
      expect(fs.readFileSync(state, 'utf8')).to.equal(prs);
      expect(fixture.git(['ls-remote', '--heads', 'origin'])).to.equal(remote);
      expect(fixture.parent('pr-leaf')).to.equal('child');
      fixture.ok(['checkout', 'pr-leaf']);
      expect(fixture.ok(['info']))
        .to.include('PR #1')
        .and.include('https://github.com/fixture/submit/pull/1');
    });
  }

  it('keeps an unchanged unselected PR and unrelated refs intact after a chosen no-op', () => {
    fixture.branch('pr-leaf', 'main');
    fixture.ok(['submit', '--publish']);
    fixture.ok(['move', 'child', '--source', 'pr-leaf']);
    fixture.git(['switch', 'child']);
    const before = fixture.snapshot();
    const remote = fixture.git(['ls-remote', '--heads', 'origin']);
    const prs = fs.readFileSync(state, 'utf8');
    fs.writeFileSync(calls, '');
    const result = choose('tip');
    expect(result.status, result.output).to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.readFileSync(calls, 'utf8')).to.equal('');
    expect(fs.readFileSync(state, 'utf8')).to.equal(prs);
    expect(fixture.git(['ls-remote', '--heads', 'origin'])).to.equal(remote);
    fixture.ok(['checkout', 'pr-leaf']);
    expect(fixture.ok(['info'])).to.include('PR #1');
  });

  function choose(tip: string) {
    const result = runCliInPty(
      getTestCliCommand(['reorder', '--stack', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Choose a tip', input: tip },
          { prompt: `› ${tip}\r\n`, input: '\r' },
        ],
      }
    );
    const directory = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (directory) {
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(
        path.join(directory, `${path.basename(fixture.root)}-pty.jsonl`),
        JSON.stringify(result) + '\n'
      );
    }
    return result;
  }
});
