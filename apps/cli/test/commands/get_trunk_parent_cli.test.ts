import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

function advanceTrunk(fixture: FrozenGetFixture): string {
  fixture.git(fixture.producer, 'switch', 'main');
  const head = fixture.commit(
    fixture.producer,
    'trunk.txt',
    'incoming trunk content'
  );
  fixture.git(fixture.producer, 'push', 'origin', 'main');
  return head;
}

function landParent(fixture: FrozenGetFixture): string {
  fixture.git(fixture.producer, 'switch', 'main');
  fixture.git(
    fixture.producer,
    'merge',
    '--no-ff',
    'parent',
    '-m',
    'merge parent PR'
  );
  const head = fixture.git(fixture.producer, 'rev-parse', 'main');
  fixture.git(fixture.producer, 'push', 'origin', 'main');
  fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
  return head;
}

describe('get CLI safe trunk and changed parents', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('fast-forwards trunk from its configured bare remote before completing a feature get', () => {
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'trunk.txt',
      'incoming trunk content'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.ok('get', 'child');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('HEAD', fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'show', 'main:trunk.txt')).to.equal(
      'incoming trunk content'
    );
    expect(fixture.git(fixture.consumer, 'rev-parse', 'main^{tree}')).to.equal(
      fixture.git(fixture.remote, 'rev-parse', 'main^{tree}')
    );
  });
  it('adopts a validated retargeted PR after its parent actually merges without overwriting an identical feature head', () => {
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.git(
      fixture.producer,
      'merge',
      '--no-ff',
      'parent',
      '-m',
      'merge parent PR'
    );
    const trunk = fixture.git(fixture.producer, 'rev-parse', 'main');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fixture.ok('get', 'child');
    fixture.assertTip('main', trunk);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.ok('info', 'child').output).to.include('Parent: main');
    expect(fixture.git(fixture.remote, 'rev-parse', 'parent')).to.equal(
      fixture.oldParent
    );
    fixture.status('child');
  });
  for (const divergent of [false, true]) {
    for (const force of [false, true]) {
      it(`refuses ${
        divergent ? 'divergent' : 'ahead'
      } local trunk with force=${force} before feature changes`, () => {
        fixture.ok('checkout', 'main');
        const local = fixture.commit(
          fixture.consumer,
          'local-main.txt',
          'local trunk work'
        );
        fixture.ok('checkout', 'child');
        if (divergent) advanceTrunk(fixture);
        fixture.git(fixture.producer, 'switch', 'child');
        fixture.advanceChild();
        const result = fixture.run([
          'get',
          'child',
          ...(force ? ['--force'] : []),
        ]);
        expect(result.status, result.output).to.equal(1);
        expect(result.output).to.include('Get never resets trunk');
        fixture.assertTip('main', local);
        fixture.assertTip('child', fixture.oldChild);
        fixture.assertTip('HEAD', fixture.oldChild);
        expect(
          fixture.git(fixture.consumer, 'show', 'main:local-main.txt')
        ).to.equal('local trunk work');
      });
    }
  }

  it('refuses divergent trunk in a real terminal without offering a forced reset', () => {
    fixture.ok('checkout', 'main');
    const local = fixture.commit(
      fixture.consumer,
      'local-main.txt',
      'local trunk work'
    );
    fixture.ok('checkout', 'child');
    advanceTrunk(fixture);
    const result = fixture.run(['get', 'child', '--force'], true);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Get never resets trunk');
    expect(result.output).not.to.include('Overwrite');
    fixture.assertTip('main', local);
  });

  it('refuses a missing remote trunk source before feature application', () => {
    fixture.advanceChild();
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/main');
    const result = fixture.run(['get', 'child', '--force']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('fetch');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', fixture.oldChild);
  });

  for (const advancing of [false, true]) {
    it(`${
      advancing ? 'refuses an advancing' : 'permits an identical'
    } trunk occupied in another worktree`, () => {
      const other = path.join(fixture.root, 'trunk-worktree');
      fixture.git(fixture.consumer, 'worktree', 'add', other, 'main');
      fs.writeFileSync(
        path.join(other, 'main.txt'),
        'other staged trunk bytes'
      );
      fixture.git(other, 'add', 'main.txt');
      const index = fixture.git(other, 'write-tree');
      const original = fixture.git(fixture.consumer, 'rev-parse', 'main');
      const child = fixture.advanceChild();
      if (advancing) advanceTrunk(fixture);
      const result = fixture.run(['get', 'child']);
      expect(result.status, result.output).to.equal(advancing ? 1 : 0);
      if (advancing) expect(result.output).to.include(other);
      fixture.assertTip('main', original);
      fixture.assertTip('child', advancing ? fixture.oldChild : child);
      expect(fixture.git(other, 'write-tree')).to.equal(index);
      expect(fs.readFileSync(path.join(other, 'main.txt'), 'utf8')).to.equal(
        'other staged trunk bytes'
      );
    });
  }

  it('adopts a fast-forward retargeted head while retaining its former parent and sibling arm', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.git(fixture.producer, 'switch', '-c', 'sibling');
    const sibling = fixture.commit(
      fixture.producer,
      'sibling.txt',
      'unrelated sibling bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      sibling: 'parent',
    });
    fixture.ok('get', 'sibling');
    fixture.git(fixture.producer, 'switch', 'child');
    const child = fixture.advanceChild();
    const trunk = landParent(fixture);
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'main',
      sibling: 'parent',
    });
    fixture.ok('get', 'child');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', child);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('sibling', sibling);
    expect(fixture.ok('info', 'child').output).to.include('Parent: main');
    expect(fixture.ok('info', 'sibling').output).to.include('Parent: parent');
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-new'
    );
    fixture.status('child');
  });

  it('requires explicit overwrite for a divergent retargeted feature and keeps force bounded to features', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local-only child bytes'
    );
    const oldTrunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    const remoteChild = fixture.advanceChild();
    const trunk = landParent(fixture);
    const refused = fixture.run(['get', 'child']);
    expect(refused.status, refused.output).to.equal(1);
    expect(refused.output).to.include('different parents');
    fixture.assertTip('main', oldTrunk);
    fixture.assertTip('child', local);
    fixture.ok('get', 'child', '--force');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', remoteChild);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.status('child', false);
  });

  it('rejects a changed numeric PR identity before trunk or feature application', () => {
    advanceTrunk(fixture);
    const oldTrunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fs.writeJsonSync(fixture.identities, {
      prReferenceOverrides: {
        child: {
          number: 99,
          url: 'https://github.com/get-fixture/repo/pull/99',
        },
      },
    });
    const result = fixture.run(['get', '2']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('identity');
    fixture.assertTip('main', oldTrunk);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('reports reached trunk and the actual remaining feature when a later hook creates a ref lock', () => {
    const trunk = advanceTrunk(fixture);
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-merge'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then touch .git/refs/heads/child.lock; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Trunk main reached');
    expect(result.output).to.include('during remote refresh');
    expect(result.output).to.include('Completed feature refresh: parent');
    expect(result.output).to.include('Pending feature refresh: child');
    fixture.assertTip('main', trunk);
    fixture.assertTip('child', fixture.oldChild);
  });
});
