import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// eslint-disable-next-line max-lines-per-function
describe('sync CLI existing feature refresh', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('refreshes existing published heads without pulling, deleting or replaying', () => {
    const { parent, child } = fixture.advanceBoth();
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'main.txt', 'remote trunk advance');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const main = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', child);
    fixture.assertTip('main', main);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    fixture.status('parent');
    fixture.status('child');
  });
  it('rejects a same-name source from another head repository before applying updates', () => {
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: {
        child: { headRepository: { nameWithOwner: 'other/repo' } },
      },
    });
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('identity');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  for (const route of [['sync'], ['repo', 'sync'], ['repo', 's']]) {
    it(`refreshes independent roots and fanout once from main via ${route.join(
      ' '
    )}`, () => {
      // Four-source Git/gh fixtures also run during parallel local verification.
      fixture.commandTimeoutMs = 30000;
      for (const [branch, parent] of [
        ['sibling', 'parent'],
        ['independent', 'main'],
        ['remote-only', 'child'],
      ]) {
        fixture.git(fixture.producer, 'switch', parent);
        fixture.git(fixture.producer, 'switch', '-c', branch);
        fixture.commit(fixture.producer, `${branch}.txt`, `${branch} old`);
        fixture.git(fixture.producer, 'push', 'origin', branch);
      }
      fs.writeJsonSync(fixture.prs, {
        parent: 'main',
        child: 'parent',
        sibling: 'parent',
        independent: 'main',
        'remote-only': 'child',
      });
      fixture.ok('get', 'sibling');
      fixture.ok('get', 'independent');
      fixture.ok('checkout', 'main');
      const expected = new Map<string, string>();
      for (const branch of ['parent', 'child', 'sibling', 'independent']) {
        fixture.git(fixture.producer, 'switch', branch);
        expected.set(
          branch,
          fixture.commit(fixture.producer, `${branch}.txt`, `${branch} new`)
        );
        fixture.git(fixture.producer, 'push', 'origin', branch);
      }
      fs.writeFileSync(fixture.ghCalls, '');
      fixture.ok(...route, '--no-pull', '--no-delete', '--no-restack');
      for (const [branch, head] of expected) fixture.assertTip(branch, head);
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('main');
      expect(
        fixture.git(fixture.consumer, 'branch', '--list', 'remote-only')
      ).to.equal('');
      expect(fixture.ok('info', 'sibling').output).to.include('Parent: parent');
      expect(fixture.ok('info', 'independent').output).to.include(
        'Parent: main'
      );
      const calls = fs
        .readFileSync(fixture.ghCalls, 'utf8')
        .trim()
        .split('\n')
        .map((line) => z.array(z.string()).parse(JSON.parse(line)));
      const discoveries = calls.filter(
        (call) => call[0] === 'pr' && call[1] === 'list'
      );
      expect(discoveries).to.have.length(expected.size);
      expect(
        discoveries.map((call) => call[call.indexOf('--head') + 1])
      ).to.have.members([...expected.keys()]);
      for (const call of calls) {
        const branch =
          call[1] === 'list' ? call[call.indexOf('--head') + 1] : call[2];
        expect([...expected.keys()]).to.include(branch);
      }
    });
  }

  it('retains named local-only work and excludes untracked local branches', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unpublished bytes'
    );
    fixture.git(fixture.consumer, 'branch', 'untracked-local');
    fixture.git(fixture.producer, 'switch', 'child');
    const child = fixture.advanceChild();
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );
    fixture.assertTip('child', child);
    fixture.assertTip('local-work', local);
    fixture.assertTip('untracked-local', local);
    expect(result.output).to.include('local-work is local-only');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:local.txt')
    ).to.equal('unpublished bytes');
    expect(
      fixture.git(fixture.remote, 'branch', '--list', 'local-work')
    ).to.equal('');
  });

  for (const state of ['CLOSED', 'MERGED']) {
    it(`retains an associated ${state} branch without requiring its deleted remote head`, () => {
      fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
      fs.writeJsonSync(fixture.identities, {
        prOverrides: { child: { state } },
      });
      fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/child');
      const result = fixture.ok(
        'sync',
        '--no-pull',
        '--no-delete',
        '--no-restack'
      );
      fixture.assertTip('child', fixture.oldChild);
      expect(result.output)
        .to.include('child')
        .and.to.include(state.toLowerCase())
        .and.to.include('refresh skipped');
    });
  }

  it('adopts an existing changed parent without replaying or losing PR/frozen identity', () => {
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('child', fixture.oldChild);
    const info = fixture.ok('info', 'child').output;
    expect(info).to.include('Parent: main');
    fixture.status('child');
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    ).to.include('"number": 2');
  });

  for (const failure of [
    { stderr: 'authentication failed', label: 'authentication' },
    { stderr: 'API rate limit exceeded', label: 'rate limit' },
    { stderr: 'network transport failed', label: 'transport' },
    { stderr: '', stdout: '{', status: 0, label: 'malformed response' },
    { stderr: 'no pull requests found', label: 'missing associated PR' },
  ]) {
    it(`refuses ${failure.label} before changing any selected head`, () => {
      fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
      fixture.advanceBoth();
      fs.writeJsonSync(fixture.identities, { prErrors: { child: failure } });
      const result = fixture.run([
        'sync',
        '--no-pull',
        '--no-delete',
        '--no-restack',
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).not.to.include('child is local-only');
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('child', fixture.oldChild);
    });
  }

  for (const parent of ['remote-only-parent', 'child']) {
    it(`refuses untraceable or cyclic parent ${parent} without imports or application`, () => {
      fixture.advanceBoth();
      fs.writeJsonSync(fixture.prs, { parent, child: 'parent' });
      const result = fixture.run([
        'sync',
        '--no-pull',
        '--no-delete',
        '--no-restack',
      ]);
      expect(result.status, result.output).to.equal(1);
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('child', fixture.oldChild);
      expect(
        fixture.git(fixture.consumer, 'branch', '--list', 'remote-only-parent')
      ).to.equal('');
    });
  }

  it('fails a missing open source before applying another selected feature', () => {
    fixture.advanceBoth();
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/child');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('refuses divergent feature commits even with legacy sync force', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unique local commit'
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
    expect(result.output).to.include('diverged');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', local);
  });

  it('makes no service calls when GitHub integration is explicitly disabled', () => {
    fixture.ok('repo', 'github', '--no-enable');
    fixture.advanceBoth();
    fs.writeFileSync(fixture.ghCalls, '');
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    expect(result.output)
      .to.include('GitHub integration is disabled')
      .and.to.include('not freshly verified');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('refuses tracked dirt without changing heads, index or user files', () => {
    fixture.advanceBoth();
    fs.writeFileSync(path.join(fixture.consumer, 'child.txt'), 'staged bytes');
    fixture.git(fixture.consumer, 'add', 'child.txt');
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'unstaged bytes'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
      '--quiet',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('tracked changes');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses an occupied affected head before updating any selected feature', () => {
    fixture.ok('checkout', 'main');
    const other = path.join(fixture.root, 'other');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'child');
    fixture.advanceBoth();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(other);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });

  it('protects untracked file collisions before the first selected update', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'collision.txt', 'incoming bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'collision.txt'),
      'precious local bytes'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('collision.txt');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('preserves an active foreign Git operation before refreshing features', () => {
    fixture.advanceBoth();
    const marker = fixture.git(
      fixture.consumer,
      'rev-parse',
      '--git-path',
      'CHERRY_PICK_HEAD'
    );
    fs.writeFileSync(
      path.resolve(fixture.consumer, marker),
      fixture.oldChild + '\n'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Sync requires no active');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('refuses contradictory stored and discovered open PR identities without applying updates', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.identities, {
      prReferenceOverrides: {
        child: {
          number: 999,
          url: 'https://github.com/get-fixture/repo/pull/999',
        },
      },
    });
    fs.writeFileSync(fixture.ghCalls, '');
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('changed during discovery');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.observe()).to.deep.equal(before);
    const calls = fs
      .readFileSync(fixture.ghCalls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => z.array(z.string()).parse(JSON.parse(line)));
    expect(
      calls.some((call) => call[1] === 'view' && call[2] === '2')
    ).to.equal(true);
    expect(
      calls.some(
        (call) =>
          call[1] === 'list' && call[call.indexOf('--head') + 1] === 'child'
      )
    ).to.equal(true);
  });

  it('rejects a mismatched source OID before applying an earlier selected branch', () => {
    fixture.advanceBoth();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { headRefOid: fixture.oldChild } },
    });
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('changed while planning');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });
  it('does not associate an unpublished local branch with an old closed same-name PR', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unpublished local work'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.git(fixture.producer, 'switch', '-c', 'local-work');
    fixture.commit(fixture.producer, 'remote.txt', 'historical closed work');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      'local-work': 'child',
    });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { 'local-work': { state: 'CLOSED' } },
    });
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('local-work', local);
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/local-work'
      )
    ).not.to.include('"number"');
  });
});
