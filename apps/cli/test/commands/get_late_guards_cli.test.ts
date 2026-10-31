import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

function parentMetadata(
  fixture: FrozenGetFixture,
  branch: string,
  parent: string
): string {
  const metadata: unknown = JSON.parse(
    fixture.git(fixture.consumer, 'show', `refs/branch-metadata/${branch}`)
  );
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  )
    throw new Error('Expected fixture metadata');
  const file = path.join(fixture.consumer, '.git', 'hook-parent.json');
  fs.writeJsonSync(file, {
    ...metadata,
    parentBranchName: parent,
    parentBranchRevision: fixture.git(fixture.consumer, 'rev-parse', parent),
  });
  return fixture.git(fixture.consumer, 'hash-object', '-w', file);
}

function startPausedGet(fixture: FrozenGetFixture, pending = false): void {
  fixture.ok('unfreeze', 'child');
  fixture.ok('create', 'local-work');
  fixture.commit(fixture.consumer, 'parent.txt', 'local conflict');
  if (pending) {
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.ok('create', 'z-pending');
    fixture.commit(fixture.consumer, 'pending.txt', 'pending local work');
  }
  fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'parent.txt', 'incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  const result = fixture.run(['get', 'parent', '--no-checkout']);
  expect(result.status, result.output).to.equal(1);
  expect(result.output).to.include('Hit conflict');
}

