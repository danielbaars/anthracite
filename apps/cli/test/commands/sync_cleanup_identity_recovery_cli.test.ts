import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// These upgrade cases use an actual older CLI to produce unmodified owned recovery.
// eslint-disable-next-line max-lines-per-function
describe('sync cleanup identity across saved recovery', function () {
  this.timeout(120000);
  const legacy = process.env.ANTHRACITE_TEST_LEGACY_BINARY;
  const legacyCase = legacy ? it : it.skip;
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 30000;
  });
  afterEach(() => fixture?.cleanup());

  legacyCase(
    'npm reuse: refuses uncovered legacy cleanup before staging or advancing',
    () => {
      withLegacyProducer(() => startCleanupConflict(fixture, true));
      const record = z
        .object({
          sync: z.object({
            version: z.literal(1),
            cleanup: z.object({
              branches: z.array(
                z.object({
                  branchName: z.string(),
                  head: z.string().optional(),
                  prHead: z.string().optional(),
                })
              ),
            }),
          }),
        })
        .parse(fs.readJsonSync(recoveryFile(fixture)));
      const child = record.sync.cleanup.branches.find(
        (entry) => entry.branchName === 'child'
      );
      expect(child).not.to.equal(undefined);
      expect(child?.prHead).to.equal(undefined);
      expect(child?.head).not.to.equal(fixture.oldChild);
      fs.writeFileSync(
        path.join(fixture.consumer, 'conflict.txt'),
        'resolved bytes'
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'unstaged.txt'),
        'must remain unstaged'
      );
      const before = fixture.observe();
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output)
        .to.include('does not cover current work')
        .and.include('Sync recovery preserved');
      expect(fixture.observe()).to.deep.equal(before);
      expect(
        fixture.git(fixture.consumer, 'show', 'child:correction.txt')
      ).to.equal('unpublished child correction');
    }
  );

  legacyCase(
    'npm reuse: completes valid legacy cleanup with freshly verified coverage',
    () => {
      withLegacyProducer(() => startCleanupConflict(fixture));
      fs.writeFileSync(
        path.join(fixture.consumer, 'conflict.txt'),
        'resolved legacy conflict'
      );
      fixture.ok('continue', '--all');
      expect(
        fixture.git(fixture.consumer, 'branch', '--list', 'child')
      ).to.equal('');
      expect(
        fixture.git(fixture.consumer, 'show', 'parent:conflict.txt')
      ).to.equal('resolved legacy conflict');
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('main');
      expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
    }
  );

  it('completes current cleanup and retains the resolved incoming work', () => {
    startCleanupConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved current conflict'
    );
    fixture.ok('continue', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--list', 'child')).to.equal(
      ''
    );
    expect(
      fixture.git(fixture.consumer, 'show', 'parent:conflict.txt')
    ).to.equal('resolved current conflict');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
  });

  it('retains current recovery and unstaged bytes when the pinned terminal head changes', () => {
    startCleanupConflict(fixture);
    fs.writeJsonSync(fixture.identities, {
      prOverrides: {
        child: { state: 'CLOSED', headRefOid: fixture.oldParent },
      },
    });
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved but not staged'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'unstaged.txt'),
      'must remain unstaged'
    );
    const before = fixture.observe();
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('does not cover current work');
    expect(fixture.observe()).to.deep.equal(before);
  });

  function withLegacyProducer(run: () => void): void {
    if (!legacy || !path.isAbsolute(legacy))
      throw new Error('Expected an absolute legacy CLI executable');
    const current = process.env.ANTHRACITE_TEST_BINARY;
    process.env.ANTHRACITE_TEST_BINARY = legacy;
    try {
      run();
    } finally {
      if (current === undefined) delete process.env.ANTHRACITE_TEST_BINARY;
      else process.env.ANTHRACITE_TEST_BINARY = current;
    }
  }
});

function recoveryFile(fixture: FrozenGetFixture): string {
  return path.join(fixture.consumer, '.git', '.gtcontinue');
}

function startCleanupConflict(
  fixture: FrozenGetFixture,
  correction = false
): void {
  fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
  if (correction) {
    fixture.ok('unfreeze', 'child');
    fixture.commit(
      fixture.consumer,
      'correction.txt',
      'unpublished child correction'
    );
  }
  fixture.ok('unfreeze', 'parent');
  fixture.git(fixture.consumer, 'switch', 'parent');
  fixture.commit(fixture.consumer, 'conflict.txt', 'local incoming conflict');
  fixture.git(fixture.consumer, 'switch', 'child');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'conflict.txt', 'remote incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  fs.writeJsonSync(fixture.identities, {
    prOverrides: { child: { state: 'CLOSED' } },
  });
  const result = fixture.run(['sync', '--delete-all'], true, [
    { prompt: 'How would you like to handle', input: '\r' },
  ]);
  expect(result.status, result.output).to.equal(1);
  expect(result.output).to.include('Hit conflict rebasing');
}
