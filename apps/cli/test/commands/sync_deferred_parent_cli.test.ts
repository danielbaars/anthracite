import { expect } from 'chai';
import fs from 'fs-extra';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync CLI deferred merged-parent transition', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;

  beforeEach(() => {
    fixture = new FrozenGetFixture();
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
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
    });
    return remoteMain;
  }

  it('fast-forwards trunk while keeping a divergent child and its former parent for recovery', () => {
    const local = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    const remoteMain = publishMergedParent();
    const remoteRefs = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.ok('sync', '--delete-all');

    expect(result.output).to.include('Fast-forwarded trunk main');
    expect(result.output).to.include('Sync partially completed');
    expect(result.output).to.include('Keeping parent for recovery');
    fixture.assertTip('main', remoteMain);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'local work'
    );
    for (const args of [['log'], ['log', 'short']]) {
      const output = fixture.ok(...args).output;
      const sections = output.split('Pending reconciliation');
      expect(sections).to.have.length(2);
      expect(sections[0]).not.to.match(
        /^(?:[◯◉│─┴┘┬┐ ]+)(?:parent|child)(?:\s|$)/m
      );
      expect(sections[1]).to.include('child').and.to.include('parent');
    }

    expect(fixture.ok('restack').output).to.include('pending reconciliation');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
    expect(fixture.run(['delete', 'parent', '--force']).output).to.include(
      'pending reconciliation'
    );
    fixture.assertTip('parent', fixture.oldParent);

    const submission = fixture.run(['submit', '--dry-run']);
    expect(submission.output).to.include('pending reconciliation');
    expect(submission.output).not.to.include('Updating pull requests');
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remoteRefs);

    fixture.ok('sync', '--delete-all');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
  });

  it('honors no-pull and leaves trunk and both local tips unchanged', () => {
    const local = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    publishMergedParent();

    const result = fixture.ok('sync', '--no-pull', '--delete-all');

    expect(result.output).to.include('Sync partially completed. Updated: none');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
  });

  it('does not record deferral when trunk cannot be updated in another worktree', () => {
    const local = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fixture.git(
      fixture.consumer,
      'worktree',
      'add',
      `${fixture.root}/other`,
      'main'
    );
    publishMergedParent();

    expect(fixture.run(['sync', '--delete-all']).status).to.equal(1);

    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
    expect(fixture.ok('log', 'short').output).not.to.include(
      'Pending reconciliation'
    );
  });
});
