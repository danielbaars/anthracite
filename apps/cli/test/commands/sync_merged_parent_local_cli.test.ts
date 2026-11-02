import { expect } from 'chai';
import fs from 'fs-extra';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync CLI local commits after a parent PR merges', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;

  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'child');
  });
  afterEach(() => fixture?.cleanup());

  function mergeParent(): void {
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.git(fixture.producer, 'merge', '--squash', 'parent');
    fixture.git(fixture.producer, 'commit', '-m', 'Merge parent PR');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/parent');
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
    });
  }

  it('retains the local child correction while cleaning its merged and retargeted parent', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'unpublished correction');
    fixture.git(
      fixture.consumer,
      'commit',
      '--amend',
      '--author',
      'Local Contributor <local@example.test>',
      '-m',
      'Keep the local correction\n\nComplete local commit body.'
    );
    const tree = fixture.git(fixture.consumer, 'rev-parse', 'child^{tree}');
    mergeParent();
    const remote = fixture.git(
      fixture.remote,
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads'
    );

    const result = fixture.ok('sync', '--delete-all');

    expect(result.output).not.to.include('Overwrite child');
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'parent')
    ).to.equal('');
    expect(fixture.ok('info', 'child').output).to.include('Parent: main');
    expect(fixture.git(fixture.consumer, 'rev-parse', 'child^{tree}')).to.equal(
      tree
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'unpublished correction'
    );
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%an <%ae>%n%B')
    ).to.equal(
      'Local Contributor <local@example.test>\nKeep the local correction\n\nComplete local commit body.'
    );
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'main'));
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(
      fixture.git(
        fixture.remote,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads'
      )
    ).to.equal(remote);
  });

  it('retains the exact local head when cleanup and replay are disabled', () => {
    const head = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local correction'
    );
    mergeParent();

    fixture.ok('sync', '--no-delete', '--no-restack');

    fixture.assertTip('child', head);
    fixture.assertTip('parent', fixture.oldParent);
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'local correction'
    );
  });

  it('keeps local commits while deferring replay after authorized cleanup', () => {
    const head = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local correction'
    );
    mergeParent();

    const result = fixture.ok('sync', '--delete-all', '--no-restack');

    fixture.assertTip('child', head);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'parent')
    ).to.equal('');
    expect(fixture.ok('info', 'child').output).to.include('Parent: main');
    expect(result.output).to.include('Pending restack: child');
  });

  it('maintains a published descendant above the preserved local correction', () => {
    fixture.commandTimeoutMs = 45000;
    fixture.git(fixture.producer, 'switch', '-c', 'tip', 'child');
    fixture.commit(fixture.producer, 'tip.txt', 'published descendant');
    fixture.git(fixture.producer, 'push', 'origin', 'tip');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      tip: 'child',
    });
    fixture.ok('get', 'tip');
    fixture.ok('unfreeze', 'tip');
    fixture.ok('checkout', 'child');
    fixture.commit(fixture.consumer, 'local.txt', 'local correction');
    fixture.ok('checkout', 'tip');
    fixture.commit(
      fixture.producer,
      'incoming.txt',
      'incoming descendant update'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'tip');
    mergeParent();
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'main',
      tip: 'child',
    });

    fixture.ok('sync', '--delete-all');

    expect(fixture.git(fixture.consumer, 'show', 'tip:local.txt')).to.equal(
      'local correction'
    );
    expect(fixture.git(fixture.consumer, 'show', 'tip:tip.txt')).to.equal(
      'published descendant'
    );
    expect(fixture.git(fixture.consumer, 'show', 'tip:incoming.txt')).to.equal(
      'incoming descendant update'
    );
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', 'tip')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'child'));
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'tip'
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
  });

  for (const blocker of ['remote divergence', 'closed parent'] as const) {
    it(`keeps explicit reconciliation for ${blocker}`, () => {
      const head = fixture.commit(
        fixture.consumer,
        'local.txt',
        'local correction'
      );
      mergeParent();
      if (blocker === 'remote divergence') {
        fixture.git(fixture.producer, 'switch', 'child');
        fixture.advanceChild();
      } else
        fs.writeJsonSync(fixture.identities, {
          prOverrides: { parent: { state: 'CLOSED' } },
        });
      const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');

      const result = fixture.run(['sync', '--delete-all']);

      expect(result.status).to.equal(1);
      expect(result.output).to.include('Cannot overwrite local branch child');
      fixture.assertTip('child', head);
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('main', trunk);
      expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
        'local correction'
      );
    });
  }
});
