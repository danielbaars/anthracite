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
  it('commits only staged work and preserves separate unfinished files', () => {
    fixture.stage();
    fixture.write('main.txt', 'unfinished tracked work');
    fixture.write('loose.txt', 'untracked work');
    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'selected']);
    expect(fixture.git(['diff', 'HEAD^', 'HEAD', '--name-only'])).to.equal(
      'new.txt'
    );
    expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal('main');
    expect(fixture.git(['diff', '--cached'])).to.equal('');
    expect(fixture.git(['status', '--porcelain'])).to.equal(
      'M main.txt\n?? loose.txt'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('unfinished tracked work');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
    ).to.equal('untracked work');
  });

  it('commits the staged version and retains the additional same-file edit', () => {
    fixture.stage('main.txt', 'prepared version\n');
    fixture.write('main.txt', 'prepared version\nunfinished addition\n');
    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'partial']);
    expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal('prepared version');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('prepared version\nunfinished addition\n');
    expect(fixture.git(['diff', '--cached'])).to.equal('');
    expect(fixture.git(['diff'])).to.include('+unfinished addition');
  });

  for (const kind of ['untracked', 'unstaged', 'staged']) {
    it(`preserves all work when a ${kind} edit blocks checkout`, () => {
      fixture.stage('sentinel.txt', 'prepared');
      if (kind === 'untracked')
        fixture.write('other.txt', 'untracked collision');
      else {
        fixture.write('base.txt', 'unfinished source content');
        if (kind === 'staged') fixture.git(['add', 'base.txt']);
      }
      const before = fixture.snapshot();
      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'blocked',
      ]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.match(
        /overwritten|local changes/i
      );
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.ok(['log', 'short', '--stack'])).not.to.include(
        'new-branch'
      );
    });
  }

  it('stages all tracked and untracked work above the chosen parent', () => {
    fixture.stage('main.txt', 'prepared version\n');
    fixture.write('main.txt', 'complete version\n');
    fixture.write('loose.txt', 'new untracked work');
    const parent = fixture.git(['rev-parse', 'other']);
    fixture.ok([
      'create',
      'new-branch',
      '--onto',
      'other',
      '--all',
      '-m',
      'all work',
    ]);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
    expect(fixture.git(['ls-tree', '--name-only', 'HEAD'])).to.equal(
      'loose.txt\nmain.txt\nother.txt'
    );
    expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal('complete version');
    expect(fixture.git(['show', 'HEAD:loose.txt'])).to.equal(
      'new untracked work'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('commits a staged sentinel plus only the chosen patch hunk in a real PTY', () => {
    const lines =
      Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    fixture.stage('main.txt', lines);
    fixture.git(['commit', '-m', 'shared patch baseline']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', lines);
    fixture.git(['commit', '-m', 'shared patch baseline']);
    fixture.git(['switch', 'base']);
    fixture.stage('sentinel.txt', 'already prepared');
    fixture.write(
      'main.txt',
      lines
        .replace('line 0\n', 'selected hunk\n')
        .replace('line 39\n', 'unfinished hunk\n')
    );
    const parent = fixture.git(['rev-parse', 'other']);
    const result = runCliInPty(
      getTestCliCommand([
        'create',
        'new-branch',
        '--onto',
        'other',
        '--patch',
        '-m',
        'selected patch',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Stage this hunk', input: 'y\n' },
          { prompt: 'Stage this hunk', input: 'n\n' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('Stage this hunk');
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
    expect(fixture.git(['show', 'HEAD:sentinel.txt'])).to.equal(
      'already prepared'
    );
    expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal(
      lines.replace('line 0\n', 'selected hunk\n').trim()
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal(
      lines
        .replace('line 0\n', 'selected hunk\n')
        .replace('line 39\n', 'unfinished hunk\n')
    );
    expect(fixture.git(['diff', '--cached'])).to.equal('');
    expect(fixture.git(['diff']))
      .to.include('+unfinished hunk')
      .and.not.include('+selected hunk');
    expect(fixture.ok(['log', 'short', '--stack']))
      .to.include('other')
      .and.include('new-branch');
    fixture.git(['restore', 'main.txt']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('refuses noninteractive patch selection before any checkout or staging', () => {
    fixture.stage();
    fixture.write('main.txt', 'selectable work');
    const before = fixture.snapshot();
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '--patch',
      '-m',
      'patch',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(
      /patch.*interactive|interactive.*patch/i
    );
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  for (const [linked, all] of [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ]) {
    it(`restores partial staging with all ${all} on a rejecting hook in linked worktree ${linked}`, () => {
      let cwd = fixture.repo;
      if (linked) {
        fixture.git(['switch', 'main']);
        fixture.git(['worktree', 'add', fixture.linked, 'base']);
        cwd = fixture.linked;
      }
      fixture.stage('main.txt', 'prepared version\n', cwd);
      fixture.write('main.txt', 'prepared version\nunfinished addition\n', cwd);
      fixture.write('loose.txt', 'untracked work', cwd);
      const hooks = fixture.git(['rev-parse', '--git-path', 'hooks'], cwd);
      fs.writeFileSync(
        path.resolve(cwd, hooks, 'pre-commit'),
        '#!/bin/sh\nexit 1\n',
        { mode: 0o755 }
      );
      const before = fixture.snapshot(cwd);
      const result = fixture.run(
        [
          'create',
          'new-branch',
          '--onto',
          'other',
          ...(all ? ['--all'] : []),
          '-m',
          'rejected',
        ],
        cwd
      );
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot(cwd)).to.deep.equal(before);
      expect(fixture.ok(['log', 'short', '--stack'], cwd)).not.to.include(
        'new-branch'
      );
      if (!linked) {
        fixture.ok(['down'], cwd);
        expect(fixture.git(['branch', '--show-current'], cwd)).to.equal('main');
      }
    });
  }

  it('preserves hook-created staging and reports the retained checkout after rejection', () => {
    fixture.stage('sentinel.txt', 'prepared work');
    const hooks = fixture.git(['rev-parse', '--git-path', 'hooks']);
    fs.writeFileSync(
      path.resolve(fixture.repo, hooks, 'pre-commit'),
      '#!/bin/sh\nprintf "hook content\\n" > main.txt\ngit add main.txt\nexit 1\n',
      { mode: 0o755 }
    );
    const parent = fixture.git(['rev-parse', 'other']);
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '-m',
      'rejected',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(
      /changed.*work|work.*changed/i
    );
    expect(result.stdout + result.stderr).to.include('new-branch');
    expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(parent);
    expect(fixture.git(['show', ':main.txt'])).to.equal('hook content');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('hook content\n');
    expect(fixture.git(['show', ':sentinel.txt'])).to.equal('prepared work');
    expect(fixture.git(['status', '--porcelain'])).to.equal(
      'M  main.txt\nA  sentinel.txt'
    );
    expect(fixture.ok(['log', 'short', '--stack'])).to.include('new-branch');
  });

  it('gives all precedence over patch without requesting input', () => {
    fixture.stage('sentinel.txt', 'prepared');
    fixture.write('main.txt', 'all selected');
    fixture.write('loose.txt', 'also selected');
    fixture.ok([
      'create',
      'new-branch',
      '--onto',
      'other',
      '--all',
      '--patch',
      '-m',
      'all wins',
    ]);
    expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal('all selected');
    expect(fixture.git(['show', 'HEAD:sentinel.txt'])).to.equal('prepared');
    expect(fixture.git(['show', 'HEAD:loose.txt'])).to.equal('also selected');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('patches unstaged work without needing a staged sentinel', () => {
    fixture.write('main.txt', 'selected only hunk');
    const result = runCliInPty(
      getTestCliCommand([
        'create',
        'new-branch',
        '--onto',
        'other',
        '--patch',
        '-m',
        'patch only',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Stage this hunk', input: 'y\n' }],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('Stage this hunk');
    expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal(
      'selected only hunk'
    );
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('preserves ordinary create patch behavior when nothing was staged', () => {
    fixture.write('main.txt', 'unfinished work');
    const before = fixture.snapshot();
    const result = runCliInPty(
      getTestCliCommand(['create', 'ordinary', '--patch', '-m', 'ordinary']),
      {
        cwd: fixture.repo,
        env: fixture.env,
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Stage this hunk');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(before.head);
    expect(fixture.git(['diff'])).to.equal(before.unstaged);
    expect(fixture.git(['diff', '--cached'])).to.equal('');
  });

  for (const noVerify of [false, true]) {
    it(`honors existing commit hook verification with no-verify ${noVerify}`, () => {
      fixture.stage();
      const hooks = fixture.git(['rev-parse', '--git-path', 'hooks']);
      fs.writeFileSync(
        path.resolve(fixture.repo, hooks, 'pre-commit'),
        '#!/bin/sh\nprintf "ran" > ../hook-ran\nexit 1\n',
        { mode: 0o755 }
      );
      const before = fixture.snapshot();
      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'verified',
        ...(noVerify ? ['--no-verify'] : []),
      ]);
      expect(result.status).to.equal(noVerify ? 0 : 1);
      expect(fs.existsSync(path.join(fixture.root, 'hook-ran'))).to.equal(
        !noVerify
      );
      if (noVerify) {
        expect(fixture.git(['show', 'HEAD:new.txt'])).to.equal('new work');
        expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(
          fixture.git(['rev-parse', 'other'])
        );
      } else expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  for (const file of ['main.txt', 'loose.txt']) {
    it(`preserves a hook edit to ${file} without silently restoring its earlier contents`, () => {
      fixture.stage('sentinel.txt', 'prepared');
      fixture.write('loose.txt', 'original untracked');
      const hooks = fixture.git(['rev-parse', '--git-path', 'hooks']);
      fs.writeFileSync(
        path.resolve(fixture.repo, hooks, 'pre-commit'),
        `#!/bin/sh\nprintf "hook edit" > ${file}\nexit 1\n`,
        { mode: 0o755 }
      );
      const result = fixture.run([
        'create',
        'new-branch',
        '--onto',
        'other',
        '-m',
        'rejected',
      ]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('retained new-branch');
      expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
      expect(fs.readFileSync(path.join(fixture.repo, file), 'utf8')).to.equal(
        'hook edit'
      );
      expect(fixture.git(['show', ':sentinel.txt'])).to.equal('prepared');
      expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(
        fixture.git(['rev-parse', 'other'])
      );
    });
  }

  it('preserves an ignored file that would be overwritten by the selected parent', () => {
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nother.txt\n');
    fixture.write('other.txt', 'ignored local content');
    fixture.stage('sentinel.txt', 'prepared');
    const before = fixture.snapshot();
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '-m',
      'blocked',
    ]);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'other.txt'), 'utf8')
    ).to.equal('ignored local content');
    expect(fixture.ok(['log', 'short', '--stack'])).not.to.include(
      'new-branch'
    );
  });

  it('retains ignored hook output when returning to the source would overwrite it', () => {
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nbase.txt\n');
    fixture.stage('sentinel.txt', 'prepared');
    const hooks = fixture.git(['rev-parse', '--git-path', 'hooks']);
    fs.writeFileSync(
      path.resolve(fixture.repo, hooks, 'pre-commit'),
      '#!/bin/sh\nprintf "ignored hook output" > base.txt\nexit 1\n',
      { mode: 0o755 }
    );
    const source = fixture.git(['rev-parse', 'base']);
    const parent = fixture.git(['rev-parse', 'other']);
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '-m',
      'rejected',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Could not clean up new-branch'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(parent);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('ignored hook output');
    expect(fixture.git(['show', ':sentinel.txt'])).to.equal('prepared');
    expect(fixture.ok(['log', 'short', '--stack'])).to.include('new-branch');
  });

  it('preserves an opaque untracked nested repository while committing selected work', () => {
    const nested = path.join(fixture.repo, 'nested');
    fixture.git(['init', '--initial-branch=main', nested]);
    fixture.write('nested/work.txt', 'nested committed work');
    fixture.git(['add', 'work.txt'], nested);
    fixture.git(
      [
        '-c',
        'user.name=Nested fixture',
        '-c',
        'user.email=nested@example.test',
        'commit',
        '-m',
        'nested work',
      ],
      nested
    );
    fixture.write('nested/work.txt', 'nested unfinished work');
    const nestedHead = fixture.git(['rev-parse', 'HEAD'], nested);
    const nestedDiff = fixture.git(['diff'], nested);
    fixture.stage('sentinel.txt', 'selected work');
    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'selected']);
    expect(fixture.git(['show', 'HEAD:sentinel.txt'])).to.equal(
      'selected work'
    );
    expect(fixture.git(['ls-tree', '--name-only', 'HEAD'])).to.equal(
      'main.txt\nother.txt\nsentinel.txt'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('?? nested/');
    expect(fixture.git(['rev-parse', 'HEAD'], nested)).to.equal(nestedHead);
    expect(fixture.git(['diff'], nested)).to.equal(nestedDiff);
    expect(fs.readFileSync(path.join(nested, 'work.txt'), 'utf8')).to.equal(
      'nested unfinished work'
    );
  });

  it('preserves a dangling untracked symlink while committing selected work', () => {
    const link = path.join(fixture.repo, 'loose-link');
    fs.symlinkSync('missing-target', link);
    fixture.stage('sentinel.txt', 'selected work');
    fixture.ok(['create', 'new-branch', '--onto', 'other', '-m', 'selected']);
    expect(fixture.git(['show', 'HEAD:sentinel.txt'])).to.equal(
      'selected work'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('?? loose-link');
    expect(fs.lstatSync(link).isSymbolicLink()).to.equal(true);
    expect(fs.readlinkSync(link)).to.equal('missing-target');
  });

  for (const staged of [false, true]) {
    it(`permits noninteractive patch with no selectable tracked changes and staged work ${staged}`, () => {
      if (staged) fixture.stage('sentinel.txt', 'prepared');
      fixture.write('loose.txt', 'untracked work');
      const parent = fixture.git(['rev-parse', 'other']);
      fixture.ok([
        'create',
        'new-branch',
        '--onto',
        'other',
        '--patch',
        '-m',
        'no hunk input',
      ]);
      expect(fixture.git(['branch', '--show-current'])).to.equal('new-branch');
      if (staged) {
        expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
        expect(fixture.git(['show', 'HEAD:sentinel.txt'])).to.equal('prepared');
      } else expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(parent);
      expect(fixture.git(['status', '--porcelain'])).to.equal('?? loose.txt');
      expect(
        fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
      ).to.equal('untracked work');
    });
  }

  it('refuses missing noninteractive all input before changing preparation', () => {
    fixture.write('main.txt', 'unfinished tracked work');
    fixture.write('loose.txt', 'untracked work');
    const before = fixture.snapshot();
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'other',
      '--all',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(/message.*non-interactive/i);
    expect(fixture.snapshot()).to.deep.equal(before);
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
        expect(result.stdout + result.stderr).to.include('an track');
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
    expect(result.stdout + result.stderr).to.include('an track');
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
