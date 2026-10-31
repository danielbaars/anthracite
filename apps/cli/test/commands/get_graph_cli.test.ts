import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('get CLI remote graph selection', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('refreshes the target fanout with each branch own remote source and parent', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.git(fixture.producer, 'switch', '-c', 'sibling');
    fixture.commit(fixture.producer, 'sibling.txt', 'sibling old');
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      sibling: 'parent',
    });
    fixture.ok('get', 'sibling');
    fixture.git(fixture.producer, 'switch', 'child');
    const child = fixture.advanceChild();
    fixture.git(fixture.producer, 'switch', 'sibling');
    const sibling = fixture.commit(
      fixture.producer,
      'sibling.txt',
      'sibling new'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fixture.ok('get', 'parent');
    fixture.assertTip('child', child);
    fixture.assertTip('sibling', sibling);
    fixture.assertTip('HEAD', fixture.oldParent);
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    expect(fixture.ok('info', 'sibling').output).to.include('Parent: parent');
    for (const branch of ['child', 'sibling']) {
      expect(
        fixture.git(fixture.consumer, 'rev-parse', `${branch}^{tree}`)
      ).to.equal(fixture.git(fixture.remote, 'rev-parse', `${branch}^{tree}`));
    }
  });
  it('retains unpublished descendant heads with no-restack and explains skipped refresh', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unpublished bytes'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    const child = fixture.advanceChild();
    const result = fixture.ok('get', 'parent', '--no-restack');
    fixture.assertTip('child', child);
    fixture.assertTip('local-work', local);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:local.txt')
    ).to.equal('unpublished bytes');
    expect(result.output).to.include('local-work is local-only');
    fixture.ok('get', 'parent', '--force', '--no-restack');
    fixture.assertTip('local-work', local);
    expect(
      fixture.git(fixture.remote, 'branch', '--list', 'local-work')
    ).to.equal('');
  });

  it('refuses known descendant divergence before updating the selected parent', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local child work'
    );
    fixture.advanceBoth();
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('diverged');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
    fixture.assertTip('HEAD', local);
  });

  it('refuses a pull request from a different repository before changing local heads', () => {
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { url: 'https://github.com/other/repo/pull/2' } },
    });
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('identity');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });
  for (const downstack of [true, false]) {
    it(`uses g with explicit downstack=${downstack} remote selection`, () => {
      const child = fixture.advanceChild();
      fixture.ok('g', 'parent', `--downstack=${downstack}`);
      fixture.assertTip('child', downstack ? fixture.oldChild : child);
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('HEAD', fixture.oldParent);
    });
  }

  it('does not add an ancestor sibling, independent stack or remote-only descendant', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.git(fixture.producer, 'switch', '-c', 'sibling');
    const sibling = fixture.commit(
      fixture.producer,
      'sibling.txt',
      'sibling old'
    );
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', '-c', 'independent');
    const independent = fixture.commit(
      fixture.producer,
      'independent.txt',
      'independent old'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.git(fixture.producer, 'switch', '-c', 'remote-only');
    fixture.commit(fixture.producer, 'remote.txt', 'remote-only bytes');
    fixture.git(
      fixture.producer,
      'push',
      'origin',
      'sibling',
      'independent',
      'remote-only'
    );
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      sibling: 'parent',
      independent: 'main',
      'remote-only': 'child',
    });
    fixture.ok('get', 'sibling');
    fixture.ok('get', 'independent');
    for (const branch of ['sibling', 'independent']) {
      fixture.git(fixture.producer, 'switch', branch);
      fixture.commit(fixture.producer, `${branch}.txt`, `${branch} new`);
      fixture.git(fixture.producer, 'push', 'origin', branch);
    }
    fixture.git(fixture.producer, 'switch', 'child');
    const child = fixture.advanceChild();
    fixture.ok('get', 'child');
    fixture.assertTip('child', child);
    fixture.assertTip('sibling', sibling);
    fixture.assertTip('independent', independent);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'remote-only')
    ).to.equal('');
  });

  for (const failure of [
    { stderr: 'authentication failed', label: 'authentication' },
    { stderr: 'API rate limit exceeded', label: 'rate limit' },
    { stderr: 'network transport failed', label: 'transport' },
    { stderr: '', stdout: '{', label: 'malformed response', status: 0 },
  ]) {
    it(`does not turn a descendant ${failure.label} failure into a local-only skip`, () => {
      fixture.advanceBoth();
      fs.writeJsonSync(fixture.identities, {
        prErrors: { child: { status: 1, ...failure } },
      });
      const result = fixture.run(['get', 'parent']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).not.to.include('is local-only');
      expect(result.output).to.include(
        failure.label === 'malformed response'
          ? 'Malformed pull request response'
          : 'Pull request lookup failed'
      );
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('child', fixture.oldChild);
    });
  }

  it('fails a missing remote source rather than treating the descendant as unpublished', () => {
    fixture.advanceBoth();
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/child');
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('fetch');
    expect(result.output).not.to.include('local-only');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('refuses cyclic required PR chains before changing branch refs', () => {
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.prs, { parent: 'child', child: 'parent' });
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('cycle');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('refuses a mismatched PR source snapshot before applying any branch', () => {
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { headRefOid: fixture.oldChild } },
    });
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('changed while planning');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('refuses an occupied descendant before applying the selected parent', () => {
    fixture.ok('checkout', 'main');
    const other = path.join(fixture.root, 'other');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'child');
    fixture.advanceBoth();
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(other);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('preserves unrelated recovery before context initialization', () => {
    const recovery = fixture.git(
      fixture.consumer,
      'rev-parse',
      '--git-path',
      '.gtcontinue'
    );
    fs.writeFileSync(
      path.resolve(fixture.consumer, recovery),
      'unrelated recovery bytes'
    );
    const before = fixture.observe();
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('recovery operation');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('gets an explicit target from detached HEAD and refuses an implicit detached target', () => {
    fixture.git(fixture.consumer, 'switch', '--detach', fixture.oldParent);
    const implicit = fixture.run(['get']);
    expect(implicit.status, implicit.output).to.equal(1);
    expect(implicit.output).to.include('no current branch');
    fixture.assertTip('HEAD', fixture.oldParent);
    const child = fixture.advanceChild();
    fixture.ok('get', '2');
    fixture.assertTip('HEAD', child);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
  });

  it('keeps trunk as a no-op even when descendant remote heads advanced', () => {
    fixture.advanceBoth();
    fixture.ok('get', 'main', '--force');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('HEAD', fixture.oldChild);
  });
  it('does not skip an absent stored PR association as unpublished work', () => {
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const source = path.join(fixture.root, 'associated-metadata.json');
    fs.writeFileSync(source, metadata.replace('{', '{"prInfo":{"number":2},'));
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', source);
    fixture.git(
      fixture.consumer,
      'update-ref',
      'refs/branch-metadata/child',
      oid
    );
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.prs, { parent: 'main' });
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('associated pull request');
    expect(result.output).not.to.include('local-only');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });
  it('reports deferred no-restack maintenance when the child lacks new parent commits', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    const child = fixture.advanceChild();
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent.txt',
      'parent advanced independently'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fixture.ok('get', 'parent', '--no-restack');
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', child);
    expect(fixture.git(fixture.consumer, 'merge-base', parent, child)).to.equal(
      fixture.oldParent
    );
    expect(fixture.ok('log', 'short').output).to.match(/child.*needs restack/);
  });
  it('allows get after a completed legacy rebase leaves only empty continuation queues', () => {
    fixture.ok('unfreeze', 'child');
    fixture.commit(fixture.consumer, 'local.txt', 'local replay');
    fixture.advanceChild();
    const conflict = fixture.run(['get', 'child'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(conflict.status, conflict.output).to.equal(1);
    expect(conflict.output).to.include('Hit conflict');
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'resolved conflict'
    );
    fixture.git(fixture.consumer, 'add', 'child.txt');
    fixture.ok('continue');
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    fixture.ok('get', 'parent', '--downstack');
    fixture.assertTip('HEAD', fixture.oldParent);
  });
});
