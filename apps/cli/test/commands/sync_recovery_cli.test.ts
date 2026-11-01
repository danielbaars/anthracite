import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// eslint-disable-next-line max-lines-per-function
describe('sync CLI owned recovery', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('continues saved maintenance in a fresh process and restores the original checkout', () => {
    startMaintenanceConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved both'
    );
    fs.writeFileSync(fixture.ghCalls, '');
    fixture.ok('cont', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved both');
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
    expect(
      fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname)',
        'refs/gt-metadata/get'
      )
    ).to.equal('');
  });
  it('continues incoming then maintenance conflicts with saved cleanup and trunk fallback', () => {
    startIncomingCleanupConflict(fixture);
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'later.txt', 'outside snapshot');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(fixture.ghCalls, '');
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved incoming'
    );
    const next = fixture.run(['continue', '--all']);
    expect(next.status, next.output).to.equal(1);
    expect(next.output)
      .to.include('Hit conflict restacking')
      .and.to.include('local-work');
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'child'),
      next.output
    ).to.equal('');
    const calls = fs
      .readFileSync(fixture.ghCalls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.map((args) => args.slice(0, 3))).to.deep.equal([
      ['pr', 'view', '2'],
      ['pr', 'view', '2'],
    ]);
    fs.writeFileSync(fixture.ghCalls, '');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved maintenance'
    );
    fixture.ok('cont', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved maintenance');
    expect(
      fixture.git(fixture.consumer, 'show', 'parent:conflict.txt')
    ).to.equal('resolved incoming');
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'parent')
    ).not.to.include('later.txt');
    expect(
      fixture.git(fixture.consumer, 'show', 'unrelated-alias:conflict.txt')
    ).to.equal('local incoming conflict');
    expect(
      fixture.git(fixture.consumer, 'ls-tree', '--name-only', 'unrelated-alias')
    ).not.to.include('later.txt');
    expect(
      fixture.git(fixture.consumer, 'config', 'rebase.updateRefs')
    ).to.equal('true');
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
  });

  it('rejects PR publication actor replacement without blessing its readback', () => {
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
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('PR publication changed');
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/parent')
    ).to.equal(old);
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(true);
  });

  for (const change of ['reopened', 'merged', 'identity', 'lookup', 'disabled'])
    it(`refuses pending cleanup ${change} before continue-all stages resolutions`, () => {
      startIncomingCleanupConflict(fixture);
      if (change === 'disabled') {
        const config = path.join(
          fixture.consumer,
          '.git',
          '.graphite_repo_config'
        );
        const value = readRecord(config);
        Reflect.set(value, 'isGithubIntegrationEnabled', false);
        fs.writeJsonSync(config, value);
      } else
        fs.writeJsonSync(
          fixture.identities,
          change === 'lookup'
            ? { prErrors: { child: { status: 7 } } }
            : {
                prOverrides: {
                  child: {
                    state:
                      change === 'reopened'
                        ? 'OPEN'
                        : change === 'merged'
                        ? 'MERGED'
                        : 'CLOSED',
                    ...(change === 'identity' ? { headRefName: 'parent' } : {}),
                  },
                },
              }
        );
      fs.writeFileSync(
        path.join(fixture.consumer, 'conflict.txt'),
        'resolved bytes'
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'unstaged.txt'),
        'do not stage'
      );
      fs.writeFileSync(fixture.ghCalls, '');
      const before = fixture.observe();
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      expect(
        fixture.git(fixture.consumer, 'branch', '--list', 'child')
      ).to.equal('child');
      if (change === 'disabled') {
        expect(result.output).to.include('requires GitHub read access');
        expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
      } else expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.include('"2"');
    });

  for (const change of [
    'version',
    'extra',
    'mirrors',
    'role',
    'file',
    'marker',
    'source',
    'abort',
    'worktree',
    'repository',
    'remote',
    'head',
    'parent',
    'active freeze',
    'pending freeze',
    'occupied',
  ])
    it(`preserves recovery, files and index for invalid ${change} before incidental staging`, () => {
      startMaintenanceConflict(fixture, true);
      const file = recoveryFile(fixture);
      if (change === 'file') fs.removeSync(file);
      if (['version', 'extra', 'mirrors', 'role'].includes(change)) {
        const record = readRecord(file);
        if (change === 'role') Reflect.deleteProperty(record, 'sync');
        if (change === 'mirrors')
          Reflect.set(record, 'branchesToSync', ['foreign']);
        if (change === 'version' || change === 'extra') {
          const sync: unknown = Reflect.get(record, 'sync');
          if (typeof sync !== 'object' || sync === null)
            throw new Error('Expected sync role');
          Reflect.set(
            sync,
            change === 'version' ? 'version' : 'foreign',
            change === 'version' ? 999 : true
          );
        }
        fs.writeJsonSync(file, record);
      }
      if (change === 'marker')
        fs.writeFileSync(
          path.join(
            fixture.consumer,
            '.git',
            'rebase-merge',
            'charcoal-continuation'
          ),
          'foreign'
        );
      if (change === 'source') {
        const source = fixture
          .git(
            fixture.consumer,
            'for-each-ref',
            '--format=%(refname)',
            'refs/gt-metadata/get'
          )
          .split('\n')[0];
        fixture.git(fixture.consumer, 'update-ref', '-d', source);
      }
      if (change === 'abort')
        fixture.git(fixture.consumer, 'rebase', '--abort');
      if (change === 'repository') {
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
      if (change === 'remote')
        fixture.git(
          fixture.consumer,
          'remote',
          'set-url',
          'origin',
          path.join(fixture.root, 'changed-remote.git')
        );
      if (change === 'head')
        fixture.git(
          fixture.consumer,
          'update-ref',
          'refs/heads/pending',
          fixture.oldParent
        );
      if (change === 'parent') {
        const actorFile = path.join(fixture.root, 'actor.json');
        const metadata = fixture.git(
          fixture.consumer,
          'cat-file',
          '-p',
          'refs/branch-metadata/pending'
        );
        fs.writeFileSync(
          actorFile,
          metadata.replace(
            '"parentBranchName": "child"',
            '"parentBranchName": "main"'
          )
        );
        const actor = fixture.git(
          fixture.consumer,
          'hash-object',
          '-w',
          actorFile
        );
        fixture.git(
          fixture.consumer,
          'update-ref',
          'refs/branch-metadata/pending',
          actor
        );
      }
      if (change.endsWith('freeze'))
        fixture.ok(
          'freeze',
          change === 'active freeze' ? 'local-work' : 'pending'
        );
      const other = path.join(fixture.root, 'other');
      if (change === 'occupied' || change === 'worktree') {
        fixture.git(
          fixture.consumer,
          'worktree',
          'add',
          ...(change === 'worktree'
            ? ['--detach', other, 'main']
            : [other, 'pending'])
        );
        if (change === 'worktree') fixture.cwd = other;
      }
      fs.writeFileSync(
        path.join(fixture.consumer, 'parent.txt'),
        'resolved bytes'
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'unstaged.txt'),
        'do not stage'
      );
      const before = fixture.observe();
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      if (change === 'abort') {
        const another = fixture.run(['sync', '--no-pull']);
        expect(another.status, another.output).to.equal(1);
        expect(fixture.observe()).to.deep.equal(before);
      }
    });
  it('resumes successive fanout and independent-root maintenance with the saved parents', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'parent.txt', 'first conflict');
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.ok('create', 'pending');
    fixture.commit(fixture.consumer, 'parent.txt', 'second conflict');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.ok('create', 'root-work');
    fixture.commit(fixture.consumer, 'main.txt', 'third conflict');
    fixture.git(fixture.consumer, 'switch', '--detach', 'main');
    const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'incoming parent');
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'main.txt', 'incoming main');
    fixture.git(fixture.producer, 'push', 'origin', 'main', 'parent');
    const start = fixture.run(['sync', '--no-delete']);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('Hit conflict restacking local-work');
    fs.writeFileSync(fixture.ghCalls, '');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'first resolution'
    );
    const second = fixture.run(['cont', '--all']);
    expect(second.status, second.output).to.equal(1);
    expect(second.output).to.include('Hit conflict restacking pending');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'second resolution'
    );
    const third = fixture.run(['continue', '--all']);
    expect(third.status, third.output).to.equal(1);
    expect(third.output).to.include('Hit conflict restacking root-work');
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'third resolution'
    );
    fixture.ok('cont', '--all');
    fixture.assertTip('HEAD', original);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    expect(fixture.ok('info', 'local-work').output).to.include('Parent: child');
    expect(fixture.ok('info', 'pending').output).to.include('Parent: child');
    expect(fixture.ok('info', 'root-work').output).to.include('Parent: main');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('first resolution');
    expect(
      fixture.git(fixture.consumer, 'show', 'pending:parent.txt')
    ).to.equal('second resolution');
    expect(
      fixture.git(fixture.consumer, 'show', 'root-work:main.txt')
    ).to.equal('third resolution');
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });

  it('keeps no-pull and no-restack choices through incoming recovery', () => {
    startIncomingCleanupConflict(fixture, ['--no-pull', '--no-restack']);
    const localWork = fixture.git(fixture.consumer, 'rev-parse', 'local-work');
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved incoming'
    );
    const result = fixture.ok('continue', '--all');
    expect(result.output).to.include('Pending restack: local-work');
    fixture.assertTip('local-work', localWork);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
  });
  it('preserves opaque out-of-graph metadata through a saved conflict without importing it', () => {
    const raw = path.join(fixture.root, 'opaque');
    fs.writeFileSync(raw, 'opaque metadata is deliberately not JSON');
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', raw);
    fixture.git(fixture.consumer, 'branch', 'opaque', 'main');
    fixture.git(
      fixture.consumer,
      'update-ref',
      'refs/branch-metadata/opaque',
      oid
    );
    startMaintenanceConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved opaque workflow'
    );
    fixture.ok('continue', '--all');
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/opaque')
    ).to.equal(oid);
    expect(fixture.git(fixture.consumer, 'cat-file', '-p', oid)).to.equal(
      'opaque metadata is deliberately not JSON'
    );
    fixture.assertTip(
      'opaque',
      fixture.git(fixture.consumer, 'rev-parse', 'main')
    );
  });

  for (const phase of ['checkout', 'sources'])
    it(`keeps foreign recovery written by final ${phase} hooks`, () => {
      startMaintenanceConflict(fixture);
      const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
      const write = `printf '%s' '${foreign}' > "$(git rev-parse --git-common-dir)/.gtcontinue"`;
      const script =
        phase === 'checkout'
          ? `#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then ${write}; fi\n`
          : `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n case "$ref:$new" in refs/gt-metadata/get/*:0000000000000000000000000000000000000000) ${write};; esac\n done\nfi\n`;
      fs.writeFileSync(
        path.join(
          fixture.consumer,
          '.git',
          'hooks',
          phase === 'checkout' ? 'post-checkout' : 'reference-transaction'
        ),
        script,
        { mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'parent.txt'),
        'resolved final hook'
      );
      const result = fixture.run(['continue', '--all']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output)
        .to.include('foreign recovery')
        .and.to.include('Manual inspection');
      expect(fs.readFileSync(recoveryFile(fixture), 'utf8')).to.equal(foreign);
      expect(
        fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
      ).to.equal('resolved final hook');
    });

  it('retains completed publication failure as manual inspection without a live retry', () => {
    startMaintenanceConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-rewrite'),
      '#!/bin/sh\nmkdir -p "$(git rev-parse --git-path refs/branch-metadata)"\ntouch "$(git rev-parse --git-path refs/branch-metadata/local-work.lock)"\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved publication'
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('metadata publication failed')
      .and.to.include('No verified owned continuation');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    const before = fixture.observe();
    const retry = fixture.run(['continue', '--all']);
    expect(retry.status, retry.output).to.equal(1);
    expect(retry.output).to.include('No matching owned active sync rebase');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('records physical cleanup deletion before metadata failure and refuses an uncertain retry', () => {
    startIncomingCleanupConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved before cleanup'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      '#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n if [ "$ref:$new" = refs/heads/child:0000000000000000000000000000000000000000 ]; then touch "$(git rev-parse --git-path refs/branch-metadata/child.lock)"; fi\n done\nfi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('Confirmed cleanup deletions: child')
      .and.to.include('Incomplete cleanup metadata: child');
    expect(fixture.git(fixture.consumer, 'branch', '--list', 'child')).to.equal(
      ''
    );
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(true);
    const before = fixture.observe();
    const retry = fixture.run(['continue', '--all']);
    expect(retry.status, retry.output).to.equal(1);
    expect(retry.output).to.include('No matching owned active sync rebase');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('continues local-only maintenance without pins or GitHub access when integration is disabled', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.commit(fixture.consumer, 'parent.txt', 'local trunk collision');
    fixture.git(fixture.consumer, 'switch', 'child');
    fs.writeFileSync(fixture.ghCalls, '');
    const start = fixture.run(['sync', '--no-pull', '--no-delete']);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('Hit conflict restacking parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved local-only'
    );
    fixture.ok('continue', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'show', 'parent:parent.txt')).to.equal(
      'resolved local-only'
    );
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
  });

  it('preserves a freeze-only change on a completed anchor while continuing editable work', () => {
    startMaintenanceConflict(fixture);
    fixture.ok('freeze', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved with frozen anchor'
    );
    fixture.ok('continue', '--all');
    fixture.status('parent');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved with frozen anchor');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
  });
  it('requires manual inspection when pending PR status changes after Git completes reconciliation', () => {
    startIncomingCleanupConflict(fixture);
    const changed = JSON.stringify({
      prOverrides: { child: { state: 'OPEN' } },
    });
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-rewrite'),
      `#!/bin/sh\nprintf '%s' '${changed}' > '${fixture.identities}'\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved before PR change'
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('PR identity/state changed')
      .and.to.include('No verified owned continuation');
    expect(
      fixture.git(fixture.consumer, 'show', 'parent:conflict.txt')
    ).to.equal('resolved before PR change');
    expect(fixture.git(fixture.consumer, 'branch', '--list', 'child')).to.equal(
      'child'
    );
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    const before = fixture.observe();
    const retry = fixture.run(['continue', '--all']);
    expect(retry.status, retry.output).to.equal(1);
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('preserves a newly frozen completed incoming anchor through pending cleanup', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.commit(fixture.consumer, 'conflict.txt', 'local child conflict');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'incoming parent anchor');
    fixture.git(fixture.producer, 'switch', 'child');
    fixture.commit(fixture.producer, 'conflict.txt', 'remote child conflict');
    fixture.git(fixture.producer, 'push', 'origin', 'parent', 'child');
    const start = fixture.run(['sync', '--no-delete'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('Hit conflict rebasing child');
    fixture.ok('freeze', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved child'
    );
    fixture.ok('continue', '--all');
    fixture.status('parent');
    expect(
      fixture.git(fixture.consumer, 'show', 'child:conflict.txt')
    ).to.equal('resolved child');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
  });
  it('does not adopt an actor-restored deleted head before creating a maintenance conflict', () => {
    startIncomingCleanupConflict(fixture);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n if [ "$ref:$new" = refs/heads/child:0000000000000000000000000000000000000000 ]; then git -c core.hooksPath=/dev/null update-ref refs/heads/child ${fixture.oldChild}; fi\n done\nfi\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'conflict.txt'),
      'resolved incoming'
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status, result.output).to.equal(1);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge')),
      result.output
    ).to.equal(false);
    expect(result.output).to.include('Confirmed cleanup deletions: child');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(true);
  });
  it('continues purely local sync without a remote or GitHub repository identity', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.ok('unfreeze', 'child');
    fixture.ok('repo', 'github', '--no-enable');
    fixture.git(fixture.consumer, 'remote', 'remove', 'origin');
    const config = path.join(fixture.consumer, '.git', '.graphite_repo_config');
    const value = readRecord(config);
    Reflect.deleteProperty(value, 'owner');
    Reflect.deleteProperty(value, 'name');
    fs.writeJsonSync(config, value);
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.commit(fixture.consumer, 'parent.txt', 'local trunk collision');
    fixture.git(fixture.consumer, 'switch', 'child');
    fs.writeFileSync(fixture.ghCalls, '');
    const start = fixture.run(['sync', '--no-pull', '--no-delete']);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('Hit conflict restacking parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved local identity'
    );
    fixture.ok('continue', '--all');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'show', 'parent:parent.txt')).to.equal(
      'resolved local identity'
    );
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    expect(fs.existsSync(recoveryFile(fixture))).to.equal(false);
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
  const result = fixture.run(['sync', '--no-delete']);
  expect(result.status, result.output).to.equal(1);
  expect(result.output).to.include('Hit conflict');
}

function startIncomingCleanupConflict(
  fixture: FrozenGetFixture,
  flags: string[] = []
): void {
  fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
  fixture.ok('unfreeze', 'parent');
  fixture.git(fixture.consumer, 'switch', 'parent');
  fixture.ok('create', 'local-work');
  fixture.commit(fixture.consumer, 'parent.txt', 'local maintenance conflict');
  fixture.git(fixture.consumer, 'switch', 'parent');
  const local = fixture.commit(
    fixture.consumer,
    'conflict.txt',
    'local incoming conflict'
  );
  fixture.git(fixture.consumer, 'branch', 'unrelated-alias', local);
  fixture.git(fixture.consumer, 'config', 'rebase.updateRefs', 'true');
  fixture.git(fixture.consumer, 'switch', 'child');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'conflict.txt', 'remote incoming conflict');
  fixture.commit(fixture.producer, 'parent.txt', 'remote maintenance conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  fs.writeJsonSync(fixture.identities, {
    prOverrides: { child: { state: 'CLOSED' } },
  });
  const start = fixture.run(['sync', '--delete-all', ...flags], true, [
    { prompt: 'How would you like to handle', input: '\r' },
  ]);
  expect(start.status, start.output).to.equal(1);
  expect(start.output).to.include('Hit conflict rebasing');
}

function readRecord(file: string): object {
  const value: unknown = fs.readJsonSync(file);
  if (typeof value !== 'object' || value === null)
    throw new Error('Expected saved object');
  return value;
}
