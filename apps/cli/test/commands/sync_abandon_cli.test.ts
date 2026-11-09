import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// The public CLI is the seam; Git creates the real pending operation.
// eslint-disable-next-line max-lines-per-function
describe('preserving sync abandonment', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 30000;
  });
  afterEach(() => fixture?.cleanup());

  it('abandons after raw Git abort while retaining earlier refresh, files and source pins', () => {
    startConflict(fixture);
    fixture.git(fixture.consumer, 'rebase', '--abort');
    fs.writeFileSync(
      path.join(fixture.consumer, 'local.txt'),
      'keep local work'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'staged correction'
    );
    fixture.git(fixture.consumer, 'add', 'main.txt');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'unstaged correction'
    );
    fs.writeFileSync(fixture.ghCalls, '');
    const record = fs.readFileSync(recovery(fixture));
    const before = fixture.observe();
    const sources = pins(fixture);
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .to.include('Sync abandoned')
      .and.include('Recorded completed')
      .and.include('Pending');
    expect(fs.existsSync(recovery(fixture))).to.equal(false);
    const after = fixture.observe();
    expect(after).to.deep.equal({ ...Object(before), recovery: null });
    expect(pins(fixture)).to.equal(sources);
    const archive = /Archive: (.+)/.exec(result.output)?.[1];
    expect(archive).not.to.equal(undefined);
    expect(
      fs.readFileSync(path.join(archive ?? '', 'recovery.json'))
    ).to.deep.equal(record);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    const again = fixture.run(['repo', 's', '--abort']);
    expect(again.status, again.output).to.equal(0);
    expect(again.output).to.include('No pending sync');
  });
  it('quits its live rebase while preserving conflicts, detached HEAD and all local work', () => {
    startConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'local.txt'),
      'keep untracked'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'staged correction'
    );
    fixture.git(fixture.consumer, 'add', 'main.txt');
    fs.writeFileSync(fixture.ghCalls, '');
    const before = fixture.observe();
    const sources = pins(fixture);
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .to.include('Sync abandoned')
      .and.include('Remaining index conflicts: parent.txt')
      .and.include('detached HEAD');
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
      rebase: false,
      rebaseFiles: null,
    });
    expect(pins(fixture)).to.equal(sources);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });

  it('preserves manual staged and unstaged resolutions even when participants became frozen or occupied', () => {
    startConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved manually'
    );
    fixture.git(fixture.consumer, 'add', 'parent.txt');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'unstaged followup'
    );
    fixture.ok('freeze', 'local-work');
    const occupied = path.join(fixture.root, 'occupied');
    fixture.git(fixture.consumer, 'worktree', 'add', occupied, 'child');
    const before = fixture.observe();
    const result = fixture.run(['repo', 'sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
      rebase: false,
      rebaseFiles: null,
    });
    expect(result.output).to.include('Remaining index conflicts: none');
    expect(fixture.git(occupied, 'status', '--porcelain')).to.equal('');
  });

  it('retains an owned autostash without applying it or losing the existing user stash', () => {
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'earlier user stash'
    );
    fixture.git(fixture.consumer, 'stash', 'push', '-m', 'keep user stash');
    const earlier = fixture.git(fixture.consumer, 'rev-parse', 'refs/stash');
    installAutostashActor(fixture);
    startConflict(fixture);
    const marker = path.join(
      fixture.consumer,
      '.git',
      'rebase-merge',
      'autostash'
    );
    expect(fs.existsSync(marker)).to.equal(true);
    const stash = fs.readFileSync(marker, 'utf8').trim();
    const before = fixture.observe();
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include(
      'Owned autostash retained without applying/discarding'
    );
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
      rebase: false,
      rebaseFiles: null,
    });
    const stashes = fixture
      .git(fixture.consumer, 'stash', 'list', '--format=%H')
      .split('\n');
    expect(stashes).to.include(earlier).and.include(stash);
    expect(fixture.git(fixture.consumer, 'show', `${stash}:main.txt`)).to.equal(
      'owned-autostash-work'
    );
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(objectname)',
        'refs/gt-metadata/sync-abandonment'
      )
    ).to.equal(stash);
  });

  it('preserves competing recovery written while retaining its autostash before quit', () => {
    installAutostashActor(fixture);
    startConflict(fixture);
    const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref" in refs/gt-metadata/sync-abandonment/*) printf '%s' '${foreign}' > "$(git rev-parse --git-common-dir)/.gtcontinue";; esac\n done\nfi\n`,
      { mode: 0o755 }
    );
    const before = fixture.observe();
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('competing recovery preserved')
      .and.include('Archive:');
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: Buffer.from(foreign).toString('base64'),
    });
    expect(fs.readFileSync(recovery(fixture), 'utf8')).to.equal(foreign);
  });

  for (const change of ['content', 'symlink'])
    it(`refuses an autostash marker replaced by ${change} while retaining evidence`, () => {
      installAutostashActor(fixture);
      startConflict(fixture);
      const marker = path.join(
        fixture.consumer,
        '.git',
        'rebase-merge',
        'autostash'
      );
      const replace =
        change === 'content'
          ? `printf '%s' '${fixture.oldParent}' > "$(git rev-parse --git-path rebase-merge)/autostash"`
          : 'rm "$(git rev-parse --git-path rebase-merge)/autostash"; ln -s ../missing-autostash "$(git rev-parse --git-path rebase-merge)/autostash"';
      fs.writeFileSync(
        path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
        `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref" in refs/gt-metadata/sync-abandonment/*) ${replace};; esac\n done\nfi\n`,
        { mode: 0o755 }
      );
      const before = fixture.observe();
      const result = fixture.run(['sync', '--abort']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Owned autostash changed before quit');
      if (change === 'content')
        expect(fs.readFileSync(marker, 'utf8')).to.equal(fixture.oldParent);
      else expect(fs.lstatSync(marker).isSymbolicLink()).to.equal(true);
      const after = fixture.observe();
      const observe = (value: unknown): object => {
        if (typeof value !== 'object' || value === null)
          throw new Error('Expected observation');
        const files = Reflect.get(value, 'rebaseFiles');
        if (typeof files !== 'object' || files === null)
          throw new Error('Expected active rebase');
        Reflect.deleteProperty(files, 'autostash');
        return value;
      };
      expect(observe(after)).to.deep.equal(observe(before));
    });

  for (const marker of ['onto', 'orig-head', 'head-name'])
    it(`refuses a replaced active rebase ${marker} without quitting`, () => {
      startConflict(fixture);
      fs.writeFileSync(
        path.join(fixture.consumer, '.git', 'rebase-merge', marker),
        marker === 'head-name' ? 'refs/heads/parent' : '0'.repeat(40)
      );
      const before = fixture.observe();
      const result = fixture.run(['sync', '--abort']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('No matching owned active sync rebase');
      expect(fixture.observe()).to.deep.equal(before);
    });

  it('keeps owned recovery and archive after Git refuses to quit', () => {
    startConflict(fixture);
    const directory = path.join(fixture.consumer, '.git', 'rebase-merge');
    fs.chmodSync(directory, 0o500);
    try {
      const before = fixture.observe();
      const result = fixture.run(['sync', '--abort']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output)
        .to.include('abandonment incomplete')
        .and.include('Saved sync gate: still present')
        .and.include('Archive:');
      expect(fixture.observe()).to.deep.equal(before);
    } finally {
      fs.chmodSync(directory, 0o700);
    }
  });

  it('keeps normal continuation available when abandonment is not chosen', () => {
    startConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved normal continuation'
    );
    fixture.ok('continue', '--all');
    expect(fs.existsSync(recovery(fixture))).to.equal(false);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved normal continuation');
  });

  it('keeps completed cleanup deletion and earlier maintenance when abandoning a later conflict', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.git(fixture.consumer, 'switch', 'parent');
    fixture.ok('create', 'early-maintenance');
    fixture.commit(fixture.consumer, 'early.txt', 'earlier maintenance');
    fixture.git(fixture.consumer, 'switch', 'parent');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'parent.txt', 'later conflict');
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'incoming parent');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'CLOSED' } },
    });
    const start = fixture.run(['sync', '--delete-all']);
    expect(start.status, start.output).to.equal(1);
    expect(start.output, start.output).to.include(
      'Hit conflict restacking local-work'
    );
    expect(fixture.git(fixture.consumer, 'branch', '--list', 'child')).to.equal(
      ''
    );
    const before = fixture.observe();
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .to.include('Recorded completed cleanup deletions: child')
      .and.include('Recorded completed maintenance: early-maintenance');
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
      rebase: false,
      rebaseFiles: null,
    });
  });

  it('reports changed participants and missing pins without replaying them', () => {
    startConflict(fixture);
    fixture.git(fixture.consumer, 'rebase', '--abort');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.consumer, 'update-ref', '-d', 'refs/heads/local-work');
    const source = pins(fixture).split('\n')[0].split(' ')[0];
    fixture.git(fixture.consumer, 'update-ref', '-d', source);
    const before = fixture.observe();
    const result = fixture.run(['repo', 'sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .to.include('missing/changed): local-work')
      .and.include(source);
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
    });
  });

  it('rejects every explicitly combined sync option before creating evidence or changing work', () => {
    for (const flag of [
      '--pull',
      '--no-pull',
      '--delete',
      '--no-delete',
      '--delete-all',
      '--force=false',
      '--no-restack',
      '--show-delete-progress',
      '-f',
      '-r',
    ]) {
      const before = fixture.observe();
      const result = fixture.run(['sync', '--abort', flag]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('--abort cannot be combined');
      expect(fixture.observe()).to.deep.equal(before);
    }
  });

  for (const invalid of [
    'malformed',
    'mixed',
    'digest',
    'repository',
    'remote',
    'worktree',
    'active rebase',
    'foreign merge',
    'archive collision',
  ])
    it(`preserves state for ${invalid}`, () => {
      startConflict(fixture);
      if (invalid !== 'active rebase')
        fixture.git(fixture.consumer, 'rebase', '--abort');
      else
        fs.writeFileSync(
          path.join(
            fixture.consumer,
            '.git',
            'rebase-merge',
            'charcoal-continuation'
          ),
          'foreign'
        );
      if (invalid === 'malformed') fs.writeFileSync(recovery(fixture), '{');
      if (invalid === 'mixed') {
        const value: unknown = fs.readJsonSync(recovery(fixture));
        if (typeof value !== 'object' || value === null)
          throw new Error('Expected record');
        Reflect.set(value, 'absorb', {
          directory: 'foreign',
          source: 'main',
          mandatory: [],
          completed: [],
        });
        fs.writeJsonSync(recovery(fixture), value);
      }
      if (invalid === 'digest') {
        const value: unknown = fs.readJsonSync(recovery(fixture));
        if (typeof value !== 'object' || value === null)
          throw new Error('Expected record');
        Reflect.set(value, 'branchesToRestack', ['foreign']);
        fs.writeJsonSync(recovery(fixture), value);
      }
      if (invalid === 'repository') {
        const config = path.join(
          fixture.consumer,
          '.git',
          '.graphite_repo_config'
        );
        fs.writeFileSync(
          config,
          fs
            .readFileSync(config, 'utf8')
            .replace('get-fixture', 'foreign-owner')
        );
      }
      if (invalid === 'remote')
        fixture.git(
          fixture.consumer,
          'remote',
          'set-url',
          'origin',
          path.join(fixture.root, 'foreign.git')
        );
      if (invalid === 'worktree') {
        const other = path.join(fixture.root, 'other');
        fixture.git(
          fixture.consumer,
          'worktree',
          'add',
          '--detach',
          other,
          'main'
        );
        fixture.cwd = other;
      }
      if (invalid === 'foreign merge')
        fs.writeFileSync(
          path.join(fixture.consumer, '.git', 'MERGE_HEAD'),
          fixture.oldParent + '\n'
        );
      if (invalid === 'archive collision')
        fs.writeFileSync(
          path.join(fixture.consumer, '.git', 'anthracite-sync-abandonment'),
          'foreign archive'
        );
      fs.writeFileSync(fixture.ghCalls, '');
      const before = fixture.observe();
      const result = fixture.run(['sync', '--abort']);
      expect(result.status, result.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    });

  it('does not clear another workflow or quit raw Git when no sync is pending', () => {
    fs.writeFileSync(
      recovery(fixture),
      JSON.stringify({
        branchesToSync: [],
        branchesToRestack: [],
        insert: { branch: 'child', mandatory: ['child'], completed: [] },
      })
    );
    fs.ensureDirSync(path.join(fixture.consumer, '.git', 'rebase-merge'));
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'rebase-merge', 'head-name'),
      'refs/heads/child'
    );
    const before = fixture.observe();
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('No pending sync');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('abandons a genuine pre-conflict publication failure without requiring a new recovery format', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    const old = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/parent'
    );
    fs.writeJsonSync(fixture.details, { parent: 'new planned title' });
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n if [ "$ref" = refs/branch-metadata/parent ]; then git -c core.hooksPath=/dev/null update-ref "$ref" ${old}; fi\n done\nfi\n`,
      { mode: 0o755 }
    );
    const start = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('PR publication changed');
    const original = fs.readFileSync(recovery(fixture));
    const value: unknown = fs.readJsonSync(recovery(fixture));
    if (typeof value !== 'object' || value === null)
      throw new Error('Expected record');
    Reflect.set(value, 'delete', { branch: 'foreign', mandatory: ['child'] });
    fs.writeJsonSync(recovery(fixture), value);
    const mixed = fixture.observe();
    const refusal = fixture.run(['sync', '--abort']);
    expect(refusal.status, refusal.output).to.equal(1);
    expect(refusal.output).to.include('foreign cleanup');
    expect(fixture.observe()).to.deep.equal(mixed);
    fs.writeFileSync(recovery(fixture), original);
    fs.writeFileSync(fixture.ghCalls, '');
    const before = fixture.observe();
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
    });
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });

  const legacy = process.env.ANTHRACITE_TEST_SYNC_LEGACY_BINARY;
  (legacy ? it : it.skip)(
    'npm legacy: abandons an unchanged version-1 record from public 0.6.14',
    () => {
      const current = process.env.ANTHRACITE_TEST_BINARY;
      try {
        fixture.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${
          fixture.env.PATH
        }`;
        process.env.ANTHRACITE_TEST_BINARY = legacy;
        expect(fixture.ok('--version').output).to.include('0.6.14');
        startConflict(fixture);
      } finally {
        if (current === undefined) delete process.env.ANTHRACITE_TEST_BINARY;
        else process.env.ANTHRACITE_TEST_BINARY = current;
      }
      fixture.git(fixture.consumer, 'rebase', '--abort');
      const record = fs.readFileSync(recovery(fixture));
      const result = fixture.run(['sync', '--abort']);
      expect(result.status, result.output).to.equal(0);
      const archive = /Archive: (.+)/.exec(result.output)?.[1];
      expect(
        fs.readFileSync(path.join(archive ?? '', 'recovery.json'))
      ).to.deep.equal(record);
    }
  );
});

