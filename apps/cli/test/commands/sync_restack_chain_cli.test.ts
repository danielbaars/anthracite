import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';
import { McpCliClient } from '../lib/mcp_client';

// Public processes, real Git and bare remotes; only gh answers are controlled.
// eslint-disable-next-line max-lines-per-function
describe('sync CLI paired local restacks', function () {
  this.timeout(180000);
  let fixture: FrozenGetFixture;
  let connection: McpCliClient | undefined;
  beforeEach(() => {
    connection = undefined;
    fixture = new FrozenGetFixture(false);
    fixture.commandTimeoutMs = 60000;
    fixture.ok('get', 'child', '--unfrozen');
  });
  afterEach(async () => {
    await connection?.close();
    fixture?.cleanup();
  });

  function restackChain(): void {
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'release.txt', 'independent release');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    fixture.ok('sync', '--no-delete');
  }

  function publish(branch: string, parent: string): void {
    fixture.git(fixture.producer, 'switch', '-c', branch, parent);
    fixture.commit(fixture.producer, `${branch}.txt`, `${branch} own work`);
    fixture.git(fixture.producer, 'push', 'origin', branch);
    fs.writeJsonSync(fixture.prs, {
      ...z.record(z.string(), z.string()).parse(fs.readJsonSync(fixture.prs)),
      [branch]: parent,
    });
    fixture.ok('get', branch, '--unfrozen');
  }

  it('npm restack: preserves a real parent-child restack on a second sync', () => {
    restackChain();
    const before = fixture.observe();
    const remote = fixture.git(fixture.remote, 'show-ref');
    const parent = fixture.git(fixture.consumer, 'rev-parse', 'parent');
    const child = fixture.git(fixture.consumer, 'rev-parse', 'child');
    expect(parent).not.to.equal(fixture.oldParent);
    expect(child).not.to.equal(fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'merge-base', fixture.oldParent, parent)
    ).not.to.equal(fixture.oldParent);

    const result = fixture.ok('sync', '--no-delete');

    expect(result.output).to.include('parent: local restack');
    expect(result.output).to.include('child: local restack');
    expect(result.output).to.include('Publication is pending');
    expect(result.output).to.include("an submit --branch 'child' --dry-run");
    expect(result.output).not.to.include('How would you like to handle');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  it('preserves longer fanout and local-only work while refreshing an independent incoming arm', () => {
    publish('tip', 'child');
    publish('sibling', 'parent');
    fixture.ok('create', 'local-only', '--onto', 'child');
    fixture.commit(fixture.consumer, 'local-only.txt', 'unpublished local arm');
    fixture.ok('checkout', 'child');
    restackChain();
    publish('independent', 'main');
    fixture.ok('checkout', 'child');
    const kept = ['parent', 'child', 'tip', 'sibling', 'local-only'].map(
      (name) => [name, fixture.git(fixture.consumer, 'rev-parse', name)]
    );
    fixture.git(fixture.producer, 'switch', 'independent');
    const incoming = fixture.commit(
      fixture.producer,
      'fresh.txt',
      'fresh work'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'independent');
    const remote = fixture.git(fixture.remote, 'show-ref');

    const result = fixture.ok('sync', '--no-delete');

    for (const [name, head] of kept) {
      if (!name || !head) throw new Error('Missing fixture head');
      fixture.assertTip(name, head);
    }
    fixture.assertTip('independent', incoming);
    expect(result.output).to.include('tip: local restack');
    expect(result.output).to.include('sibling: local restack');
    expect(result.output).to.include('local-only is local-only');
    expect(
      fixture.git(fixture.consumer, 'show', 'independent:fresh.txt')
    ).to.equal('fresh work');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-only:local-only.txt')
    ).to.equal('unpublished local arm');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(
      fixture.git(fixture.consumer, 'for-each-ref', 'refs/gt-metadata/get')
    ).to.equal('');
  });

  for (const change of [
    'remote child',
    'remote parent',
    'parent author',
    'parent boundary',
  ])
    it(`npm restack uncertainty: refuses changed ${change} without applying the paired plan`, () => {
      restackChain();
      if (change.startsWith('remote')) {
        const branch = change === 'remote child' ? 'child' : 'parent';
        fixture.git(fixture.producer, 'switch', branch);
        fixture.commit(fixture.producer, 'incoming.txt', 'new incoming work');
        fixture.git(fixture.producer, 'push', 'origin', branch);
      } else {
        fixture.git(fixture.consumer, 'switch', 'parent');
        if (change === 'parent author')
          fixture.git(
            fixture.consumer,
            'commit',
            '--amend',
            '--no-edit',
            '--author',
            'Other Author <other@example.test>'
          );
        else {
          fixture.env.GIT_COMMITTER_DATE = '2026-11-11T12:00:00Z';
          fixture.git(fixture.consumer, 'commit', '--amend', '--no-edit');
        }
        fixture.git(fixture.consumer, 'switch', 'child');
      }
      const before = fixture.observe();
      const remote = fixture.git(fixture.remote, 'show-ref');

      const result = fixture.run(['sync', '--no-delete']);

      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('histories differ');
      expect(result.output).not.to.include('child: local restack');
      expect(fixture.observe()).to.deep.equal(before);
      expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
      expect(
        fixture.git(fixture.consumer, 'for-each-ref', 'refs/gt-metadata/get')
      ).to.equal('');
    });

  it('npm restack recovery: continues a genuine paired-chain conflict in a fresh process', () => {
    restackChain();
    const own = fixture.git(
      fixture.consumer,
      'log',
      'parent..child',
      '--format=%an <%ae>%n%at%n%B'
    );
    fixture.git(fixture.producer, 'switch', 'main');
    const trunk = fixture.commit(
      fixture.producer,
      'child.txt',
      'independent trunk edit'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const remote = fixture.git(fixture.remote, 'show-ref');

    const paused = fixture.run(['sync', '--no-delete']);

    expect(paused.status, paused.output).to.equal(1);
    expect(paused.output).to.include('child: local restack');
    expect(paused.output).to.include('Hit conflict restacking child');
    const record = z
      .object({
        sync: z.object({
          refresh: z.object({ preserved: z.array(z.string()) }),
          completedMaintenance: z.array(z.string()),
        }),
      })
      .parse(
        fs.readJsonSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
      );
    expect(record.sync.refresh.preserved).to.deep.equal(['parent', 'child']);
    expect(record.sync.completedMaintenance).to.include('parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'deliberate combined resolution'
    );
    fixture.git(fixture.consumer, 'add', 'child.txt');
    fs.writeFileSync(fixture.ghCalls, '');

    fixture.ok('continue');

    fixture.assertTip('main', trunk);
    expect(
      fixture.git(
        fixture.consumer,
        'log',
        'parent..child',
        '--format=%an <%ae>%n%at%n%B'
      )
    ).to.equal(own);
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'deliberate combined resolution'
    );
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(false);
    expect(
      fixture.git(fixture.consumer, 'for-each-ref', 'refs/gt-metadata/get')
    ).to.equal('');
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });

  it('keeps paired history and frozen state under explicit no-pull and no-restack controls', () => {
    restackChain();
    fixture.ok('freeze', 'child');
    const parent = fixture.git(fixture.consumer, 'rev-parse', 'parent');
    const child = fixture.git(fixture.consumer, 'rev-parse', 'child');
    const main = fixture.git(fixture.consumer, 'rev-parse', 'main');
    const own = fixture.git(
      fixture.consumer,
      'log',
      'parent..child',
      '--format=%an <%ae>%n%at%n%B'
    );
    fixture.git(fixture.producer, 'switch', 'main');
    const incoming = fixture.commit(
      fixture.producer,
      'next.txt',
      'next trunk work'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const remote = fixture.git(fixture.remote, 'show-ref');

    fixture.ok(
      'sync',
      '--no-pull',
      '--no-delete',
      '--delete-all',
      '--force',
      '--no-restack'
    );

    fixture.assertTip('main', main);
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', child);
    fixture.status('child', true);
    fixture.ok('sync', '--no-delete', '--no-restack');
    fixture.assertTip('main', incoming);
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', child);
    fixture.ok('unfreeze', 'parent');
    fixture.ok('sync', '--no-delete');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'main', 'child')
    ).to.equal(incoming);
    expect(
      fixture.git(
        fixture.consumer,
        'log',
        'parent..child',
        '--format=%an <%ae>%n%at%n%B'
      )
    ).to.equal(own);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
  });

  for (const protection of ['tracked work', 'file collision', 'occupied child'])
    it(`retains ${protection} before maintaining a preserved pair`, () => {
      restackChain();
      fixture.git(fixture.producer, 'switch', 'main');
      fixture.commit(fixture.producer, 'incoming.txt', 'incoming trunk bytes');
      fixture.git(fixture.producer, 'push', 'origin', 'main');
      if (protection === 'tracked work') {
        fs.writeFileSync(
          path.join(fixture.consumer, 'child.txt'),
          'deliberate staging'
        );
        fixture.git(fixture.consumer, 'add', 'child.txt');
        fs.writeFileSync(
          path.join(fixture.consumer, 'child.txt'),
          'unstaged followup'
        );
      } else if (protection === 'file collision')
        fs.writeFileSync(
          path.join(fixture.consumer, 'incoming.txt'),
          'protected local bytes'
        );
      else {
        fixture.git(fixture.consumer, 'switch', 'main');
        fixture.git(
          fixture.consumer,
          'worktree',
          'add',
          path.join(fixture.root, 'occupied'),
          'child'
        );
      }
      const before = fixture.observe();
      const remote = fixture.git(fixture.remote, 'show-ref');

      const result = fixture.run(['sync', '--no-delete']);

      expect(result.status, result.output).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
      expect(
        fixture.git(fixture.consumer, 'for-each-ref', 'refs/gt-metadata/get')
      ).to.equal('');
    });

  it('retains both paired decisions when a hook interrupts later maintenance', () => {
    restackChain();
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.commit(fixture.producer, 'next.txt', 'next trunk work');
    fixture.git(fixture.producer, 'push', 'origin', 'main');
    const child = fixture.git(fixture.consumer, 'rev-parse', 'child');
    const hook = path.join(fixture.consumer, '.git', 'hooks', 'pre-rebase');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif [ "$2" = child ]; then exit 37; fi\n',
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
      .parse(
        fs.readJsonSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
      );
    expect(record.sync.refresh.preserved).to.deep.equal(['parent', 'child']);
    expect(record.sync.completedMaintenance).to.include('parent');
    fixture.assertTip('child', child);
    fs.removeSync(hook);
    const reached = fixture.observe();
    const refused = fixture.run(['continue', '--all']);
    expect(refused.status, refused.output).to.equal(1);
    expect(fixture.observe()).to.deep.equal(reached);
    fixture.ok('sync', '--abort');
    expect(fixture.observe()).to.deep.equal({
      ...Object(reached),
      recovery: null,
    });
  });

  it('npm restack MCP: learns and executes the same preserving workflow with literal arguments', async () => {
    restackChain();
    connection = new McpCliClient(fixture.consumer, fixture.env);
    await connection.connect();
    const tools = await connection.client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).to.deep.equal([
      'learn_an',
      'run_an_cmd',
    ]);
    const learned = await connection.client.callTool({
      name: 'learn_an',
      arguments: {},
    });
    const guide = JSON.stringify(learned.content);
    for (const fragment of [
      'unpublished local restack',
      'exact remote',
      'clean local log',
      'submit --branch child --dry-run',
    ])
      expect(guide).to.include(fragment);
    const before = fixture.observe();
    const remote = fixture.git(fixture.remote, 'show-ref');

    const response = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: {
        args: ['sync', '--no-pull', '--no-delete', '--no-restack'],
        cwd: fixture.consumer,
        why: 'Inspect and retain verified unpublished fixture history without publication',
      },
    });
    const result = parseMcp(response.content);

    expect(response.isError).to.equal(false);
    expect(result.status, result.stderr).to.equal('success');
    expect(result.exitCode).to.equal(0);
    expect(result.stdout).to.include('child: local restack');
    expect(fixture.observe()).to.deep.equal(before);
    fixture.git(
      fixture.consumer,
      'commit',
      '--amend',
      '-m',
      'new local explanation'
    );
    const uncertain = fixture.observe();
    const failed = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: {
        args: ['sync', '--no-delete'],
        cwd: fixture.consumer,
        why: 'Verify uncertain history is not reconciled without a terminal decision',
      },
    });
    expect(failed.isError).to.equal(true);
    expect(parseMcp(failed.content).status).to.equal('cli_error');
    expect(fixture.observe()).to.deep.equal(uncertain);
    expect(fixture.git(fixture.remote, 'show-ref')).to.equal(remote);
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
  });

  it('explains the bounded proof refusal and matching control under debug', () => {
    restackChain();
    fixture.git(
      fixture.consumer,
      'commit',
      '--amend',
      '-m',
      'different child explanation'
    );
    const before = fixture.observe();
    const failed = fixture.run(['sync', '--no-delete', '--debug']);
    expect(failed.status, failed.output).to.equal(1);
    expect(failed.output).to.include('complete commit message bytes differ');
    expect(fixture.observe()).to.deep.equal(before);
    fixture.git(fixture.consumer, 'commit', '--amend', '-m', 'child-old');
    const matching = fixture.observe();
    const kept = fixture.ok('sync', '--no-delete', '--debug');
    expect(kept.output).to.include('matched 1 ordered own commit(s)');
    expect(fixture.observe()).to.deep.equal(matching);
  });
});

function parseMcp(content: unknown) {
  const items = z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .length(1)
    .parse(content);
  const text = items[0]?.text;
  if (text === undefined) throw new Error('Missing MCP text result');
  const value: unknown = JSON.parse(text);
  return z
    .object({
      status: z.string(),
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number().nullable(),
    })
    .parse(value);
}
