import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('file split preflight through the public CLI', function () {
  this.timeout(60000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected');
    fs.writeFileSync(path.join(fixture.repo, 'remainder.txt'), 'remainder');
    fixture.git(['add', 'selected.txt', 'remainder.txt']);
    fixture.git(['commit', '-m', 'Mixed source']);
  });
  afterEach(() => fixture?.cleanup());

  it('refuses a complete selection before changing indexes, refs or metadata', () => {
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['split', '--by-file', '.', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('no remainder');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const [label, args, diagnostic] of [
    ['unmatched', ['--by-file', 'missing.txt'], 'No net changed files'],
    ['unchanged', ['--file', 'main.txt'], 'No net changed files'],
    ['blank', ['-f', ' '], 'nonempty pathspec'],
    ['missing', ['--by-file'], 'Not enough arguments'],
    ['malformed', ['--by-file', ':(unsupported)file'], 'pathspec'],
    [
      'conflicting',
      ['--by-file', 'selected.txt', '--by-hunk'],
      'mutually exclusive',
    ],
  ] as const)
    it(`refuses ${label} selectors without repairing metadata`, () => {
      const prInfo = path.join(fixture.repo, '.git', '.graphite_pr_info');
      fs.writeFileSync(prInfo, 'retain opaque PR information');
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['sp', ...args, '--no-interactive']);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(diagnostic);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });

  for (const staged of [false, true])
    it(`refuses ${
      staged ? 'staged' : 'unstaged'
    } tracked work without changing the index`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'local change');
      if (staged) fixture.git(['add', 'main.txt']);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'split',
        '-f',
        'selected.txt',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('tracked changes');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });

  for (const branch of ['base', 'child', 'tip'])
    it(`refuses frozen mandatory ${branch} before extraction`, () => {
      const metadata = ['base', 'child', 'tip'].map((name) => ({
        name,
        revision: fixture.git(['rev-parse', `refs/branch-metadata/${name}`]),
      }));
      fixture.ok(['freeze', branch]);
      // Public freeze includes downstack; isolate the mandatory descendant flag.
      for (const { name, revision } of metadata)
        if (name !== branch)
          fixture.git(['update-ref', `refs/branch-metadata/${name}`, revision]);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'split',
        '-f',
        'selected.txt',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(`an unfreeze ${branch}`);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });

  it('preserves opaque continuation even when no rebase remains', () => {
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      'opaque invalid recovery'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('existing continuation');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses a dirty occupied descendant and preserves both worktree indexes', () => {
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked work');
    fixture.git(['add', 'child.txt'], linked);
    const before = fixture.inspectionSnapshot();
    const linkedBefore = fixture.inspectionSnapshot(linked);
    const result = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('checked out in worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(linkedBefore);
  });

  for (const ignored of [false, true])
    it(`refuses ${
      ignored ? 'ignored' : 'untracked'
    } child checkout collisions before extraction`, () => {
      if (ignored)
        fs.appendFileSync(
          path.join(fixture.repo, '.git', 'info', 'exclude'),
          '\nchild.txt\n'
        );
      fs.writeFileSync(
        path.join(fixture.repo, 'child.txt'),
        'local child path'
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'split',
        '-f',
        'selected.txt',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(
        `overwrite ${ignored ? 'ignored' : 'untracked'} file`
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });

  it('protects a local path materialized only by an intermediate descendant commit', () => {
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'transient.txt'), 'intermediate');
    fixture.git(['add', 'transient.txt']);
    fixture.git(['commit', '-m', 'Add intermediate path']);
    fixture.git(['rm', 'transient.txt']);
    fixture.git(['commit', '-m', 'Remove intermediate path']);
    fixture.git(['switch', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'transient.txt'), 'local work');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('overwrite untracked file transient.txt');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const kind of ['trunk', 'detached', 'untracked', 'stale'] as const)
    it(`refuses a ${kind} source without tracking or repair`, () => {
      if (kind === 'trunk') fixture.git(['switch', 'main']);
      if (kind === 'detached') fixture.git(['checkout', '--detach']);
      if (kind === 'untracked') fixture.git(['switch', '-c', 'untracked']);
      if (kind === 'stale') {
        fixture.git(['switch', 'main']);
        fixture.commit('advance');
        fixture.git(['switch', 'base']);
      }
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'split',
        '-f',
        'selected.txt',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(
        kind === 'untracked'
          ? 'tracked source'
          : kind === 'stale'
          ? 'needs restack'
          : kind
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });

  it('refuses a tracked source without net work', () => {
    fixture.branch('empty', 'main', true);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['split', '-f', '.', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('No net changed files');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const branch of ['base', 'child'])
    it(`refuses merge history in mandatory ${branch}`, () => {
      fixture.git(['switch', branch]);
      fixture.git(['merge', '--no-ff', 'other', '-m', 'Merge fixture']);
      fixture.git(['switch', 'base']);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'split',
        '-f',
        'selected.txt',
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(
        `unsupported merge history in ${branch}`
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });

  it('preserves an active Git operation and foreign cache lock', () => {
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'CHERRY_PICK_HEAD'),
      fixture.git(['rev-parse', 'HEAD']) + '\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_lock'),
      JSON.stringify({ pid: 424242, timestamp: 1 })
    );
    const before = fixture.inspectionSnapshot();
    const operation = fs.readFileSync(
      path.join(fixture.repo, '.git', 'CHERRY_PICK_HEAD')
    );
    const result = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('CHERRY_PICK_HEAD');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'CHERRY_PICK_HEAD'))
    ).to.deep.equal(operation);
  });
});