function recovery(fixture: FrozenGetFixture): string {
  return path.join(fixture.consumer, '.git', '.gtcontinue');
}
function pins(fixture: FrozenGetFixture): string {
  return fixture.git(
    fixture.consumer,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    'refs/gt-metadata/get'
  );
}
function startConflict(fixture: FrozenGetFixture): void {
  fixture.ok('unfreeze', 'child');
  fixture.ok('create', 'local-work');
  fixture.commit(fixture.consumer, 'parent.txt', 'local conflict');
  fixture.git(fixture.consumer, 'switch', 'main');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'parent.txt', 'incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  const start = fixture.run(['sync', '--no-delete']);
  expect(start.status, start.output).to.equal(1);
  expect(start.output, start.output).to.include('Hit conflict');
}

function installAutostashActor(fixture: FrozenGetFixture): void {
  fixture.git(fixture.consumer, 'config', 'rebase.autoStash', 'true');
  // Delegate real Git unchanged; inject a concurrent edit just before the actual replay.
  fs.writeFileSync(
    path.join(fixture.bin, 'git'),
    '#!/bin/sh\nis_rebase=false\nlast_arg=\nfor arg do\n [ "$arg" = rebase ] && is_rebase=true\n last_arg=$arg\ndone\nif $is_rebase && [ "$last_arg" = local-work ]; then printf owned-autostash-work > main.txt; fi\nexec /usr/bin/git "$@"\n',
    { mode: 0o755 }
  );
}
