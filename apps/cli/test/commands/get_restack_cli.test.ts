import { expect } from 'chai';
import path from 'path';
import fs from 'fs-extra';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('get CLI automatic local maintenance', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('applies all incoming heads before replaying editable descendants with their own content', () => {
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.commit(fixture.producer, 'child-new.txt', 'incoming child bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent', 'child');
    const result = fixture.ok('get', 'parent');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'show', 'child:parent-new.txt')
    ).to.equal('incoming parent bytes');
    expect(
      fixture.git(fixture.consumer, 'show', 'child:child-new.txt')
    ).to.equal('incoming child bytes');
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-old'
    );
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    expect(result.output).to.include('Local maintenance: child');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'parent'
    );
  });
  it('refuses a known occupied maintenance sibling before applying incoming updates', () => {
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.consumer, 'switch', 'main');
    const other = path.join(fixture.root, 'other');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent-new.txt', 'incoming parent bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.run(['get', 'parent', '--downstack']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(other);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(other, 'status', '--porcelain')).to.equal('');
  });
  it('bounds replay refs even when local rebase.updateRefs is enabled', () => {
    fixture.ok('unfreeze', 'child');
    fixture.git(
      fixture.consumer,
      'branch',
      'unrelated-alias',
      fixture.oldChild
    );
    fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fixture.ok('get', 'parent', '--downstack');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(parent);
    fixture.assertTip('unrelated-alias', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'config', '--get', 'rebase.updateRefs')
    ).to.equal('true');
  });

  it('maintains a sibling outside downstack remote refresh without fetching its newer remote work', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.git(fixture.producer, 'switch', '-c', 'sibling');
    fixture.commit(fixture.producer, 'sibling.txt', 'local sibling bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fixture.git(fixture.consumer, 'switch', 'parent');
    fixture.git(fixture.consumer, 'switch', '-c', 'sibling');
    fixture.commit(fixture.consumer, 'sibling.txt', 'local sibling bytes');
    fixture.ok('track', 'sibling', '--parent', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.producer, 'switch', 'sibling');
    fixture.commit(
      fixture.producer,
      'remote-only.txt',
      'must not refresh sibling'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.ok('get', 'child', '--downstack');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'sibling')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'show', 'sibling:sibling.txt')
    ).to.equal('local sibling bytes');
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'sibling')
    ).not.to.include('remote-only.txt');
    expect(result.output).to.include('Local maintenance: child, sibling');
    expect(fixture.ok('info', 'sibling').output).to.include('Parent: parent');
  });

  it('replays the selected root onto advancing trunk without touching an independent trunk stack', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.consumer, 'switch', '-c', 'independent', 'main');
    const independent = fixture.commit(
      fixture.consumer,
      'independent.txt',
      'independent bytes'
    );
    fixture.ok('track', 'independent', '--parent', 'main');
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'trunk-new.txt',
      'incoming trunk bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.ok('get', 'parent');
    fixture.assertTip('main', trunk);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'parent')
    ).to.equal(trunk);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'parent'));
    expect(
      fixture.git(fixture.consumer, 'show', 'child:trunk-new.txt')
    ).to.equal('incoming trunk bytes');
    fixture.assertTip('independent', independent);
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'independent')
    ).not.to.include('trunk-new.txt');
  });
  it('maintains descendants on the resulting reconciled parent rather than its incoming source head', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.consumer, 'switch', 'parent');
    fixture.commit(
      fixture.consumer,
      'local-parent.txt',
      'retained local parent'
    );
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent-new.txt', 'incoming parent bytes');
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.git(fixture.producer, 'merge', '--no-edit', 'parent');
    fixture.commit(fixture.producer, 'child-new.txt', 'incoming child bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent', 'child');
    const result = fixture.run(['get', 'child'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'parent'));
    expect(
      fixture.git(fixture.consumer, 'show', 'child:local-parent.txt')
    ).to.equal('retained local parent');
    expect(
      fixture.git(fixture.consumer, 'show', 'child:child-new.txt')
    ).to.equal('incoming child bytes');
  });

  for (const mode of [
    { command: 'get', option: '--no-restack', enabled: false },
    { command: 'g', option: '--restack=false', enabled: false },
    { command: 'g', option: '--restack=true', enabled: true },
  ]) {
    it(`honors ${mode.command} ${mode.option} independently of final checkout`, () => {
      fixture.ok('unfreeze', 'child');
      fixture.git(fixture.consumer, 'switch', 'main');
      const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
      fixture.git(fixture.producer, 'switch', 'parent');
      const parent = fixture.commit(
        fixture.producer,
        'parent-new.txt',
        'incoming parent bytes'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'parent');
      const result = fixture.ok(
        mode.command,
        'parent',
        mode.option,
        '--no-checkout'
      );
      fixture.assertTip('parent', parent);
      fixture.assertTip('HEAD', original);
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('main');
      if (mode.enabled) {
        expect(
          fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
        ).to.equal(parent);
        expect(result.output).not.to.include('Pending restack');
      } else {
        fixture.assertTip('child', fixture.oldChild);
        expect(result.output).to.include('Pending restack: child');
      }
    });
  }

  it('preserves unpublished descendant authors, full messages and files across dependency replays', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fs.writeFileSync(
      path.join(fixture.consumer, 'local.txt'),
      'unpublished bytes'
    );
    fixture.git(fixture.consumer, 'add', 'local.txt');
    fixture.git(
      fixture.consumer,
      'commit',
      '--author',
      'Original Author <original@example.test>',
      '-m',
      'Unique local title\n\nFull retained body.\nSecond body line.'
    );
    const original = fixture.git(
      fixture.consumer,
      'show',
      '-s',
      '--format=%an <%ae>%n%B',
      'HEAD'
    );
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.ok('get', 'parent', '--no-checkout');
    expect(
      fixture.git(
        fixture.consumer,
        'show',
        '-s',
        '--format=%an <%ae>%n%B',
        'local-work'
      )
    ).to.equal(original);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:local.txt')
    ).to.equal('unpublished bytes');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent-new.txt')
    ).to.equal('incoming parent bytes');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', 'local-work')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'child'));
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'local-work'
    );
    expect(
      fixture.git(fixture.consumer, 'rev-list', '--count', 'child..local-work')
    ).to.equal('1');
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(result.output).to.include('local-work is local-only');
    expect(
      fixture.git(fixture.remote, 'branch', '--list', 'local-work')
    ).to.equal('');
  });

  it('retains a frozen incoming anchor and replays editable local work onto that retained head', () => {
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'local.txt', 'unpublished bytes');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    const child = fixture.commit(
      fixture.producer,
      'child-new.txt',
      'incoming frozen child'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent', 'child');
    const result = fixture.ok('get', 'parent');
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', child);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', 'local-work')
    ).to.equal(child);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:local.txt')
    ).to.equal('unpublished bytes');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:child-new.txt')
    ).to.equal('incoming frozen child');
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'local-work')
    ).not.to.include('parent-new.txt');
    fixture.status('child', true);
    expect(result.output).to.include('Skipping frozen branch child');
    expect(fixture.ok('log', 'short').output).to.match(/child.*needs restack/);
  });

  it('reports reached updates and pending maintenance while retaining a real conflict and index', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'parent.txt', 'local conflicting parent');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent.txt',
      'remote conflicting parent'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.run(['get', 'parent', '--no-checkout', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Updated parent');
    expect(result.output).to.include('Completed local maintenance: child');
    expect(result.output).to.include('Pending local maintenance: local-work');
    fixture.assertTip('parent', parent);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    expect(
      fixture.git(fixture.consumer, 'diff', '--name-only', '--diff-filter=U')
    ).to.equal('parent.txt');
    expect(
      fixture.git(fixture.consumer, 'ls-files', '--unmerged')
    ).not.to.equal('');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(true);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(true);
  });

  it('refuses a maintenance ref changed by an incoming checkout hook before replaying it', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'local.txt', 'planned local bytes');
    fixture.git(fixture.consumer, 'switch', '-c', 'concurrent-work');
    const concurrent = fixture.commit(
      fixture.consumer,
      'concurrent.txt',
      'concurrent bytes'
    );
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = parent ]; then git update-ref refs/heads/local-work ${concurrent}; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'get',
      'parent',
      '--downstack',
      '--no-checkout',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('local-work changed');
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('local-work', concurrent);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:concurrent.txt')
    ).to.equal('concurrent bytes');
  });
  it('keeps explicit reconciliation permission separate from disabled automatic replay and bounds its refs', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.git(fixture.consumer, 'switch', 'parent');
    const local = fixture.commit(
      fixture.consumer,
      'local-parent.txt',
      'retained local parent'
    );
    fixture.git(fixture.consumer, 'branch', 'unrelated-alias', local);
    fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent-new.txt', 'incoming parent bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.run(
      ['get', 'parent', '--downstack', '--no-restack'],
      true,
      [{ prompt: 'How would you like to handle', input: '\r' }]
    );
    expect(result.status, result.output).to.equal(0);
    expect(
      fixture.git(fixture.consumer, 'show', 'parent:local-parent.txt')
    ).to.equal('retained local parent');
    expect(
      fixture.git(fixture.consumer, 'show', 'parent:parent-new.txt')
    ).to.equal('incoming parent bytes');
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('unrelated-alias', local);
    expect(result.output).to.include('Pending restack: child');
    expect(
      fixture.git(fixture.consumer, 'config', '--get', 'rebase.updateRefs')
    ).to.equal('true');
  });

  for (const ignored of [false, true]) {
    it(`refuses known ${
      ignored ? 'ignored' : 'untracked'
    } maintenance collisions before incoming changes`, () => {
      fixture.ok('unfreeze', 'child');
      fixture.ok('create', 'local-work');
      fixture.commit(fixture.consumer, 'local.txt', 'committed local bytes');
      fixture.git(fixture.consumer, 'switch', 'main');
      if (ignored)
        fs.appendFileSync(
          path.join(fixture.consumer, '.git', 'info', 'exclude'),
          '\nlocal.txt\n'
        );
      fs.writeFileSync(
        path.join(fixture.consumer, 'local.txt'),
        'protected local bytes'
      );
      fixture.git(fixture.producer, 'switch', 'parent');
      fixture.commit(
        fixture.producer,
        'parent-new.txt',
        'incoming parent bytes'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'parent');
      const result = fixture.run(['get', 'parent', '--downstack']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include(ignored ? 'ignored' : 'untracked');
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('child', fixture.oldChild);
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'local.txt'), 'utf8')
      ).to.equal('protected local bytes');
      expect(
        fixture.git(fixture.consumer, 'diff', '--cached', '--name-only')
      ).to.equal('');
    });
  }

  it('documents restack defaults and negative flags on both public command names', () => {
    for (const command of ['get', 'g']) {
      const output = fixture.ok(command, '--help').output;
      expect(output).to.include('--restack');
      expect(output).to.include('--no-restack');
      expect(output).to.match(/restack[\s\S]*default: true/);
    }
  });
  it('maintains authorized editable imports over advancing trunk despite a confirmed untracked namesake', () => {
    fixture.freshConsumer();
    fixture.git(fixture.consumer, 'switch', '-c', 'child');
    fixture.commit(
      fixture.consumer,
      'namesake.txt',
      'explicitly replaced namesake'
    );
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'trunk-new.txt',
      'incoming trunk bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.ok('get', 'child', '--force', '--unfrozen');
    fixture.assertTip('main', trunk);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'parent')
    ).to.equal(trunk);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'parent'));
    expect(
      fixture.git(fixture.consumer, 'show', 'child:trunk-new.txt')
    ).to.equal('incoming trunk bytes');
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-old'
    );
    fixture.status('parent', false);
    fixture.status('child', false);
  });
  it('reports replayed content with pending metadata when publication fails after Git completes', () => {
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const oldMetadata = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/child'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-rewrite'),
      '#!/bin/sh\nmkdir -p "$(git rev-parse --git-path refs/branch-metadata)"\ntouch "$(git rev-parse --git-path refs/branch-metadata/child.lock)"\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'parent', '--downstack', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Completed local maintenance: none');
    expect(result.output).to.include('Pending local maintenance: child');
    expect(result.output).to.include(
      'Rewrite of child completed, but metadata publication failed'
    );
    fixture.assertTip('parent', parent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'show', 'child:parent-new.txt')
    ).to.equal('incoming parent bytes');
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(oldMetadata);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
  });
});
