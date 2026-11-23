import { expect } from 'chai';
import fs from 'fs-extra';
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

    expect(result.output).to.include('conflicts in child.txt');
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
