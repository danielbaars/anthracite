import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('file split selectors and entries through the public CLI', function () {
  this.timeout(90000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.git(['switch', 'tip']);
  });
  afterEach(() => fixture?.cleanup());

  it('combines spellings, repeated overlapping selectors and literal wildcard names once', () => {
    fs.mkdirSync(path.join(fixture.repo, 'src'));
    for (const [name, content] of [
      ['src/a.txt', 'selected A'],
      ['src/space α.txt', 'selected Unicode'],
      ['wild*.txt', 'literal star'],
      ['src/transient.txt', 'transient'],
    ])
      fs.writeFileSync(path.join(fixture.repo, name), content);
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'Add selected groups']);
    fixture.git(['rm', 'src/transient.txt']);
    fixture.git(['commit', '-m', 'Remove a transient path']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    fixture.ok([
      'sp',
      '--by-file',
      'src/**',
      ':(literal)wild*.txt',
      '--file',
      'src/a.txt',
      '-f',
      'src/space α.txt',
    ]);
    expect(selectedNames(fixture)).to.deep.equal([
      'src/a.txt',
      'src/space α.txt',
      'wild*.txt',
    ]);
    expect(fixture.git(['show', 'tip_split:wild*.txt'])).to.equal(
      'literal star'
    );
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(fixture.git(['diff', '--name-only', 'tip_split', 'tip'])).to.equal(
      'tip.txt'
    );
  });

  it('uses effective subdirectory cwd together with top and exclusion magic', () => {
    fixture.git(['config', 'diff.relative', 'true']);
    fs.mkdirSync(path.join(fixture.repo, 'src'));
    for (const name of ['a.txt', 'space α.txt', 'excluded.txt'])
      fs.writeFileSync(path.join(fixture.repo, 'src', name), name);
    fs.writeFileSync(path.join(fixture.repo, 'wild*.txt'), 'literal top');
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'Add cwd-sensitive paths']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    fixture.ok(
      [
        'split',
        '--file',
        '**',
        '--file',
        ':(top,literal)wild*.txt',
        '--file',
        ':(top,exclude)src/excluded.txt',
      ],
      path.join(fixture.repo, 'src')
    );
    expect(selectedNames(fixture)).to.deep.equal([
      'src/a.txt',
      'src/space α.txt',
      'wild*.txt',
    ]);
    expect(
      fixture.git(['ls-tree', '--name-only', 'tip_split', 'src/excluded.txt'])
    ).to.equal('');
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
  });

  it('retains a leading Unicode byte-order character in a selected filename', () => {
    const name = '\uFEFFselected.txt';
    fs.writeFileSync(path.join(fixture.repo, name), 'valid Unicode name');
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'Add leading Unicode filename']);
    fixture.ok(['split', '-f', name]);
    expect(selectedNames(fixture)).to.deep.equal([name]);
    expect(fixture.git(['show', `tip_split:${name}`])).to.equal(
      'valid Unicode name'
    );
  });

  it('projects additions, deletions, binary blobs, executable modes and symlinks losslessly', () => {
    const binary = Buffer.from([0, 255, 128, 1, 10, 0]);
    fixture.git(['rm', 'main.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), binary);
    fs.writeFileSync(path.join(fixture.repo, 'added.txt'), 'new entry');
    fs.writeFileSync(
      path.join(fixture.repo, 'executable'),
      '#!/bin/sh\nexit 0\n',
      { mode: 0o755 }
    );
    fs.symlinkSync('../outside-target', path.join(fixture.repo, 'link'));
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'Add mixed entry kinds']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    fixture.ok([
      'split',
      '-f',
      'main.txt',
      'base.txt',
      'added.txt',
      'executable',
      'link',
    ]);
    expect(selectedNames(fixture)).to.deep.equal([
      'added.txt',
      'base.txt',
      'executable',
      'link',
      'main.txt',
    ]);
    expect(fixture.git(['ls-tree', 'tip_split', 'executable'])).to.match(
      /^100755 blob /
    );
    expect(fixture.git(['ls-tree', 'tip_split', 'link'])).to.match(
      /^120000 blob /
    );
    expect(fixture.git(['show', 'tip_split:link'])).to.equal(
      '../outside-target'
    );
    expect(fixture.git(['show', 'tip_split:added.txt'])).to.equal('new entry');
    expect(fixture.git(['ls-tree', 'tip_split', 'main.txt'])).to.equal('');
    expect(
      execFileSync('git', ['show', 'tip_split:base.txt'], {
        cwd: fixture.repo,
        env: fixture.env,
      })
    ).to.deep.equal(binary);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
  });

  for (const endpoint of ['old', 'new'] as const)
    it(`selects only the ${endpoint} endpoint of a cross-path rename`, () => {
      fixture.git(['mv', 'child.txt', 'renamed.txt']);
      fixture.git(['commit', '-m', 'Rename inherited path']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      fixture.ok([
        'split',
        '--by-file',
        endpoint === 'old' ? 'child.txt' : 'renamed.txt',
      ]);
      expect(selectedNames(fixture)).to.deep.equal([
        endpoint === 'old' ? 'child.txt' : 'renamed.txt',
      ]);
      if (endpoint === 'old') {
        expect(fixture.git(['ls-tree', 'tip_split', 'child.txt'])).to.equal('');
        expect(fixture.git(['ls-tree', 'tip_split', 'renamed.txt'])).to.equal(
          ''
        );
      } else {
        expect(fixture.git(['show', 'tip_split:child.txt'])).to.equal('child');
        expect(fixture.git(['show', 'tip_split:renamed.txt'])).to.equal(
          'child'
        );
      }
      expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    });

  it('refuses an impossible partial file-to-directory projection before hooks or construction', () => {
    fixture.git(['rm', 'main.txt']);
    fs.mkdirSync(path.join(fixture.repo, 'main.txt'));
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt', 'nested.txt'),
      'nested'
    );
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'Replace parent file with a directory']);
    const marker = path.join(fixture.root, 'unexpected-hook');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        marker
      )},'ran');\n`,
      { mode: 0o755 }
    );
    const before = fixture.inspectionSnapshot();
    const worktrees = fixture.git(['worktree', 'list', '--porcelain']);
    const result = fixture.run([
      'split',
      '--by-file',
      'main.txt/nested.txt',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('dependent paths');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['worktree', 'list', '--porcelain'])).to.equal(
      worktrees
    );
    expect(fs.existsSync(marker)).to.equal(false);
    fixture.ok(['split', '-f', 'main.txt']);
    expect(selectedNames(fixture)).to.deep.equal([
      'main.txt',
      'main.txt/nested.txt',
    ]);
    expect(fixture.git(['show', 'tip_split:main.txt/nested.txt'])).to.equal(
      'nested'
    );
  });

  it('refuses changed gitlinks even when another path is selected, without effects', () => {
    fixture.git(['config', 'diff.ignoreSubmodules', 'all']);
    fs.mkdirSync(path.join(fixture.repo, 'module'));
    const commit = fixture.git(['rev-parse', 'main']);
    fixture.git([
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${commit},module`,
    ]);
    fixture.git(['commit', '-m', 'Add a gitlink']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['split', '-f', 'tip.txt', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('gitlink');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('retains an unchanged gitlink while extracting ordinary files', () => {
    fs.mkdirSync(path.join(fixture.repo, 'module'));
    const commit = fixture.git(['rev-parse', 'main']);
    fixture.git([
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${commit},module`,
    ]);
    fixture.git(['commit', '-m', 'Add unchanged anchor gitlink']);
    fixture.branch('leaf', 'tip');
    fs.writeFileSync(
      path.join(fixture.repo, 'selected.txt'),
      'ordinary selected'
    );
    fixture.git(['add', '.']);
    fixture.git(['commit', '-m', 'Add ordinary selected file']);
    fixture.ok(['split', '-f', 'selected.txt']);
    for (const ref of ['leaf', 'leaf_split'])
      expect(fixture.git(['ls-tree', ref, 'module'])).to.equal(
        `160000 commit ${commit}\tmodule`
      );
  });

  it('refuses committed non-UTF-8 path records without changing the index', () => {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: fixture.repo,
      env: fixture.env,
      input: 'opaque path contents',
      encoding: 'utf8',
    }).trim();
    const record = Buffer.concat([
      Buffer.from(`100644 ${blob}\tbad-`),
      Buffer.from([255, 0]),
    ]);
    execFileSync('git', ['update-index', '-z', '--index-info'], {
      cwd: fixture.repo,
      env: fixture.env,
      input: record,
    });
    fixture.git(['commit', '-m', 'Add a path with unsupported encoding']);
    const state = (): Record<string, unknown> => ({
      refs: fixture.refs(),
      index: fixture.index(),
      paths: execFileSync('git', ['ls-files', '-z'], {
        cwd: fixture.repo,
        env: fixture.env,
      }).toString('hex'),
      contents: fixture.git(['cat-file', 'blob', blob]),
      worktrees: fixture.git(['worktree', 'list', '--porcelain']),
    });
    const before = state();
    const result = fixture.run(['split', '-f', 'bad-*', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('UTF-8');
    expect(state()).to.deep.equal(before);
  });

  it('accepts empty legacy recovery queues without rewriting them on early refusal', () => {
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      JSON.stringify({ branchesToSync: [], branchesToRestack: [] })
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['split', '-f', '.', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('no remainder');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('preserves unknown recovery fields instead of treating the file as empty', () => {
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      JSON.stringify({
        branchesToSync: [],
        branchesToRestack: [],
        futureOperation: {},
      })
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['split', '-f', '.', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('existing continuation');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses an outside-repository selector without effects', () => {
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'split',
      '-f',
      '../outside.txt',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('outside repository');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});

function selectedNames(fixture: RelationCliFixture): string[] {
  return execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', '-z', 'child', 'tip_split'],
    {
      cwd: fixture.repo,
      env: fixture.env,
    }
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
}
