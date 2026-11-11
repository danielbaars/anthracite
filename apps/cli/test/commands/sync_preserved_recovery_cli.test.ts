import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Every operation uses public processes and real Git; only gh is controlled.
// eslint-disable-next-line max-lines-per-function
describe('sync recovery with preserved unpublished work', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 30000;
  });
  afterEach(() => fixture?.cleanup());
  const legacyCase = process.env.ANTHRACITE_SYNC_LEGACY_BINARY ? it : it.skip;

  legacyCase(
    'released 0.7.0 refuses a preserved plan without staging or consuming it',
    () => {
      startPreservedConflict(fixture);
      resolvePreservedConflict(fixture);
      fs.writeFileSync(
        path.join(fixture.consumer, 'untracked.txt'),
        'do not stage'
      );
      const before = fixture.observe();
      const sources = sourcePins(fixture);
      const result = withReleasedCli(() => fixture.run(['continue', '--all']));
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Sync recovery preserved');
      expect(fixture.observe()).to.deep.equal(before);
      expect(sourcePins(fixture)).to.equal(sources);
      fs.removeSync(path.join(fixture.consumer, 'untracked.txt'));
      fixture.ok('continue', '--all');
      expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
    }
  );

  legacyCase(
    'continues an unmodified released record with its explicit rebase choice',
    () => {
      withReleasedCli(() => startIncomingConflict(fixture));
      const record = z
        .object({
          sync: z.object({
            version: z.literal(1),
            refresh: z.object({
              preserved: z.array(z.string()).optional(),
              nodes: z.array(
                z.object({
                  branchName: z.string(),
                  resolution: z.string().optional(),
                })
              ),
            }),
          }),
        })
        .parse(fs.readJsonSync(recoveryFile(fixture)));
      expect(record.sync.refresh.preserved).to.equal(undefined);
      expect(
        record.sync.refresh.nodes.find((entry) => entry.branchName === 'parent')
          ?.resolution
      ).to.equal('REBASE');
      fs.writeFileSync(
        path.join(fixture.consumer, 'conflict.txt'),
        'deliberate incoming resolution'
      );
      fixture.ok('continue', '--all');
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('child');
      expect(
        fixture.git(fixture.consumer, 'show', 'parent:conflict.txt')
      ).to.equal('deliberate incoming resolution');
      expect(
        fixture.git(fixture.consumer, 'log', 'parent', '--format=%s')
      ).to.include('local incoming conflict');
      expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
      expect(sourcePins(fixture)).to.equal('');
    }
  );

  legacyCase(
    'keeps an explicit overwrite from an unmodified released record',
    () => {
      withReleasedCli(() => {
        fixture.ok('unfreeze', 'parent');
        fixture.ok('unfreeze', 'child');
        fixture.git(fixture.consumer, 'switch', 'parent');
        fixture.commit(
          fixture.consumer,
          'discarded.txt',
          'explicitly overwritten work'
        );
        fixture.ok('create', 'local-work');
        fixture.commit(
          fixture.consumer,
          'parent.txt',
          'local maintenance conflict'
        );
        fixture.git(fixture.consumer, 'switch', 'child');
        fixture.git(fixture.producer, 'switch', 'parent');
        fixture.commit(
          fixture.producer,
          'parent.txt',
          'remote maintenance conflict'
        );
        fixture.git(fixture.producer, 'push', 'origin', 'parent');
        const start = fixture.run(['sync', '--no-delete'], true, [
          { prompt: 'How would you like to handle', input: '\u001b[B\r' },
        ]);
        expect(start.status, start.output).to.equal(1);
        expect(start.output).to.include('Hit conflict restacking local-work');
      });
      const record = z
        .object({
          sync: z.object({
            refresh: z.object({
              nodes: z.array(
                z.object({
                  branchName: z.string(),
                  resolution: z.string().optional(),
                })
              ),
            }),
          }),
        })
        .parse(fs.readJsonSync(recoveryFile(fixture)));
      expect(
        record.sync.refresh.nodes.find((entry) => entry.branchName === 'parent')
          ?.resolution
      ).to.equal('OVERWRITE');
      fs.writeFileSync(
        path.join(fixture.consumer, 'parent.txt'),
        'resolved maintenance'
      );
      fixture.ok('continue', '--all');
      expect(fixture.git(fixture.consumer, 'rev-parse', 'parent')).to.equal(
        fixture.git(fixture.producer, 'rev-parse', 'parent')
      );
      expect(
        fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'parent')
      ).not.to.include('discarded.txt');
      expect(
        fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
      ).to.equal('resolved maintenance');
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('child');
    }
  );

  it('continues the pinned plan after a preserved branch remote advances', () => {
    startPreservedConflict(fixture);
    const message = fixture.git(
      fixture.consumer,
      'log',
      '-1',
      '--format=%an <%ae>%n%B',
      'child'
    );
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.commit(fixture.producer, 'later.txt', 'outside the saved plan');
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    const remote = fixture.git(fixture.remote, 'show-ref');
    fs.writeFileSync(fixture.ghCalls, '');
    resolvePreservedConflict(fixture);
    fixture.ok('continue', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:main.txt')).to.equal(
      'deliberate resolution preserving both corrections'
    );
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%an <%ae>%n%B')
    ).to.equal(message);
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'child')
    ).not.to.include('later.txt');
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
    expect(sourcePins(fixture)).to.equal('');
  });

  for (const change of [
    'source',
    'metadata',
    'freeze',
    'occupied',
    'record',
    'decision',
  ])
    it(`refuses changed ${change} before staging a preserved conflict`, () => {
      startPreservedConflict(fixture);
      if (change === 'source') {
        const source = sourcePins(fixture).split('\n')[0].split(' ')[0];
        fixture.git(fixture.consumer, 'update-ref', '-d', source);
      }
      if (change === 'metadata')
        fixture.git(
          fixture.consumer,
          'update-ref',
          'refs/branch-metadata/child',
          fixture.git(
            fixture.consumer,
            'rev-parse',
            'refs/branch-metadata/parent'
          )
        );
      if (change === 'freeze') fixture.ok('freeze', 'child');
      if (change === 'occupied')
        fixture.git(
          fixture.consumer,
          'worktree',
          'add',
          '--force',
          path.join(fixture.root, 'occupied'),
          'child'
        );
      if (change === 'record' || change === 'decision') {
        const record: unknown = fs.readJsonSync(recoveryFile(fixture));
        if (typeof record !== 'object' || record === null)
          throw new Error('Expected recovery');
        if (change === 'record') Reflect.set(record, 'foreign', true);
        else {
          const parsed = z
            .object({
              sync: z.object({
                refresh: z.object({ preserved: z.array(z.string()) }),
              }),
            })
            .parse(record);
          const sync: unknown = Reflect.get(record, 'sync');
          if (typeof sync !== 'object' || sync === null)
            throw new Error('Expected sync');
          const refresh: unknown = Reflect.get(sync, 'refresh');
          if (typeof refresh !== 'object' || refresh === null)
            throw new Error('Expected refresh');
          expect(parsed.sync.refresh.preserved).to.include('child');
          Reflect.deleteProperty(refresh, 'preserved');
        }
        fs.writeJsonSync(recoveryFile(fixture), record);
      }
      resolvePreservedConflict(fixture);
      fs.writeFileSync(
        path.join(fixture.consumer, 'untracked.txt'),
        'do not stage'
      );
      const before = fixture.observe();
      const sources = sourcePins(fixture);
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      expect(sourcePins(fixture)).to.equal(sources);
    });

  it('declines another reconciliation without consuming preserved local work', () => {
    addPreservedArm(fixture);
    prepareIncomingConflict(fixture);
    const before = fixture.observe();
    const result = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'How would you like to handle', input: '\u001b[B\u001b[B\r' },
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(fixture.observe()).to.deep.equal(before);
    expect(sourcePins(fixture)).to.equal('');
  });

  for (const change of ['reopened', 'identity', 'unavailable'])
    it(`revalidates ${change} cleanup evidence while another branch is preserved`, () => {
      addPreservedArm(fixture);
      fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
      fs.writeJsonSync(fixture.identities, {
        prOverrides: { child: { state: 'CLOSED' } },
      });
      startIncomingConflict(fixture, true);
      const kept = fixture.git(fixture.consumer, 'rev-parse', 'kept');
      const record = z
        .object({
          sync: z.object({
            refresh: z.object({ preserved: z.array(z.string()) }),
          }),
        })
        .parse(fs.readJsonSync(recoveryFile(fixture)));
      expect(record.sync.refresh.preserved).to.include('kept');
      fs.writeJsonSync(
        fixture.identities,
        change === 'unavailable'
          ? { prErrors: { child: { status: 7 } } }
          : {
              prOverrides: {
                child: {
                  state: change === 'reopened' ? 'OPEN' : 'CLOSED',
                  ...(change === 'identity' ? { headRefName: 'parent' } : {}),
                },
              },
            }
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'conflict.txt'),
        'resolved incoming'
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'untracked.txt'),
        'do not stage'
      );
      const before = fixture.observe();
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      expect(fixture.git(fixture.consumer, 'rev-parse', 'kept')).to.equal(kept);
      expect(
        fixture.git(fixture.consumer, 'branch', '--list', 'child')
      ).to.equal('child');
    });

  for (const stoppedBranch of ['parent', 'child'])
    it(`retains reached work when a hook interrupts ${stoppedBranch} maintenance`, () => {
      fixture.ok('unfreeze', 'parent');
      fixture.ok('unfreeze', 'child');
      const local = fixture.commit(
        fixture.consumer,
        'correction.txt',
        'unpublished correction'
      );
      fixture.git(fixture.producer, 'switch', 'main');
      const trunk = fixture.commit(
        fixture.producer,
        'new-trunk.txt',
        'independent trunk work'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'main');
      const hook = path.join(fixture.consumer, '.git', 'hooks', 'pre-rebase');
      fs.writeFileSync(
        hook,
        `#!/bin/sh\nif [ "$2" = ${stoppedBranch} ]; then exit 37; fi\n`,
        { mode: 0o755 }
      );
      const result = fixture.run(['sync', '--no-delete']);
      expect(result.status, result.output).to.equal(1);
      const record = z
        .object({
          sync: z.object({
            refresh: z.object({ preserved: z.array(z.string()) }),
            completedMaintenance: z.array(z.string()),
          }),
        })
        .parse(fs.readJsonSync(recoveryFile(fixture)));
      expect(record.sync.refresh.preserved).to.include('child');
      expect(record.sync.completedMaintenance.includes('parent')).to.equal(
        stoppedBranch === 'child'
      );
      fixture.assertTip('main', trunk);
      fixture.assertTip('child', local);
      if (stoppedBranch === 'parent')
        fixture.assertTip('parent', fixture.oldParent);
      else
        expect(
          fixture.git(fixture.consumer, 'merge-base', 'parent', 'main')
        ).to.equal(trunk);
      fs.removeSync(hook);
      const before = fixture.observe();
      const pins = sourcePins(fixture);
      const retry = fixture.run(['continue', '--all']);
      expect(retry.status, retry.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      fixture.ok('sync', '--abort');
      expect(fixture.observe()).to.deep.equal({
        ...Object(before),
        recovery: null,
      });
      expect(sourcePins(fixture)).to.equal(pins);
    });

  it('abandons a preserved conflict offline without losing staged or unstaged resolutions', () => {
    startPreservedConflict(fixture);
    resolvePreservedConflict(fixture);
    fixture.git(fixture.consumer, 'add', 'main.txt');
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'unstaged followup'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'untracked.txt'),
      'keep untracked'
    );
    fs.writeFileSync(fixture.ghCalls, '');
    const record = fs.readFileSync(recoveryFile(fixture));
    const before = fixture.observe();
    const pins = sourcePins(fixture);
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
      rebase: false,
      rebaseFiles: null,
    });
    expect(sourcePins(fixture)).to.equal(pins);
    const archive = /Archive: (.+)/.exec(result.output)?.[1];
    expect(archive).not.to.equal(undefined);
    expect(
      fs.readFileSync(path.join(archive ?? '', 'recovery.json'))
    ).to.deep.equal(record);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    const again = fixture.run(['sync', '--abort']);
    expect(again.status, again.output).to.equal(0);
    expect(again.output).to.include('No pending sync');
  });
});

