import { expect } from 'chai';
import fs from 'fs-extra';
import { execFileSync } from 'child_process';
import { z } from 'zod';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Independent public CLI repository scenarios.
// eslint-disable-next-line max-lines-per-function
describe('sync protects current work from retired PR identities', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  function associateChild(): void {
    const ref = 'refs/branch-metadata/child';
    const metadata = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(fixture.git(fixture.consumer, 'cat-file', '-p', ref)));
    metadata.prInfo = {
      number: 2,
      url: 'https://github.com/get-fixture/repo/pull/2',
      state: 'OPEN',
      base: 'parent',
    };
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: fixture.consumer,
      env: fixture.env,
      input: JSON.stringify(metadata),
      encoding: 'utf8',
    }).trim();
    fixture.git(fixture.consumer, 'update-ref', ref, oid);
  }

  it('npm reuse: refreshes a current open PR instead of its stale terminal association', () => {
    associateChild();
    const incoming = fixture.commit(
      fixture.producer,
      'incoming.txt',
      'current open PR'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    const old = {
      number: 2,
      url: 'https://github.com/get-fixture/repo/pull/2',
      title: 'Old PR',
      body: '',
      author: { login: 'get-fixture' },
      state: 'CLOSED',
      isDraft: false,
      headRefName: 'child',
      headRefOid: fixture.oldChild,
      baseRefName: 'parent',
      baseRefOid: fixture.oldParent,
      headRepository: { name: 'repo' },
      headRepositoryOwner: { login: 'get-fixture' },
      isCrossRepository: false,
    };
    fs.writeJsonSync(fixture.identities, {
      prReferenceOverrides: { '2': old },
      prLists: {
        child: [
          old,
          {
            ...old,
            number: 3,
            url: 'https://github.com/get-fixture/repo/pull/3',
            state: 'OPEN',
            headRefOid: incoming,
          },
        ],
      },
    });
    fixture.ok('sync', '--no-pull', '--delete-all', '--no-restack');
    fixture.assertTip('child', incoming);
    expect(
      fixture.git(fixture.consumer, 'show', 'child:incoming.txt')
    ).to.equal('current open PR');
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    ).to.include('"number": 3');
  });

  it('refuses cleanup if the selected terminal PR reopens after planning', () => {
    associateChild();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'CLOSED' } },
    });
    const shim = path.join(fixture.bin, 'gh');
    const original = shim + '-original';
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${process.execPath}
const cp = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
const result = cp.spawnSync(${JSON.stringify(
        original
      )}, args, {encoding:'utf8'});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
if (args[0] === 'pr' && args[1] === 'list' && args.includes('child'))
  fs.writeFileSync(${JSON.stringify(
    fixture.identities
  )}, JSON.stringify({prOverrides:{child:{state:'OPEN'}}}));
process.exitCode = result.status;
`,
      { mode: 0o755 }
    );
    const head = fixture.git(fixture.consumer, 'rev-parse', 'child');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--delete-all',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('cleanup PR identity/state/head changed');
    fixture.assertTip('child', head);
  });

  for (const state of ['CLOSED', 'MERGED']) {
    for (const consent of ['--delete-all', '--force']) {
      it(`retains unpublished ${state} work despite ${consent} cleanup consent`, () => {
        associateChild();
        const correction = fixture.commit(
          fixture.consumer,
          'correction.txt',
          'unpublished correction'
        );
        fs.writeJsonSync(fixture.identities, {
          prOverrides: { child: { state } },
        });
        fixture.ok('sync', '--no-pull', consent, '--no-restack');
        fixture.assertTip('child', correction);
        expect(
          fixture.git(fixture.consumer, 'show', 'child:correction.txt')
        ).to.equal('unpublished correction');
      });
    }
  }

  it('retains an unassociated reused name without adopting terminal history', () => {
    const correction = fixture.commit(
      fixture.consumer,
      'correction.txt',
      'unpublished correction'
    );
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'MERGED' } },
    });
    fixture.ok('sync', '--no-pull', '--delete-all', '--no-restack');
    fixture.assertTip('child', correction);
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/child'
      )
    ).not.to.include('"number"');
  });

  it('retains cached closed work when GitHub integration is disabled', () => {
    associateChild();
    const correction = fixture.commit(
      fixture.consumer,
      'correction.txt',
      'unpublished correction'
    );
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'CLOSED' } },
    });
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.ok('repo', 'github', '--no-enable');
    fs.writeFileSync(fixture.ghCalls, '');
    fixture.ok('sync', '--no-pull', '--delete-all', '--no-restack');
    fixture.assertTip('child', correction);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });

  it('npm reuse: deletes a freshly verified exact-head terminal branch', () => {
    associateChild();
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'MERGED' } },
    });
    fixture.ok('sync', '--no-pull', '--delete-all', '--no-restack');
    expect(fixture.git(fixture.consumer, 'branch', '--list', 'child')).to.equal(
      ''
    );
    fixture.assertTip('parent', fixture.oldParent);
  });

  it('npm reuse: retains unpublished commits after the associated PR closes', () => {
    associateChild();
    const correction = fixture.commit(
      fixture.consumer,
      'correction.txt',
      'unpublished correction'
    );
    fs.writeJsonSync(fixture.identities, {
      prOverrides: { child: { state: 'CLOSED' } },
    });
    fixture.ok('sync', '--no-pull', '--delete-all', '--no-restack');
    fixture.assertTip('child', correction);
    expect(
      fixture.git(fixture.consumer, 'show', 'child:correction.txt')
    ).to.equal('unpublished correction');
    expect(
      z
        .object({ prInfo: z.object({ state: z.string() }) })
        .parse(
          JSON.parse(
            fixture.git(
              fixture.consumer,
              'cat-file',
              '-p',
              'refs/branch-metadata/child'
            )
          )
        ).prInfo.state
    ).to.equal('CLOSED');
  });
});
