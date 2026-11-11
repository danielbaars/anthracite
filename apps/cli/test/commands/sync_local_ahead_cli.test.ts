import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Only gh responses are controlled; sync and all Git state use public processes.
// eslint-disable-next-line max-lines-per-function
describe('sync CLI unpublished local commits', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.ok('unfreeze', 'child');
  });
  afterEach(() => fixture?.cleanup());

  it('keeps same-parent local-ahead history without reconciliation or publication', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'unpublished correction');
    fixture.git(
      fixture.consumer,
      'commit',
      '--amend',
      '--author',
      'Local Contributor <local@example.test>',
      '-m',
      'Keep this correction\n\nComplete local explanation.'
    );
    const head = fixture.git(fixture.consumer, 'rev-parse', 'child');
    const heads = fixture.git(
      fixture.consumer,
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads'
    );
    const index = fixture.git(fixture.consumer, 'ls-files', '--stage');
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );

    fixture.assertTip('child', head);
    expect(result.output).to.include('child').and.to.include('unpublished');
    expect(result.output).to.include("an submit --branch 'child' --dry-run");
    expect(result.output).not.to.include('How would you like to handle');
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%an <%ae>%n%B')
    ).to.equal(
      'Local Contributor <local@example.test>\nKeep this correction\n\nComplete local explanation.'
    );
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads'
      )
    ).to.equal(heads);
    expect(fixture.git(fixture.consumer, 'ls-files', '--stage')).to.equal(
      index
    );
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    fixture.status('child', false);
  });

  it('explains different histories without attributing a remote edit or applying them', () => {
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'unpublished local correction'
    );
    const remote = fixture.advanceChild();
    const before = fixture.observe();

    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
      '--debug',
    ]);

    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(
      'Local and remote histories differ for child'
    );
    expect(result.output).to.include(
      'may include an unpublished local restack'
    );
    expect(result.output).to.include(local).and.to.include(remote);
    expect(result.output).not.to.include('shares a name with a local branch');
    expect(result.output).to.include('does not authorize feature overwrite');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('keeps local-ahead commits in a terminal without prompting', () => {
    const head = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    const result = fixture.run(
      ['sync', '--no-pull', '--no-delete', '--no-restack'],
      true
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('How would you like to handle');
    expect(result.output).to.include('unpublished local history');
    fixture.assertTip('child', head);
    fixture.assertTip('parent', fixture.oldParent);
  });

  it('retains frozen local-ahead work even when force supplies no feature overwrite authority', () => {
    const head = fixture.commit(fixture.consumer, 'local.txt', 'frozen work');
    fixture.ok('freeze', 'child');
    fixture.ok('sync', '--force', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('child', head);
    fixture.status('child');
    expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(
      fixture.oldChild
    );
  });

  it('still refuses a changed parent instead of preserving solely by head ancestry', () => {
    const head = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    fs.writeFileSync(
      fixture.prs,
      JSON.stringify({ parent: 'main', child: 'main' })
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('different parents');
    fixture.assertTip('child', head);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('preserves the whole reached state when terminal reconciliation is declined', () => {
    fixture.commit(fixture.consumer, 'local.txt', 'local change');
    fixture.advanceChild();
    const before = fixture.observe();
    const result = fixture.run(
      ['sync', '--no-pull', '--no-delete', '--no-restack'],
      true,
      [
        {
          prompt: 'How would you like to handle',
          input: '\u001b[B\u001b[B\r',
        },
      ]
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Local and remote histories differ');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('keeps a preserved branch protected against occupied worktrees', () => {
    const head = fixture.commit(fixture.consumer, 'local.txt', 'occupied work');
    fixture.ok('checkout', 'main');
    fixture.git(
      fixture.consumer,
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'child'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('worktree');
    fixture.assertTip('child', head);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('retains local commits through required replay and fresh-process continuation', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.commit(fixture.consumer, 'main.txt', 'local conflict correction');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'main.txt', 'new trunk conflict');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const remote = fixture.git(fixture.remote, 'show-ref');
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Hit conflict restacking child');
    expect(result.output).to.include('keeping local history');
    expect(
      fixture.git(fixture.consumer, 'diff', '--name-only', '--diff-filter=U')
    ).to.equal('main.txt');
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'deliberate resolution retaining both corrections'
    );
    fixture.ok('continue', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:main.txt')).to.equal(
      'deliberate resolution retaining both corrections'
    );
    expect(fixture.git(fixture.consumer, 'log', '-1', '--format=%B')).to.equal(
      'local conflict correction'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(false);
    expect(
      fixture.git(fixture.consumer, 'for-each-ref', 'refs/gt-metadata/get')
    ).to.equal('');
  });

  it('keeps get reconciliation unchanged for the same local-ahead input', () => {
    const head = fixture.commit(fixture.consumer, 'local.txt', 'local work');
    const before = fixture.observe();
    const result = fixture.run(['get', 'child', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('shares a name with a local branch');
    expect(result.output).not.to.include('keeping local history');
    fixture.assertTip('child', head);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses a kept head changed while another branch choice is open', () => {
    fixture.ok('unfreeze', 'parent');
    const child = fixture.commit(fixture.consumer, 'local.txt', 'child work');
    fixture.git(fixture.consumer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.consumer,
      'parent-local.txt',
      'parent local work'
    );
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'incoming parent change');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const remote = fixture.git(fixture.remote, 'show-ref');
    const main = fixture.git(fixture.consumer, 'rev-parse', 'main');

    const result = fixture.run(
      ['sync', '--no-pull', '--no-delete', '--no-restack'],
      true,
      [
        {
          prompt: 'How would you like to handle',
          input: '\r',
          beforeInput: [
            'git',
            '-C',
            fixture.consumer,
            'commit',
            '--allow-empty',
            '-m',
            'concurrent local work',
          ],
        },
      ]
    );

    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('child').and.to.include('changed');
    fixture.assertTip('parent', parent);
    fixture.assertTip('main', main);
    expect(fixture.git(fixture.consumer, 'rev-parse', 'child')).not.to.equal(
      child
    );
    expect(fixture.git(fixture.consumer, 'log', '-1', '--format=%s')).to.equal(
      'concurrent local work'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
      'child work'
    );
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(false);
  });

  it('quotes shell-significant literal branch names in the publication preview', () => {
    const branch = "topic'$HOME;tail";
    fixture.git(fixture.producer, 'switch', '-c', branch, 'child');
    fixture.commit(fixture.producer, 'topic.txt', 'published topic');
    fixture.git(fixture.producer, 'push', 'origin', branch);
    fs.writeFileSync(
      fixture.prs,
      JSON.stringify({ parent: 'main', child: 'parent', [branch]: 'child' })
    );
    fixture.ok('get', branch, '--unfrozen');
    const head = fixture.commit(fixture.consumer, 'local.txt', 'local topic');
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );
    expect(result.output).to.include(
      "an submit --branch 'topic'\\''$HOME;tail' --dry-run"
    );
    fixture.assertTip(branch, head);
  });
});
