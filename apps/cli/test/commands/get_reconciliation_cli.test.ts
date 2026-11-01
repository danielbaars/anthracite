import { expect } from 'chai';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('get CLI unique incoming reconciliation', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('replays only unique local commits after both published parent and child advance', () => {
    fixture.ok('unfreeze', 'child');
    fixture.env.GIT_AUTHOR_NAME = 'Local Collaborator';
    fixture.env.GIT_AUTHOR_EMAIL = 'collaborator@example.test';
    fixture.commit(fixture.consumer, 'local.txt', 'unique local bytes');
    fixture.git(
      fixture.consumer,
      'commit',
      '--amend',
      '-m',
      'Local subject\n\nComplete body\n\nLocal-Trailer: retained'
    );
    const { parent, child } = fixture.advanceBoth();
    const result = fixture.run(['get', 'child', '--no-restack'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(result.status, result.output).to.equal(0);
    fixture.assertTip('parent', parent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', child)
    ).to.equal(child);
    expect(
      fixture.git(fixture.consumer, 'rev-list', '--count', `${child}..child`)
    ).to.equal('1');
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%an <%ae>')
    ).to.equal('Local Collaborator <collaborator@example.test>');
    expect(fixture.git(fixture.consumer, 'log', '-1', '--format=%B')).to.equal(
      'Local subject\n\nComplete body\n\nLocal-Trailer: retained'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'unique local bytes'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:parent.txt')).to.equal(
      'parent-new'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-new'
    );
  });
  it('never replays old parent commits when the pinned remote parent was rewritten', () => {
    fixture.ok('unfreeze', 'child');
    fixture.commit(fixture.consumer, 'local.txt', 'unique local bytes');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.git(fixture.producer, 'reset', '--hard', 'main');
    const parent = fixture.commit(
      fixture.producer,
      'rewritten-parent.txt',
      'new parent bytes'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.git(fixture.producer, 'reset', '--hard', 'parent');
    const child = fixture.commit(fixture.producer, 'child.txt', 'child-old');
    fixture.git(
      fixture.producer,
      'push',
      '--force',
      'origin',
      'parent',
      'child'
    );
    const result = fixture.run(['get', 'child', '--no-restack'], true, [
      { prompt: 'How would you like to handle parent', input: '\r' },
      { prompt: 'How would you like to handle child', input: '\r' },
    ]);
    expect(result.status, result.output).to.equal(0);
    fixture.assertTip('parent', parent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', child)
    ).to.equal(child);
    expect(
      fixture.git(fixture.consumer, 'rev-list', '--count', `${child}..child`)
    ).to.equal('1');
    expect(
      fixture.git(
        fixture.consumer,
        'ls-tree',
        '--name-only',
        'child',
        'parent.txt'
      )
    ).to.equal('');
    expect(
      fixture.git(fixture.consumer, 'show', 'child:rewritten-parent.txt')
    ).to.equal('new parent bytes');
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'unique local bytes'
    );
  });
});
