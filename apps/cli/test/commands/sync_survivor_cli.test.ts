import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync CLI incoming and cleanup survivor plan', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('refuses an occupied cleanup candidate before applying another incoming head', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    fixture.advanceChild();
    fixture.git(
      fixture.consumer,
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'parent'
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('worktree');
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('parent', fixture.oldParent);
  });
  it('cleans a removed remote parent after its frozen incoming child retargets to trunk', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('checkout', 'main');
    fixture.advanceChild();
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/parent');
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack'
    );
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'parent')
    ).to.equal('');
    expect(fixture.ok('info', 'child').output).to.include('Parent: main');
    expect(result.output).not.to.include('Skipping cleanup of parent');
    fixture.status('child');
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-new'
    );
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    )
      .to.include('"number": 2')
      .and.to.include('"base": "main"');
  });

  it('abandons cleanup cancellation before applying an incoming head', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    fixture.advanceChild();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    const result = fixture.run(['sync', '--no-pull', '--no-restack'], true, [
      { prompt: 'Delete it?', input: '\u0003' },
    ]);
    expect(result.status, result.output).not.to.equal(0);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('parent', fixture.oldParent);
  });

  it('reports a confirmed physical deletion when metadata removal subsequently fails', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      '#!/bin/sh\nif [ "$1" = prepared ]; then\n while read old new ref; do\n  if [ "$ref" = refs/branch-metadata/parent ] && [ "$new" = 0000000000000000000000000000000000000000 ]; then exit 1; fi\n done\nfi\n',
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'parent')
    ).to.equal('');
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/parent')
    ).to.have.length(40);
    expect(result.output)
      .to.include('Confirmed cleanup deletions: parent')
      .and.to.include('Incomplete cleanup metadata: parent');
  });

  it('refreshes a survivor still naming a removed parent and keeps its PR base and unique content', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    const head = fixture.advanceChild();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'MERGED' } },
    });
    fixture.git(fixture.remote, 'update-ref', '-d', 'refs/heads/parent');
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack'
    );
    fixture.assertTip('child', head);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'parent')
    ).to.equal('');
    expect(fixture.ok('info', 'child').output).to.include('Parent: main');
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-new'
    );
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    expect(metadata)
      .to.include('"number": 2')
      .and.to.include('"base": "parent"');
    expect(result.output).to.include('Pending restack: child');
  });

  it('retains new open incoming work even when the old local tip was merged into trunk', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('checkout', 'main');
    fixture.git(fixture.consumer, 'merge', '--no-edit', 'child');
    const head = fixture.advanceChild();
    fixture.ok('sync', '--no-pull', '--delete-all', '--no-restack');
    fixture.assertTip('child', head);
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-new'
    );
  });

  it('excludes cleanup when a frozen incoming child newly targets the removable parent', () => {
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('checkout', 'main');
    const head = fixture.advanceChild();
    fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'parent' });
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack'
    );
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', head);
    fixture.status('child');
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    expect(result.output).to.include('Skipping cleanup of parent');
  });
  it('preserves concurrent PR metadata from a checkout hook and refuses stale cleanup', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const concurrent = path.join(fixture.root, 'concurrent-metadata.json');
    fs.writeFileSync(
      concurrent,
      metadata.replace('child original PR', 'concurrent title')
    );
    const concurrentOid = fixture.git(
      fixture.consumer,
      'hash-object',
      '-w',
      concurrent
    );
    const incoming = fixture.advanceChild();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then git update-ref refs/branch-metadata/child ${concurrentOid}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', incoming);
    fixture.assertTip('parent', fixture.oldParent);
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    )
      .to.include('concurrent title')
      .and.to.include('"parentBranchName": "parent"');
    expect(result.output)
      .to.include('Updated child')
      .and.to.include('projected cleanup graph');
  });
  it('shows optional progress while inspecting cleanup candidates', () => {
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--no-restack',
      '--show-delete-progress'
    );
    expect(result.output).to.include(
      '100% done searching for merged/closed branches to delete'
    );
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
  });
});
