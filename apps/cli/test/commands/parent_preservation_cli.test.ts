import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('parent persistent operation and PR state through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('keeps known PR identity and makes no external adapter calls', () => {
    const bin = path.join(fixture.root, 'gh-bin');
    fs.mkdirSync(bin);
    const state = path.join(fixture.root, 'prs.json');
    const calls = path.join(fixture.root, 'gh.jsonl');
    fs.writeFileSync(state, '[]');
    fs.writeFileSync(calls, '');
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!${process.execPath}\n${fs.readFileSync(
        path.join(__dirname, '../lib/fixtures/submit_gh.js'),
        'utf8'
      )}`,
      { mode: 0o755 }
    );
    fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
    fixture.env.ANTHRACITE_TEST_GH_STATE = state;
    fixture.env.ANTHRACITE_TEST_GH_LOG = calls;
    const remote = path.join(fixture.root, 'remote.git');
    fixture.git(['init', '--bare', remote]);
    fixture.git(['remote', 'add', 'origin', remote]);
    fixture.git(['push', '-u', 'origin', 'main']);
    fixture.ok(['repo', 'owner', '--set', 'fixture']);
    fixture.ok(['repo', 'name', '--set', 'submit']);
    fixture.ok(['submit', '--publish']);
    const identity = (output: string): string =>
      output
        .split('\n')
        .filter(
          (line) => line.startsWith('PR #') || line.startsWith('https://')
        )
        .join('\n');
    const pager = fixture.env.CH_PAGER;
    fixture.env.CH_PAGER = '';
    const info = identity(fixture.ok(['info']));
    fixture.env.CH_PAGER = pager;
    expect(info).to.include('PR #1');
    fs.writeFileSync(calls, '');
    const before = fixture.inspectionSnapshot();
    const prs = fs.readFileSync(state, 'utf8');
    const remoteRefs = fixture.git(['ls-remote', '--heads', 'origin']);
    for (const args of [
      ['parent'],
      ['parent', '-q'],
      ['parent', '--interactive'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(args.includes('-q') ? '' : 'main\n');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fixture.env.CH_PAGER = '';
    expect(identity(fixture.ok(['info']))).to.equal(info);
    expect(fs.readFileSync(calls, 'utf8')).to.equal('');
    expect(fs.readFileSync(state, 'utf8')).to.equal(prs);
    expect(fixture.git(['ls-remote', '--heads', 'origin'])).to.equal(
      remoteRefs
    );
  });

  it('preserves a real pending conflict while another attached worktree inspects its parent', () => {
    fixture.branch('conflict-base', 'main', true);
    const file = path.join(fixture.repo, 'main.txt');
    const commit = (text: string): void => {
      fs.writeFileSync(file, text);
      fixture.git(['add', 'main.txt']);
      fixture.git(['commit', '-m', text]);
    };
    commit('base own');
    fixture.branch('conflict-child', 'conflict-base', true);
    commit('child own');
    fixture.git(['switch', 'conflict-base']);
    commit('base changed');
    fixture.git(['switch', 'conflict-child']);
    const conflict = fixture.run(['restack', '--only', '--no-interactive']);
    expect(conflict.status).not.to.equal(0);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    fs.writeFileSync(file, 'resolved');
    fixture.git(['add', 'main.txt']);
    const before = fixture.inspectionSnapshot();
    const continuation = path.join(fixture.repo, '.git', '.gtcontinue');
    expect(fs.existsSync(continuation)).to.equal(true);
    const bytes = fs.readFileSync(continuation);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'other']);
    const linkedBefore = fixture.inspectionSnapshot(linked);
    const query = fixture.run(['parent'], linked);
    expect(query.status, query.stderr).to.equal(0);
    expect(query.stdout).to.equal('main\n');
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(linkedBefore);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    for (const args of [
      ['parent', '--wrong'],
      ['parent', '--', 'other'],
      ['parent', '--help'],
    ]) {
      const result = fixture.run(args);
      if (!args.includes('--help')) {
        expect(result.status).to.equal(1);
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
      } else expect(result.status).to.equal(0);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(continuation)).to.deep.equal(bytes);
    }
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'conflict-child'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(fs.readFileSync(file, 'utf8')).to.equal('resolved');
    expect(fixture.run(['parent']).stdout).to.equal('conflict-base\n');
  });
});
