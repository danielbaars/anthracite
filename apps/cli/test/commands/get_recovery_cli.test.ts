import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Each case exercises a separate public process workflow.
// eslint-disable-next-line max-lines-per-function
describe('get CLI owned graph recovery', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('finishes maintenance in a fresh process before restoring the saved original branch', () => {
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
    const result = fixture.run(['get', 'parent', '--no-checkout']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Hit conflict');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved both'
    );
    fixture.ok('continue', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'local-work')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved both');
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname)',
        'refs/gt-metadata/get'
      )
    ).to.equal('');
  });
  it('resumes fanout from pinned sources with correct sibling parents and exact detached restoration', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.producer, 'switch', '-c', 'sibling', 'parent');
    const sibling = fixture.commit(
      fixture.producer,
      'sibling.txt',
      'planned sibling'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      sibling: 'parent',
    });
    fixture.ok('get', 'sibling', '-U');
    fixture.git(fixture.consumer, 'switch', 'parent');
    const local = fixture.commit(
      fixture.consumer,
      'conflict.txt',
      'local parent'
    );
    fixture.git(fixture.consumer, 'branch', 'unrelated-alias', local);
    fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
    fixture.git(fixture.consumer, 'switch', '--detach', 'main');
    const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    fixture.git(fixture.producer, 'switch', 'parent');
    const incoming = fixture.commit(
      fixture.producer,
      'conflict.txt',
      'incoming parent'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const start = fixture.run(['get', 'parent', '--no-checkout'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('Hit conflict');
    fixture.git(fixture.producer, 'switch', 'sibling');
    fixture.commit(fixture.producer, 'later.txt', 'not part of snapshot');
    fixture.git(fixture.producer, 'push', 'origin', 'sibling');
    fs.writeFileSync(fixture.ghCalls, '');
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved parent'
    );
    fixture.ok('cont', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    fixture.assertTip('HEAD', original);
    fixture.assertTip('unrelated-alias', local);
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', incoming)
    ).to.equal(incoming);
    expect(fixture.ok('info', 'sibling').output).to.include('Parent: parent');
    expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'sibling')
    ).to.equal(fixture.git(fixture.consumer, 'rev-parse', 'parent'));
    expect(
      fixture.git(fixture.consumer, 'show', 'sibling:sibling.txt')
    ).to.equal('planned sibling');
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'sibling')
    ).not.to.include('later.txt');
    expect(
      fixture.git(fixture.consumer, 'merge-base', sibling, 'parent')
    ).not.to.equal(sibling);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });

  it('refuses changed saved checkout authority before staging or advancing the queue', () => {
    startMaintenanceConflict(fixture);
    fs.writeFileSync(
      recoveryFile(fixture),
      fs
        .readFileSync(recoveryFile(fixture), 'utf8')
        .replace('"shouldCheckout": false', '"shouldCheckout": true')
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved bytes'
    );
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('saved get intent changed');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('preserves a raw-aborted owned queue and refuses before continue --all or a new get', () => {
    startMaintenanceConflict(fixture);
    fixture.git(fixture.consumer, 'rebase', '--abort');
    fs.writeFileSync(
      path.join(fixture.consumer, 'unstaged.txt'),
      'do not stage'
    );
    const recovery = fs.readFileSync(recoveryFile(fixture), 'utf8');
    const before = fixture.observe();
    for (const args of [
      ['continue', '--all'],
      ['get', 'parent'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('recovery preserved');
      expect(fs.readFileSync(recoveryFile(fixture), 'utf8')).to.equal(recovery);
      expect(fixture.observe()).to.deep.equal(before);
    }
    expect(() =>
      fixture.git(
        fixture.consumer,
        'rebase',
        '--onto',
        'parent',
        'child',
        'local-work'
      )
    ).to.throw();
    const rawState = fixture.observe();
    const raw = fixture.run(['continue', '--all']);
    expect(raw.status, raw.output).to.equal(1);
    expect(raw.output).to.include('No matching owned active get rebase');
    expect(fixture.observe()).to.deep.equal(rawState);
  });

  it('refuses a newly frozen pending replay before --all stages resolutions or unrelated files', () => {
    startMaintenanceConflict(fixture, true);
    fixture.ok('freeze', 'pending');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved parent'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'unstaged.txt'),
      'do not stage'
    );
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('an unfreeze pending');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('refuses a different linked worktree before staging the original worktree conflict', () => {
    startMaintenanceConflict(fixture);
    const other = path.join(fixture.root, 'other');
    fixture.git(fixture.consumer, 'worktree', 'add', '--detach', other, 'main');
    const before = fixture.observe();
    fixture.cwd = other;
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('original worktree');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(other, 'status', '--porcelain')).to.equal('');
  });

  it('finds foreign common-dir recovery from a linked worktree without clearing it', () => {
    const other = path.join(fixture.root, 'other');
    fixture.git(fixture.consumer, 'worktree', 'add', '--detach', other, 'main');
    const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
    fs.writeFileSync(recoveryFile(fixture), foreign);
    const before = fixture.observe();
    fixture.cwd = other;
    const result = fixture.run(['get', 'parent']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('existing operation');
    expect(fs.readFileSync(recoveryFile(fixture), 'utf8')).to.equal(foreign);
    expect(fixture.observe()).to.deep.equal(before);
  });

  for (const command of ['get', 'continue'])
    it(`preserves malformed recovery JSON before ${command} can clear it`, () => {
      const invalid = '{"get":';
      fs.writeFileSync(recoveryFile(fixture), invalid);
      const before = fixture.observe();
      const result = fixture.run(
        command === 'get' ? ['get', 'parent'] : ['continue', '--all']
      );
      expect(result.status, result.output).to.equal(1);
      expect(fs.readFileSync(recoveryFile(fixture), 'utf8')).to.equal(invalid);
      expect(fixture.observe()).to.deep.equal(before);
    });

  it('refuses missing pinned sources before --all stages resolutions', () => {
    startMaintenanceConflict(fixture);
    const source = fixture
      .git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname)',
        'refs/gt-metadata/get'
      )
      .split('\n')[0];
    fixture.git(fixture.consumer, 'update-ref', '-d', source);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved bytes'
    );
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('missing or changed');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('preserves a foreign record written by the final checkout hook and retains its source pins', () => {
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'new.txt',
      'incoming bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then printf '%s' '${foreign}' > "$(git rev-parse --git-common-dir)/.gtcontinue"; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'get',
      'parent',
      '--downstack',
      '--no-restack',
      '--no-checkout',
      '--quiet',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('foreign recovery');
    expect(fs.readFileSync(recoveryFile(fixture), 'utf8')).to.equal(foreign);
    fixture.assertTip('parent', parent);
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname)',
        'refs/gt-metadata/get'
      )
    ).not.to.equal('');
  });

  it('does not resume a completed replay with failed metadata publication as a live rebase', () => {
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'new.txt', 'incoming bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-rewrite'),
      '#!/bin/sh\nmkdir -p "$(git rev-parse --git-path refs/branch-metadata)"\ntouch "$(git rev-parse --git-path refs/branch-metadata/child.lock)"\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'parent', '--downstack']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('metadata publication failed');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    const before = fixture.observe();
    const resumed = fixture.run(['continue', '--all']);
    expect(resumed.status, resumed.output).to.equal(1);
    expect(resumed.output).to.include('No matching owned active get rebase');
    expect(fixture.observe()).to.deep.equal(before);
  });
  for (const removed of ['role', 'file'])
    it(`refuses a removed get ${removed} while its active rebase binding remains before staging`, () => {
      startMaintenanceConflict(fixture);
      if (removed === 'file') fs.removeSync(recoveryFile(fixture));
      else {
        const record: unknown = fs.readJsonSync(recoveryFile(fixture));
        if (typeof record !== 'object' || record === null)
          throw new Error('Expected recovery object');
        Reflect.deleteProperty(record, 'get');
        fs.writeJsonSync(recoveryFile(fixture), record);
      }
      fs.writeFileSync(
        path.join(fixture.consumer, 'parent.txt'),
        'resolved bytes'
      );
      const before = fixture.observe();
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('get intent is missing');
      expect(fixture.observe()).to.deep.equal(before);
    });

  it('checks an occupied pending replay before --all touches the active index', () => {
    startMaintenanceConflict(fixture, true);
    const other = path.join(fixture.root, 'other');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'pending');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved bytes'
    );
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(other);
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(other, 'status', '--porcelain')).to.equal('');
  });

  it('refuses changed repository identity before staging and retains the saved workflow', () => {
    startMaintenanceConflict(fixture);
    const config = path.join(fixture.consumer, '.git', '.graphite_repo_config');
    fs.writeFileSync(
      config,
      fs.readFileSync(config, 'utf8').replace('get-fixture', 'other-owner')
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved bytes'
    );
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('configured repository');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('keeps saved no-restack authority and default target checkout after reconciliation', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.git(fixture.consumer, 'switch', 'parent');
    fixture.commit(fixture.consumer, 'conflict.txt', 'local bytes');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'conflict.txt', 'remote bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const start = fixture.run(
      ['get', 'parent', '--downstack', '--no-restack'],
      true,
      [{ prompt: 'How would you like to handle', input: '\r' }]
    );
    expect(start.status, start.output).to.equal(1);
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved bytes'
    );
    const result = fixture.ok('continue', '--all');
    expect(result.output).to.include('Pending restack: child');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'parent'
    );
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'show', 'parent:conflict.txt')
    ).to.equal('resolved bytes');
  });
  it('refuses foreign legacy mirror work before --all stages or consumes an otherwise valid get role', () => {
    startMaintenanceConflict(fixture);
    const record: unknown = fs.readJsonSync(recoveryFile(fixture));
    if (typeof record !== 'object' || record === null)
      throw new Error('Expected recovery object');
    Reflect.set(record, 'branchesToSync', ['foreign-legacy-work']);
    fs.writeJsonSync(recoveryFile(fixture), record);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved bytes'
    );
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('saved get intent changed');
    expect(fixture.observe()).to.deep.equal(before);
  });
});

function recoveryFile(fixture: FrozenGetFixture): string {
  return path.join(fixture.consumer, '.git', '.gtcontinue');
}
function startMaintenanceConflict(
  fixture: FrozenGetFixture,
  pending = false
): void {
  fixture.ok('unfreeze', 'child');
  fixture.ok('create', 'local-work');
  fixture.commit(fixture.consumer, 'parent.txt', 'local conflict');
  if (pending) {
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.ok('create', 'pending');
    fixture.commit(fixture.consumer, 'pending.txt', 'pending bytes');
  }
  fixture.git(fixture.consumer, 'switch', 'main');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'parent.txt', 'incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  const result = fixture.run(['get', 'parent', '--no-checkout']);
  expect(result.status, result.output).to.equal(1);
  expect(result.output).to.include('Hit conflict');
}
