import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { RelationCliFixture } from '../lib/fixtures/relation_cli';

const statLines = (output: string): readonly string[] =>
  stripAnsi(output)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => / \| |\bfiles? changed\b/.test(line));

// eslint-disable-next-line max-lines-per-function
describe('info diffstat through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.env.CH_PAGER = '';
  });
  afterEach(() => {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.cleanup();
  });

  it('adds one cumulative Git diffstat and preserves the selected commit order with stat and aliases', () => {
    const base = fixture.git(['rev-parse', 'base']);
    fixture.git(['switch', 'child']);
    fixture.commit('second-change');
    const selected = fixture.git(['rev-parse', 'child']);
    fixture.git(['switch', 'other']);
    const expected = statLines(fixture.git(['diff', '--stat', base, selected]));
    const commits = fixture
      .git(['log', '--format=%H', `${base}..${selected}`])
      .split('\n');
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['info', 'child', '--stat'],
      ['info', '--branch', 'child', '-s'],
      ['i', 'child', '--diff', '--stat'],
      ['info', 'child', '--patch', '--diff', '--stat'],
    ]) {
      const result = fixture.run([...args, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      const output = stripAnsi(result.stdout);
      expect(output)
        .to.match(/^child\s/)
        .and.not.include('diff --git');
      expect(statLines(output)).to.deep.equal(expected);
      expect(output.match(/files? changed/g)?.length).to.equal(1);
      expect(output.indexOf(`commit ${commits[0]}`)).to.be.lessThan(
        output.indexOf(`commit ${commits[1]}`)
      );
      expect(result.stderr).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('shows per-commit Git statistics without hunks for patch plus stat', () => {
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'first\nsecond\n');
    fixture.git(['add', 'child.txt']);
    fixture.git(['commit', '-m', 'replace child']);
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'second\nthird\n');
    fixture.git(['add', 'child.txt']);
    fixture.git(['commit', '-m', 'replace first']);
    const base = fixture.git(['rev-parse', 'base']);
    const head = fixture.git(['rev-parse', 'child']);
    const expected = statLines(
      fixture.git(['log', '--format=', '--stat', `${base}..${head}`])
    );
    const cumulative = statLines(fixture.git(['diff', '--stat', base, head]));
    expect(expected).not.to.deep.equal(cumulative);
    fixture.git(['switch', 'other']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'info',
      'child',
      '--patch',
      '--stat',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(statLines(result.stdout)).to.deep.equal(expected);
    expect(stripAnsi(result.stdout))
      .not.to.include('diff --git')
      .and.not.to.include('@@');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses invalid stat boolean values including aliases and clusters before output', () => {
    const before = fixture.inspectionSnapshot();
    for (const flag of [
      '--stat=invalid',
      '-s=invalid',
      '-ps=invalid',
      '-sp=invalid',
      '--no-stat=invalid',
      '--s=invalid',
    ]) {
      const result = fixture.run(['info', 'child', flag, '--no-interactive']);
      expect(result.status, flag).to.equal(1);
      expect(result.stdout, flag).to.equal('');
      expect(result.stderr, flag).not.to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('uses the registered parent revision for stat after parent advance and needs-restack', () => {
    const registered = fixture.git(['rev-parse', 'base']);
    const selected = fixture.git(['rev-parse', 'child']);
    const expected = statLines(
      fixture.git(['diff', '--stat', registered, selected])
    );
    fixture.commit('parent-advance');
    const liveParent = statLines(
      fixture.git(['diff', '--stat', 'base', selected])
    );
    expect(expected).not.to.deep.equal(liveParent);
    fixture.git(['switch', 'other']);
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--diff'], ['--patch'], ['--diff', '--patch']]) {
      const result = fixture.run([
        'info',
        'child',
        '--stat',
        ...flags,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^child \(needs restack\)/)
        .and.not.include('parent-advance');
      expect(statLines(result.stdout)).to.deep.equal(expected);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('matches ordinary Git counts for modifications, renames, binary changes, added and deleted files', () => {
    fixture.branch('stat-base', 'main', true);
    const write = (name: string, contents: string | Buffer): void => {
      fs.writeFileSync(path.join(fixture.repo, name), contents);
    };
    write('old.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n');
    write('text.txt', 'old line\nkeep\n');
    write('deleted.txt', 'delete\nthese\n');
    write('binary.bin', Buffer.from([0, 1, 2]));
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'stat fixture base']);
    const base = fixture.git(['rev-parse', 'HEAD']);
    fixture.branch('stat-topic', 'stat-base', true);
    fixture.git(['mv', 'old.txt', 'renamed.txt']);
    write('text.txt', 'new line\nkeep\nextra\n');
    write('added.txt', 'add\nthese\n');
    write('binary.bin', Buffer.from([0, 3, 4, 5]));
    fixture.git(['rm', 'deleted.txt']);
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'all diff kinds']);
    write('text.txt', 'new line\nkeep\nextra\nlast\n');
    fixture.git(['add', 'text.txt']);
    fixture.git(['commit', '-m', 'another text change']);
    const head = fixture.git(['rev-parse', 'HEAD']);
    const expected = statLines(fixture.git(['diff', '--stat', base, head]));
    expect(expected.join('\n'))
      .to.include('=>')
      .and.include('Bin 3 -> 4 bytes')
      .and.include('5 files changed');
    expect(fixture.git(['diff', '--numstat', base, head]))
      .to.include('3\t1\ttext.txt')
      .and.include('2\t0\tadded.txt')
      .and.include('0\t2\tdeleted.txt');
    fixture.git(['switch', 'other']);
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--diff'], ['--patch']]) {
      const result = fixture.run([
        'info',
        'stat-topic',
        '--stat',
        ...flags,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      const oracle = flags.includes('--patch')
        ? statLines(
            fixture.git(['log', '--format=', '--stat', `${base}..${head}`])
          )
        : expected;
      expect(statLines(result.stdout)).to.deep.equal(oracle);
      expect(stripAnsi(result.stdout))
        .not.to.include('diff --git')
        .and.not.to.include('@@');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('keeps implicit selection and ordinary patch or diff when stat is explicitly disabled', () => {
    const base = fixture.git(['rev-parse', 'main']);
    const head = fixture.git(['rev-parse', 'base']);
    const expectedPatch = fixture.git(['diff', base, head]);
    const implicitStat = fixture.run(['info', '--stat', '--no-interactive']);
    expect(implicitStat.status, implicitStat.stderr).to.equal(0);
    expect(statLines(implicitStat.stdout)).to.deep.equal(
      statLines(fixture.git(['diff', '--stat', base, head]))
    );
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--stat=false'], ['-s=false'], ['--no-stat']]) {
      const result = fixture.run(['info', ...flags, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^base\s/)
        .and.include(`commit ${head}`);
      expect(statLines(result.stdout)).to.deep.equal([]);
      expect(stripAnsi(result.stdout)).not.to.include('diff --git');
    }
    for (const flags of [['--patch'], ['--diff'], ['--patch', '--diff']]) {
      const result = fixture.run([
        'i',
        ...flags,
        '--stat=false',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout)).to.include(expectedPatch);
      expect(statLines(result.stdout)).to.deep.equal([]);
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const help = fixture.run(['info', '--help'], fixture.root);
    expect(help.status, help.stderr).to.equal(0);
    expect(help.stdout).to.include('--stat').and.include('-s');
  });

  it('keeps literal selected branch statistics distinct from colliding tags', () => {
    for (const name of [
      'topic/λ#stat',
      '\u2003stat\u2003',
      '123',
      '$(touch${IFS}stat-sentinel)',
    ]) {
      fixture.branch(name, 'main');
      const head = fixture.git(['rev-parse', `refs/heads/${name}`]);
      const expected = statLines(fixture.git(['diff', '--stat', 'main', head]));
      fixture.git(['switch', 'base']);
      fixture.git(['tag', name, 'base']);
      const before = fixture.inspectionSnapshot();
      for (const args of [
        ['--branch', name, '--stat'],
        ['--patch', '-s', '--', name],
      ]) {
        const result = fixture.run(['info', '--no-interactive', ...args]);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(stripAnsi(result.stdout).startsWith(`${name} `)).to.equal(true);
        expect(statLines(result.stdout)).to.deep.equal(expected);
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      }
    }
    expect(fs.existsSync(path.join(fixture.repo, 'stat-sentinel'))).to.equal(
      false
    );
  });

  it('keeps empty branches empty and preserves ordinary trunk and standard merge Git statistics', () => {
    fixture.branch('empty-stat', 'base', true);
    fixture.git(['switch', 'other']);
    const before = fixture.inspectionSnapshot();
    for (const flags of [[], ['--patch'], ['--diff'], ['--patch', '--diff']]) {
      const result = fixture.run([
        'info',
        'empty-stat',
        '--stat',
        ...flags,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.match(/^empty-stat\s/)
        .and.not.include('commit ')
        .and.not.include('diff --git');
      expect(statLines(result.stdout)).to.deep.equal([]);
      const root = fixture.run([
        'info',
        'main',
        '--stat',
        ...flags,
        '--no-interactive',
      ]);
      expect(root.status).to.equal(1);
      expect(root.stdout).to.equal('');
      expect(root.stderr).to.include('previous commit');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fixture.git(['switch', 'main']);
    fixture.commit('trunk-next');
    for (const merge of [false, true]) {
      if (merge)
        fixture.git(['merge', '--no-ff', 'other', '-m', 'trunk merge']);
      const base = fixture.git(['rev-parse', 'main~']);
      const head = fixture.git(['rev-parse', 'main']);
      const commits = fixture
        .git(['log', '--format=%H', `${base}..${head}`])
        .split('\n');
      expect(commits.length).to.equal(merge ? 2 : 1);
      const snapshot = fixture.inspectionSnapshot();
      for (const flags of [[], ['--patch'], ['--diff', '--patch']]) {
        const result = fixture.run([
          'info',
          'main',
          '--stat',
          ...flags,
          '--no-interactive',
        ]);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const oracle =
          flags.length === 1
            ? fixture.git(['log', '--format=', '--stat', `${base}..${head}`])
            : fixture.git(['diff', '--stat', base, head]);
        expect(statLines(result.stdout)).to.deep.equal(statLines(oracle));
        const output = stripAnsi(result.stdout);
        for (const commit of commits)
          expect(output).to.include(`commit ${commit}`);
        expect(output).not.to.include('diff --git');
        expect(fixture.inspectionSnapshot()).to.deep.equal(snapshot);
      }
    }
  });

  it('preserves dirty worktrees and opaque damaged cache bytes on stat success and invalid range errors', () => {
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged');
    fixture.git(['add', 'main.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'unstaged');
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked staged');
    fixture.git(['add', 'child.txt'], linked);
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked unstaged');
    fs.writeFileSync(path.join(linked, 'untracked.bin'), Buffer.from([0, 255]));
    fs.symlinkSync('untracked.bin', path.join(linked, 'symlink'));
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'ignored.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored.bin'),
      Buffer.from([255, 0])
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_persist'),
      Buffer.from([0, 255, 1])
    );
    for (const target of ['child', 'missing']) {
      const before = [
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ];
      const result = fixture.run([
        'info',
        target,
        '--stat',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(
        target === 'child' ? 0 : 1
      );
      if (target === 'missing') expect(result.stdout).to.equal('');
      else expect(statLines(result.stdout).join('\n')).to.include('child.txt');
      expect([
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ]).to.deep.equal(before);
    }
    fixture.git(['update-ref', 'refs/heads/child', 'main']);
    for (const removeParent of [false, true]) {
      if (removeParent) {
        fixture.git(['switch', 'other']);
        fixture.git(['branch', '-D', 'base']);
      }
      const before = [
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ];
      const result = fixture.run([
        'info',
        'child',
        '--patch',
        '--stat',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect([
        fixture.inspectionSnapshot(),
        fixture.inspectionSnapshot(linked),
      ]).to.deep.equal(before);
    }
  });
  it('composes selected stat with the integrated quiet and direct-output policy', () => {
    fixture.env.CH_PAGER = path.join(fixture.root, 'sentinel-bin', 'pager');
    const before = fixture.inspectionSnapshot();
    const quiet = fixture.run([
      'info',
      'child',
      '--patch',
      '--stat',
      '--quiet',
      '--interactive',
    ]);
    expect(quiet.status, quiet.stderr).to.equal(0);
    expect(quiet.stdout).to.equal('');
    expect(quiet.stderr).to.equal('');
    const ordinary = fixture.run([
      'info',
      'child',
      '--patch',
      '--stat',
      '--quiet=false',
      '--no-interactive',
    ]);
    expect(ordinary.status, ordinary.stderr).to.equal(0);
    expect(statLines(ordinary.stdout)).to.deep.equal(
      statLines(fixture.git(['log', '--format=', '--stat', 'base..child']))
    );
    const invalid = fixture.run([
      'info',
      'missing',
      '--stat',
      '--quiet',
      '--interactive',
    ]);
    expect(invalid.status).to.equal(1);
    expect(invalid.stdout).to.equal('');
    expect(invalid.stderr).not.to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
