/* eslint-disable max-lines-per-function */
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import { z } from 'zod';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { McpCliClient } from '../lib/mcp_client';
import { McpPipeClient } from '../lib/mcp_pipe_client';

async function observe(predicate: () => boolean, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    })
      .trim()
      .startsWith('Z');
  } catch {
    return false;
  }
}

const ownedSchema = z.object({
  cli: z.number().int().positive(),
  hook: z.number().int().positive(),
  grandchild: z.number().int().positive(),
});

/** Ordinary hook descendants, observable independently of the MCP supervisor. */
function blockHook(fixture: CwdCliFixture, ownLock = false) {
  const ready = path.join(fixture.root, 'owned-ready');
  const grandchildReady = path.join(fixture.root, 'grandchild-ready');
  const descendant = `const fs=require('fs');process.on('SIGINT',()=>{});fs.writeFileSync(${JSON.stringify(
    grandchildReady
  )},String(process.pid));setInterval(()=>{},100);`;
  fs.writeFileSync(
    path.join(fixture.repo, '.git/hooks/post-checkout'),
    `#!${
      process.execPath
    }\nconst fs=require('fs');const cp=require('child_process');process.on('SIGINT',()=>{});const cli=Number(cp.execFileSync('ps',['-o','pgid=','-p',String(process.pid)],{encoding:'utf8'}).trim());const grandchild=cp.spawn(process.execPath,['-e',${JSON.stringify(
      descendant
    )}],{stdio:'inherit'});${
      ownLock
        ? `fs.writeFileSync(${JSON.stringify(
            path.join(fixture.repo, '.git/.graphite_cache_lock')
          )},JSON.stringify({pid:cli,timestamp:456}));process.kill(cli,'SIGSTOP');`
        : ''
    }fs.writeFileSync(${JSON.stringify(
      ready
    )},JSON.stringify({cli,hook:process.pid,grandchild:grandchild.pid}));setInterval(()=>{},100);`,
    { mode: 0o755 }
  );
  return {
    isReady: () => fs.existsSync(ready) && fs.existsSync(grandchildReady),
    read: () => ownedSchema.parse(JSON.parse(fs.readFileSync(ready, 'utf8'))),
  };
}

function processSnapshot(owned: z.infer<typeof ownedSchema>) {
  const result = spawnSync(
    'ps',
    ['-o', 'pid=,ppid=,pgid=,stat=', '-p', Object.values(owned).join(',')],
    { encoding: 'utf8' }
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function record(name: string, evidence: unknown): void {
  const directory = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, `lifecycle-${name}-${process.pid}.json`),
    JSON.stringify(evidence, null, 2)
  );
}