function startPreservedConflict(fixture: FrozenGetFixture): void {
  fixture.ok('unfreeze', 'parent');
  fixture.ok('unfreeze', 'child');
  fixture.commit(fixture.consumer, 'main.txt', 'local conflict correction');
  fixture.git(
    fixture.consumer,
    'commit',
    '--amend',
    '--author',
    'Local Contributor <local@example.test>',
    '-m',
    'Preserve this correction\n\nComplete original explanation.'
  );
  fixture.git(fixture.producer, 'switch', 'main');
  fixture.commit(fixture.producer, 'main.txt', 'incoming trunk correction');
  fixture.git(fixture.producer, 'push', 'origin', 'main');
  const start = fixture.run(['sync', '--no-delete']);
  expect(start.status, start.output).to.equal(1);
  expect(start.output).to.include('Hit conflict restacking child');
  const record = z
    .object({
      sync: z.object({
        refresh: z.object({ preserved: z.array(z.string()) }),
        completedMaintenance: z.array(z.string()),
      }),
    })
    .parse(fs.readJsonSync(recoveryFile(fixture)));
  expect(record.sync.refresh.preserved).to.include('child');
  expect(record.sync.completedMaintenance).to.include('parent');
}

function startIncomingConflict(
  fixture: FrozenGetFixture,
  cleanup = false
): void {
  prepareIncomingConflict(fixture);
  const start = fixture.run(
    ['sync', cleanup ? '--delete-all' : '--no-delete'],
    true,
    [{ prompt: 'How would you like to handle', input: '\r' }]
  );
  expect(start.status, start.output).to.equal(1);
  expect(start.output).to.include('Hit conflict rebasing');
}

