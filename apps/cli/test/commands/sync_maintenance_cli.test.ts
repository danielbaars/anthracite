import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync CLI repository-wide local maintenance', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('repairs local-only independent roots and fanout by default with GitHub disabled', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'parent');
    fixture.ok('create', 'sibling');
    fixture.commit(fixture.consumer, 'sibling.txt', 'sibling own work');
    fixture.ok('checkout', 'main');
    fixture.ok('create', 'independent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'independent.txt'),
      'independent bytes'
    );
    fixture.git(fixture.consumer, 'add', 'independent.txt');
    fixture.git(
      fixture.consumer,
      'commit',
      '--author=Original Author <original@example.test>',
      '-m',
      'Independent subject\n\nFull message body.\nSecond body line.'
    );
    const own = fixture.git(
      fixture.consumer,
      'show',
      '-s',
      '--format=%an <%ae>%n%B',
      'independent'
    );
    fixture.ok('repo', 'github', '--no-enable');
    fixture.git(fixture.producer, 'switch', 'main');
    const main = fixture.commit(
      fixture.producer,
      'main.txt',
      'new trunk bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const result = fixture.ok('sync', '--no-delete');
    for (const [branch, parent] of [
      ['parent', 'main'],
      ['child', 'parent'],
      ['sibling', 'parent'],
      ['independent', 'main'],
    ]) {
      expect(
        fixture.git(fixture.consumer, 'merge-base', branch, parent)
      ).to.equal(fixture.git(fixture.consumer, 'rev-parse', parent));
      expect(
        fixture.git(fixture.consumer, 'show', `${branch}:main.txt`)
      ).to.equal('new trunk bytes');
    }
    fixture.assertTip('main', main);
    expect(
      fixture.git(
        fixture.consumer,
        'show',
        '-s',
        '--format=%an <%ae>%n%B',
        'independent'
      )
    ).to.equal(own);
    expect(
      fixture.git(fixture.consumer, 'show', 'independent:independent.txt')
    ).to.equal('independent bytes');
    expect(
      fixture.git(fixture.remote, 'branch', '--list', 'independent', 'sibling')
    ).to.equal('');
    expect(result.output)
      .to.include('Local maintenance:')
      .and.to.include('independent')
      .and.to.include('sibling');
    const heads = fixture.git(
      fixture.consumer,
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads'
    );
    fixture.ok('sync', '--no-delete');
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads'
      )
    ).to.equal(heads);
  });
  it('refuses a late PR metadata change before replaying the pending child', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'main.txt', 'new trunk bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const marker = path.join(fixture.root, 'changed-metadata');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!${process.execPath}
const fs = require('fs');
const cp = require('child_process');
const git = (...args) => cp.execFileSync('git', args, {encoding:'utf8'}).trim();
if (!fs.existsSync(${JSON.stringify(
        marker
      )}) && git('branch','--show-current') === 'main' && git('rev-parse','parent') !== ${JSON.stringify(
        fixture.oldParent
      )}) {
  fs.writeFileSync(${JSON.stringify(marker)}, 'changed');
  const meta = JSON.parse(git('cat-file','-p','refs/branch-metadata/child'));
  meta.prInfo = {...meta.prInfo, title:'Concurrent child title'};
  const oid = cp.execFileSync('git', ['hash-object','-w','--stdin'], {input:JSON.stringify(meta), encoding:'utf8'}).trim();
  git('update-ref','refs/branch-metadata/child',oid);
}
`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sync', '--no-delete']);
    expect(fs.existsSync(marker), result.output).to.equal(true);
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('child changed')
      .and.to.include('Completed local maintenance: parent');
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    ).to.include('Concurrent child title');
  });

  it('reports already-stale independent work with explicit no-restack even without incoming nodes', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('checkout', 'main');
    fixture.ok('create', 'independent');
    const own = fixture.commit(
      fixture.consumer,
      'independent.txt',
      'unpublished bytes'
    );
    fixture.ok('checkout', 'main');
    fixture.commit(fixture.consumer, 'main.txt', 'local trunk advance');
    fixture.ok('checkout', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    const result = fixture.ok(
      'repo',
      's',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('independent', own);
    expect(result.output)
      .to.include('Pending restack:')
      .and.to.include('independent')
      .and.to.include('parent')
      .and.to.include('child');
    fixture.ok('repo', 'sync', '--no-pull', '--no-delete', '-r');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'independent', 'main')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'main'));
  });

  it('preflights an occupied local-only replay before incoming heads or trunk advance', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    const own = fixture.commit(fixture.consumer, 'local.txt', 'local bytes');
    fixture.ok('checkout', 'main');
    fixture.git(
      fixture.consumer,
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'local-work'
    );
    fixture.advanceBoth();
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'main.txt', 'new trunk bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const main = fixture.git(fixture.consumer, 'rev-parse', 'main');
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('worktree');
    fixture.assertTip('main', main);
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('local-work', own);
  });

  it('keeps frozen anchors while repairing editable descendants and protects other refs with local updateRefs true', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    fixture.ok('checkout', 'parent');
    const parent = fixture.commit(
      fixture.consumer,
      'parent.txt',
      'anchor inbound bytes'
    );
    fixture.ok('checkout', 'child');
    fixture.git(fixture.consumer, 'branch', 'out-of-scope', 'child');
    fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'main.txt', 'new trunk bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const result = fixture.ok('sync', '--no-delete');
    fixture.assertTip('parent', parent);
    fixture.assertTip('out-of-scope', fixture.oldChild);
    expect(
      fixture.git(
        fixture.consumer,
        'config',
        '--local',
        '--get',
        'rebase.updateRefs'
      )
    ).to.equal('true');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', 'parent')
    ).to.equal(parent);
    expect(fixture.git(fixture.consumer, 'show', 'child:parent.txt')).to.equal(
      'anchor inbound bytes'
    );
    expect(result.output).to.include('Unreplayed frozen work: parent');
  });

  it('retains a real maintenance conflict and names completed and pending work', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    fixture.git(fixture.producer, 'switch', 'main');
    const main = fixture.commit(
      fixture.producer,
      'child.txt',
      'trunk conflicting addition'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const result = fixture.run(['sync', '--no-delete', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('Completed local maintenance: parent')
      .and.to.include('Pending local maintenance: child')
      .and.to.include('no saved phase continuation');
    fixture.assertTip('main', main);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'main')
    ).to.equal(main);
    const rebase = fixture.git(
      fixture.consumer,
      'rev-parse',
      '--git-path',
      'rebase-merge'
    );
    expect(fs.existsSync(path.resolve(fixture.consumer, rebase))).to.equal(
      true
    );
    expect(fixture.git(fixture.consumer, 'ls-files', '--unmerged')).to.include(
      'child.txt'
    );
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
    ).to.include('<<<<<<<');
  });

  it('replays stale incoming children and unpublished descendants after feature refresh', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'local.txt', 'local descendant work');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent.txt',
      'incoming parent bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.ok('sync', '--no-pull', '--no-delete');
    fixture.assertTip('parent', parent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', 'parent')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'local-work', 'child')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'child'));
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('incoming parent bytes');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:child.txt')
    ).to.equal('child-old');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:local.txt')
    ).to.equal('local descendant work');
    expect(result.output).to.include('Local maintenance: child, local-work.');
    expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(
      fixture.oldChild
    );
    expect(
      fixture.git(fixture.remote, 'branch', '--list', 'local-work')
    ).to.equal('');
  });

  it('retains explicit boolean forms on every sync route and describes default maintenance', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    fixture.ok('checkout', 'main');
    fixture.commit(fixture.consumer, 'main.txt', 'local trunk advance');
    for (const route of [['sync'], ['repo', 'sync'], ['repo', 's']]) {
      const help = fixture.ok(...route, '--help').output;
      expect(help)
        .to.include('Repair affected tracked branches')
        .and.to.include('--no-restack');
      const result = fixture.ok(
        ...route,
        '--no-pull',
        '--no-delete',
        '--restack=false'
      );
      expect(result.output).to.include(
        'Pending restack: parent, child (--no-restack).'
      );
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('child', fixture.oldChild);
    }
    fixture.ok('sync', '--no-pull', '--no-delete', '--restack=true');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'child', 'main')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'main'));
  });
});
