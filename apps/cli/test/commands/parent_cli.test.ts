import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('parent through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    delete fixture.env.GIT_OPTIONAL_LOCKS;
  });
  afterEach(() => fixture?.cleanup());
  it('prints only the direct trackingparent of the attached branch', () => {
    const result = fixture.run(['parent']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal('main\n');
    expect(result.stderr).to.equal('');
  });
  it('rejects positional arguments, including after the terminator', () => {
    for (const args of [
      ['parent', 'other'],
      ['parent', '--', 'other'],
      ['parent', '--surprise'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, args.join(' ')).to.equal(1);
      expect(result.stdout, args.join(' ')).to.equal('');
      expect(result.stderr, args.join(' ')).not.to.equal('');
    }
    expect(fixture.run(['parent', '--']).stdout).to.equal('main\n');
  });

  for (const [branch, parent] of [
    ['base', 'main'],
    ['child', 'base'],
    ['tip', 'child'],
  ]) {
    it(`reads ${branch} as an attached identity without checkout or graph effects`, () => {
      fixture.git(['switch', branch]);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['parent']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(`${parent}\n`);
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }
  it('keeps equal-SHA empty identities and valid needs-restack relationships', () => {
    fixture.branch('empty-one', 'child', true);
    fixture.branch('empty-two', 'empty-one', true);
    expect(fixture.run(['parent']).stdout).to.equal('empty-one\n');
    fixture.git(['switch', 'base']);
    fixture.commit('new-base');
    fixture.git(['switch', 'child']);
    const before = fixture.inspectionSnapshot();
    expect(fixture.run(['parent']).stdout).to.equal('base\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('uses literal UTF-8 names without shell interpretation or whitespace trimming', () => {
    const parent = "\u00a0#head/a'$(touch${IFS}PWNED)\u2003";
    const subject = '\u2003subject/#child\u00a0';
    fixture.branch(parent, 'main', true);
    fixture.branch(subject, parent, true);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['parent']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal(`${parent}\n`);
    expect(result.stderr).to.equal('');
    expect(fs.existsSync(path.join(fixture.repo, 'PWNED'))).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('suppresses only successful names under quiet and routes debug to stderr', () => {
    for (const args of [
      ['parent', '--quiet'],
      ['parent', '-q'],
    ]) {
      const result = fixture.run(args);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
    }
    expect(fixture.run(['parent', '--quiet=false']).stdout).to.equal('main\n');
    const debug = fixture.run(['parent', '--debug']);
    expect(debug.status).to.equal(0);
    expect(debug.stdout).to.equal('main\n');
    expect(debug.stderr).to.include('Reading cache');
  });
  for (const mode of [[], ['--interactive'], ['--no-interactive']]) {
    it(`prints immediately with pipes and a real PTY in ${
      mode.join(' ') || 'default'
    } mode`, () => {
      const before = fixture.inspectionSnapshot();
      const piped = fixture.run(['parent', ...mode]);
      expect(piped.status).to.equal(0);
      expect(piped.stdout).to.equal('main\n');
      expect(piped.stderr).to.equal('');
      const pty = runCliInPty(getTestCliCommand(['parent', ...mode]), {
        cwd: fixture.repo,
        env: fixture.env,
      });
      fixture.savePty(pty);
      expect(pty.status).to.equal(0);
      expect(pty.output.replace(/\r\n/g, '\n')).to.equal('main\n');
      const quiet = runCliInPty(getTestCliCommand(['parent', ...mode, '-q']), {
        cwd: fixture.repo,
        env: fixture.env,
      });
      fixture.savePty(quiet);
      expect(quiet).to.deep.equal({ status: 0, output: '' });
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }
  for (const subject of [
    'main',
    'untracked',
    'detached',
    'missing-parent',
    'bad-revision',
  ]) {
    it(`rejects ${subject} on stderr even under quiet without changing state`, () => {
      if (subject === 'main') fixture.git(['switch', 'main']);
      if (subject === 'untracked')
        fixture.git(['switch', '-c', 'untracked', 'main']);
      if (subject === 'detached') fixture.git(['switch', '--detach', 'base']);
      if (subject === 'missing-parent') {
        fixture.git(['switch', 'child']);
        fixture.git(['branch', '-D', 'base']);
      }
      if (subject === 'bad-revision') {
        fixture.git(['switch', 'other']);
        fixture.git([
          'update-ref',
          'refs/heads/child',
          fixture.git(['rev-parse', 'main']),
        ]);
        fixture.git(['switch', 'child']);
      }
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['parent', '-q']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('ERROR:');
      if (
        subject === 'untracked' ||
        subject === 'missing-parent' ||
        subject === 'bad-revision'
      )
        expect(result.stderr).to.include('ch track');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }
  it('requires explicit initialization without initializing or pruning orphaned tracking', () => {
    fixture.git(['branch', '-D', 'tip']);
    const config = path.join(fixture.repo, '.git', '.graphite_repo_config');
    fs.unlinkSync(config);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['parent', '--interactive']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('ch init');
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
      const result = fixture.run(['parent'], repo);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('ch init');
      expect(
        fs.existsSync(path.join(repo, '.git', '.graphite_repo_config'))
      ).to.equal(false);
      expect(fs.readFileSync(path.join(repo, '.git', 'HEAD'))).to.deep.equal(
        head
      );
      expect(fixture.git(['for-each-ref'], repo)).to.equal(refs);
    });
  }
  it('serves help outside Git and reports outside-Git or malformed config errors on stderr', () => {
    const help = fixture.run(['parent', '--help'], fixture.root);
    expect(help.status).to.equal(0);
    expect(help.stdout).to.include('ch parent');
    expect(help.stderr).to.equal('');
    const outside = fixture.run(['parent'], fixture.root);
    expect(outside.status).to.equal(1);
    expect(outside.stdout).to.equal('');
    expect(outside.stderr).to.include('repository');
    const config = fixture.env.GRAPHITE_USER_CONFIG_PATH ?? '';
    fs.writeFileSync(config, 'malformed');
    const bad = fixture.run(['parent', '--debug']);
    expect(bad.status).to.equal(1);
    expect(bad.stdout).to.equal('');
    expect(bad.stderr).to.include('Malformed data');
    expect(fs.readFileSync(config, 'utf8')).to.equal('malformed');
  });
  it('does not repair a stale boundary or prune deleted/unusable unrelated children', () => {
    // Complete public tracking setup before introducing stale/deleted records:
    // normal track startup could otherwise repair/prune away the test condition.
    fixture.branch('broken', 'base');
    fixture.git(['switch', 'base']);
    fixture.commit('base-new');
    fixture.git(['rebase', 'base', 'child']);
    fixture.git(['switch', 'base']);
    fixture.git(['branch', '-D', 'tip']);
    fixture.git([
      'update-ref',
      'refs/heads/broken',
      fixture.git(['rev-parse', 'main']),
    ]);
    fixture.git(['switch', 'child']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['parent']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal('base\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('preserves raw index, mtime-only files, partial staging, binary/ignored work, configs and foreign coordination', () => {
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
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_lock'),
      'another operation'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_pr_info'),
      'opaque legacy file'
    );
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['parent'],
      ['parent', '-q'],
      ['parent', '--help'],
      ['parent', '--wrong'],
      ['parent', '--', 'other'],
    ]) {
      fixture.run(args);
      expect(fixture.inspectionSnapshot(), args.join(' ')).to.deep.equal(
        before
      );
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
});
