import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('children preservation through the public CLI', function () {
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
      ['children'],
      ['children', '-q'],
      ['children', '--interactive'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(args.includes('-q') ? '' : 'child\n');
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

  it('preserves raw index, partial staging, opaque state and binary/ignored/symlink work for every result mode', () => {
    const clean = path.join(fixture.repo, 'main.txt');
    const now = new Date(Date.now() + 5000);
    fs.utimesSync(clean, now, now);
    const base = path.join(fixture.repo, 'base.txt');
    fs.writeFileSync(base, 'staged base\n');
    fixture.git(['add', 'base.txt']);
    fs.appendFileSync(base, 'unstaged base\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.bin'),
      Buffer.from([0, 255, 13, 10, 128])
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'ignored.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored.bin'),
      Buffer.from([255, 0, 34])
    );
    fs.symlinkSync('untracked.bin', path.join(fixture.repo, 'untracked-link'));
    fixture.git(['config', 'user.relationFixture', 'keep']);
    fixture.git([
      'update-ref',
      'refs/remotes/fixture/base',
      fixture.git(['rev-parse', 'base']),
    ]);
    fixture.git(['tag', 'fixture-tag']);
    for (const [name, contents] of [
      ['.graphite_cache_lock', 'another operation'],
      ['.graphite_pr_info', 'opaque legacy file'],
    ])
      fs.writeFileSync(path.join(fixture.repo, '.git', name), contents);
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['children'],
      ['children', '-q'],
      ['children', '--help'],
      ['children', '--wrong'],
      ['children', '--', 'other'],
    ]) {
      const result = fixture.run(args);
      const isError = args.includes('--wrong') || args.includes('other');
      expect(result.status, result.stderr).to.equal(isError ? 1 : 0);
      if (isError) {
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
      }
      expect(fixture.inspectionSnapshot(), args.join(' ')).to.deep.equal(
        before
      );
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('preserves dirty leaf state when the complete successful result is empty', () => {
    fixture.git(['switch', 'tip']);
    fs.appendFileSync(path.join(fixture.repo, 'tip.txt'), 'staged\n');
    fixture.git(['add', 'tip.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'tip.txt'), 'unstaged\n');
    const clean = path.join(fixture.repo, 'main.txt');
    const now = new Date(Date.now() + 5000);
    fs.utimesSync(clean, now, now);
    const before = fixture.inspectionSnapshot();
    for (const args of [['children'], ['children', '-q']]) {
      const result = fixture.run(args);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('requires explicit initialization without repairing or pruning orphaned tracking', () => {
    fixture.git(['branch', '-D', 'tip']);
    const config = path.join(fixture.repo, '.git', '.graphite_repo_config');
    fs.unlinkSync(config);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['children', '--interactive']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('an init');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(config)).to.equal(false);
  });

  for (const committed of [false, true]) {
    it(`rejects an uninitialized repository ${
      committed ? 'with' : 'without'
    } a commit without setup`, () => {
      const repo = path.join(fixture.root, 'uninitialized');
      fs.mkdirSync(repo);
      fixture.git(['init', '--initial-branch=main'], repo);
      if (committed)
        fixture.git(
          [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '--allow-empty',
            '-m',
            'initial',
          ],
          repo
        );
      const head = fs.readFileSync(path.join(repo, '.git', 'HEAD'));
      const refs = fixture.git(['for-each-ref'], repo);
      const result = fixture.run(['children'], repo);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('an init');
      expect(
        fs.existsSync(path.join(repo, '.git', '.graphite_repo_config'))
      ).to.equal(false);
      expect(fs.readFileSync(path.join(repo, '.git', 'HEAD'))).to.deep.equal(
        head
      );
      expect(fixture.git(['for-each-ref'], repo)).to.equal(refs);
    });
  }

  it('serves help outside Git and preserves malformed configuration on startup failure', () => {
    const help = fixture.run(['children', '--help'], fixture.root);
    expect(help.status).to.equal(0);
    expect(help.stdout).to.include('an children');
    expect(help.stderr).to.equal('');
    const outside = fixture.run(['children'], fixture.root);
    expect(outside.status).to.equal(1);
    expect(outside.stdout).to.equal('');
    expect(outside.stderr).to.include('repository');
    const config = fixture.env.GRAPHITE_USER_CONFIG_PATH ?? '';
    fs.writeFileSync(config, 'malformed');
    const before = fixture.inspectionSnapshot();
    const bad = fixture.run(['children', '--debug']);
    expect(bad.status).to.equal(1);
    expect(bad.stdout).to.equal('');
    expect(bad.stderr).to.include('Malformed data');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
