import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// eslint-disable-next-line max-lines-per-function
describe('sync CLI preserving merged-parent replay', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;

  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 45_000;
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'child');
  });
  afterEach(() => fixture?.cleanup());

  function publishMergedParent(): string {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'published parent revision');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.git(fixture.producer, 'cherry-pick', 'parent~1', 'parent');
    const trunk = fixture.git(fixture.producer, 'rev-parse', 'main');
    fixture.git(
      fixture.producer,
      'rebase',
      '--onto',
      'main',
      fixture.oldParent,
      'child'
    );
    fixture.git(fixture.producer, 'push', '--force', 'origin', 'main', 'child');
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
    });
    return trunk;
  }

  it('replays proven equivalent work onto trunk without asking to overwrite', () => {
    const prBase = publishMergedParent();
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'incoming.txt',
      'trunk continued'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: {
        parent: { state: 'MERGED' },
        child: { baseRefOid: prBase },
      },
    });
    fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
    fixture.git(
      fixture.consumer,
      'branch',
      'unmanaged-anchor',
      fixture.oldChild
    );
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.ok('sync', '--no-delete');

    expect(result.output).to.include('Reconciled child on main');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('unmanaged-anchor', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(trunk);
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-old'
    );
    expect(fixture.ok('log', 'short').output).not.to.include(
      'Pending reconciliation'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  it('reconciles after intentionally unfreezing a previously deferred survivor', () => {
    fixture.ok('freeze', 'child');
    const trunk = publishMergedParent();
    expect(fixture.ok('sync', '--no-delete').output).to.include('Deferred:');
    fixture.assertTip('child', fixture.oldChild);
    fixture.ok('unfreeze', 'child');
    const resumed = fixture.ok('sync', '--no-delete');
    expect(resumed.output).to.include('Reconciled child on main');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(trunk);
    expect(fixture.ok('log', 'short').output).not.to.include(
      'Pending reconciliation'
    );
  });

  it('keeps differing local work after explicit preserving choice', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'my unpublished change');
    const trunk = publishMergedParent();
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\n' },
    ]);

    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('Reconciled child on main');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(trunk);
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'my unpublished change'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  for (const trunkAlreadyCurrent of [false, true]) {
    it(`takes the published branch only after separate confirmation (trunk current: ${trunkAlreadyCurrent})`, () => {
      fixture.commit(fixture.consumer, 'local.txt', 'my unpublished change');
      const trunk = publishMergedParent();
      fixture.commit(
        fixture.producer,
        'published.txt',
        'published feature work'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'child');
      const remote = fixture.git(fixture.remote, 'show-ref');
      if (trunkAlreadyCurrent) {
        fixture.git(fixture.consumer, 'fetch', 'origin', 'main');
        fixture.git(fixture.consumer, 'branch', '-f', 'main', trunk);
      }

      const result = fixture.run(['sync', '--no-delete'], true, [
        { prompt: 'Reconcile child (PR #2)?', input: '\u001b[B\r' },
        {
          prompt: 'Replace local child with the verified GitHub version?',
          input: 'y\r',
        },
      ]);

      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include(
        'Reconciled child on main, using the verified GitHub version'
      );
      expect(result.output).to.include('my unpublished change');
      expect(
        fixture.git(fixture.consumer, 'show', 'child:published.txt')
      ).to.equal('published feature work');
      expect(
        fixture.git(fixture.consumer, 'ls-tree', 'child', 'local.txt')
      ).to.equal('');
      expect(
        fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
      ).to.equal(trunk);
      expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    });
  }

  for (const response of ['decline', 'no-terminal', 'changed-source']) {
    it(`preserves local work when published replacement is ${response}`, () => {
      const head = fixture.commit(
        fixture.consumer,
        'local.txt',
        'unpublished correction'
      );
      const trunk = publishMergedParent();
      fixture.commit(
        fixture.producer,
        'published.txt',
        'published feature work'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'child');
      const remote = fixture.git(fixture.remote, 'rev-parse', 'child');
      const result =
        response === 'no-terminal'
          ? fixture.run(['sync', '--force', '--no-delete'])
          : fixture.run(['sync', '--no-delete'], true, [
              { prompt: 'Reconcile child (PR #2)?', input: '\u001b[B\r' },
              {
                prompt: 'Replace local child with the verified GitHub version?',
                input: response === 'decline' ? 'n\r' : 'y\r',
                ...(response === 'changed-source'
                  ? {
                      beforeInput: [
                        'git',
                        '--git-dir',
                        fixture.remote,
                        'update-ref',
                        'refs/heads/child',
                        trunk,
                        remote,
                      ],
                    }
                  : {}),
              },
            ]);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include('Sync partially completed');
      if (response === 'changed-source')
        expect(result.output).to.include(
          'GitHub reconciliation evidence changed for child'
        );
      fixture.assertTip('main', trunk);
      fixture.assertTip('child', head);
      fixture.assertTip('parent', fixture.oldParent);
      expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(
        response === 'changed-source' ? trunk : remote
      );
    });
  }

  it('compares a newly published tip after deferral and requires fresh consent', () => {
    const local = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    const trunk = publishMergedParent();
    const first = fixture.ok('sync', '--no-delete');
    expect(first.output).to.include('Sync partially completed');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', local);

    const newer = fixture.commit(fixture.producer, 'published.txt', 'new work');
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    const remote = fixture.git(fixture.remote, 'show-ref');
    const repeat = fixture.ok('sync', '--force', '--no-delete', '--debug');
    expect(repeat.output).to.include('Sync partially completed');
    expect(repeat.stderr).to.include(`GitHub tip: ${newer.slice(0, 8)}`);
    fixture.assertTip('child', local);

    const accepted = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\u001b[B\r' },
      {
        prompt: 'Replace local child with the verified GitHub version?',
        input: 'y\r',
      },
    ]);
    expect(accepted.status, accepted.output).to.equal(0);
    expect(accepted.output).to.include('using the verified GitHub version');
    fixture.assertTip('child', newer);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(fixture.ok('log', 'short').output).not.to.include(
      'Pending reconciliation'
    );
  });

  it('continues an interrupted authorized replacement without replacing the branch twice', () => {
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'my local work'
    );
    publishMergedParent();
    const published = fixture.commit(
      fixture.producer,
      'published.txt',
      'published work'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'new-trunk.txt',
      'more trunk'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const hook = path.join(fixture.consumer, '.git/hooks/pre-rebase');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const remote = fixture.git(fixture.remote, 'show-ref');

    const stopped = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\u001b[B\r' },
      {
        prompt: 'Replace local child with the verified GitHub version?',
        input: 'y\r',
      },
    ]);
    expect(stopped.status, stopped.output).to.equal(1);
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', published);
    expect(
      fixture.git(fixture.consumer, 'rev-list', '--all').split('\n')
    ).to.include(local);
    fs.removeSync(hook);
    const resumed = fixture.ok('continue');
    expect(resumed.output).to.include('using the verified GitHub version');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(trunk);
    expect(
      fixture
        .git(fixture.consumer, 'log', '--format=%s', 'main..child')
        .split('\n')
    ).to.deep.equal(['published work', 'child-old']);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(fixture.ok('log', 'short').output).not.to.include(
      'Pending reconciliation'
    );
  });

  it('refuses an edited idle reconciliation choice and resumes the original local replay', () => {
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'my local work'
    );
    const trunk = publishMergedParent();
    const published = fixture.commit(
      fixture.producer,
      'published.txt',
      'remote work'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    const hook = path.join(fixture.consumer, '.git/hooks/pre-rebase');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const stopped = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\r' },
    ]);
    expect(stopped.status, stopped.output).to.equal(1);
    fixture.assertTip('child', local);
    fixture.assertTip('main', trunk);
    fs.removeSync(hook);

    const recovery = path.join(fixture.consumer, '.git', '.gtcontinue');
    const original = fs.readFileSync(recovery, 'utf8');
    const index = fixture.git(fixture.consumer, 'ls-files', '--stage');
    const remote = fixture.git(fixture.remote, 'show-ref');
    const edited = JSON.parse(original);
    edited.sync.refresh.reconciliation[0].replacement = { from: trunk };
    fs.writeJsonSync(recovery, edited);
    const retry = fixture.run(['continue', '--all']);
    expect(retry.status, retry.output).to.equal(1);
    expect(retry.output).to.include(
      'Saved reconciliation retry authorization changed'
    );
    fixture.assertTip('child', local);
    fixture.assertTip('main', trunk);
    expect(fixture.git(fixture.consumer, 'ls-files', '--stage')).to.equal(
      index
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);

    fs.writeFileSync(recovery, original);
    expect(fixture.ok('continue').output).to.include('keeping local commits');
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'my local work'
    );
    expect(fixture.git(fixture.consumer, 'rev-parse', 'child')).not.to.equal(
      published
    );
  });

  it('resumes a live reconciliation conflict only against the original verified source', () => {
    const local = fixture.commit(fixture.consumer, 'main.txt', 'local edit');
    publishMergedParent();
    const published = fixture.git(fixture.producer, 'rev-parse', 'child');
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(fixture.producer, 'main.txt', 'trunk edit');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/info/attributes'),
      'main.txt merge=union\n'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/pre-rebase'),
      '#!/bin/sh\nrm -f .git/info/attributes\n',
      { mode: 0o755 }
    );
    const stopped = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\r' },
    ]);
    expect(stopped.status, stopped.output).to.equal(1);
    expect(stopped.output).to.include(
      'Resolve the conflict and run an continue'
    );
    expect(
      fixture.git(fixture.consumer, 'diff', '--name-only', '--diff-filter=U')
    ).to.equal('main.txt');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', local);
    fs.writeFileSync(path.join(fixture.consumer, 'main.txt'), 'my resolution');
    const index = fixture.git(fixture.consumer, 'ls-files', '--stage');

    const sourcePin = `refs/gt-metadata/sync-reconciliation/commits/${published}`;
    fixture.git(fixture.consumer, 'update-ref', '-d', sourcePin, published);
    const missing = fixture.run(['continue', '--all']);
    expect(missing.status, missing.output).to.equal(1);
    expect(missing.output).to.include('pinned sync reconciliation source');
    expect(fixture.git(fixture.consumer, 'ls-files', '--stage')).to.equal(
      index
    );
    fixture.git(fixture.consumer, 'update-ref', sourcePin, published);

    fixture.git(fixture.producer, 'switch', 'child');
    fixture.commit(fixture.producer, 'incoming.txt', 'late published edit');
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    const stale = fixture.run(['continue', '--all']);
    expect(stale.status, stale.output).to.equal(1);
    expect(stale.output).to.include('GitHub reconciliation evidence changed');
    expect(fixture.git(fixture.consumer, 'ls-files', '--stage')).to.equal(
      index
    );
    fixture.assertTip('child', local);
    fixture.assertTip('main', trunk);
    expect(
      fixture.git(fixture.consumer, 'rev-list', '--all').split('\n')
    ).to.include(local);

    fixture.git(fixture.producer, 'reset', '--hard', published);
    fixture.git(fixture.producer, 'push', '--force', 'origin', 'child');
    const remote = fixture.git(fixture.remote, 'show-ref');
    const resumed = fixture.ok('continue', '--all');
    expect(resumed.output).to.include('Reconciled child on main');
    expect(fixture.git(fixture.consumer, 'show', 'child:main.txt')).to.equal(
      'my resolution'
    );
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(trunk);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  it('offers a clean published replay after a local conflict without making replacement the default', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'my local change');
    publishMergedParent();
    fixture.commit(fixture.producer, 'published.txt', 'published work');
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'local.txt',
      'different trunk text'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\u001b[A\r' },
      {
        prompt: 'Replace local child with the verified GitHub version?',
        input: 'y\r',
      },
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include(
      'Local replay would conflict in local.txt'
    );
    expect(result.output.indexOf('Local tip:')).to.be.within(
      0,
      result.output.indexOf('Reconcile child (PR #2)?') - 1
    );
    expect(result.output).to.include(
      'Sync will replay the GitHub commits onto main'
    );
    expect(result.output).to.include('Reconciled child on main');
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'different trunk text'
    );
    expect(
      fixture.git(fixture.consumer, 'show', 'child:published.txt')
    ).to.equal('published work');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(trunk);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  it('keeps an ignored file that the published replay would touch between commits', () => {
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unpublished local work'
    );
    const trunk = publishMergedParent();
    fixture.commit(
      fixture.producer,
      'scratch.tmp',
      'temporary published content'
    );
    fixture.git(fixture.producer, 'rm', 'scratch.tmp');
    fixture.git(
      fixture.producer,
      'commit',
      '-m',
      'Remove temporary published content'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    const ignore = `${fixture.consumer}/.git/info/exclude`;
    fs.appendFileSync(ignore, '\nscratch.tmp\n');
    fs.writeFileSync(
      `${fixture.consumer}/scratch.tmp`,
      'ignored work stays here'
    );
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'Reconcile child (PR #2)?', input: '\u001b[B\r' },
      {
        prompt: 'Replace local child with the verified GitHub version?',
        input: 'y\r',
      },
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include(
      'Cannot sync: restacking would overwrite ignored file scratch.tmp'
    );
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', local);
    expect(fs.readFileSync(`${fixture.consumer}/scratch.tmp`, 'utf8')).to.equal(
      'ignored work stays here'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  it('names a conflict found while revalidating a previously clean replay', () => {
    const local = fixture.commit(fixture.consumer, 'main.txt', 'local edit');
    publishMergedParent();
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(fixture.producer, 'main.txt', 'trunk edit');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const attributes = path.join(fixture.consumer, '.git/info/attributes');
    fs.writeFileSync(attributes, 'main.txt merge=union\n');
    const result = fixture.run(['sync', '--no-delete'], true, [
      {
        prompt: 'Reconcile child (PR #2)?',
        beforeInput: ['rm', attributes],
        input: '\r',
      },
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include(
      'could not be reverified. conflicts in main.txt'
    );
    expect(result.output).to.include('Sync partially completed');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', local);
    expect(
      fixture.git(fixture.consumer, 'diff', '--name-only', '--diff-filter=U')
    ).to.equal('');
  });

  it('names a proven conflict before deferring, while trunk advances', () => {
    publishMergedParent();
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'child.txt',
      'incoming conflicting change'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const head = fixture.git(fixture.consumer, 'rev-parse', 'child');
    const files = fixture.git(fixture.consumer, 'status', '--porcelain');
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.ok('sync', '--delete-all');

    expect(result.output).to.include(
      'Local and GitHub replays would conflict in child.txt'
    );
    expect(result.output.match(/conflict in child\.txt/g)).to.have.length(1);
    expect(result.output).not.to.include('Replace local child');
    expect(result.output).to.include('Later commits were not assessed');
    expect(result.output).to.include('Sync partially completed');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', head);
    fixture.assertTip('parent', fixture.oldParent);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal(
      files
    );
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });
});
