import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync CLI planned update authority', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('refuses divergent trunk before applying planned feature updates', () => {
    fixture.ok('checkout', 'main');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique trunk work'
    );
    fixture.ok('checkout', 'child');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'remote.txt', 'remote trunk work');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.advanceBoth();
    const result = fixture.run([
      'sync',
      '--delete-all',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('main', local);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  for (const kind of ['ahead', 'divergent']) {
    for (const force of [false, true]) {
      it(`${
        force ? 'resets' : 'refuses'
      } ${kind} trunk with explicit force ${force}`, () => {
        fixture.ok('checkout', 'main');
        const local = fixture.commit(
          fixture.consumer,
          'local.txt',
          'unique trunk work'
        );
        fixture.ok('checkout', 'child');
        if (kind === 'divergent') {
          fixture.git(fixture.producer, 'switch', 'main');
          fixture.commit(fixture.producer, 'remote.txt', 'remote trunk work');
          fixture.git(fixture.producer, 'push', 'origin', 'main');
        }
        const remote = fixture.git(fixture.remote, 'rev-parse', 'main');
        const result = fixture.run([
          'sync',
          '--delete-all',
          '--no-delete',
          '--no-restack',
          ...(force ? ['--force'] : []),
        ]);
        expect(result.status, result.output).to.equal(force ? 0 : 1);
        fixture.assertTip('main', force ? remote : local);
        fixture.assertTip('child', fixture.oldChild);
        expect(
          fixture.git(fixture.consumer, 'branch', '--show-current')
        ).to.equal('child');
      });
    }
  }

  it('applies the pinned trunk source before features after multiple fetches', () => {
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'remote.txt',
      'remote trunk advance'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const { parent, child } = fixture.advanceBoth();
    fixture.ok('sync', '--no-delete', '--no-restack');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', child);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
  });

  for (const noPull of [false, true]) {
    it(`${
      noPull ? 'skips' : 'refuses'
    } a missing remote trunk before feature application`, () => {
      fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/main');
      const { parent, child } = fixture.advanceBoth();
      const result = fixture.run([
        'sync',
        '--force',
        '--no-delete',
        '--no-restack',
        ...(noPull ? ['--no-pull'] : []),
      ]);
      expect(result.status, result.output).to.equal(noPull ? 0 : 1);
      fixture.assertTip('parent', noPull ? parent : fixture.oldParent);
      fixture.assertTip('child', noPull ? child : fixture.oldChild);
    });
  }

  it('refuses an occupied trunk before applying feature updates', () => {
    fixture.git(
      fixture.consumer,
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'main'
    );
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'remote.txt', 'remote trunk advance');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.advanceBoth();
    const result = fixture.run([
      'sync',
      '--force',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('worktree');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('never resets an unrelated checkout selected by a real trunk checkout hook', () => {
    fixture.ok('checkout', 'main');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique trunk work'
    );
    fixture.ok('checkout', 'child');
    fixture.git(fixture.consumer, 'branch', 'actor', 'child');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/post-checkout'),
      '#!/bin/sh\nif test "$(git symbolic-ref --short HEAD)" = main; then git -c core.hooksPath=/dev/null switch actor; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--force',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Physical checkout changed');
    fixture.assertTip('main', local);
    fixture.assertTip('actor', fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'actor'
    );
  });

  for (const accept of [false, true]) {
    it(`${
      accept ? 'accepts' : 'declines'
    } a real terminal trunk reset before feature application`, () => {
      fixture.ok('checkout', 'main');
      const local = fixture.commit(
        fixture.consumer,
        'local.txt',
        'unique trunk work'
      );
      fixture.ok('checkout', 'child');
      const remote = fixture.git(fixture.remote, 'rev-parse', 'main');
      const { child } = fixture.advanceBoth();
      const result = fixture.run(
        ['sync', '--no-delete', '--no-restack'],
        true,
        [{ prompt: 'Overwrite main', input: accept ? 'y\r' : 'n\r' }]
      );
      expect(result.status, result.output).to.equal(accept ? 0 : 1);
      fixture.assertTip('main', accept ? remote : local);
      fixture.assertTip('child', accept ? child : fixture.oldChild);
    });
  }

  for (const choice of ['REBASE', 'OVERWRITE', 'ABORT']) {
    it(`collects real terminal feature ${choice} before applying trunk and feature updates`, () => {
      fixture.ok('unfreeze', 'child');
      const local = fixture.commit(
        fixture.consumer,
        'local.txt',
        'unique feature work'
      );
      fixture.git(fixture.producer, 'switch', 'main');
      const oldTrunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
      const trunk = fixture.commit(
        fixture.producer,
        'remote.txt',
        'remote trunk advance'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'main');
      const { parent, child } = fixture.advanceBoth();
      const result = fixture.run(
        ['sync', '--force', '--no-delete', '--no-restack'],
        true,
        [
          {
            prompt: 'How would you like to handle',
            input:
              choice === 'REBASE'
                ? '\r'
                : choice === 'OVERWRITE'
                ? '\u001b[B\r'
                : '\u001b[B\u001b[B\r',
          },
        ]
      );
      expect(result.status, result.output).to.equal(choice === 'ABORT' ? 1 : 0);
      fixture.assertTip('main', choice === 'ABORT' ? oldTrunk : trunk);
      fixture.assertTip(
        'parent',
        choice === 'ABORT' ? fixture.oldParent : parent
      );
      if (choice === 'ABORT') fixture.assertTip('child', local);
      else if (choice === 'OVERWRITE') fixture.assertTip('child', child);
      else {
        expect(
          fixture.git(fixture.consumer, 'merge-base', 'child', child)
        ).to.equal(child);
        expect(
          fixture.git(fixture.consumer, 'show', 'child:local.txt')
        ).to.equal('unique feature work');
      }
    });
  }
  it('gives truthful sync divergence guidance without offering force overwrite', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique feature work'
    );
    fixture.advanceBoth();
    const result = fixture.run([
      'sync',
      '--force',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('does not authorize feature overwrite');
    expect(result.output).not.to.include('or use --force to overwrite');
    fixture.assertTip('child', local);
    fixture.assertTip('parent', fixture.oldParent);
  });

  it('continues a real reconciliation conflict through owned sync phases', () => {
    fixture.ok('unfreeze', 'child');
    fixture.commit(fixture.consumer, 'child.txt', 'conflicting local child');
    const remote = fixture.advanceChild();
    const result = fixture.run(
      ['sync', '--no-pull', '--no-delete', '--no-restack'],
      true,
      [{ prompt: 'How would you like to handle', input: '\r' }]
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(
      'Resolve the conflict and run an continue.'
    );
    expect(result.output).to.include(
      'continue executing your previous Anthracite command'
    );
    expect(fixture.git(fixture.consumer, 'rev-parse', 'HEAD')).to.equal(remote);
    expect(
      fixture.git(fixture.consumer, 'diff', '--name-only', '--diff-filter=U')
    ).to.equal('child.txt');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/rebase-merge'))
    ).to.equal(true);
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'resolved incoming child'
    );
    fixture.ok('cont', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'resolved incoming child'
    );
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(false);
  });

  it('offers frozen divergence overwrite and abort without local rebase', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'unique frozen work');
    const head = fixture.advanceChild();
    const result = fixture.run(
      ['sync', '--no-pull', '--no-delete', '--no-restack'],
      true,
      [{ prompt: 'How would you like to handle', input: '\r' }]
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Rebase your changes');
    fixture.assertTip('child', head);
    fixture.status('child');
  });
  it('preserves local-ahead trunk with force when pull is explicitly disabled', () => {
    fixture.ok('checkout', 'main');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique trunk work'
    );
    fixture.ok('checkout', 'child');
    const { child } = fixture.advanceBoth();
    fixture.ok('sync', '--force', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('main', local);
    fixture.assertTip('child', child);
  });

  for (const ignored of [false, true]) {
    it(`preserves ${
      ignored ? 'ignored' : 'untracked'
    } file collisions despite reset force`, () => {
      fixture.ok('checkout', 'main');
      const local = fixture.commit(
        fixture.consumer,
        'local.txt',
        'unique trunk work'
      );
      fixture.ok('checkout', 'child');
      fixture.git(fixture.producer, 'switch', 'main');
      fixture.commit(fixture.producer, 'collision.txt', 'incoming trunk bytes');
      fixture.git(fixture.producer, 'push', 'origin', 'main');
      if (ignored)
        fs.writeFileSync(
          path.join(fixture.consumer, '.git/info/exclude'),
          'collision.txt\n'
        );
      fs.writeFileSync(
        path.join(fixture.consumer, 'collision.txt'),
        'private local bytes'
      );
      const before = fixture.observe();
      const result = fixture.run([
        'sync',
        '--force',
        '--no-delete',
        '--no-restack',
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('would be overwritten');
      fixture.assertTip('main', local);
      expect(fixture.observe()).to.deep.equal(before);
    });
  }

  it('preserves tracked staged and unstaged bytes despite reset force', () => {
    fixture.ok('checkout', 'main');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique trunk work'
    );
    fixture.ok('checkout', 'child');
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'staged private bytes'
    );
    fixture.git(fixture.consumer, 'add', 'child.txt');
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'unstaged private bytes'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--force',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('tracked changes');
    fixture.assertTip('main', local);
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('refuses quiet forced feature divergence before a planned trunk fast-forward', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique feature work'
    );
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'remote.txt', 'incoming trunk advance');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.advanceBoth();
    const result = fixture.run([
      'sync',
      '--force',
      '--quiet',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('does not authorize feature overwrite');
    expect(result.output).not.to.include('How would you like');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
  });
});
