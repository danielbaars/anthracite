import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// eslint-disable-next-line max-lines-per-function
describe('sync CLI assembled late participant guards', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('preserves a foreign recovery actor written by the original pre-rebase hook before replay', () => {
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'own local bytes'
    );
    fixture.git(fixture.consumer, 'switch', 'main');
    const incoming = fixture.advanceBoth();
    const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/pre-rebase'),
      `#!/bin/sh\nprintf '%s' '${foreign}' > "$(git rev-parse --git-common-dir)/.gtcontinue"\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', incoming.child);
    fixture.assertTip('local-work', local);
    expect(
      fs.readFileSync(path.join(fixture.consumer, '.git/.gtcontinue'), 'utf8')
    ).to.equal(foreign);
    expect(result.output).to.include('foreign recovery');
  });

  it('keeps the trusted owner when activation removes its role before the managed hook starts', () => {
    const incoming = fixture.advanceBoth();
    const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = committed ] && printf '%s' "$updates" | grep -q refs/gt-metadata/FETCH_BASE; then\n printf '%s' '${foreign}' > "$(git rev-parse --git-common-dir)/.gtcontinue"\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fs.readFileSync(path.join(fixture.consumer, '.git/.gtcontinue'), 'utf8')
    ).to.equal(foreign);
    expect(fixture.git(fixture.remote, 'rev-parse', 'parent')).to.equal(
      incoming.parent
    );
    expect(result.output).to.include('foreign recovery');
  });

  it('refuses a missing owner removed by the original pre-rebase hook before replay', () => {
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'own local bytes'
    );
    fixture.git(fixture.consumer, 'switch', 'main');
    const incoming = fixture.advanceBoth();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/pre-rebase'),
      '#!/bin/sh\nrm "$(git rev-parse --git-common-dir)/.gtcontinue"\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', incoming.child);
    fixture.assertTip('local-work', local);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/.gtcontinue'))
    ).to.equal(false);
    expect(result.output).to.include('foreign recovery');
  });

  it('preserves a changed full owner envelope from an original continuation ref hook before the active head advances', () => {
    pauseMaintenance(fixture);
    const head = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    const record = path.join(fixture.consumer, '.git/.gtcontinue');
    const actor = fs.readFileSync(record, 'utf8') + '\n';
    const actorFile = path.join(fixture.consumer, '.git/actor-recovery');
    fs.writeFileSync(actorFile, actor);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      '#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && printf "%s" "$updates" | grep -q " HEAD"; then\n cp "$(git rev-parse --git-common-dir)/actor-recovery" "$(git rev-parse --git-common-dir)/.gtcontinue"\nfi\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved before actor'
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('local-work', head);
    expect(fs.readFileSync(record, 'utf8')).to.equal(actor);
    expect(result.output).to.include('foreign recovery');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/rebase-merge'))
    ).to.equal(true);
  });

  it('resumes the same bound conflict after a transient freeze clears without staging unrelated files', () => {
    pauseMaintenance(fixture);
    const local = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    fixture.git(fixture.consumer, 'branch', 'unrelated-alias', local);
    fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
    fixture.ok('freeze', 'local-work');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved after freeze'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'untracked.txt'),
      'untracked local bytes'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/info/exclude'),
      'ignored.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'ignored.txt'),
      'ignored local bytes'
    );
    const before = fixture.observe();
    const blocked = fixture.run(['continue', '--all']);
    expect(blocked.status, blocked.output).to.equal(1);
    expect(fixture.observe()).to.deep.equal(before);
    fixture.ok('unfreeze', 'local-work');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      '#!/bin/sh\nprintf "%s\\n" "$1" >> "$(git rev-parse --git-common-dir)/original-hook-ran"\n',
      { mode: 0o755 }
    );
    fixture.git(fixture.consumer, 'add', 'parent.txt');
    fixture.ok('cont');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved after freeze');
    fixture.assertTip('unrelated-alias', local);
    expect(
      fixture.git(fixture.consumer, 'config', 'rebase.updateRefs')
    ).to.equal('true');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(
      fixture.git(
        fixture.consumer,
        'ls-files',
        '--',
        'untracked.txt',
        'ignored.txt'
      )
    ).to.equal('');
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'untracked.txt'), 'utf8')
    ).to.equal('untracked local bytes');
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'ignored.txt'), 'utf8')
    ).to.equal('ignored local bytes');
    expect(
      fs.readFileSync(
        path.join(fixture.consumer, '.git/original-hook-ran'),
        'utf8'
      )
    ).to.include('prepared');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/.gtcontinue'))
    ).to.equal(false);
  });

  it('resumes after a late pending worktree blocker clears and preserves the other worktree files', () => {
    pauseMaintenance(fixture, true);
    const active = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    const pending = fixture.git(fixture.consumer, 'rev-parse', 'pending');
    const other = path.join(fixture.root, 'pending-worktree');
    const quoted = quote(other);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved before occupancy'
    );
    const hook = path.join(
      fixture.consumer,
      '.git/hooks/reference-transaction'
    );
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && [ ! -f .git/occupy-once ] && printf '%s' "$updates" | grep -q ' HEAD'; then\n touch .git/occupy-once\n git -c core.hooksPath=/dev/null worktree add ${quoted} pending\n printf '%s' 'other pending bytes' > ${quoted}/pending.txt\nfi\n`,
      { mode: 0o755 }
    );
    const blocked = fixture.run(['continue', '--all']);
    expect(blocked.status, blocked.output).to.equal(1);
    fixture.assertTip('local-work', active);
    fixture.assertTip('pending', pending);
    expect(blocked.output).to.include(other);
    expect(fs.readFileSync(path.join(other, 'pending.txt'), 'utf8')).to.equal(
      'other pending bytes'
    );
    fs.removeSync(hook);
    fixture.git(other, 'switch', '--detach');
    fixture.ok('continue');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved before occupancy');
    expect(
      fixture.git(fixture.consumer, 'show', 'pending:pending.txt')
    ).to.equal('pending own bytes');
    expect(fs.readFileSync(path.join(other, 'pending.txt'), 'utf8')).to.equal(
      'other pending bytes'
    );
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
  });

  for (const change of ['head', 'parent', 'freeze', 'source'])
    it(`preserves a late pending ${change} actor from the original continuation hook before active publication`, () => {
      pauseMaintenance(fixture, true);
      const active = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
      const pending = fixture.git(fixture.consumer, 'rev-parse', 'pending');
      const source = fixture
        .git(
          fixture.consumer,
          'for-each-ref',
          '--format=%(refname)',
          'refs/gt-metadata/get'
        )
        .split('\n')[0];
      const ref =
        change === 'source'
          ? source
          : change === 'head'
          ? 'refs/heads/pending'
          : 'refs/branch-metadata/pending';
      const actor =
        change === 'head' || change === 'source'
          ? fixture.oldParent
          : metadataActor(
              fixture,
              'pending',
              change === 'freeze'
                ? { frozen: true }
                : { parentBranchName: 'main' }
            );
      fs.writeFileSync(
        path.join(fixture.consumer, 'parent.txt'),
        'resolved before pending actor'
      );
      fs.writeFileSync(
        path.join(fixture.consumer, '.git/hooks/reference-transaction'),
        `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && [ ! -f .git/actor-once ] && printf '%s' "$updates" | grep -q ' HEAD'; then\n touch .git/actor-once\n git -c core.hooksPath=/dev/null update-ref ${quote(
          ref
        )} ${actor}\nfi\n`,
        { mode: 0o755 }
      );
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      fixture.assertTip('local-work', active);
      fixture.assertTip('pending', change === 'head' ? actor : pending);
      expect(fixture.git(fixture.consumer, 'rev-parse', ref)).to.equal(actor);
      expect(
        fs.existsSync(path.join(fixture.consumer, '.git/rebase-merge'))
      ).to.equal(true);
      expect(
        fs.existsSync(path.join(fixture.consumer, '.git/actor-once'))
      ).to.equal(true);
      expect(result.output).to.include(
        change === 'source' ? 'Pinned sync source' : 'pending'
      );
    });

  it('preserves a selected head changed by an incoming hook after earlier refresh progress', () => {
    const incoming = fixture.advanceBoth();
    const actor = fixture.git(
      fixture.consumer,
      'commit-tree',
      fixture.git(fixture.consumer, 'rev-parse', 'child^{tree}'),
      '-p',
      fixture.oldChild,
      '-m',
      'actor child commit'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-merge'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git update-ref refs/heads/child ${actor}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', actor);
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%s', 'child')
    ).to.equal('actor child commit');
    expect(result.output)
      .to.include('Completed feature refresh: parent')
      .and.to.include('Pending feature refresh: child');
  });

  it('preserves selected PR metadata changed by an incoming hook before applying that participant', () => {
    const actor = metadataActor(fixture, 'child', {
      prInfo: {
        number: 2,
        url: 'https://github.com/get-fixture/repo/pull/2',
        title: 'actor title',
        state: 'OPEN',
        base: 'parent',
      },
    });
    const incoming = fixture.advanceBoth();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-merge'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git update-ref refs/branch-metadata/child ${actor}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(actor);
    expect(result.output)
      .to.include('Completed feature refresh: parent')
      .and.to.include('Pending feature refresh: child');
  });

  it('does not apply an injected shared source changed by its activation hook', () => {
    const incoming = fixture.advanceBoth();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = committed ] && [ ! -f .git/source-once ] && printf '%s' "$updates" | grep -q refs/gt-metadata/FETCH_BASE; then\n touch .git/source-once\n git -c core.hooksPath=/dev/null update-ref refs/gt-metadata/FETCH_HEAD ${fixture.oldChild}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(fixture.remote, 'rev-parse', 'parent')).to.equal(
      incoming.parent
    );
    expect(result.output).to.include(
      'Activated remote source for parent changed'
    );
  });

  it('preserves a checkout hook redirection without advancing its unrelated physical branch', () => {
    fixture.git(fixture.consumer, 'branch', 'actor', fixture.oldParent);
    fixture.advanceBoth();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git switch actor; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-delete',
      '--no-restack',
      '--quiet',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('actor', fixture.oldParent);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'actor'
    );
    expect(result.output).to.include('Physical checkout changed');
  });

  it('refuses fresh unfreezing of a saved maintenance anchor without expanding replay authority', () => {
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'own local bytes'
    );
    fixture.git(fixture.consumer, 'switch', 'main');
    const actor = metadataActor(fixture, 'child', { frozen: false });
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-next.txt',
      'incoming parent'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-merge'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git update-ref refs/branch-metadata/child ${actor}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('local-work', local);
    fixture.status('child', false);
    expect(result.output).to.include(
      'planned as a frozen anchor and became editable'
    );
  });

  it('leaves harmless unrelated occupancy outside the sync writes and completion selection', () => {
    fixture.git(fixture.consumer, 'branch', 'unrelated', 'main');
    const other = path.join(fixture.root, 'unrelated-worktree');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'unrelated');
    fs.writeFileSync(path.join(other, 'main.txt'), 'other staged bytes');
    fixture.git(other, 'add', 'main.txt');
    const head = fixture.git(other, 'rev-parse', 'HEAD');
    const status = fixture.git(other, 'status', '--porcelain');
    const indexFile = path.resolve(
      other,
      fixture.git(other, 'rev-parse', '--git-path', 'index')
    );
    const index = fs.readFileSync(indexFile).toString('base64');
    const incoming = fixture.advanceBoth();
    fixture.ok('sync', '--no-delete', '--no-restack');
    fixture.assertTip('parent', incoming.parent);
    fixture.assertTip('child', incoming.child);
    expect(fixture.git(other, 'rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.git(other, 'status', '--porcelain')).to.equal(status);
    expect(fs.readFileSync(indexFile).toString('base64')).to.equal(index);
    expect(fixture.git(other, 'branch', '--show-current')).to.equal(
      'unrelated'
    );
    expect(fixture.git(other, 'diff', '--cached', '--name-only')).to.equal(
      'main.txt'
    );
    expect(fs.readFileSync(path.join(other, 'main.txt'), 'utf8')).to.equal(
      'other staged bytes'
    );
  });
});

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function metadataActor(
  fixture: FrozenGetFixture,
  branch: string,
  changes: object
): string {
  const value: unknown = JSON.parse(
    fixture.git(fixture.consumer, 'show', `refs/branch-metadata/${branch}`)
  );
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected fixture metadata');
  const file = path.join(fixture.consumer, '.git/actor-metadata.json');
  fs.writeJsonSync(file, { ...value, ...changes });
  return fixture.git(fixture.consumer, 'hash-object', '-w', file);
}

function pauseMaintenance(fixture: FrozenGetFixture, pending = false): void {
  fixture.ok('unfreeze', 'child');
  fixture.ok('create', 'local-work');
  fixture.commit(fixture.consumer, 'parent.txt', 'local conflict');
  if (pending) {
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.ok('create', 'pending');
    fixture.commit(fixture.consumer, 'pending.txt', 'pending own bytes');
  }
  fixture.git(fixture.consumer, 'switch', 'main');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'parent.txt', 'incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  const start = fixture.run(['sync', '--no-delete']);
  expect(start.status, start.output).to.equal(1);
  expect(start.output).to.include('Hit conflict restacking local-work');
}
