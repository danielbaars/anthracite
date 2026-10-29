import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('absorb previews through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    fixture.git(['switch', 'tip']);
  });
  afterEach(() => {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.cleanup();
  });

  function stageCorrection(): void {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    fixture.git(['add', 'base.txt']);
  }

  function refuses(pattern: RegExp, directory = fixture.repo): void {
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(
      ['absorb', '--dry-run', '--no-interactive'],
      directory
    );
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.match(pattern);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  }

  it('identifies the original downstack commit and replay chain without effects', () => {
    const original = fixture.git(['rev-parse', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'local-note.txt'), 'keep local');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('base.txt').and.include(original);
    expect(result.stdout)
      .to.include('base')
      .and.include('child')
      .and.include('tip');
    expect(result.stdout).not.to.include('Unrelated work');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('refuses saved recovery from a linked worktree without cleaning either index', () => {
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    fs.writeFileSync(path.join(linked, 'base.txt'), 'corrected base\n');
    fixture.git(['add', 'base.txt'], linked);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      JSON.stringify({ branchesToSync: [], branchesToRestack: ['tip'] })
    );
    const before = [
      fixture.inspectionSnapshot(),
      fixture.inspectionSnapshot(linked),
    ];
    const result = fixture.run(
      ['absorb', '--dry-run', '--no-interactive'],
      linked
    );
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('recovery');
    expect([
      fixture.inspectionSnapshot(),
      fixture.inspectionSnapshot(linked),
    ]).to.deep.equal(before);
  });

  it('preserves opaque caches, foreign locks, ignored work and dirty index stat data', () => {
    stageCorrection();
    const common = path.join(fixture.repo, '.git');
    for (const name of [
      '.graphite_cache_persist',
      '.graphite_cache_lock',
      '.graphite_pr_info',
    ])
      fs.writeFileSync(path.join(common, name), Buffer.from([255, 0, 123]));
    fs.appendFileSync(path.join(common, 'info', 'exclude'), '\nignored.bin\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored.bin'),
      Buffer.from([0, 255, 1])
    );
    const file = path.join(fixture.repo, 'child.txt');
    const stat = fs.statSync(file);
    fs.utimesSync(file, stat.atime, new Date(stat.mtimeMs + 50000));
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses an occupied mandatory branch and preserves its dirty linked files and index', () => {
    stageCorrection();
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'base']);
    fs.writeFileSync(path.join(linked, 'base.txt'), 'dirty linked edit\n');
    const before = [
      fixture.inspectionSnapshot(),
      fixture.inspectionSnapshot(linked),
    ];
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('checked out in worktree');
    expect([
      fixture.inspectionSnapshot(),
      fixture.inspectionSnapshot(linked),
    ]).to.deep.equal(before);
  });

  it('refuses a frozen mandatory descendant instead of silently skipping it', () => {
    fixture.git(['switch', 'child']);
    stageCorrection();
    const metadata: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/tip'])
    );
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      throw new Error('Expected fixture metadata object');
    const file = path.join(fixture.root, 'frozen-metadata.json');
    fs.writeFileSync(file, JSON.stringify({ ...metadata, frozen: true }));
    fixture.git([
      'update-ref',
      'refs/branch-metadata/tip',
      fixture.git(['hash-object', '-w', file]),
    ]);
    refuses(/frozen branch tip/);
  });

  it('reports a frozen target and a trunk-owned correction as retained input', () => {
    stageCorrection();
    fixture.ok(['freeze', 'base']);
    let before = fixture.inspectionSnapshot();
    let result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Retained base.txt').and.include('frozen');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['restore', '--staged', '--worktree', 'base.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'trunk-only correction\n'
    );
    fixture.git(['add', 'main.txt']);
    before = fixture.inspectionSnapshot();
    result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Retained main.txt')
      .and.include('No eligible feature commit');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('explains a no-input preview, refuses unavailable application and previews wider input', () => {
    let before = fixture.inspectionSnapshot();
    let result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('No staged changes');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    result = fixture.run(['absorb', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('application is not available');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    stageCorrection();
    fs.writeFileSync(
      path.join(fixture.repo, 'child.txt'),
      'child correction\n'
    );
    fixture.git(['add', 'child.txt']);
    before = fixture.inspectionSnapshot();
    result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('base.txt: absorb into base')
      .and.include('child.txt: absorb into child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('lets an empty tracked caller inspect an eligible ancestor', () => {
    fixture.branch('empty-caller', 'tip', true);
    stageCorrection();
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('empty-caller')
      .and.include(fixture.git(['rev-parse', 'base']));
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('retains an unsupported staged mode change instead of advertising a text-only amendment', () => {
    stageCorrection();
    fixture.git(['update-index', '--chmod=+x', 'base.txt']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Retained base.txt:').and.include('mode');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses an unhandled content filter without invoking configured text conversion', () => {
    stageCorrection();
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'attributes'),
      'base.txt filter=custom diff=custom\n'
    );
    const sentinel = path.join(fixture.root, 'sentinel-bin', 'editor');
    fixture.git(['config', 'diff.custom.textconv', sentinel]);
    fixture.git(['config', 'filter.custom.clean', sentinel]);
    fixture.git(['config', 'filter.custom.smudge', sentinel]);
    // Status can itself run clean filters, so observe raw state without it.
    const observe = (): unknown => ({
      refs: fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']),
      index: fs
        .readFileSync(path.join(fixture.repo, '.git', 'index'))
        .toString('base64'),
      config: fs
        .readFileSync(path.join(fixture.repo, '.git', 'config'))
        .toString('base64'),
      contents: fs
        .readFileSync(path.join(fixture.repo, 'base.txt'))
        .toString('base64'),
      attributes: fs
        .readFileSync(path.join(fixture.repo, '.git', 'info', 'attributes'))
        .toString('base64'),
    });
    const before = observe();
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.match(/content filter|encoding/i);
    expect(observe()).to.deep.equal(before);
  });

  for (const source of [
    'trunk',
    'detached',
    'untracked',
    'stale',
    'merge',
    'unmerged',
    'active',
    'uninitialized',
    'outside',
  ])
    it(`refuses ${source} source before repair or cleanup`, () => {
      if (source === 'trunk') fixture.git(['switch', 'main']);
      if (source === 'detached') fixture.git(['switch', '--detach']);
      if (source === 'untracked') fixture.git(['switch', '-c', 'untracked']);
      if (source === 'stale') {
        fixture.git(['switch', 'base']);
        fixture.commit('advance-base');
        fixture.git(['switch', 'tip']);
      }
      if (source === 'merge') {
        fixture.git([
          'merge',
          '--no-ff',
          'other',
          '-m',
          'Merge unrelated branch',
        ]);
      }
      if (source === 'unmerged') {
        const revision = fixture.git(['rev-parse', 'HEAD:base.txt']);
        fixture.git(['update-index', '--force-remove', 'base.txt']);
        execFileSync('git', ['update-index', '--index-info'], {
          cwd: fixture.repo,
          env: fixture.env,
          input: [1, 2, 3]
            .map((stage) => `100644 ${revision} ${stage}\tbase.txt\n`)
            .join(''),
        });
      }
      if (source === 'active')
        fs.mkdirSync(path.join(fixture.repo, '.git', 'rebase-merge'));
      if (source === 'uninitialized')
        fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_repo_config'));
      const directory = source === 'outside' ? fixture.root : fixture.repo;
      refuses(
        /trunk|attached|tracked|restack|merge|recovery|initialized|repository|git repository|resolved index/i,
        directory
      );
    });
});
