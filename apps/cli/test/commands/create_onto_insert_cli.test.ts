import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('create --onto --insert through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('retains the new commit and prior child commits on an actual insert conflict', () => {
    fixture.git(['switch', 'child']);
    fixture.stage('main.txt', 'conflicting child work');
    fixture.git(['commit', '-m', 'child changes shared content']);
    const child = fixture.git(['rev-parse', 'child']);
    const parent = fixture.git(['rev-parse', 'base']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'inserted shared work');

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '-m',
      'inserted work',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.match(/conflict/i)
      .and.include('child');
    expect(result.stdout + result.stderr).to.match(/continue/i);
    expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
      'main.txt'
    );
    expect(fixture.git(['rev-parse', '--verify', 'REBASE_HEAD'])).to.equal(
      child
    );
    expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(parent);
    expect(fixture.git(['show', 'inserted:main.txt'])).to.equal(
      'inserted shared work'
    );
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['show', 'child:main.txt'])).to.equal(
      'conflicting child work'
    );
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.ok(['log', 'short'])).to.include('inserted');
  });

  it('stages all remaining work before safely restacking, with all taking patch precedence', () => {
    fixture.git(['switch', 'other']);
    fixture.stage('inserted.txt', 'prepared');
    fixture.write('main.txt', 'all tracked work');
    fixture.write('loose.txt', 'all untracked work');

    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '--all',
      '--patch',
      '-m',
      'all selected',
    ]);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const branch of ['inserted', 'child', 'tip']) {
      expect(fixture.git(['show', `${branch}:main.txt`])).to.equal(
        'all tracked work'
      );
      expect(fixture.git(['show', `${branch}:loose.txt`])).to.equal(
        'all untracked work'
      );
      expect(fixture.git(['show', `${branch}:inserted.txt`])).to.equal(
        'prepared'
      );
    }
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('retains noncolliding untracked work during a necessary restack', () => {
    fixture.git(['switch', 'other']);
    fixture.stage('inserted.txt', 'prepared');
    fixture.write('loose.txt', 'untracked work');

    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '-m',
      'selected',
    ]);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['status', '--porcelain'])).to.equal('?? loose.txt');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
    ).to.equal('untracked work');
    expect(fixture.git(['ls-tree', '--name-only', 'child'])).not.to.include(
      'loose.txt'
    );
    expect(fixture.git(['show', 'child:inserted.txt'])).to.equal('prepared');
  });

  it('refuses a child worktree even when inserting without a new commit', () => {
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.write('main.txt', 'unfinished main');
    fixture.write('loose.txt', 'untracked main');
    fixture.stage('main.txt', 'linked staged', fixture.linked);
    fixture.write('main.txt', 'linked unfinished', fixture.linked);
    fixture.write('linked-loose.txt', 'linked untracked', fixture.linked);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    const topology = fixture.ok(['log', 'short']);

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('child')
      .and.include(fixture.linked);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
  });

  it('allows a read-only parent worktree without disturbing either prepared index', () => {
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    fixture.stage('main.txt', 'linked prepared', fixture.linked);
    fixture.write('main.txt', 'linked unfinished', fixture.linked);
    fixture.write('linked-loose.txt', 'linked untracked', fixture.linked);
    fixture.stage('inserted.txt', 'prepared');
    const linkedBefore = fixture.snapshot(fixture.linked);

    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '-m',
      'selected',
    ]);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['show', 'child:inserted.txt'])).to.equal('prepared');
    const after = fixture.snapshot(fixture.linked);
    expect({ ...after, refs: linkedBefore.refs }).to.deep.equal(linkedBefore);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(linkedBefore.head);
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('does not block an aligned deep worktree during an empty insertion', () => {
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.stage('main.txt', 'linked staged', fixture.linked);
    fixture.write('main.txt', 'linked unfinished', fixture.linked);
    fixture.write('linked-loose.txt', 'linked untracked', fixture.linked);
    const before = fixture.refs();
    const linkedBefore = fixture.snapshot(fixture.linked);

    fixture.ok(['create', 'inserted', '--onto', 'base', '--insert']);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/inserted '))
        .join('\n')
    ).to.equal(before);
    const after = fixture.snapshot(fixture.linked);
    expect({ ...after, refs: linkedBefore.refs }).to.deep.equal(linkedBefore);
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('still blocks a deep worktree that already needs restacking during empty insertion', () => {
    fixture.git(['switch', 'child']);
    fixture.stage('additional.txt', 'amended child');
    fixture.git(['commit', '-m', 'additional child commit']);
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    const topology = fixture.ok(['log', 'short']);

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('tip')
      .and.include(fixture.linked);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
  });

  it('protects a differently cased ignored descendant path on a case-insensitive worktree', function () {
    if (
      fixture.git([
        'config',
        '--bool',
        '--default',
        'false',
        '--get',
        'core.ignorecase',
      ]) !== 'true'
    ) {
      this.skip();
    }
    fixture.branch('target', 'main');
    fixture.branch('case-child', 'target');
    fixture.stage('Child.txt', 'descendant content');
    fixture.git(['commit', '-m', 'case-sensitive child path']);
    fixture.git(['switch', 'other']);
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nchild.txt\n');
    fixture.write('child.txt', 'local ignored content');
    fixture.stage('inserted.txt', 'inserted work');
    const before = fixture.snapshot();
    const topology = fixture.ok(['log', 'short']);

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'target',
      '--insert',
      '-m',
      'selected',
    ]);

    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('local ignored content');
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
    expect(result.stdout + result.stderr).to.match(/child\.txt/i);
  });

  for (const obstruction of ['file', 'symlink', 'case-variant symlink']) {
    it(`protects a nested descendant path obstructed by a local ${obstruction}`, function () {
      if (
        obstruction === 'case-variant symlink' &&
        fixture.git([
          'config',
          '--bool',
          '--default',
          'false',
          '--get',
          'core.ignorecase',
        ]) !== 'true'
      ) {
        this.skip();
      }
      const folder =
        obstruction === 'case-variant symlink' ? 'Folder' : 'folder';
      fixture.branch('nested-child', 'base');
      fs.mkdirSync(path.join(fixture.repo, folder));
      fixture.stage(`${folder}/file.txt`, 'nested child work');
      fixture.git(['commit', '-m', 'nested child content']);
      fixture.git(['switch', 'other']);
      const outside = path.join(fixture.root, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'file.txt'), 'outside work');
      if (obstruction.includes('symlink')) {
        const exclude = fixture.git([
          'rev-parse',
          '--git-path',
          'info/exclude',
        ]);
        fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nfolder\n');
        fs.symlinkSync(outside, path.join(fixture.repo, 'folder'));
      } else {
        fixture.write('folder', 'untracked ancestor work');
      }
      fixture.stage('inserted.txt', 'inserted work');
      const before = fixture.refs();
      const staged = fixture.git(['diff', '--cached', '--binary']);
      const status = fixture.git(['status', '--porcelain']);
      const topology = fixture.ok(['log', 'short']);

      const result = fixture.run([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '-m',
        'selected',
      ]);

      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('folder');
      expect(fixture.git(['branch', '--show-current'])).to.equal('other');
      expect(fixture.refs()).to.equal(before);
      expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(staged);
      expect(fixture.git(['status', '--porcelain'])).to.equal(status);
      expect(fixture.ok(['log', 'short'])).to.equal(topology);
      expect(fs.readFileSync(path.join(outside, 'file.txt'), 'utf8')).to.equal(
        'outside work'
      );
      if (obstruction.includes('symlink')) {
        expect(fs.readlinkSync(path.join(fixture.repo, 'folder'))).to.equal(
          outside
        );
      } else {
        expect(
          fs.readFileSync(path.join(fixture.repo, 'folder'), 'utf8')
        ).to.equal('untracked ancestor work');
      }
    });
  }

  for (const ignored of [false, true]) {
    it(`protects a descendant-only path collision before insertion with ignored ${ignored}`, () => {
      fixture.git(['switch', 'other']);
      if (ignored) {
        const exclude = fixture.git([
          'rev-parse',
          '--git-path',
          'info/exclude',
        ]);
        fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nchild.txt\n');
      }
      fixture.write('child.txt', 'local unfinished child content');
      fixture.stage('inserted.txt', 'inserted work');
      const before = fixture.snapshot();
      const topology = fixture.ok(['log', 'short']);

      const result = fixture.run([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '-m',
        'inserted work',
      ]);

      expect(result.status).not.to.equal(0);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
      ).to.equal('local unfinished child content');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.ok(['log', 'short'])).to.equal(topology);
      expect(result.stdout + result.stderr).to.include('child.txt');
    });
  }

  for (const all of [false, true]) {
    it(`permits an unchanged deep worktree when selected work already matches the parent with all ${all}`, () => {
      fixture.branch('target', 'main');
      fixture.stage('main.txt', 'target version');
      fixture.git(['commit', '-m', 'target baseline']);
      fixture.branch('target-child', 'target');
      fixture.branch('target-tip', 'target-child');
      fixture.git(['switch', 'other']);
      fixture.git(['worktree', 'add', fixture.linked, 'target-tip']);
      fixture.write('linked-loose.txt', 'linked work', fixture.linked);
      fixture.stage('main.txt', 'target version');
      const before = fixture.refs();
      const linkedBefore = fixture.snapshot(fixture.linked);
      const parent = fixture.git(['rev-parse', 'target']);

      fixture.ok([
        'create',
        'inserted',
        '--onto',
        'target',
        '--insert',
        ...(all ? ['--all'] : []),
        '-m',
        'selected work already present',
      ]);

      expect(fixture.git(['rev-parse', 'inserted'])).to.equal(parent);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(
        fixture
          .refs()
          .split('\n')
          .filter((line) => !line.startsWith('refs/heads/inserted '))
          .join('\n')
      ).to.equal(before);
      const linkedAfter = fixture.snapshot(fixture.linked);
      expect({ ...linkedAfter, refs: linkedBefore.refs }).to.deep.equal(
        linkedBefore
      );
      fixture.ok(['checkout', 'target-child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    });
  }

  for (const source of ['child', 'tip']) {
    it(`restacks a departure ${source} within the selected scope`, () => {
      fixture.git(['switch', source]);
      const other = fixture.git(['rev-parse', 'other']);
      const parent = fixture.git(['rev-parse', 'base']);
      fixture.stage('inserted.txt', 'inserted work');

      fixture.ok([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '-m',
        'inserted work',
      ]);

      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(parent);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['show', `${source}:${source}.txt`])).to.equal(source);
      expect(fixture.git(['show', `${source}:inserted.txt`])).to.equal(
        'inserted work'
      );
      fixture.git(['merge-base', '--is-ancestor', 'inserted', source]);
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      fixture.ok(['checkout', 'tip']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    });
  }

  it('inserts without children while retaining unfinished work', () => {
    fixture.stage();
    fixture.write('main.txt', 'unfinished tracked work');
    fixture.write('loose.txt', 'unfinished untracked work');
    const before = fixture.refs();
    const parent = fixture.git(['rev-parse', 'other']);

    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'other',
      '--insert',
      '-m',
      'inserted work',
    ]);

    expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(parent);
    expect(fixture.git(['show', 'HEAD:new.txt'])).to.equal('new work');
    expect(fixture.git(['status', '--porcelain'])).to.equal(
      'M main.txt\n?? loose.txt'
    );
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/inserted '))
        .join('\n')
    ).to.equal(before);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('inserts an empty branch without rewriting aligned children or losing dirty work', () => {
    fixture.git(['switch', 'other']);
    fixture.write('main.txt', 'unfinished tracked work');
    fixture.write('loose.txt', 'unfinished untracked work');
    const before = fixture.refs();
    const parent = fixture.git(['rev-parse', 'base']);

    fixture.ok(['create', 'inserted', '--onto', 'base', '--insert']);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(parent);
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/inserted '))
        .join('\n')
    ).to.equal(before);
    expect(fixture.git(['status', '--porcelain'])).to.equal(
      'M main.txt\n?? loose.txt'
    );
    expect(fixture.git(['diff'])).to.include('+unfinished tracked work');
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });

  it('refuses remaining unstaged tracked work before committing an insertion', () => {
    fixture.git(['switch', 'other']);
    fixture.stage();
    fixture.write('main.txt', 'unfinished tracked work');
    fixture.write('loose.txt', 'unfinished untracked work');
    const before = fixture.snapshot();
    const topology = fixture.ok(['log', 'short']);

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '-m',
      'inserted work',
    ]);

    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
    expect(result.stdout + result.stderr).to.match(/unstaged|restack/i);
  });

  it('refuses a descendant worktree before creating its new ancestor', () => {
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.stage();
    fixture.stage('main.txt', 'linked staged', fixture.linked);
    fixture.write('main.txt', 'linked unfinished', fixture.linked);
    fixture.write('linked-loose.txt', 'linked untracked', fixture.linked);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    const topology = fixture.ok(['log', 'short']);

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '-m',
      'inserted work',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('tip')
      .and.include(fixture.linked)
      .and.match(/switch|detach/i);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
  });

  it('refuses a child worktree before all staging, commit, or reparenting', () => {
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.stage('main.txt', 'prepared main');
    fixture.write('main.txt', 'prepared main plus unfinished');
    fixture.write('loose.txt', 'main untracked');
    fixture.stage('main.txt', 'linked staged', fixture.linked);
    fixture.write('main.txt', 'linked staged plus unfinished', fixture.linked);
    fixture.write('linked-loose.txt', 'linked untracked', fixture.linked);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    const topology = fixture.ok(['log', 'short']);

    const result = fixture.run([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '--all',
      '-m',
      'inserted work',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('child')
      .and.include(fixture.linked)
      .and.match(/switch|detach/i);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    expect(fixture.ok(['log', 'short'])).to.equal(topology);
  });

  it('inserts beneath both original children and restacks their descendants', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'other']);
    const before = fixture.refs();
    const parent = fixture.git(['rev-parse', 'base']);
    fixture.stage('inserted.txt', 'inserted work');

    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '-m',
      'inserted work',
    ]);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(parent);
    expect(fixture.git(['show', 'inserted:inserted.txt'])).to.equal(
      'inserted work'
    );
    for (const branch of ['child', 'tip', 'sibling']) {
      expect(fixture.git(['show', `${branch}:${branch}.txt`])).to.equal(branch);
      expect(fixture.git(['show', `${branch}:inserted.txt`])).to.equal(
        'inserted work'
      );
      fixture.git(['merge-base', '--is-ancestor', 'inserted', branch]);
    }
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('child');
    const preserved = (refs: string): string =>
      refs
        .split('\n')
        .filter(
          (line) =>
            !['child', 'tip', 'sibling', 'inserted'].some((branch) =>
              line.startsWith(`refs/heads/${branch} `)
            )
        )
        .join('\n');
    expect(preserved(fixture.refs())).to.equal(preserved(before));
    for (const branch of ['child', 'sibling']) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    }
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    fixture.ok(['checkout', 'inserted']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });
});