describe('get CLI late participant guards', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('preserves an unrelated ref when a feature checkout hook redirects physical HEAD', () => {
    fixture.git(fixture.consumer, 'branch', 'decoy', fixture.oldParent);
    fixture.git(fixture.producer, 'switch', 'parent');
    const incoming = fixture.commit(
      fixture.producer,
      'parent-next.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = parent ] && [ ! -f .git/redirect-once ]; then\n touch .git/redirect-once\n git switch decoy\nfi\n',
      { mode: 0o755 }
    );
    const result = fixture.run([
      'get',
      'parent',
      '--downstack',
      '--no-restack',
      '--quiet',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('decoy', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'decoy'
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(fixture.git(fixture.remote, 'rev-parse', 'parent')).to.equal(
      incoming
    );
    expect(result.output).to.include('Pending feature refresh: parent');
  });
  it('preserves a hook-written parent after an authorized force head update and reports incomplete publication', () => {
    const hookOid = parentMetadata(fixture, 'child', 'main');
    const incoming = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = child ] && [ ! -f .git/parent-once ]; then\n touch .git/parent-once\n git update-ref refs/branch-metadata/child ${hookOid}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'get',
      'child',
      '--force',
      '--downstack',
      '--no-restack',
      '--quiet',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', incoming);
    fixture.assertTip('parent', fixture.oldParent);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(hookOid);
    expect(result.output).to.include('Pending feature refresh: child');
    expect(result.output).to.include(
      'Reached changes requiring inspection: child'
    );
    expect(result.output).not.to.include('Synced child');
  });
  it('refuses a shared fetch source changed during activation without applying the injected object', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    const incoming = fixture.commit(
      fixture.producer,
      'parent-next.txt',
      'planned parent content'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = committed ] && printf "%s" "$updates" | grep -q refs/gt-metadata/FETCH_BASE && [ ! -f .git/activation-once ]; then\n touch .git/activation-once\n git -c core.hooksPath=/dev/null update-ref refs/gt-metadata/FETCH_HEAD ${fixture.oldChild}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'get',
      'parent',
      '--downstack',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(fixture.remote, 'rev-parse', 'parent')).to.equal(
      incoming
    );
    expect(result.output).to.include('Pending feature refresh: parent');
  });

  it('keeps planned frozen-anchor authority when an incoming hook unfreezes it beside ignored work', () => {
    fixture.git(fixture.consumer, 'switch', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/info/exclude'),
      'child.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'ignored local child bytes'
    );
    const metadata: unknown = JSON.parse(
      fixture.git(fixture.consumer, 'show', 'refs/branch-metadata/child')
    );
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata)
    )
      throw new Error('Expected fixture metadata');
    const file = path.join(fixture.consumer, '.git/hook-unfreeze.json');
    fs.writeJsonSync(file, { ...metadata, frozen: false });
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-next.txt',
      'incoming parent'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git update-ref refs/branch-metadata/child ${oid}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'parent', '--downstack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
    ).to.equal('ignored local child bytes');
    expect(result.output).not.to.include('Restacked child');
  });

  it('refuses a disappeared original checkout before continue --all stages or advances', () => {
    startPausedGet(fixture);
    fixture.git(fixture.consumer, 'update-ref', '-d', 'refs/heads/inspection');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved parent'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'unrelated.txt'),
      'do not stage'
    );
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(fixture.observe()).to.deep.equal(before);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'inspection')
    ).to.equal('');
  });
  it('rechecks pending topology after an original continue commit hook before advancing the active ref', () => {
    startPausedGet(fixture, true);
    const activeHead = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    const pendingHead = fixture.git(fixture.consumer, 'rev-parse', 'z-pending');
    const oid = parentMetadata(fixture, 'z-pending', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved parent'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && [ ! -f .git/pending-parent-once ] && printf "%s" "$updates" | grep -q ' HEAD'; then\n touch .git/pending-parent-once\n git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/z-pending ${oid}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'local-work'),
      result.output
    ).to.equal(activeHead);
    fixture.assertTip('z-pending', pendingHead);
    expect(
      fixture.git(
        fixture.consumer,
        'rev-parse',
        'refs/branch-metadata/z-pending'
      )
    ).to.equal(oid);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/rebase-merge'))
    ).to.equal(true);
    expect(
      fixture.git(fixture.consumer, 'diff', '--cached', '--name-only')
    ).to.include('parent.txt');
  });
  it('preserves active topology changed by a post-rewrite hook after completed continuation replay', () => {
    startPausedGet(fixture);
    const original = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    const oid = parentMetadata(fixture, 'local-work', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved parent'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-rewrite'),
      `#!/bin/sh\ngit update-ref refs/branch-metadata/local-work ${oid}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(
        fixture.consumer,
        'rev-parse',
        'refs/branch-metadata/local-work'
      )
    ).to.equal(oid);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'local-work')
    ).not.to.equal(original);
    expect(result.output).to.include('Pending local maintenance: local-work');
  });
  it('stops a force import whose checkout hook redirects physical HEAD before metadata publication', () => {
    const metadata = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/child'
    );
    fixture.git(fixture.consumer, 'branch', 'decoy', fixture.oldParent);
    const incoming = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = child ]; then git switch decoy; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child', '--force', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', incoming);
    fixture.assertTip('decoy', fixture.oldParent);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(metadata);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'decoy'
    );
    expect(result.output).to.include('Pending feature refresh: child');
  });

  it('preserves a parent changed by a post-merge hook after the planned feature fast-forward', () => {
    const oid = parentMetadata(fixture, 'child', 'main');
    const incoming = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-merge'),
      `#!/bin/sh\ngit update-ref refs/branch-metadata/child ${oid}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', incoming);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(oid);
    expect(result.output).not.to.include('Synced child');
  });

  for (const force of [false, true]) {
    it(`retains a late concurrent selected head after earlier parent progress with force=${force}`, () => {
      const incoming = fixture.advanceBoth();
      const concurrent = fixture.git(
        fixture.consumer,
        'commit-tree',
        fixture.git(fixture.consumer, 'rev-parse', 'child^{tree}'),
        '-p',
        fixture.oldChild,
        '-m',
        'concurrent local child commit'
      );
      fs.writeFileSync(
        path.join(
          fixture.consumer,
          '.git/hooks',
          force ? 'post-checkout' : 'post-merge'
        ),
        `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ] && [ ! -f .git/ref-once ]; then\n touch .git/ref-once\n git update-ref refs/heads/child ${concurrent}\nfi\n`,
        { mode: 0o755 }
      );
      const result = fixture.run([
        'get',
        'child',
        '--no-restack',
        ...(force ? ['--force'] : []),
      ]);
      expect(result.status, result.output).to.equal(1);
      fixture.assertTip('parent', incoming.parent);
      fixture.assertTip('child', concurrent);
      expect(
        fixture.git(fixture.consumer, 'log', '-1', '--format=%s', 'child')
      ).to.equal('concurrent local child commit');
      expect(result.output).to.include('Completed feature refresh: parent');
      expect(result.output).to.include('Pending feature refresh: child');
    });
  }

  it('protects a maintenance worktree occupied by an incoming hook after remote progress', () => {
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local branch bytes'
    );
    const incoming = fixture.advanceBoth();
    const other = path.join(fixture.root, 'late-worktree');
    const quoted = "'" + other.replace(/'/g, "'\"'\"'") + "'";
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ] && [ ! -f .git/worktree-once ]; then\n touch .git/worktree-once\n git worktree add ${quoted} local-work\n printf '%s' 'other staged bytes' > ${quoted}/local.txt\n (unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX; git -C ${quoted} add local.txt)\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', incoming.child);
    fixture.assertTip('local-work', local);
    expect(fs.readFileSync(path.join(other, 'local.txt'), 'utf8')).to.equal(
      'other staged bytes'
    );
    expect(fixture.git(other, 'diff', '--cached', '--name-only')).to.equal(
      'local.txt'
    );
    expect(result.output).to.include(other);
    expect(result.output).to.include('Pending local maintenance: local-work');
  });

  it('rechecks a pending worktree occupied by an original continuation reference hook before ref advancement', () => {
    startPausedGet(fixture, true);
    const active = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    const pending = fixture.git(fixture.consumer, 'rev-parse', 'z-pending');
    const other = path.join(fixture.root, 'pending-worktree');
    const quoted = "'" + other.replace(/'/g, "'\"'\"'") + "'";
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved parent'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && [ ! -f .git/occupy-once ] && printf "%s" "$updates" | grep -q ' HEAD'; then\n touch .git/occupy-once\n git -c core.hooksPath=/dev/null worktree add ${quoted} z-pending\n printf '%s' 'other pending bytes' > ${quoted}/pending.txt\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'local-work'),
      result.output
    ).to.equal(active);
    fixture.assertTip('z-pending', pending);
    expect(fs.readFileSync(path.join(other, 'pending.txt'), 'utf8')).to.equal(
      'other pending bytes'
    );
    expect(result.output).to.include(other);
    expect(result.output).to.include(
      'Resolve the conflict and run an continue'
    );
    fs.removeSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction')
    );
    fixture.git(other, 'switch', '--detach');
    fixture.ok('continue');
    expect(fs.readFileSync(path.join(other, 'pending.txt'), 'utf8')).to.equal(
      'other pending bytes'
    );
  });

  it('preserves a maintenance parent changed by the original pre-rebase hook before replay', () => {
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'own local bytes'
    );
    const oid = parentMetadata(fixture, 'local-work', 'main');
    const incoming = fixture.advanceBoth();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/pre-rebase'),
      `#!/bin/sh\ngit update-ref refs/branch-metadata/local-work ${oid}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', incoming.child);
    fixture.assertTip('local-work', local);
    expect(
      fixture.git(
        fixture.consumer,
        'rev-parse',
        'refs/branch-metadata/local-work'
      )
    ).to.equal(oid);
  });
  it('preserves a concurrent active branch head introduced by an original continuation reference hook', () => {
    startPausedGet(fixture);
    const original = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    const concurrent = fixture.git(
      fixture.consumer,
      'commit-tree',
      fixture.git(fixture.consumer, 'rev-parse', 'local-work^{tree}'),
      '-p',
      original,
      '-m',
      'concurrent active local work'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved parent'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && [ ! -f .git/active-ref-once ] && printf "%s" "$updates" | grep -q ' HEAD'; then\n touch .git/active-ref-once\n git -c core.hooksPath=/dev/null update-ref refs/heads/local-work ${concurrent}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('local-work', concurrent);
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%s', 'local-work')
    ).to.equal('concurrent active local work');
    expect(result.output).to.include('local-work');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/.gtcontinue'))
    ).to.equal(true);
  });
});