function prepareIncomingConflict(fixture: FrozenGetFixture): void {
  fixture.ok('unfreeze', 'parent');
  fixture.ok('unfreeze', 'child');
  fixture.git(fixture.consumer, 'switch', 'parent');
  fixture.commit(fixture.consumer, 'conflict.txt', 'local incoming conflict');
  fixture.git(fixture.consumer, 'switch', 'child');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'conflict.txt', 'remote incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
}

function addPreservedArm(fixture: FrozenGetFixture): void {
  fixture.git(fixture.producer, 'switch', 'main');
  fixture.git(fixture.producer, 'switch', '-c', 'kept');
  fixture.commit(fixture.producer, 'kept.txt', 'published arm');
  fixture.git(fixture.producer, 'push', 'origin', 'kept');
  fs.writeJsonSync(fixture.prs, {
    parent: 'main',
    child: 'parent',
    kept: 'main',
  });
  fixture.ok('get', 'kept');
  fixture.ok('unfreeze', 'kept');
  fixture.commit(
    fixture.consumer,
    'correction.txt',
    'unpublished arm correction'
  );
  fixture.git(fixture.consumer, 'switch', 'child');
}

function resolvePreservedConflict(fixture: FrozenGetFixture): void {
  fs.writeFileSync(
    path.join(fixture.consumer, 'main.txt'),
    'deliberate resolution preserving both corrections'
  );
}

function recoveryFile(fixture: FrozenGetFixture): string {
  return path.join(fixture.consumer, '.git', '.gtcontinue');
}

function sourcePins(fixture: FrozenGetFixture): string {
  return fixture.git(
    fixture.consumer,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    'refs/gt-metadata/get'
  );
}

function withReleasedCli<T>(run: () => T): T {
  const legacy = process.env.ANTHRACITE_SYNC_LEGACY_BINARY;
  if (!legacy || !path.isAbsolute(legacy))
    throw new Error('Expected an absolute released 0.7.0 CLI path');
  const current = process.env.ANTHRACITE_TEST_BINARY;
  process.env.ANTHRACITE_TEST_BINARY = legacy;
  try {
    return run();
  } finally {
    if (current === undefined) delete process.env.ANTHRACITE_TEST_BINARY;
    else process.env.ANTHRACITE_TEST_BINARY = current;
  }
}
