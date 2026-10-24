import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('children through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('prints only direct tracked children of the attached branch', () => {
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['children']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal('child\n');
    expect(result.stderr).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('sorts a complete fan-out by UTF-8 bytes independently of dates, locale and tracking order', () => {
    const names = ['𐀀', 'z-child', '\uE000', 'A-child'];
    for (const [index, name] of names.entries()) {
      fixture.branch(name, 'base', true);
      fixture.env.GIT_COMMITTER_DATE = `2020-01-0${4 - index}T12:00:00Z`;
      fixture.git([
        '-c',
        `user.name=Author ${index}`,
        'commit',
        '--allow-empty',
        '--date',
        `2020-01-0${4 - index}T12:00:00Z`,
        '-m',
        name,
      ]);
      delete fixture.env.GIT_COMMITTER_DATE;
    }
    fixture.git(['switch', 'base']);
    const expected = 'A-child\nchild\nz-child\n\uE000\n𐀀\n';
    for (const locale of ['C', 'en_US.UTF-8']) {
      fixture.env.LC_ALL = locale;
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['children']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(expected);
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fixture.ok(['untrack', 'z-child']);
    fixture.ok(['track', 'z-child', '--parent', 'base']);
    expect(fixture.run(['children']).stdout).to.equal(expected);
    fixture.git(['switch', 'A-child']);
    fixture.env.GIT_COMMITTER_DATE = '2025-01-01T12:00:00Z';
    fixture.git(['commit', '--amend', '--allow-empty', '--no-edit']);
    delete fixture.env.GIT_COMMITTER_DATE;
    fixture.git(['switch', 'base']);
    expect(fixture.run(['children']).stdout).to.equal(expected);
  });

  it('fails the entire result when an existing direct child has unusable tracking', () => {
    fixture.branch('zzz-broken', 'base');
    fixture.branch('aaa-valid', 'base');
    fixture.git(['switch', 'base']);
    fixture.git([
      'update-ref',
      'refs/heads/zzz-broken',
      fixture.git(['rev-parse', 'main']),
    ]);
    const before = fixture.inspectionSnapshot();
    for (const args of [['children'], ['children', '-q']]) {
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('zzz-broken');
      expect(result.stderr).to.include('ch track');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    // A valid parent query does not repair or audit unrelated invalid children.
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('distinguishes roots, middle branches, leaves and trunk without roots', () => {
    for (const [subject, expected] of [
      ['main', 'base\nother\n'],
      ['child', 'tip\n'],
      ['tip', ''],
    ]) {
      fixture.git(['switch', subject]);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['children']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal(expected);
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fixture.ok(['untrack', 'base', '--force']);
    fixture.ok(['untrack', 'other', '--force']);
    fixture.git(['switch', 'main']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['children']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps equal-SHA identities, needs-restack relations and local tracking scope', () => {
    fixture.branch('empty-one', 'base', true);
    fixture.branch('empty-two', 'empty-one', true);
    fixture.git(['branch', 'untracked', 'base']);
    fixture.git(['tag', 'untracked', 'base']);
    fixture.git([
      'update-ref',
      'refs/remotes/fixture/remote-child',
      fixture.git(['rev-parse', 'child']),
    ]);
    fixture.git(['switch', 'base']);
    fixture.commit('base-ahead');
    const before = fixture.inspectionSnapshot();
    expect(fixture.run(['children']).stdout).to.equal('child\nempty-one\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['switch', 'empty-one']);
    expect(fixture.run(['children']).stdout).to.equal('empty-two\n');
    expect(fixture.git(['rev-parse', 'empty-one'])).to.equal(
      fixture.git(['rev-parse', 'empty-two'])
    );
  });

  it('omits a deleted child without pruning tracking or repairing a stale boundary', () => {
    fixture.branch('deleted', 'base');
    fixture.git(['switch', 'base']);
    fixture.commit('base-new');
    fixture.git(['rebase', 'base', 'child']);
    fixture.git(['switch', 'base']);
    fixture.git(['branch', '-D', 'deleted']);
    const before = fixture.inspectionSnapshot();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = fixture.run(['children']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal('child\n');
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('preserves literal UTF-8 names and shell punctuation without interpretation', () => {
    const names = [
      "\u00a0#head/a'$(touch${IFS}PWNED)\u2003",
      '#leading',
      '\u2003child/#embedded\u00a0',
    ];
    for (const name of names) fixture.branch(name, 'base', true);
    fixture.git(['switch', 'base']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['children']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal(
      "#leading\nchild\n\u00a0#head/a'$(touch${IFS}PWNED)\u2003\n\u2003child/#embedded\u00a0\n"
    );
    expect(result.stderr).to.equal('');
    expect(fs.existsSync(path.join(fixture.repo, 'PWNED'))).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('supports quiet, explicit false, debug and the bare terminator', () => {
    for (const args of [
      ['children', '--quiet'],
      ['children', '-q'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
    }
    expect(fixture.run(['children', '--quiet=false']).stdout).to.equal(
      'child\n'
    );
    expect(fixture.run(['children', '--']).stdout).to.equal('child\n');
    const debug = fixture.run(['children', '--debug']);
    expect(debug.status).to.equal(0);
    expect(debug.stdout).to.equal('child\n');
    expect(debug.stderr).to.include('Reading cache');
  });

  it('rejects extra targets and unknown options before inspecting', () => {
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['children', 'other'],
      ['children', '--', 'other'],
      ['children', '--surprise'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, args.join(' ')).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  for (const mode of [[], ['--interactive'], ['--no-interactive']]) {
    it(`prints a fan-out immediately via pipes and a real PTY in ${
      mode.join(' ') || 'default'
    } mode`, () => {
      fixture.branch('alpha', 'base', true);
      fixture.branch('zeta', 'base', true);
      fixture.git(['switch', 'base']);
      const before = fixture.inspectionSnapshot();
      const piped = fixture.run(['children', ...mode]);
      expect(piped.status, piped.stderr).to.equal(0);
      expect(piped.stdout).to.equal('alpha\nchild\nzeta\n');
      expect(piped.stderr).to.equal('');
      const pty = runCliInPty(getTestCliCommand(['children', ...mode]), {
        cwd: fixture.repo,
        env: fixture.env,
      });
      fixture.savePty(pty);
      expect(pty.status).to.equal(0);
      expect(pty.output.replace(/\r\n/g, '\n')).to.equal(
        'alpha\nchild\nzeta\n'
      );
      const quiet = runCliInPty(
        getTestCliCommand(['children', ...mode, '-q']),
        {
          cwd: fixture.repo,
          env: fixture.env,
        }
      );
      fixture.savePty(quiet);
      expect(quiet).to.deep.equal({ status: 0, output: '', outputBase64: '' });
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  for (const subject of [
    'untracked',
    'detached',
    'missing-parent',
    'bad-revision',
  ]) {
    it(`rejects an unusable ${subject} subject without an empty successful result`, () => {
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
      const result = fixture.run(['children', '-q']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('ERROR:');
      if (subject !== 'detached') expect(result.stderr).to.include('ch track');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }
});
