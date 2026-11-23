import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// eslint-disable-next-line max-lines-per-function
describe('sync CLI merged-parent reconciliation evidence', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;

  beforeEach(() => {
    fixture = new FrozenGetFixture(false);
    fixture.commandTimeoutMs = 45_000;
    fixture.ok('get', 'child');
    fixture.env.TZ = 'Europe/Amsterdam';
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'child');
  });
  afterEach(() => fixture?.cleanup());

  function publishTransition(): string {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'published parent revision');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.git(fixture.producer, 'cherry-pick', 'parent~1', 'parent');
    fixture.git(
      fixture.producer,
      'rebase',
      '--onto',
      'main',
      fixture.oldParent,
      'child'
    );
    const published = fixture.git(fixture.producer, 'rev-parse', 'child');
    fixture.git(fixture.producer, 'push', '--force', 'origin', 'main', 'child');
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/parent');
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    return published;
  }

  it('identifies equivalent feature work across changed bases and labels the source of times', () => {
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    const published = publishTransition();
    expect(published).not.to.equal(fixture.oldChild);
    fixture.env.GIT_COMMITTER_DATE = '2026-10-22T11:01:00Z';
    fixture.git(
      fixture.consumer,
      'update-ref',
      'refs/heads/child',
      fixture.oldParent
    );
    fixture.git(
      fixture.consumer,
      'update-ref',
      'refs/heads/child',
      fixture.oldChild
    );
    fs.writeJsonSync(fixture.identities, {
      prOverrides: {
        parent: { state: 'MERGED', mergedAt: '2026-10-23T10:00:00Z' },
      },
      activity: [
        {
          ref: 'refs/heads/other',
          after: published,
          activity_type: 'push',
          timestamp: '2026-10-23T12:20:00Z',
        },
        {
          ref: 'refs/heads/child',
          after: fixture.oldChild,
          activity_type: 'push',
          timestamp: '2026-10-23T12:10:00Z',
        },
        {
          ref: 'refs/heads/child',
          after: published,
          activity_type: 'pr_merge',
          timestamp: '2026-10-23T12:05:00Z',
        },
        {
          ref: 'refs/heads/child',
          after: published,
          activity_type: 'force_push',
          timestamp: '2026-10-23T12:00:00Z',
        },
      ],
    });

    const { output } = fixture.ok('sync', '--no-pull', '--delete-all');

    expect(output).to.include('child (PR #2) now targets main on GitHub');
    expect(output).to.include('Local parent: parent (PR #1)');
    expect(output).to.include(
      'The merged PR head differs from the former local parent tip'
    );
    expect(output).to.include('Merged: 2026-10-23, 12:00');
    expect(output).to.include(
      'Equivalent branch work: 1 own commit matches in order'
    );
    expect(output).to.include('GitHub push: 2026-10-23, 14:00');
    expect(output).to.include('Local commit: 2026-10-21, 14:00');
    expect(output).to.include('Local update: 2026-10-22, 13:01');
    expect(output).to.include('GitHub commit: 2026-10-21, 14:00');
    expect(output)
      .not.to.include('14:20')
      .and.not.to.include('14:10')
      .and.not.to.include('14:05');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('reports differing own patches and retains both local tips when push evidence does not match', () => {
    const published = publishTransition();
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'local revision'
    );
    fixture.git(fixture.consumer, 'add', 'child.txt');
    fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
    const local = fixture.git(fixture.consumer, 'rev-parse', 'child');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
      activity: [
        {
          ref: 'refs/heads/other',
          after: published,
          activity_type: 'push',
          timestamp: '2026-10-23T12:20:00Z',
        },
        {
          ref: 'refs/heads/child',
          after: fixture.oldChild,
          activity_type: 'push',
          timestamp: '2026-10-23T12:10:00Z',
        },
      ],
    });

    const { output } = fixture.ok('sync', '--delete-all');

    expect(output).to.include(
      'Branch patches differ. Local commits: 1. GitHub commits: 1.'
    );
    expect(output).to.include('Patches matching at the same position: 0.');
    expect(output)
      .to.include('GitHub commit:')
      .and.not.to.include('GitHub push:');
    expect(output)
      .not.to.include('Merged:')
      .and.not.to.include('Equivalent branch work');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
  });

  it('reports unproven commit ranges separately from differing patches when activity is unavailable', () => {
    publishTransition();
    const local = fixture.git(
      fixture.consumer,
      'commit-tree',
      'child^{tree}',
      '-p',
      'child',
      '-p',
      'parent',
      '-m',
      'merge-shaped local history'
    );
    fixture.git(fixture.consumer, 'update-ref', 'refs/heads/child', local);
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED', mergedAt: 'invalid time' } },
      activityError: true,
    });

    const { output } = fixture.ok('sync', '--delete-all');

    expect(output).to.include('Fast-forwarded trunk main');
    expect(output).to.include(
      'Comparison unavailable: could not verify both branch commit ranges.'
    );
    expect(output)
      .not.to.include('Branch patches differ')
      .and.not.to.include('GitHub push:');
    expect(output).not.to.include('invalid time').and.not.to.include('Merged:');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
  });

  it('does not fetch an unavailable PR base to explain branch history with no-pull', () => {
    const localTrunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    publishTransition();
    fixture.git(fixture.producer, 'switch', 'main');
    const githubTrunk = fixture.commit(
      fixture.producer,
      'new.txt',
      'later trunk work'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
    });

    const { output } = fixture.ok('sync', '--no-pull', '--delete-all');

    expect(output).to.include(
      'Comparison unavailable: could not verify both branch commit ranges.'
    );
    expect(output).not.to.include('Fast-forwarded trunk main');
    fixture.assertTip('main', localTrunk);
    fixture.assertTip('child', fixture.oldChild);
    expect(() =>
      fixture.git(fixture.consumer, 'cat-file', '-e', githubTrunk)
    ).to.throw();
  });
});
