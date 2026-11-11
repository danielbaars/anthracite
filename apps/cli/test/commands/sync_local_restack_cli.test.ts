import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Public sync processes and real Git; only gh responses are controlled.
// eslint-disable-next-line max-lines-per-function
describe('sync CLI equivalent local restacks', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture(false);
    fixture.commandTimeoutMs = 60000;
    fixture.ok('get', 'parent', '--unfrozen');
  });
  afterEach(() => fixture?.cleanup());

  function createRestack(): void {
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'release.txt', 'independent release');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.ok('sync', '--no-delete');
  }

  function rewriteRawMessage(message: Buffer): void {
    const raw = execFileSync('git', ['cat-file', 'commit', 'parent'], {
      cwd: fixture.consumer,
      env: fixture.env,
    });
    const separator = raw.indexOf('\n\n');
    const commit = Buffer.concat([raw.subarray(0, separator + 2), message]);
    const oid = execFileSync(
      'git',
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      {
        cwd: fixture.consumer,
        env: fixture.env,
        input: commit,
        encoding: 'utf8',
      }
    ).trim();
    fixture.git(fixture.consumer, 'update-ref', 'refs/heads/parent', oid);
  }

  it('keeps a root restack created by the preceding sync without publishing it', () => {
    createRestack();
    const head = fixture.git(fixture.consumer, 'rev-parse', 'parent');
    const remote = fixture.git(fixture.remote, 'show-ref');
    const before = fixture.observe();

    const result = fixture.ok('sync', '--no-delete');

    fixture.assertTip('parent', head);
    expect(result.output).to.include('local restack').and.to.include('match');
    expect(result.output).to.include('unpublished');
    expect(result.output).not.to.include('How would you like to handle');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });
  const changedHistory = [
    {
      name: 'amended content',
      change: () => {
        fs.writeFileSync(
          path.join(fixture.consumer, 'parent.txt'),
          'local correction'
        );
        fixture.git(fixture.consumer, 'add', 'parent.txt');
        fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
      },
    },
    {
      name: 'changed author identity',
      change: () =>
        fixture.git(
          fixture.consumer,
          'commit',
          '--amend',
          '--no-edit',
          '--author',
          'Other Author <other@example.test>'
        ),
    },
    {
      name: 'changed author time',
      change: () =>
        fixture.git(
          fixture.consumer,
          'commit',
          '--amend',
          '--no-edit',
          '--date=2026-10-22T12:00:00Z'
        ),
    },
    {
      name: 'changed complete message with equal code',
      change: () =>
        fixture.git(
          fixture.consumer,
          'commit',
          '--amend',
          '-m',
          'New complete explanation\n\nPreserve this local message.'
        ),
    },
    {
      name: 'leading and trailing message bytes',
      change: () => rewriteRawMessage(Buffer.from('\nparent-old\n\n \n')),
    },
    {
      name: 'trailing whitespace with equal stable patch IDs',
      change: () => {
        fs.writeFileSync(
          path.join(fixture.consumer, 'parent.txt'),
          'parent-old '
        );
        fixture.git(fixture.consumer, 'add', 'parent.txt');
        fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
      },
    },
    {
      name: 'binary changes',
      change: () => {
        fs.writeFileSync(
          path.join(fixture.consumer, 'parent.txt'),
          Buffer.from([0, 255, 1])
        );
        fixture.git(fixture.consumer, 'add', 'parent.txt');
        fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
      },
    },
    {
      name: 'file mode changes',
      change: () => {
        fs.chmodSync(path.join(fixture.consumer, 'parent.txt'), 0o755);
        fixture.git(fixture.consumer, 'add', 'parent.txt');
        fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
      },
    },
    {
      name: 'path changes',
      change: () => {
        fixture.git(fixture.consumer, 'mv', 'parent.txt', 'renamed.txt');
        fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
      },
    },
    {
      name: 'an added empty commit',
      change: () =>
        fixture.git(
          fixture.consumer,
          'commit',
          '--allow-empty',
          '-m',
          'Keep this deliberately empty commit'
        ),
    },
    {
      name: 'an extra local commit after restacking',
      change: () =>
        fixture.commit(fixture.consumer, 'local.txt', 'additional local work'),
    },
    {
      name: 'a remote update after restacking',
      change: () => {
        fixture.git(fixture.producer, 'switch', 'parent');
        fixture.commit(
          fixture.producer,
          'incoming.txt',
          'new incoming correction'
        );
        fixture.git(fixture.producer, 'push', 'origin', 'parent');
      },
    },
    {
      name: 'unsupported encoding',
      change: () => {
        const raw = execFileSync('git', ['cat-file', 'commit', 'parent'], {
          cwd: fixture.consumer,
          env: fixture.env,
        });
        const separator = raw.indexOf('\n\n');
        const commit = Buffer.concat([
          raw.subarray(0, separator),
          Buffer.from('\nencoding ISO-8859-1'),
          raw.subarray(separator),
        ]);
        const oid = execFileSync(
          'git',
          ['hash-object', '-t', 'commit', '-w', '--stdin'],
          {
            cwd: fixture.consumer,
            env: fixture.env,
            input: commit,
            encoding: 'utf8',
          }
        ).trim();
        fixture.git(fixture.consumer, 'update-ref', 'refs/heads/parent', oid);
      },
    },
  ];
  for (const scenario of changedHistory) {
    it(`retains deliberate reconciliation for ${scenario.name}`, () => {
      createRestack();
      scenario.change();
      const before = fixture.observe();
      const remote = fixture.git(fixture.remote, 'show-ref');
      const result = fixture.run(['sync', '--no-delete']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Local and remote histories differ');
      expect(result.output).not.to.include('branch commits match remote');
      expect(fixture.observe()).to.deep.equal(before);
      expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    });
  }

  it('preserves a frozen equivalent restack in a terminal without prompting', () => {
    createRestack();
    fixture.ok('freeze', 'parent');
    const before = fixture.observe();
    const result = fixture.run(['sync', '--no-delete'], true);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('local restack');
    expect(result.output).not.to.include('How would you like to handle');
    expect(fixture.observe()).to.deep.equal(before);
    fixture.status('parent');
  });

  it('leaves get reconciliation unchanged for an equivalent local restack', () => {
    createRestack();
    const before = fixture.observe();
    const result = fixture.run(['get', 'parent', '--no-restack']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('shares a name with a local branch');
    expect(fixture.observe()).to.deep.equal(before);
  });
  function publishExtraCommit(empty = false): void {
    fixture.git(fixture.producer, 'switch', 'parent');
    if (empty)
      fixture.git(
        fixture.producer,
        'commit',
        '--allow-empty',
        '-m',
        'Deliberate empty explanation'
      );
    else
      fixture.commit(
        fixture.producer,
        'second.txt',
        'second independent change'
      );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fixture.ok('get', 'parent', '--no-restack');
  }

  function assertUncertainPreserving(): void {
    const before = fixture.observe();
    const remote = fixture.git(fixture.remote, 'show-ref');
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Local and remote histories differ');
    expect(result.output).not.to.include('branch commits match remote');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  }

  it('rejects reordered commits even when the aggregate branch diff matches', () => {
    publishExtraCommit();
    createRestack();
    const base = fixture.git(fixture.consumer, 'rev-parse', 'main');
    const ids = fixture
      .git(fixture.consumer, 'rev-list', '--reverse', `${base}..parent`)
      .split('\n');
    expect(ids).to.have.length(2);
    const aggregate = fixture.git(
      fixture.consumer,
      'diff',
      '--binary',
      base,
      'parent'
    );
    fixture.git(fixture.consumer, 'reset', '--hard', base);
    for (const oid of ids.reverse())
      fixture.git(fixture.consumer, 'cherry-pick', oid);
    expect(
      fixture.git(fixture.consumer, 'diff', '--binary', base, 'parent')
    ).to.equal(aggregate);
    assertUncertainPreserving();
  });

  it('retains matching deliberate empty commits in the compared sequence', () => {
    publishExtraCommit(true);
    createRestack();
    const before = fixture.observe();
    const result = fixture.ok('sync', '--no-delete');
    expect(result.output).to.include('local restack');
    expect(fixture.git(fixture.consumer, 'log', '-1', '--format=%B')).to.equal(
      'Deliberate empty explanation'
    );
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('allows a replay committer timestamp change without erasing author data', () => {
    createRestack();
    execFileSync('git', ['commit', '--amend', '--no-edit'], {
      cwd: fixture.consumer,
      env: {
        ...fixture.env,
        GIT_COMMITTER_DATE: '2026-10-22T12:00:00Z',
      },
      stdio: 'pipe',
    });
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%at %ct')
    ).to.equal('1792584000 1792670400');
    const before = fixture.observe();
    const remote = fixture.git(fixture.remote, 'show-ref');
    const result = fixture.ok('sync', '--no-delete');
    expect(result.output).to.include('local restack');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  it('keeps unsupported merged histories uncertain', () => {
    fixture.git(fixture.producer, 'switch', '-c', 'side', 'main');
    fixture.commit(fixture.producer, 'side.txt', 'independent side change');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.git(
      fixture.producer,
      'merge',
      '--no-ff',
      'side',
      '-m',
      'Merge independent history'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fixture.ok('get', 'parent', '--no-restack');
    createRestack();
    assertUncertainPreserving();
  });

  it('does not compare distinct invalid UTF-8 messages as replacement characters', () => {
    createRestack();
    const old = execFileSync('git', ['cat-file', 'commit', 'parent'], {
      cwd: fixture.producer,
      env: fixture.env,
    });
    const header = old.subarray(0, old.indexOf('\n\n') + 2);
    const remote = execFileSync(
      'git',
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      {
        cwd: fixture.producer,
        env: fixture.env,
        input: Buffer.concat([header, Buffer.from([255])]),
        encoding: 'utf8',
      }
    ).trim();
    fixture.git(fixture.producer, 'update-ref', 'refs/heads/parent', remote);
    fixture.git(
      fixture.producer,
      'push',
      '--force-with-lease',
      'origin',
      'parent'
    );
    rewriteRawMessage(Buffer.from([254]));
    assertUncertainPreserving();
  });

  it('keeps an over-limit commit sequence uncertain without changing it', () => {
    createRestack();
    let tip = fixture.git(fixture.producer, 'rev-parse', 'parent');
    const tree = fixture.git(fixture.producer, 'rev-parse', 'parent^{tree}');
    let local = fixture.git(fixture.consumer, 'rev-parse', 'parent');
    const localTree = fixture.git(
      fixture.consumer,
      'rev-parse',
      'parent^{tree}'
    );
    for (let index = 0; index < 128; index++) {
      tip = fixture.git(
        fixture.producer,
        'commit-tree',
        tree,
        '-p',
        tip,
        '-m',
        `Deliberate entry ${index}`
      );
      local = fixture.git(
        fixture.consumer,
        'commit-tree',
        localTree,
        '-p',
        local,
        '-m',
        `Deliberate entry ${index}`
      );
    }
    fixture.git(fixture.producer, 'update-ref', 'refs/heads/parent', tip);
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fixture.git(fixture.consumer, 'update-ref', 'refs/heads/parent', local);
    assertUncertainPreserving();
  });

  it('keeps a large ambiguous patch uncertain within the bounded proof', () => {
    fixture.commandTimeoutMs = 45000;
    createRestack();
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      Buffer.alloc(8 * 1024 * 1024, 120)
    );
    fixture.git(fixture.consumer, 'add', 'parent.txt');
    fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
    assertUncertainPreserving();
  });
  it('does not hide changed root files through relative diff configuration', () => {
    createRestack();
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'different local code'
    );
    fixture.git(fixture.consumer, 'add', 'parent.txt');
    fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
    fixture.git(fixture.consumer, 'config', 'diff.relative', 'true');
    const nested = path.join(fixture.consumer, 'nested');
    fs.mkdirSync(nested);
    fixture.cwd = nested;
    assertUncertainPreserving();
  });

  it('does not hide gitlink changes through ignored-submodule configuration', () => {
    fixture.git(fixture.producer, 'switch', 'parent');
    const oldLink = fixture.git(fixture.producer, 'rev-parse', 'main');
    fixture.git(
      fixture.producer,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${oldLink},module`
    );
    fixture.git(fixture.producer, 'commit', '-m', 'Add module reference');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fixture.ok('get', 'parent', '--no-restack');
    createRestack();
    const newLink = fixture.git(fixture.consumer, 'rev-parse', 'main');
    expect(newLink).not.to.equal(oldLink);
    fixture.git(
      fixture.consumer,
      'update-index',
      '--cacheinfo',
      `160000,${newLink},module`
    );
    fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
    fixture.git(fixture.consumer, 'config', 'diff.ignoreSubmodules', 'all');
    assertUncertainPreserving();
  });

  it('does not use replacement ancestry to declare remote work locally contained', () => {
    const remote = fixture.git(fixture.remote, 'rev-parse', 'parent');
    fixture.git(fixture.consumer, 'reset', '--hard', 'main');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local branch omits remote work'
    );
    const tree = fixture.git(fixture.consumer, 'rev-parse', 'HEAD^{tree}');
    const virtual = execFileSync('git', ['commit-tree', tree, '-p', remote], {
      cwd: fixture.consumer,
      env: fixture.env,
      input: 'virtual ancestry only\n',
      encoding: 'utf8',
    }).trim();
    fixture.git(fixture.consumer, 'replace', local, virtual);
    expect(
      spawnSync(
        'git',
        ['--no-replace-objects', 'merge-base', '--is-ancestor', remote, local],
        { cwd: fixture.consumer, env: fixture.env }
      ).status
    ).to.equal(1);
    expect(fixture.git(fixture.consumer, 'merge-base', remote, local)).to.equal(
      remote
    );
    const before = fixture.observe();
    const remoteRefs = fixture.git(fixture.remote, 'show-ref');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).not.to.include('keeping local history');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remoteRefs);
  });
});
