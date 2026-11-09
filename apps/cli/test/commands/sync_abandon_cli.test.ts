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

  const legacy = process.env.ANTHRACITE_TEST_LEGACY_BINARY;
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
  expect(start.output).to.include('Hit conflict');
}
