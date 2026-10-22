import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// Independent public CLI scenarios, each with a fresh Git repository.
// eslint-disable-next-line max-lines-per-function
describe('create --onto through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('commits staged work above the selected local tip and persists navigation', () => {
    const before = fixture.refs();
    const parent = fixture.git(['rev-parse', 'other']);
    fixture.stage();

    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'new work']);

    expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
    expect(fixture.git(['log', '-1', '--format=%s'])).to.equal('new work');
    expect(fixture.git(['ls-tree', '--name-only', 'HEAD'])).to.equal(
      'main.txt\nnew.txt\nother.txt'
    );
    expect(fixture.git(['show', 'HEAD:new.txt'])).to.equal('new work');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/new-branch '))
        .join('\n')
    ).to.equal(before);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    fixture.ok(['up']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
    expect(fixture.ok(['log', 'short', '--stack']))
      .to.include('new-branch')
      .and.include('other');
  });
  it('refuses missing noninteractive commit input before changing the checkout', () => {
    fixture.stage();
    const before = fixture.snapshot();

    const result = fixture.run(['create', 'new-branch', '--onto', 'other']);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(/message|interactive/i);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('refuses detached HEAD without creating a branch or changing work', () => {
    fixture.git(['switch', '--detach']);
    fixture.stage();
    const before = fixture.snapshot();

    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '-m',
      'new work',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(
      /branch checked out|detached/i
    );
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('refuses an unfinished merge even after its conflicts have been staged', () => {
    fixture.git(['merge', '--no-commit', '--no-ff', 'other']);
    fixture.stage();
    const before = fixture.snapshot();
    const mergeHead = fixture.git(['rev-parse', 'MERGE_HEAD']);

    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'base',
      '-m',
      'new work',
    ]);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(/merge/i);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.git(['rev-parse', 'MERGE_HEAD'])).to.equal(mergeHead);
  });

  for (const flag of ['--all', '--patch', '--insert']) {
    it(`refuses unsupported onto ${flag} before changing staged work`, () => {
      fixture.stage();
      fixture.write('main.txt', 'unfinished');
      const before = fixture.snapshot();

      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'new work',
        flag,
      ]);

      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  for (const [source, parent] of [
    ['base', 'main'],
    ['base', 'base'],
    ['child', 'base'],
    ['base', 'child'],
    ['base', 'tip'],
  ]) {
    it(`creates an empty tracked branch from ${source} at the ${parent} tip`, () => {
      fixture.git(['switch', source]);
      const before = fixture.refs();
      const tip = fixture.git(['rev-parse', parent]);

      fixture.ok(['c', 'new-branch', '--onto', parent]);

      expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(tip);
      expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
      expect(
        fixture
          .refs()
          .split('\n')
          .filter((line) => !line.startsWith('refs/heads/new-branch '))
          .join('\n')
      ).to.equal(before);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
      fixture.ok(['checkout', 'new-branch']);
      expect(fixture.ok(['log', 'short', '--stack']))
        .to.include('new-branch')
        .and.include(parent);
    });
  }

  for (const target of [
    'missing',
    '',
    'tag-target',
    'origin/main',
    'untracked',
    'sha',
  ]) {
    it(`rejects non-parent target ${
      target || '(empty)'
    } without mutation`, () => {
      fixture.git(['tag', 'tag-target', 'other']);
      fixture.git(['branch', 'untracked', 'other']);
      fixture.stage();
      const before = fixture.snapshot();
      const parent =
        target === 'sha' ? fixture.git(['rev-parse', 'other']) : target;

      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        parent,
        '-m',
        'new work',
      ]);

      expect(result.status).not.to.equal(0);
      if (target === 'untracked')
        expect(result.stdout + result.stderr).to.include('ch track');
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  for (const name of ['..bad', '.', 'other', 'base']) {
    it(`rejects invalid or colliding new name ${name} without mutation`, () => {
      fixture.stage();
      const before = fixture.snapshot();

      const result = fixture.run([
        'create',
        name,
        '--onto',
        'other',
        '-m',
        'new work',
      ]);

      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  it('requires an onto value without silently falling back to the current parent', () => {
    fixture.stage();
    const before = fixture.snapshot();
    const result = fixture.run([
      'create',
      'new-branch',
      '-m',
      'new work',
      '--onto',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('onto');
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('rejects a second create with the same name while preserving the first result', () => {
    fixture.stage();
    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'new work']);
    fixture.stage('more.txt', 'more work');
    const before = fixture.snapshot();
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '-m',
      'again',
    ]);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['log', 'short', '--stack']);
  });

  it('generates names from the message using existing user settings', () => {
    const config = fixture.env.GRAPHITE_USER_CONFIG_PATH;
    if (!config) throw new Error('Missing fixture config');
    fs.writeFileSync(
      config,
      JSON.stringify({
        tips: false,
        branchDate: false,
        branchPrefix: 'work/',
        branchReplacement: '-',
      })
    );
    fixture.stage();

    fixture.ok(['create', '--onto', 'other', '-m', 'feat(test): useful work.']);

    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'work/feat-test-useful-work'
    );
    expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
      'feat(test): useful work.'
    );
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  for (const explicit of [false, true]) {
    it(`preserves ordinary create name normalization with explicit parent ${explicit}`, () => {
      const parent = fixture.git(['rev-parse', 'base']);
      fixture.stage();
      fixture.ok([
        'create',
        'Useful branch.',
        ...(explicit ? ['--onto', 'base'] : []),
        '-m',
        'new work',
      ]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        'Useful_branch'
      );
      expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
      expect(fixture.git(['ls-tree', '--name-only', 'HEAD'])).to.equal(
        'base.txt\nmain.txt\nnew.txt'
      );
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }

  it('allows a normal untracked source without tracking or changing it', () => {
    fixture.git(['switch', '-c', 'untracked-source', 'base']);
    fixture.commit('source');
    const before = fixture.refs();
    fixture.stage();

    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'new work']);

    expect(fixture.git(['ls-tree', '--name-only', 'HEAD'])).to.equal(
      'main.txt\nnew.txt\nother.txt'
    );
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/new-branch '))
        .join('\n')
    ).to.equal(before);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    fixture.ok(['checkout', 'untracked-source']);
    const result = fixture.run(['down']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('ch track');
  });

  it('creates directly above a parent active in another worktree without touching that work', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'other']);
    fixture.stage('other.txt', 'staged parent edit', fixture.linked);
    fixture.write('other.txt', 'unstaged parent edit', fixture.linked);
    fixture.write('loose.txt', 'untracked parent content', fixture.linked);
    const before = fixture.snapshot(fixture.linked);
    fixture.stage();

    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'new work']);

    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(before.head);
    const after = fixture.snapshot(fixture.linked);
    expect({ ...after, refs: before.refs }).to.deep.equal(before);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    fixture.ok(['log', 'short', '--stack']);
  });

  it('creates from a linked current worktree while preserving the main checkout', () => {
    fixture.git(['switch', 'main']);
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    fixture.stage('main.txt', 'main index work');
    fixture.write('main.txt', 'main unstaged work');
    fixture.write('loose.txt', 'main untracked work');
    const before = fixture.snapshot();
    fixture.stage('new.txt', 'new work', fixture.linked);
    const parent = fixture.git(['rev-parse', 'other']);

    fixture.ok(
      ['create', 'new-branch', '--onto', 'other', '-m', 'new work'],
      fixture.linked
    );

    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'new-branch'
    );
    expect(fixture.git(['rev-parse', 'HEAD^'], fixture.linked)).to.equal(
      parent
    );
    const after = fixture.snapshot();
    expect({ ...after, refs: before.refs }).to.deep.equal(before);
    fixture.ok(['down'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'other'
    );
    fixture.ok(['up'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'new-branch'
    );
  });

  it('finishes an explicit interactive command in a real PTY without keyboard input', () => {
    fixture.stage();
    const result = runCliInPty(
      getTestCliCommand([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'new work',
      ]),
      { cwd: fixture.repo, env: fixture.env }
    );
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
    expect(fixture.git(['show', 'HEAD:new.txt'])).to.equal('new work');
  });

  it('describes the onto option in public help', () => {
    expect(fixture.ok(['create', '--help']))
      .to.include('--onto')
      .and.include('local branch');
  });

  it('requires either a name or a message before any noninteractive mutation', () => {
    const before = fixture.snapshot();
    const result = fixture.run(['create', '--onto', 'other']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(/name|message/i);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  for (const backend of ['--merge', '--apply']) {
    it(`preserves an active ${backend} rebase and its staged resolution`, () => {
      fixture.stage('main.txt', 'source change');
      fixture.git(['commit', '-m', 'source conflict']);
      fixture.git(['switch', 'other']);
      fixture.stage('main.txt', 'target change');
      fixture.git(['commit', '-m', 'target conflict']);
      fixture.git(['switch', 'base']);
      expect(() => fixture.git(['rebase', backend, 'other'])).to.throw();
      fixture.stage('main.txt', 'resolved content');
      const before = fixture.snapshot();
      const rebaseHead = fixture.git(['rev-parse', 'REBASE_HEAD']);

      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'new work',
      ]);

      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.match(/rebase|continue/i);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.git(['rev-parse', 'REBASE_HEAD'])).to.equal(rebaseHead);
      fixture.git(['rebase', '--abort']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }

  it('uses the local branch tip even when a tag has the same name', () => {
    fixture.git(['tag', 'other', 'main']);
    const tip = fixture.git(['rev-parse', 'refs/heads/other']);
    fixture.stage();
    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'new work']);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(tip);
    expect(fixture.git(['show', 'HEAD:other.txt'])).to.equal('other');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });
  for (const parentElsewhere of [false, true]) {
    it(`restores the original source on a rejecting hook with parent elsewhere ${parentElsewhere}`, () => {
      if (parentElsewhere)
        fixture.git(['worktree', 'add', fixture.linked, 'other']);
      const hooks = fixture.git(['rev-parse', '--git-path', 'hooks']);
      fs.writeFileSync(
        path.resolve(fixture.repo, hooks, 'pre-commit'),
        '#!/bin/sh\nexit 1\n',
        { mode: 0o755 }
      );
      fixture.stage();
      const before = fixture.snapshot();
      const otherBefore = parentElsewhere
        ? fixture.snapshot(fixture.linked)
        : undefined;

      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'new work',
      ]);

      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      if (otherBefore)
        expect(fixture.snapshot(fixture.linked)).to.deep.equal(otherBefore);
      fixture.ok(['log', 'short', '--stack']);
    });
  }
});
