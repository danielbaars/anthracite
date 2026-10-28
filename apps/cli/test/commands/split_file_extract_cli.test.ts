import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('file split extraction through the public CLI', function () {
  this.timeout(90000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected');
    fs.writeFileSync(path.join(fixture.repo, 'remainder.txt'), 'remainder');
    fixture.git(['add', 'selected.txt', 'remainder.txt']);
    fixture.git(['commit', '-m', 'Mixed source']);
    fixture.ok(['restack']);
  });
  afterEach(() => fixture?.cleanup());

  it('extracts a prerequisite and retains source and synchronized descendant trees', () => {
    const trees = Object.fromEntries(
      ['main', 'base', 'child', 'tip', 'other'].map((name) => [
        name,
        fixture.git(['rev-parse', `${name}^{tree}`]),
      ])
    );
    const unrelated = fixture.git(['rev-parse', 'other']);
    fixture.ok(['split', '--by-file', 'selected.txt']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['show', 'base_split:selected.txt'])).to.equal(
      'selected'
    );
    expect(
      fixture.git(['ls-tree', '-r', '--name-only', 'base_split'])
    ).to.equal('main.txt\nselected.txt');
    expect(fixture.parent('base')).to.equal('base_split');
    expect(fixture.parent('base_split')).to.equal('main');
    for (const name of ['main', 'base', 'child', 'tip', 'other'])
      expect(fixture.git(['rev-parse', `${name}^{tree}`])).to.equal(
        trees[name]
      );
    expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
    expect(
      fixture.git(['merge-base', '--is-ancestor', 'base', 'tip'])
    ).to.equal('');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
  it('flattens complete messages oldest first using the invoking identity', () => {
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'second');
    fixture.git(['add', 'selected.txt']);
    fixture.git([
      'commit',
      '--author',
      'Original author <original@example.test>',
      '-m',
      'Third subject\n\nDetailed body',
    ]);
    const originalTree = fixture.git(['rev-parse', 'base^{tree}']);
    fixture.ok(['sp', '-f', 'selected.txt', '--no-by-commit', '--no-by-hunk']);
    const expected = 'base\n\nMixed source\n\nThird subject\n\nDetailed body';
    for (const name of ['base_split', 'base']) {
      expect(fixture.git(['show', '-s', '--format=%B', name])).to.equal(
        expected
      );
      expect(
        fixture.git(['show', '-s', '--format=%an <%ae>|%cn <%ce>', name])
      ).to.equal(
        'Reorder fixture <reorder@example.test>|Reorder fixture <reorder@example.test>'
      );
    }
    expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('2');
    expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(originalTree);
  });

  for (const collision of ['base_split', 'base_split/occupied'])
    it(`retains local PR identity and allocates around ${collision}`, () => {
      fixture.git(['branch', collision, 'other']);
      const collisionTip = fixture.git(['rev-parse', collision]);
      const metadata = JSON.parse(
        fixture.git(['cat-file', '-p', 'refs/branch-metadata/base'])
      );
      const prInfo = {
        number: 42,
        title: 'Approved title',
        body: 'Approved body',
        url: 'https://example.test/pull/42',
        base: 'main',
        state: 'OPEN',
        isDraft: true,
      };
      const file = path.join(fixture.root, 'pr-metadata');
      fs.writeFileSync(file, JSON.stringify({ ...metadata, prInfo }));
      const oid = fixture.git(['hash-object', '-w', file]);
      fixture.git(['update-ref', 'refs/branch-metadata/base', oid]);
      fixture.ok(['split', '--file', 'selected.txt']);
      const source = JSON.parse(
        fixture.git(['cat-file', '-p', 'refs/branch-metadata/base'])
      );
      const parent = JSON.parse(
        fixture.git(['cat-file', '-p', 'refs/branch-metadata/base_split_split'])
      );
      expect(source.prInfo).to.deep.equal(prInfo);
      expect(source.parentBranchName).to.equal('base_split_split');
      expect(parent.parentBranchName).to.equal('main');
      expect(parent.prInfo).to.equal(undefined);
      expect(parent.frozen).not.to.equal(true);
      expect(fixture.git(['rev-parse', collision])).to.equal(collisionTip);
    });

  it('restacks nonconflicting fan-out parent-first and retains each final tree', () => {
    fixture.branch('side', 'base');
    fixture.branch('side-tip', 'side');
    fixture.git(['switch', 'base']);
    const trees = Object.fromEntries(
      ['child', 'tip', 'side', 'side-tip'].map((name) => [
        name,
        fixture.git(['rev-parse', `${name}^{tree}`]),
      ])
    );
    fixture.ok(['split', '-f', 'selected.txt']);
    for (const name of ['child', 'tip', 'side', 'side-tip']) {
      expect(fixture.git(['rev-parse', `${name}^{tree}`])).to.equal(
        trees[name]
      );
      expect(
        fixture.git(['merge-base', '--is-ancestor', 'base', name])
      ).to.equal('');
    }
    expect(fixture.parent('side-tip')).to.equal('side');
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('allows a frozen occupied read-only parent and preserves unrelated local files', () => {
    fixture.git(['switch', 'child']);
    fixture.commit('child-remainder');
    fixture.ok(['restack']);
    fixture.ok(['freeze', 'base']);
    const linked = path.join(fixture.root, 'anchor');
    fixture.git(['worktree', 'add', linked, 'base']);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'anchor local edit');
    fixture.git(['add', 'main.txt'], linked);
    fs.writeFileSync(
      path.join(fixture.repo, 'local-untracked.txt'),
      'local untracked'
    );
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nlocal-ignored.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'local-ignored.txt'),
      'local ignored'
    );
    const localState = (): Record<string, unknown> => {
      const snapshot = fixture.inspectionSnapshot(linked);
      return Object.fromEntries(
        [
          'head',
          'branch',
          'index',
          'indexLock',
          'staging',
          'status',
          'files',
        ].map((key) => [key, snapshot[key]])
      );
    };
    const before = localState();
    fixture.ok(['split', '-f', 'child.txt']);
    expect(localState()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'local-untracked.txt'), 'utf8')
    ).to.equal('local untracked');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'local-ignored.txt'), 'utf8')
    ).to.equal('local ignored');
    expect(fixture.ok(['info', 'base'])).to.include('(frozen)');
  });

  it('preserves local work at a source-deleted parent path that is never checked out', () => {
    fixture.git(['switch', 'tip']);
    fixture.git(['rm', 'child.txt']);
    fixture.git(['commit', '-m', 'Delete inherited child file']);
    fs.writeFileSync(
      path.join(fixture.repo, 'child.txt'),
      'untracked replacement'
    );
    const originalTree = fixture.git(['rev-parse', 'tip^{tree}']);
    fixture.ok(['split', '-f', 'tip.txt']);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('untracked replacement');
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(originalTree);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
  });

  it('runs real commit hooks for both prepared commits in detached owned work', () => {
    const marker = path.join(fixture.root, 'commit-hook-records');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(
      hook,
      `#!${
        process.execPath
      }\nconst fs=require('fs');const {execFileSync}=require('child_process');const git=(args)=>execFileSync('git',args,{encoding:'utf8'}).trim();fs.appendFileSync(${JSON.stringify(
        marker
      )},JSON.stringify({branch:git(['branch','--show-current']),paths:git(['diff','--cached','--name-only'])})+'\\n');\n`,
      { mode: 0o755 }
    );
    fixture.ok(['split', '-f', 'selected.txt']);
    expect(
      fs
        .readFileSync(marker, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).to.deep.equal([
      { branch: '', paths: 'selected.txt' },
      { branch: '', paths: 'base.txt\nremainder.txt' },
    ]);
    expect(
      fixture.git(['worktree', 'list', '--porcelain']).match(/^worktree /gm)
    ).to.have.length(1);
  });

  it('refuses an alternate caller index before touching either index or branch state', () => {
    const alternate = path.join(fixture.root, 'alternate-index');
    fs.copyFileSync(path.join(fixture.repo, '.git', 'index'), alternate);
    const bytes = fs.readFileSync(alternate).toString('base64');
    const before = fixture.inspectionSnapshot();
    fixture.env.GIT_INDEX_FILE = alternate;
    const result = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    delete fixture.env.GIT_INDEX_FILE;
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('GIT_INDEX_FILE');
    expect(fs.readFileSync(alternate).toString('base64')).to.equal(bytes);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
