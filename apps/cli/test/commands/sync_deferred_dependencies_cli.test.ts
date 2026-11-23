import { expect } from 'chai';
import fs from 'fs-extra';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// eslint-disable-next-line max-lines-per-function
describe('sync CLI deferred reconciliation dependencies', function () {
  this.timeout(180000);
  let fixture: FrozenGetFixture;

  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 45000;
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
    const remoteMain = fixture.git(fixture.producer, 'rev-parse', 'main');
    fixture.git(
      fixture.producer,
      'rebase',
      '--onto',
      'main',
      fixture.oldParent,
      'child'
    );
    fixture.git(fixture.producer, 'push', '--force', 'origin', 'main', 'child');
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/parent');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
    });
    return remoteMain;
  }

  it('retains a newly projected dependency and its local descendant while syncing a separate stack', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'local correction');
    fixture.ok('checkout', 'main');
    fixture.ok('create', 'incoming');
    const incoming = fixture.commit(
      fixture.consumer,
      'incoming.txt',
      'work in incoming'
    );
    fixture.ok('create', 'local-descendant');
    const descendant = fixture.commit(
      fixture.consumer,
      'descendant.txt',
      'local descendant'
    );
    fixture.ok('checkout', 'main');
    fixture.ok('create', 'independent');
    fixture.commit(fixture.consumer, 'independent.txt', 'independent-old');
    const trunk = publishMergedParent();

    fixture.git(fixture.producer, 'switch', '-c', 'incoming', 'child');
    fixture.commit(fixture.producer, 'published.txt', 'published dependent');
    fixture.git(fixture.producer, 'switch', '-c', 'independent', 'main');
    const independent = fixture.commit(
      fixture.producer,
      'independent.txt',
      'independent-old'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'incoming', 'independent');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'main',
      incoming: 'child',
      independent: 'main',
    });
    // Align independent's existing local head with the old published commit,
    // then provide a genuine inbound fast-forward on the captured new base.
    fixture.git(fixture.consumer, 'fetch', 'origin', 'independent');
    fixture.git(fixture.consumer, 'reset', '--hard', independent);
    const newest = fixture.commit(
      fixture.producer,
      'extra.txt',
      'independent advance'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'independent');

    const result = fixture.ok('sync', '--delete-all');

    fixture.assertTip('main', trunk);
    fixture.assertTip('independent', newest);
    fixture.assertTip('incoming', incoming);
    fixture.assertTip('local-descendant', descendant);
    expect(result.output).to.match(
      /Deferred: [^\n]*incoming[^\n]*local-descendant/
    );
    for (const args of [['log'], ['log', 'short']]) {
      const sections = fixture
        .ok(...args)
        .output.split('Pending reconciliation');
      expect(sections).to.have.length(2);
      expect(sections[1])
        .to.include('incoming')
        .and.to.include('local-descendant');
      expect(sections[0])
        .to.include('independent')
        .and.not.to.include('local-descendant');
    }
    expect(
      fixture.run(['submit', '--branch', 'local-descendant', '--dry-run'])
        .output
    ).to.include('Skipping local-descendant: pending reconciliation');

    const silent = fixture.ok('sync', '--no-delete', '--quiet');
    expect(silent.output).to.include('Sync partially completed');

    // GitHub retargets only the projected dependency. Its locally tracked
    // parent was already main, so it and its own child can resume normally.
    fixture.git(fixture.consumer, 'push', '--force', 'origin', 'incoming');
    fixture.git(fixture.producer, 'fetch', 'origin', 'incoming');
    fixture.git(fixture.producer, 'switch', 'incoming');
    fixture.git(fixture.producer, 'reset', '--hard', 'FETCH_HEAD');
    const remoteAdvance = fixture.commit(
      fixture.producer,
      'published.txt',
      'independent now'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'incoming');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'main',
      incoming: 'main',
      independent: 'main',
    });
    const retargeted = fixture.ok('sync', '--no-delete', '--no-restack');
    fixture.assertTip('incoming', remoteAdvance);
    fixture.assertTip('local-descendant', descendant);
    expect(retargeted.output).not.to.match(/Deferred: [^\n]*incoming/);
    const active = fixture
      .ok('log', 'short')
      .output.split('Pending reconciliation');
    expect(active[0]).to.include('local-descendant');
    expect(active[1]).not.to.include('local-descendant');
  });
  it('defers cleanup that would reparent a retained former parent and removes independent eligible work', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'local correction');
    fixture.ok('checkout', 'main');
    fixture.ok('create', 'disposable');
    const disposable = fixture.commit(
      fixture.consumer,
      'disposable.txt',
      'closed work'
    );
    fixture.ok('checkout', 'main');
    fixture.git(fixture.consumer, 'push', 'origin', 'disposable');
    fixture.git(fixture.producer, 'fetch', 'origin', 'disposable');
    fixture.git(fixture.producer, 'branch', 'disposable', 'FETCH_HEAD');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      disposable: 'main',
    });
    fixture.ok('unfreeze', 'parent');
    fixture.ok('create', 'lower', '--insert', '--insert-child', 'parent');
    const lower = fixture.git(fixture.consumer, 'rev-parse', 'lower');
    fixture.ok('checkout', 'main');
    fixture.git(fixture.consumer, 'push', 'origin', 'lower');
    fixture.git(fixture.producer, 'fetch', 'origin', 'lower');
    fixture.git(fixture.producer, 'branch', 'lower', 'FETCH_HEAD');
    fs.writeJsonSync(fixture.prs, {
      parent: 'lower',
      child: 'parent',
      disposable: 'main',
      lower: 'main',
    });
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    const trunk = publishMergedParent();
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'main',
      disposable: 'main',
      lower: 'main',
    });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: {
        parent: { state: 'MERGED' },
        disposable: { state: 'CLOSED' },
        lower: { state: 'MERGED' },
      },
    });

    const result = fixture.ok('sync', '--delete-all', '--no-restack');

    fixture.assertTip('main', trunk);
    fixture.assertTip('lower', lower);
    fixture.assertTip('parent', fixture.oldParent);
    expect(fixture.ok('info', 'parent').output).to.include('lower');
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'disposable')
    ).to.equal('');
    expect(fixture.git(fixture.remote, 'rev-parse', 'disposable')).to.equal(
      disposable
    );
    expect(result.output).to.include('Deferring cleanup of lower');
    expect(result.output).to.include('Deleted branch disposable');
  });
});
