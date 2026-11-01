import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync CLI checked completion', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  const breakChildParent = (): string => {
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const file = path.join(fixture.root, 'invalid-parent.json');
    fs.writeFileSync(
      file,
      metadata.replace(
        '"parentBranchName": "parent"',
        '"parentBranchName": "removed-parent"'
      )
    );
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fixture.git(
      fixture.consumer,
      'update-ref',
      'refs/branch-metadata/child',
      oid
    );
    return oid;
  };

  it('falls back to trunk after confirmed cleanup removes the original checkout', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'CLOSED' } },
    });
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack'
    );
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'child'),
      result.output
    ).to.equal('');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(result.output).to.include(
      'Original checkout child was deleted by sync cleanup; switched to trunk main'
    );
  });
  it('refuses completion when source cleanup hooks change surviving PR metadata', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const file = path.join(fixture.root, 'changed.json');
    fs.writeFileSync(
      file,
      metadata.replace('child original PR', 'concurrent title')
    );
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/child ${oid};; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    ).to.include('concurrent title');
    expect(result.output)
      .to.include('Manual inspection')
      .and.to.include('source refs');
  });

  it('restores the original surviving branch at its refreshed authorized head', () => {
    fixture.ok('checkout', 'parent');
    const heads = fixture.advanceBoth();
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'parent'
    );
    expect(fixture.git(fixture.consumer, 'rev-parse', 'HEAD')).to.equal(
      heads.parent
    );
    fixture.assertTip('child', heads.child);
  });

  it('restores the exact detached OID after incoming refresh', () => {
    fixture.git(fixture.consumer, 'switch', '--detach', fixture.oldParent);
    const head = fixture.advanceChild();
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    expect(fixture.git(fixture.consumer, 'rev-parse', 'HEAD')).to.equal(
      fixture.oldParent
    );
    fixture.assertTip('child', head);
  });

  it('refuses a final checkout hook PR mutation and keeps reached cleanup and actual checkout', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    const head = fixture.advanceChild();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const file = path.join(fixture.root, 'changed.json');
    fs.writeFileSync(
      file,
      metadata.replace('child original PR', 'concurrent final title')
    );
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then git update-ref refs/branch-metadata/child ${oid}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', head);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'parent')
    ).to.equal('');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    ).to.include('concurrent final title');
    expect(result.output)
      .to.include('Sync completion failed')
      .and.to.include('Confirmed cleanup deletions: parent');
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname)',
        'refs/gt-metadata/get'
      )
    ).not.to.equal('');
  });

  it('refuses source cleanup hooks that move a surviving head', () => {
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) git -c core.hooksPath=/dev/null update-ref refs/heads/parent ${trunk};; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', trunk);
    expect(result.output)
      .to.include('parent changed outside')
      .and.to.include('Manual inspection');
  });

  it('refuses a source cleanup hook physical checkout change without switching it back', () => {
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) git -c core.hooksPath=/dev/null -c advice.detachedHead=false switch --detach ${fixture.oldParent};; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    expect(fixture.git(fixture.consumer, 'rev-parse', 'HEAD')).to.equal(
      fixture.oldParent
    );
    expect(result.output)
      .to.include('Actual checkout: detached HEAD')
      .and.to.include('source refs');
  });

  it('keeps a permitted freeze-only delta from a final checkout hook', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const file = path.join(fixture.root, 'freeze.json');
    fs.writeFileSync(
      file,
      metadata.replace('"frozen": false', '"frozen": true')
    );
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then git update-ref refs/branch-metadata/child ${oid}; fi\n`,
      { mode: 0o755 }
    );
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.status('child');
  });

  it('refuses unexpected original-ref disappearance instead of recreating it or falling back', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const head = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = child ]; then git update-ref -d refs/heads/inspection; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'inspection')
    ).to.equal('');
    fixture.assertTip('child', head);
    expect(result.output)
      .to.include('inspection')
      .and.not.to.include('was deleted by sync cleanup');
  });
  it('refuses a final checkout hook that redirects physical checkout', () => {
    fixture.ok('checkout', 'main');
    const head = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then git -c core.hooksPath=/dev/null switch parent; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'parent'
    );
    fixture.assertTip('child', head);
    expect(result.output)
      .to.include('Actual checkout: parent')
      .and.to.include('before sync stopped')
      .and.not.to.include('before get stopped');
  });

  it('refuses final restoration when a hook occupies the original branch in another worktree', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const head = fixture.advanceChild();
    const other = path.join(fixture.root, 'occupied');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = child ] && [ ! -d "${other}" ]; then git -c core.hooksPath=/dev/null worktree add "${other}" inspection; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(fixture.git(other, 'branch', '--show-current')).to.equal(
      'inspection'
    );
    fixture.assertTip('child', head);
    expect(result.output)
      .to.include('worktree')
      .and.to.include('Actual checkout: child');
  });

  it('refuses a final checkout hook surviving head mutation', () => {
    fixture.ok('checkout', 'main');
    const head = fixture.advanceChild();
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then git update-ref refs/heads/parent ${trunk}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', trunk);
    fixture.assertTip('child', head);
    expect(result.output)
      .to.include('parent changed outside')
      .and.to.include('Actual checkout: main');
  });
  it('preserves unchanged pre-existing metadata outside the valid tracked graph', () => {
    const oid = breakChildParent();
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(oid);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
  });
  it('rejects source cleanup actor head changes outside the valid tracked graph', () => {
    breakChildParent();
    const trunk = fixture.git(fixture.consumer, 'rev-parse', 'main');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) git -c core.hooksPath=/dev/null update-ref refs/heads/child ${trunk};; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', trunk);
    expect(result.output)
      .to.include('child changed outside')
      .and.to.include('Manual inspection');
  });

  it('rejects incoming-hook changes to original opaque out-of-graph metadata', () => {
    breakChildParent();
    const file = path.join(fixture.root, 'opaque.txt');
    fs.writeFileSync(file, 'concurrent opaque metadata');
    const actor = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fixture.ok('checkout', 'main');
    const heads = fixture.advanceBoth();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git update-ref refs/branch-metadata/child ${actor}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', heads.parent);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(actor);
    expect(result.output)
      .to.include('Sync stopped during prs')
      .and.to.include('child changed outside the saved sync plan')
      .and.to.include('No verified owned continuation');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'parent'
    );
    expect(
      fixture.git(fixture.consumer, 'diff', '--cached', 'parent')
    ).to.equal('');
    expect(fixture.git(fixture.consumer, 'diff')).to.equal('');
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'parent.txt'), 'utf8')
    ).to.equal('parent-new');
    expect(fs.existsSync(path.join(fixture.consumer, 'child.txt'))).to.equal(
      false
    );
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(true);
    const stopped = fixture.observe();
    const retry = fixture.run(['continue', '--all']);
    expect(retry.status, retry.output).to.equal(1);
    expect(fixture.observe()).to.deep.equal(stopped);
  });

  it('rejects a genuinely new tracked participant introduced during source cleanup', () => {
    const oid = breakChildParent();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/intruder ${oid};; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(
        fixture.consumer,
        'rev-parse',
        'refs/branch-metadata/intruder'
      )
    ).to.equal(oid);
    expect(result.output).to.include('Unexpected tracked branch intruder');
  });
  it('compares untouched opaque metadata exactly without adopting a changed freeze field', () => {
    breakChildParent();
    const metadata = fixture.git(
      fixture.consumer,
      'cat-file',
      '-p',
      'refs/branch-metadata/child'
    );
    const file = path.join(fixture.root, 'actor-freeze.json');
    fs.writeFileSync(
      file,
      metadata.replace('"frozen": true', '"frozen": false')
    );
    const actor = fixture.git(fixture.consumer, 'hash-object', '-w', file);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/child ${actor};; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(actor);
    expect(result.output).to.include('child changed outside');
  });

  it('rejects a committed cleanup parent publication hook that restores the old parent', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    const oldMetadata = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/child'
    );
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { parent: { state: 'CLOSED' } },
    });
    const marker = path.join(fixture.root, 'restored-parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ] && [ ! -e "${marker}" ]; then\n while read old new ref; do\n if [ "$ref" = refs/branch-metadata/child ] && git cat-file -p "$new" | grep -q '\"parentBranchName\": \"main\"'; then\n touch "${marker}"\n git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/child ${oldMetadata}\n fi\n done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack',
    ]);
    expect(fs.existsSync(marker), result.output).to.equal(true);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(oldMetadata);
    expect(result.output)
      .to.include('cleanup parent publication')
      .and.to.include('retained');
  });
});