describe('MCP cancellation and shutdown through stdio', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  let queued: CwdCliFixture;
  let connection: McpCliClient | undefined;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    queued = new CwdCliFixture();
  });
  afterEach(async () => {
    await connection?.close();
    fixture.cleanup();
    queued.cleanup();
  });
  function call(target: CwdCliFixture, args: readonly string[], why: string) {
    return {
      name: 'run_an_cmd',
      arguments: { args, cwd: target.repo, why },
    };
  }

  it('scenario 14: cancels active and queued work, omits results and preserves unrelated state before serving another request', async () => {
    const hook = blockHook(fixture);
    const control = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], {
      stdio: 'ignore',
    });
    const controlPid = control.pid;
    if (controlPid === undefined) throw new Error('Missing control process');
    const lock = path.join(fixture.repo, '.git/.graphite_cache_lock');
    const foreign = JSON.stringify({ pid: controlPid, timestamp: 123 });
    fs.writeFileSync(lock, foreign);
    fs.writeFileSync(
      path.join(fixture.repo, 'pending.txt'),
      'staged remains\n'
    );
    fixture.git(['add', 'pending.txt']);
    const staged = fixture.git(['diff', '--cached', '--binary']);
    const queuedBefore = queued.inspectionSnapshot();
    connection = new McpCliClient(fixture.root, fixture.env);
    await connection.connect();
    const client = connection;
    const activeCancel = new AbortController();
    const queuedCancel = new AbortController();
    const active = client.client.callTool(
      call(fixture, ['switch', '--detach', 'HEAD'], 'active'),
      undefined,
      { signal: activeCancel.signal }
    );
    const activeSettled = Promise.allSettled([active]);
    let owned: z.infer<typeof ownedSchema> | undefined;
    try {
      expect(await observe(hook.isReady), 'owned hook readiness').to.equal(
        true
      );
      owned = hook.read();
      expect(Object.values(owned).every(isRunning)).to.equal(true);
      const beforeProcesses = processSnapshot(owned);
      const pending = client.client.callTool(
        call(
          queued,
          ['create', 'cancelled-queued', '-m', 'never commit'],
          'queued'
        ),
        undefined,
        { signal: queuedCancel.signal }
      );
      const queuedSettled = Promise.allSettled([pending]);
      expect((await client.client.listTools()).tools).to.have.length(2);
      queuedCancel.abort();
      activeCancel.abort();
      expect((await activeSettled)[0]?.status).to.equal('rejected');
      expect((await queuedSettled)[0]?.status).to.equal('rejected');
      expect(
        await observe(() =>
          Object.values(hook.read()).every((pid) => !isRunning(pid))
        )
      ).to.equal(true);
      const ids = client.sentMessages
        .filter(
          (message) => 'method' in message && message.method === 'tools/call'
        )
        .map((message) => ('id' in message ? message.id : null));
      expect(ids).to.have.length(2);
      for (const id of ids) {
        if (id === null) throw new Error('Missing request ID');
        await client.client.notification({
          method: 'notifications/cancelled',
          params: { requestId: id },
        });
      }
      await client.client.notification({
        method: 'notifications/cancelled',
        params: { requestId: 'unknown' },
      });
      const response = await client.client.callTool(
        call(fixture, ['show', 'HEAD:base.txt'], 'after cancellation')
      );
      expect(response.isError).to.equal(false);
      expect(
        client.messages.some(
          (message) => 'id' in message && ids.includes(message.id)
        )
      ).to.equal(false);
      expect(queued.inspectionSnapshot()).to.deep.equal(queuedBefore);
      expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(staged);
      expect(fs.readFileSync(lock, 'utf8')).to.equal(foreign);
      expect(isRunning(controlPid)).to.equal(true);
      expect(client.stderr).to.equal('');
      record('14-cancellation', {
        server: client.transport.pid,
        owned,
        beforeProcesses,
        afterProcesses: processSnapshot(owned),
        messages: client.messages,
        sentMessages: client.sentMessages,
        staged,
        foreign,
        queuedPreserved: true,
        controlStillRunning: isRunning(controlPid),
      });
    } finally {
      activeCancel.abort();
      queuedCancel.abort();
      await activeSettled;
      if (owned && isRunning(owned.cli)) process.kill(-owned.cli, 'SIGKILL');
      control.kill('SIGKILL');
    }
  });

  it('scenario 14: accepts numeric-zero cancellation and ignores malformed, unknown and completed notifications during later work', async () => {
    const hook = blockHook(fixture, true);
    const lock = path.join(fixture.repo, '.git/.graphite_cache_lock');
    connection = new McpCliClient(fixture.root, fixture.env);
    await connection.connect();
    const client = connection;
    const queuedBefore = queued.inspectionSnapshot();
    let owned: z.infer<typeof ownedSchema> | undefined;
    const laterCancel = new AbortController();
    try {
      await client.transport.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: call(fixture, ['switch', '--detach', 'HEAD'], 'zero active'),
      });
      expect(await observe(hook.isReady)).to.equal(true);
      owned = hook.read();
      const beforeProcesses = processSnapshot(owned);
      const firstOwned = owned;
      expect(JSON.parse(fs.readFileSync(lock, 'utf8'))).to.include({
        pid: owned.cli,
      });
      await client.client.notification({
        method: 'notifications/cancelled',
        params: { requestId: 0 },
      });
      expect(
        await observe(() =>
          Object.values(hook.read()).every((pid) => !isRunning(pid))
        ),
        'numeric-zero active cancellation stops owned work'
      ).to.equal(true);
      const completed = await client.client.callTool(
        call(fixture, ['show', 'HEAD:base.txt'], 'completed')
      );
      expect(completed.isError).to.equal(false);
      expect(fs.existsSync(lock)).to.equal(false);
      const afterFirstProcesses = processSnapshot(firstOwned);
      const completedRequest = client.sentMessages.find(
        (message) =>
          'method' in message &&
          message.method === 'tools/call' &&
          message.params?.arguments &&
          typeof message.params.arguments === 'object' &&
          'why' in message.params.arguments &&
          message.params.arguments.why === 'completed'
      );
      if (!completedRequest || !('id' in completedRequest))
        throw new Error('Missing completed request');
      fs.unlinkSync(path.join(fixture.root, 'owned-ready'));
      fs.unlinkSync(path.join(fixture.root, 'grandchild-ready'));
      const later = client.client.callTool(
        call(fixture, ['switch', '--detach', 'HEAD'], 'later active'),
        undefined,
        { signal: laterCancel.signal }
      );
      const laterSettled = Promise.allSettled([later]);
      expect(await observe(hook.isReady)).to.equal(true);
      owned = hook.read();
      await client.transport.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: call(
          queued,
          ['create', 'zero-never-starts', '-m', 'never'],
          'zero queued'
        ),
      });
      await client.client.notification({
        method: 'notifications/cancelled',
        params: { requestId: 0 },
      });
      await client.client.notification({
        method: 'notifications/cancelled',
        params: { requestId: completedRequest.id },
      });
      await client.client.notification({
        method: 'notifications/cancelled',
        params: { requestId: 'unknown' },
      });
      await client.transport.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: { malformed: true } },
      });
      expect((await client.client.listTools()).tools).to.have.length(2);
      expect(Object.values(owned).every(isRunning)).to.equal(true);
      laterCancel.abort();
      await laterSettled;
      const after = await client.client.callTool(
        call(fixture, ['show', 'HEAD:base.txt'], 'after zero')
      );
      expect(after.isError).to.equal(false);
      expect(Object.values(owned).every((pid) => !isRunning(pid))).to.equal(
        true
      );
      expect(queued.inspectionSnapshot()).to.deep.equal(queuedBefore);
      expect(
        client.messages.filter((message) => 'id' in message && message.id === 0)
      ).to.have.length(1); // Only initialization replies; both zero-ID executions were cancelled.
      expect(fs.existsSync(lock)).to.equal(false);
      expect(client.stderr).to.include('MCP error:');
      record('14-zero', {
        first: {
          owned: firstOwned,
          beforeProcesses,
          afterProcesses: afterFirstProcesses,
        },
        later: { owned, afterProcesses: processSnapshot(owned) },
        ownLockRemoved: !fs.existsSync(lock),
        messages: client.messages,
        sentMessages: client.sentMessages,
        stderr: client.stderr,
      });
    } finally {
      laterCancel.abort();
      if (owned && isRunning(owned.cli)) process.kill(-owned.cli, 'SIGKILL');
    }
  });

  it('scenario 15: EOF and server signals stop owned descendants, discard queued mutations and preserve genuine recovery for a fresh session', async () => {
    queued.env.GIT_EDITOR = 'true';
    queued.branch('conflict-base', 'main', true);
    fs.writeFileSync(path.join(queued.repo, 'main.txt'), 'base own\n');
    queued.git(['add', 'main.txt']);
    queued.git(['commit', '-m', 'base own']);
    queued.branch('conflict-child', 'conflict-base', true);
    fs.writeFileSync(path.join(queued.repo, 'main.txt'), 'child own\n');
    queued.git(['add', 'main.txt']);
    queued.git(['commit', '-m', 'child own']);
    queued.git(['switch', 'conflict-base']);
    const input = queued.input('conflict-base\nconflict-child\n');
    expect(
      queued.run(['reorder', '--stack', '--input', input, '--no-interactive'])
        .status
    ).to.equal(1);
    expect(queued.git(['ls-files', '--unmerged'])).not.to.equal('');
    fs.writeFileSync(
      path.join(queued.repo, 'main.txt'),
      'deliberately staged resolution\n'
    );
    queued.git(['add', 'main.txt']);
    const recoveryBefore = queued.inspectionSnapshot();
    const control = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], {
      stdio: 'ignore',
    });
    const controlPid = control.pid;
    if (controlPid === undefined) throw new Error('Missing control');
    const lock = path.join(fixture.repo, '.git/.graphite_cache_lock');
    const gitLock = path.join(fixture.repo, '.git/preserved-control.lock');
    const foreign = JSON.stringify({ pid: controlPid, timestamp: 123 });
    fs.writeFileSync(lock, foreign);
    fs.writeFileSync(gitLock, 'unrelated Git lock bytes');
    try {
      for (const mode of ['EOF', 'SIGINT', 'SIGTERM', 'EPIPE'] as const) {
        const hook = blockHook(fixture);
        const pipe = new McpPipeClient(fixture.root, fixture.env);
        await pipe.connect();
        const active = pipe.client.callTool(
          call(fixture, ['switch', '--detach', 'HEAD'], 'shutdown active')
        );
        const activeSettled = Promise.allSettled([active]);
        let owned: z.infer<typeof ownedSchema> | undefined;
        try {
          expect(await observe(hook.isReady)).to.equal(true);
          owned = hook.read();
          const serverPid = pipe.child.pid;
          if (serverPid === undefined)
            throw new Error('Missing public server PID');
          const leader = execFileSync(
            'ps',
            ['-o', 'ppid=,pgid=', '-p', String(owned.cli)],
            { encoding: 'utf8' }
          )
            .trim()
            .split(/\s+/)
            .map(Number);
          expect(leader).to.deep.equal([serverPid, owned.cli]);
          const reachedState = fixture.inspectionSnapshot();
          const beforeProcesses = processSnapshot(owned);
          const pending = pipe.client.callTool(
            call(queued, ['reset', '--hard', 'main'], 'discard on shutdown')
          );
          const queuedSettled = Promise.allSettled([pending]);
          expect((await pipe.client.listTools()).tools).to.have.length(2);
          if (mode === 'EOF') pipe.endStdin();
          else if (mode === 'EPIPE') {
            await new Promise<void>((resolve) => {
              pipe.child.stdout.once('close', resolve);
              pipe.child.stdout.destroy();
            });
            // Prompt a protocol response on the now-closed client output pipe.
            void Promise.allSettled([pipe.client.listTools()]);
          } else process.kill(serverPid, mode);
          expect(
            await observe(() => pipe.hasClosed),
            `${mode}: server exits without client fallback signals`
          ).to.equal(true);
          await Promise.all([activeSettled, queuedSettled]);
          expect(
            Object.values(owned).every((pid) => !isRunning(pid)),
            mode
          ).to.equal(true);
          expect(isRunning(serverPid)).to.equal(false);
          expect(fixture.inspectionSnapshot()).to.deep.equal(reachedState);
          expect(queued.inspectionSnapshot()).to.deep.equal(recoveryBefore);
          expect(isRunning(controlPid)).to.equal(true);
          expect(fs.readFileSync(lock, 'utf8')).to.equal(foreign);
          expect(fs.readFileSync(gitLock, 'utf8')).to.equal(
            'unrelated Git lock bytes'
          );
          expect(
            pipe.messages.filter(
              (message) => 'result' in message && 'content' in message.result
            )
          ).to.have.length(0);
          expect(pipe.stderr).to.equal('');
          const afterProcesses = processSnapshot(owned);
          expect(
            afterProcesses.stdout
              .split('\n')
              .some(
                (line) => line.trim().split(/\s+/)[0] === String(owned?.cli)
              ),
            'direct CLI child is reaped'
          ).to.equal(false);
          record(`15-${mode}`, {
            serverPid,
            owned,
            beforeProcesses,
            afterProcesses,
            reachedState,
            recoveryBefore,
            recovered: queued.inspectionSnapshot(),
            foreign,
            controlStillRunning: isRunning(controlPid),
            messages: pipe.messages,
            sentMessages: pipe.sentMessages,
            stderr: pipe.stderr,
            exitCode: pipe.child.exitCode,
            signal: pipe.child.signalCode,
          });
          fs.unlinkSync(path.join(fixture.root, 'owned-ready'));
          fs.unlinkSync(path.join(fixture.root, 'grandchild-ready'));
          const fresh = new McpCliClient(queued.root, queued.env);
          try {
            await fresh.connect();
            const inspected = await fresh.client.callTool(
              call(
                queued,
                ['status', '--porcelain'],
                'inspect preserved recovery'
              )
            );
            expect(inspected.isError).to.equal(false);
            expect(queued.inspectionSnapshot()).to.deep.equal(recoveryBefore);
          } finally {
            await fresh.close();
          }
        } finally {
          if (owned && isRunning(owned.cli))
            process.kill(-owned.cli, 'SIGKILL');
          if (!pipe.hasClosed) pipe.child.kill('SIGKILL');
          await activeSettled;
        }
      }
    } finally {
      control.kill('SIGKILL');
    }
  });
});
