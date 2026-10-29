import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('single-commit absorb application through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    fixture.git(['switch', 'tip']);
  });
  afterEach(() => fixture.cleanup());
  function stage(file: string, text: string): void {
    fs.writeFileSync(path.join(fixture.repo, file), text);
    fixture.git(['add', '--', file]);
  }
  it('corrects the original ancestor and replays descendants while returning staged and unstaged work', () => {
    const trunk = fixture.git(['rev-parse', 'main']);
    const metadata = fixture.git([
      'cat-file',
      '-p',
      'refs/branch-metadata/base',
    ]);
    stage('base.txt', 'corrected base\n');
    stage('leftover.txt', 'staged addition\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'corrected base\nunstaged sentinel\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.txt'),
      'untracked sentinel\n'
    );
    const prospective = fixture.git(['write-tree']);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('child');
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'main'])).to.equal(trunk);
    expect(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/base'])
    ).to.equal(metadata);
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('corrected base\nunstaged sentinel\n');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
    ).to.equal('untracked sentinel\n');
  });
  it('preserves interior authors, exact full messages and own order despite inherited author overrides', () => {
    fixture.git(['switch', 'base']);
    stage('first.txt', 'first original\n');
    fixture.git([
      '-c',
      'user.name=First Author',
      '-c',
      'user.email=first@example.test',
      'commit',
      '--date=2020-01-02T03:04:05+02:00',
      '-m',
      'First subject\n\nFirst body.\n\nReviewed-by: Human <human@example.test>',
    ]);
    const first = fixture.git(['rev-parse', 'HEAD']);
    const firstIdentity = fixture.git([
      'show',
      '-s',
      '--format=%an%n%ae%n%aI%n%B',
      first,
    ]);
    stage('second.txt', 'second original\n');
    fixture.git([
      '-c',
      'user.name=Second Author',
      '-c',
      'user.email=second@example.test',
      'commit',
      '--date=2021-06-07T08:09:10-03:00',
      '-m',
      'Second subject\n\nSecond body.',
    ]);
    const secondIdentity = fixture.git([
      'show',
      '-s',
      '--format=%an%n%ae%n%aI%n%B',
      'HEAD',
    ]);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('first.txt', 'first corrected\n');
    fixture.env.GIT_AUTHOR_NAME = 'Unrelated inherited author';
    fixture.env.GIT_AUTHOR_EMAIL = 'inherited@example.test';
    fixture.env.GIT_AUTHOR_DATE = '2026-01-01T00:00:00Z';
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base^:first.txt'])).to.equal(
      'first corrected'
    );
    expect(
      fixture.git(['show', '-s', '--format=%an%n%ae%n%aI%n%B', 'base^'])
    ).to.equal(firstIdentity);
    expect(
      fixture.git(['show', '-s', '--format=%an%n%ae%n%aI%n%B', 'base'])
    ).to.equal(secondIdentity);
    expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('3');
    expect(fixture.git(['show', 'tip:second.txt'])).to.equal('second original');
  });

  it('refuses redirected indexes before planning or writing any source state', () => {
    stage('base.txt', 'corrected base\n');
    const external = path.join(fixture.root, 'external-index');
    fs.copyFileSync(path.join(fixture.repo, '.git', 'index'), external);
    const original = fs.readFileSync(external);
    const before = fixture.inspectionSnapshot();
    fixture.env.GIT_INDEX_FILE = external;
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    delete fixture.env.GIT_INDEX_FILE;
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('Git environment redirection');
    expect(fs.readFileSync(external)).to.deep.equal(original);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses working-tree conversions before constructing commits or cleaning input', () => {
    fixture.git(['config', 'core.autocrlf', 'true']);
    stage('base.txt', 'corrected base\r\n');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('working-tree conversions');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('preserves hook changes to the source instead of overwriting them during checkout cleanup', () => {
    stage('base.txt', 'corrected base\n');
    const refs = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
    ]);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nprintf "hook changed source\\n" > ' +
        JSON.stringify(path.join(fixture.repo, 'base.txt')) +
        '\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('source work changed');
    expect(
      fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
    ).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('hook changed source\n');
    expect(fixture.git(['show', ':base.txt'])).to.equal('corrected base');
  });

  it('keeps local input durable after replay hook failure, legacy cleanup and Git pruning, then executes manual restoration', () => {
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'user stash content\n'
    );
    fixture.git(['stash', 'push', '-m', 'original user stash']);
    const stash = fixture.git(['rev-parse', 'refs/stash']);
    stage('base.txt', 'corrected base\n');
    stage('leftover.txt', 'staged durable content\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'corrected base\nunstaged sentinel\n'
    );
    const prospective = fixture.git(['write-tree']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-rebase');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nprintf "hook output\\n" > hook-created.txt\nprintf "foreign lock\\n" > ' +
        JSON.stringify(path.join(fixture.repo, '.git', 'foreign.lock')) +
        '\nexit 1\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('Completed: base.')
      .and.include('Pending: child, tip.')
      .and.include('No automatic continuation is available for this Git state.');
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
    const match = /running: (?:BUN_BE_BUN=1 )?'([^'\n]+)' '([^'\n]+)'/.exec(
      result.stderr
    );
    if (!match) throw new Error('No executable recovery path printed');
    const restore: unknown = match[2];
    if (typeof restore !== 'string') throw new Error('Invalid recovery path');
    fixture.run(['continue', '--no-interactive']);
    expect(fs.existsSync(restore)).to.equal(true);
    fixture.git(['reflog', 'expire', '--expire=now', '--all']);
    fixture.git(['gc', '--prune=now']);
    const recovery = spawnSync(match[1], [restore], {
      cwd: fixture.repo,
      env: {
        ...fixture.env,
        ...(result.stderr.includes('running: BUN_BE_BUN=1 ')
          ? { BUN_BE_BUN: '1' }
          : {}),
      },
      encoding: 'utf8',
    });
    expect(recovery.status, recovery.stdout + recovery.stderr).to.equal(0);
    expect(fixture.git(['show', ':leftover.txt'])).to.equal(
      'staged durable content'
    );
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('corrected base\nunstaged sentinel\n');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-created.txt'), 'utf8')
    ).to.equal('hook output\n');
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'foreign.lock'), 'utf8')
    ).to.equal('foreign lock\n');
    expect(fixture.git(['rev-parse', 'refs/stash'])).to.equal(stash);
  });

  it('keeps a genuine mandatory descendant conflict separate from retained work, and preserves earlier amendments after raw Git abort', () => {
    stage('base.txt', 'tip override\n');
    fixture.git(['commit', '-m', 'Override inherited base on descendant']);
    const oldTip = fixture.git(['rev-parse', 'tip']);
    fixture.git(['switch', 'child']);
    stage('base.txt', 'corrected base\n');
    stage('leftover.txt', 'staged conflict leftover\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'child.txt'),
      'child unstaged sentinel\n'
    );
    const prospective = fixture.git(['write-tree']);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('Content conflict')
      .and.include('Completed: base, child.')
      .and.include('Pending: tip.');
    expect(fixture.git(['ls-files', '--unmerged'])).to.include('base.txt');
    expect(fixture.git(['diff', '--cached', '--name-only'])).not.to.include(
      'leftover.txt'
    );
    expect(fs.existsSync(path.join(fixture.repo, 'leftover.txt'))).to.equal(
      false
    );
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    const match = /running: (?:BUN_BE_BUN=1 )?'([^'\n]+)' '([^'\n]+)'/.exec(
      result.stderr
    );
    if (!match) throw new Error('No recovery command printed');
    fixture.git(['rebase', '--abort']);
    fixture.git(['switch', 'child']);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(oldTip);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    const recovery = spawnSync(match[1], [match[2]], {
      cwd: fixture.repo,
      env: {
        ...fixture.env,
        ...(result.stderr.includes('running: BUN_BE_BUN=1 ')
          ? { BUN_BE_BUN: '1' }
          : {}),
      },
      encoding: 'utf8',
    });
    expect(recovery.status, recovery.stdout + recovery.stderr).to.equal(0);
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('child unstaged sentinel\n');
  });

  it('refuses manual restoration over newer same-path staging or a newer clean source commit', () => {
    stage('base.txt', 'corrected base\n');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-rebase'),
      '#!/bin/sh\nexit 1\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    const match = /running: (?:BUN_BE_BUN=1 )?'([^'\n]+)' '([^'\n]+)'/.exec(
      result.stderr
    );
    if (!match) throw new Error('No recovery command printed');
    const recover = () =>
      spawnSync(match[1], [match[2]], {
        cwd: fixture.repo,
        env: {
          ...fixture.env,
          ...(result.stderr.includes('running: BUN_BE_BUN=1 ')
            ? { BUN_BE_BUN: '1' }
            : {}),
        },
        encoding: 'utf8',
      });
    stage('tip.txt', 'newer staged work\n');
    let before = fixture.inspectionSnapshot();
    const staged = recover();
    expect(staged.status, staged.stderr).to.equal(1);
    expect(staged.stderr).to.include('New staged work');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['commit', '-m', 'New deliberate source commit']);
    before = fixture.inspectionSnapshot();
    const committed = recover();
    expect(committed.status, committed.stderr).to.equal(1);
    expect(committed.stderr).to.include('Source HEAD changed');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('stops when a replay hook changes an already-adopted ancestor and preserves that external ref', () => {
    const original = fixture.git(['rev-parse', 'base']);
    stage('base.txt', 'corrected base\n');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-rebase');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\ngit update-ref refs/heads/base ' +
        original +
        '\nprintf "hook sentinel\\n" > hook-created.txt\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('expected ref changed: refs/heads/base')
      .and.include('Completed: base.');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(original);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-created.txt'), 'utf8')
    ).to.equal('hook sentinel\n');
    expect(result.stderr).to.include('Retained input and construction:');
  });

  it('applies a current-commit correction with a minimal PATH and retains staged non-UTF8 bytes and ignored files', () => {
    const binary = Buffer.from([255, 254, 0, 128, 1]);
    fs.writeFileSync(path.join(fixture.repo, 'binary.bin'), binary);
    fixture.git(['add', 'binary.bin']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'ignored-sentinel\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored-sentinel'),
      'ignored bytes\n'
    );
    stage('tip.txt', 'corrected tip\n');
    const prospective = fixture.git(['write-tree']);
    fixture.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('corrected tip');
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'binary.bin'))
    ).to.deep.equal(binary);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'ignored-sentinel'), 'utf8')
    ).to.equal('ignored bytes\n');
  });

  it('applies a root-relative correction from a nested directory with a literal Unicode path', () => {
    fixture.git(['switch', 'base']);
    stage('space [literal] Ω.txt', 'original text\n');
    fixture.git(['commit', '-m', 'Introduce literal text path']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('space [literal] Ω.txt', 'corrected text\n');
    fs.mkdirSync(path.join(fixture.repo, 'nested'));
    const result = fixture.run(
      ['absorb', '--force', '--no-interactive'],
      path.join(fixture.repo, 'nested')
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:space [literal] Ω.txt'])).to.equal(
      'corrected text'
    );
    expect(fixture.git(['show', 'tip:space [literal] Ω.txt'])).to.equal(
      'corrected text'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
  });

  it('refuses frozen or occupied mandatory participants before input or refs change', () => {
    fixture.git(['switch', 'base']);
    stage('base.txt', 'corrected base\n');
    const meta: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/tip'])
    );
    if (!meta || typeof meta !== 'object' || Array.isArray(meta))
      throw new Error('Invalid fixture metadata');
    const frozen = path.join(fixture.root, 'frozen-tip.json');
    fs.writeFileSync(frozen, JSON.stringify({ ...meta, frozen: true }));
    fixture.git([
      'update-ref',
      'refs/branch-metadata/tip',
      fixture.git(['hash-object', '-w', frozen]),
    ]);
    let before = fixture.inspectionSnapshot();
    let result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.ok(['unfreeze', 'tip']);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'tip']);
    fs.writeFileSync(path.join(linked, 'tip.txt'), 'occupied work\n');
    before = fixture.inspectionSnapshot();
    const outside = fixture.inspectionSnapshot(linked);
    result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('checked out in worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(outside);
  });

  it('refuses an opaque existing cache lock without deleting it or changing input', () => {
    stage('base.txt', 'corrected base\n');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_lock'),
      'foreign opaque lock bytes'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('lock');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('retains original input on a real commit hook failure and honors no-verify without deleting the failed construction', () => {
    stage('base.txt', 'corrected base\n');
    const original = fixture.git(['rev-parse', 'base']);
    const locationFile = path.join(fixture.root, 'failed-construction');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\npwd > ' +
        JSON.stringify(locationFile) +
        '\nprintf "hook-owned bytes\\n" > hook-created.txt\nprintf "foreign lock\\n" > "$(git rev-parse --git-path foreign.lock)"\nexit 1\n',
      { mode: 0o755 }
    );
    const failed = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
    expect(failed.stderr)
      .to.include('Completed: none.')
      .and.include('Retained input and construction:');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(original);
    expect(fixture.git(['show', ':base.txt'])).to.equal('corrected base');
    const construction = fs.readFileSync(locationFile, 'utf8').trim();
    expect(
      fs.readFileSync(path.join(construction, 'hook-created.txt'), 'utf8')
    ).to.equal('hook-owned bytes\n');
    const lock = fixture.git(
      ['rev-parse', '--path-format=absolute', '--git-path', 'foreign.lock'],
      construction
    );
    expect(fs.readFileSync(lock, 'utf8')).to.equal('foreign lock\n');
    const succeeded = fixture.run([
      'absorb',
      '--force',
      '--no-verify',
      '--no-interactive',
    ]);
    expect(succeeded.status, succeeded.stdout + succeeded.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(
      fs.readFileSync(path.join(construction, 'hook-created.txt'), 'utf8')
    ).to.equal('hook-owned bytes\n');
    expect(fs.readFileSync(lock, 'utf8')).to.equal('foreign lock\n');
  });

  it('applies from a linked source worktree while preserving the primary checkout and both local-work layers', () => {
    fixture.git(['switch', 'main']);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'primary work stays here\n'
    );
    const linked = path.join(fixture.root, 'linked-source');
    fixture.git(['worktree', 'add', linked, 'tip']);
    fs.writeFileSync(path.join(linked, 'base.txt'), 'linked correction\n');
    fs.writeFileSync(path.join(linked, 'new.txt'), 'linked staged addition\n');
    fixture.git(['add', 'base.txt', 'new.txt'], linked);
    const prospective = fixture.git(['write-tree'], linked);
    fs.writeFileSync(
      path.join(linked, 'base.txt'),
      'linked correction\nlinked unstaged sentinel\n'
    );
    const primary = fixture.inspectionSnapshot();
    const result = fixture.run(
      ['absorb', '--force', '--no-interactive'],
      linked
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal(
      'linked correction'
    );
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal('tip');
    expect(fixture.git(['write-tree'], linked)).to.equal(prospective);
    expect(fs.readFileSync(path.join(linked, 'base.txt'), 'utf8')).to.equal(
      'linked correction\nlinked unstaged sentinel\n'
    );
    const after = fixture.inspectionSnapshot();
    expect(after.index).to.equal(primary.index);
    expect(after.head).to.equal(primary.head);
    expect(after.branch).to.equal(primary.branch);
    expect(after.files).to.deep.equal(primary.files);
  });
});
