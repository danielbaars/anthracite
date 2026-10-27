/* eslint-disable max-lines-per-function */
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { z } from 'zod';
import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
  message: z.string().optional(),
});

async function observe(
  predicate: () => boolean,
  timeoutMs = 10000
): Promise<boolean> {
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

describe('MCP execution bounds through stdio', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  let connection: McpCliClient | undefined;
  beforeEach(() => {
    fixture = new CwdCliFixture({
      ...process.env,
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    });
  });
  afterEach(async () => {
    await connection?.close();
    fixture.cleanup();
  });
  async function connect(options: readonly string[] = []) {
    connection = new McpCliClient(
      fixture.root,
      fixture.env,
      getTestCliCommand(['mcp', ...options])
    );
    await connection.connect();
    return connection;
  }
  async function run(args: readonly string[], cwd = fixture.repo) {
    if (!connection) throw new Error('Connect the public MCP client first');
    const response = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: { args, cwd, why: 'Verify bounded fixture execution' },
    });
    const content = response.content;
    if (!Array.isArray(content) || content[0]?.type !== 'text')
      throw new Error('Expected a JSON text result');
    const parsed: unknown = JSON.parse(content[0].text);
    return { ...resultSchema.parse(parsed), isError: response.isError };
  }

  it('scenarios 12–13: validates and documents MCP-only integer execution limits before transport startup', () => {
    const help = fixture.run(['mcp', '--help'], fixture.root);
    expect(help.status, help.stderr).to.equal(0);
    expect(help.stdout).to.include('--command-timeout-ms');
    expect(help.stdout).to.include('300000');
    expect(help.stdout).to.include('--max-output-bytes');
    expect(help.stdout).to.include('1048576');
    const completions = fixture.run(
      ['--get-yargs-completions', 'an', 'mcp', '--'],
      fixture.root
    );
    expect(completions.status, completions.stderr).to.equal(0);
    expect(completions.stdout).to.include('--command-timeout-ms');
    expect(completions.stdout).to.include('--max-output-bytes');
    for (const [option, values] of [
      ['--command-timeout-ms', ['0', '3600001', '1.5', 'no', 'Infinity']],
      ['--max-output-bytes', ['1023', '16777217', '1024.5', 'no']],
    ] as const)
      for (const value of values) {
        const result = fixture.run(['mcp', option, value], fixture.root);
        expect(result.status, `${option} ${value}`).to.equal(1);
        expect(result.stdout).to.equal('');
        expect(result.stderr).to.include(option.slice(2));
      }
  });
  it('scenario 12: returns a complete 96KiB UTF-8 subject, ancestry tail and final LF, then bounds an explicit cap', async () => {
    const subject = 'é空'.repeat(19661) + ' subject-end';
    const message = path.join(fixture.root, 'large-message');
    fs.writeFileSync(message, subject + '\n');
    fixture.git(['commit', '--allow-empty', '-F', message]);
    const args = ['log', '--stack'];
    const direct = fixture.run(args);
    expect(direct.status, direct.stderr).to.equal(0);
    expect(Buffer.byteLength(subject)).to.be.greaterThan(96 * 1024);
    expect(direct.stdout).to.include(subject);
    expect(direct.stdout).to.match(/main[\s\S]*main[\s\S]*\n$/);
    await connect();
    expect(await run(args)).to.include({
      status: 'success',
      stdout: direct.stdout,
      stderr: direct.stderr,
      exitCode: 0,
      signal: null,
      truncated: false,
      isError: false,
    });
    await connection?.close();
    await connect(['--max-output-bytes', '1024']);
    const limited = await run(args);
    expect(limited.status).to.equal('output_limit');
    expect(limited).to.include({ isError: true, truncated: true });
    expect(limited.message).to.include('1024');
    expect(
      Buffer.byteLength(limited.stdout) + Buffer.byteLength(limited.stderr)
    ).to.be.at.most(1024);
    expect(limited.stdout).not.to.include('\ufffd');
    expect(direct.stdout.startsWith(limited.stdout)).to.equal(true);
    expect(await run(['parent'])).to.include({
      status: 'success',
      stdout: 'main\n',
    });
  });
  it('scenario 6: serializes overlapping repository and linked-worktree calls in FIFO order with isolated IDs and directories', async () => {
    const second = new CwdCliFixture(fixture.env);
    const linked = path.join(fixture.root, 'linked tree 空間');
    fixture.git(['worktree', 'add', linked, 'other']);
    const ready = path.join(fixture.root, 'first-ready');
    const release = path.join(fixture.root, 'release-first');
    const secondReady = path.join(fixture.root, 'second-ready');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-commit'),
      `#!${
        process.execPath
      }\nconst fs = require('fs');fs.writeFileSync(${JSON.stringify(
        ready
      )}, 'ready');const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(
        release
      )})) { clearInterval(timer); } }, 10);`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(second.repo, '.git/hooks/pre-commit'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        secondReady
      )}, 'ready');`,
      { mode: 0o755 }
    );
    fs.writeFileSync(path.join(fixture.repo, 'queued.txt'), 'first repository');
    fixture.git(['add', 'queued.txt']);
    fs.writeFileSync(path.join(second.repo, 'queued.txt'), 'second repository');
    second.git(['add', 'queued.txt']);
    const client = await connect();
    const first = run(['create', 'first-mcp', '-m', 'first repository']);
    try {
      expect(await observe(() => fs.existsSync(ready))).to.equal(true);
      const next = run(
        ['create', 'second-mcp', '-m', 'second repository'],
        second.repo
      );
      const third = run(['show', 'HEAD:other.txt'], linked);
      expect((await client.client.listTools()).tools).to.have.length(2);
      expect(
        (await client.client.callTool({ name: 'learn_an' })).isError
      ).not.to.equal(true);
      const overlapped = await observe(() => fs.existsSync(secondReady), 1500);
      fs.writeFileSync(release, 'continue');
      const results = await Promise.all([first, next, third]);
      expect(
        overlapped,
        'second hook must wait until the first command finishes'
      ).to.equal(false);
      expect(results.map((result) => result.status)).to.deep.equal([
        'success',
        'success',
        'success',
      ]);
      expect(results[2].stdout).to.equal('other');
      expect(fixture.git(['show', 'HEAD:queued.txt'])).to.equal(
        'first repository'
      );
      expect(second.git(['show', 'HEAD:queued.txt'])).to.equal(
        'second repository'
      );
      expect(fixture.git(['branch', '--show-current'], linked)).to.equal(
        'other'
      );
      const calls = client.messages.filter(
        (message) =>
          'result' in message &&
          typeof message.result === 'object' &&
          message.result !== null &&
          'content' in message.result
      );
      expect(
        calls.map((message) => ('id' in message ? message.id : null))
      ).to.deep.equal([5, 1, 2, 3]);
      expect(
        await run(['create', 'wrong-cwd', '--cwd', second.repo])
      ).to.include({ status: 'invalid_input' });
      expect(client.errors).to.deep.equal([]);
    } finally {
      fs.writeFileSync(release, 'continue');
      await first;
      second.cleanup();
    }
  });
  it('scenario 13: times out a real hook and grandchild, preserves foreign ownership and staged state, then serves queued work', async () => {
    const linked = path.join(fixture.root, 'timeout linked tree 空間');
    fixture.git(['worktree', 'add', linked, 'other']);
    const ready = path.join(fixture.root, 'blocked-ready');
    const grandchildReady = path.join(fixture.root, 'grandchild-ready');
    const ownedMode = path.join(fixture.root, 'owned-mode');
    const lock = path.join(fixture.repo, '.git/.graphite_cache_lock');
    const gitLock = path.join(fixture.repo, '.git/foreign-control.lock');
    const controlReady = path.join(fixture.root, 'control-ready');
    const control = spawn(
      process.execPath,
      [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(
          controlReady
        )}, 'ready');setInterval(() => {}, 100);`,
      ],
      { stdio: 'ignore' }
    );
    const controlPid = control.pid;
    if (controlPid === undefined) throw new Error('Missing control process');
    const foreign = JSON.stringify({ pid: controlPid, timestamp: 123 });
    fs.writeFileSync(lock, foreign);
    fs.writeFileSync(gitLock, 'preserve unrelated Git lock bytes');
    const descendant = `const fs = require('fs');process.on('SIGINT', () => {});fs.writeFileSync(${JSON.stringify(
      grandchildReady
    )}, String(process.pid));setInterval(() => {}, 100);`;
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-commit'),
      `#!${
        process.execPath
      }\nconst fs = require('fs');const cp = require('child_process');process.on('SIGINT', () => {});const cli = Number(cp.execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {encoding:'utf8'}).trim());const child = cp.spawn(process.execPath, ['-e', ${JSON.stringify(
        descendant
      )}], {stdio: 'inherit'});const before = cp.execFileSync('ps', ['-o', 'pid=,ppid=,pgid=,stat=,comm=', '-p', [cli,process.ppid,process.pid,child.pid].join(',')], {encoding:'utf8'});if(fs.existsSync(${JSON.stringify(
        ownedMode
      )})){fs.writeFileSync(${JSON.stringify(
        lock
      )}, JSON.stringify({pid:cli,timestamp:456}));process.kill(cli, 'SIGSTOP');}fs.writeFileSync(${JSON.stringify(
        ready
      )}, JSON.stringify({cli,hook:process.pid,grandchild:child.pid,before}));setInterval(() => {}, 100);`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(linked, 'pending.txt'),
      'staged resolution remains'
    );
    fixture.git(['add', 'pending.txt'], linked);
    const staged = fixture.git(['diff', '--cached', '--binary'], linked);
    const client = await connect([
      '--command-timeout-ms',
      '5000',
      '--max-output-bytes',
      '1024',
    ]);
    const active = run(
      ['create', 'timeout-feature', '-m', 'blocked commit'],
      linked
    );
    try {
      expect(
        await observe(
          () =>
            fs.existsSync(ready) &&
            fs.existsSync(grandchildReady) &&
            fs.existsSync(controlReady)
        )
      ).to.equal(true);
      const pidsSchema = z.object({
        cli: z.number().int().positive(),
        hook: z.number().int().positive(),
        grandchild: z.number().int().positive(),
        before: z.string(),
      });
      const pids = pidsSchema.parse(JSON.parse(fs.readFileSync(ready, 'utf8')));
      expect(
        isRunning(pids.cli) &&
          isRunning(pids.hook) &&
          isRunning(pids.grandchild)
      ).to.equal(true);
      const later = run(['parent'], linked);
      expect((await client.client.listTools()).tools).to.have.length(2);
      const result = await active;
      expect(result).to.include({
        status: 'timeout',
        isError: true,
        truncated: false,
      });
      expect(result.message).to.include('5000ms');
      expect(result.message).to.include('does not roll back');
      expect(result.exitCode !== null || result.signal !== null).to.equal(true);
      expect(
        await observe(
          () =>
            !isRunning(pids.cli) &&
            !isRunning(pids.hook) &&
            !isRunning(pids.grandchild)
        )
      ).to.equal(true);
      expect(fs.readFileSync(lock, 'utf8')).to.equal(foreign);
      expect(fs.readFileSync(gitLock, 'utf8')).to.equal(
        'preserve unrelated Git lock bytes'
      );
      expect(isRunning(controlPid)).to.equal(true);
      expect(fixture.git(['diff', '--cached', '--binary'], linked)).to.equal(
        staged
      );
      expect(await later).to.include({ status: 'success', stdout: 'main\n' });
      fs.unlinkSync(lock);
      fs.unlinkSync(ready);
      fs.unlinkSync(grandchildReady);
      fs.writeFileSync(
        ownedMode,
        'force stopped CLI to require adapter cleanup'
      );
      const interruptOutputHook = fs
        .readFileSync(path.join(fixture.repo, '.git/hooks/pre-commit'), 'utf8')
        .replace(
          "process.on('SIGINT', () => {});",
          "process.on('SIGINT', () => {process.stdout.write('é'.repeat(1024));process.stderr.write('S'.repeat(2048));});"
        );
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/post-checkout'),
        interruptOutputHook,
        { mode: 0o755 }
      );
      const forced = run(['switch', '--detach', 'HEAD'], linked);
      expect(
        await observe(
          () => fs.existsSync(ready) && fs.existsSync(grandchildReady)
        )
      ).to.equal(true);
      const owned = pidsSchema.parse(
        JSON.parse(fs.readFileSync(ready, 'utf8'))
      );
      expect(JSON.parse(fs.readFileSync(lock, 'utf8'))).to.include({
        pid: owned.cli,
      });
      const stoppedState = execFileSync(
        'ps',
        [
          '-o',
          'pid=,ppid=,pgid=,stat=,comm=',
          '-p',
          [owned.cli, owned.hook, owned.grandchild].join(','),
        ],
        { encoding: 'utf8' }
      );
      const leader = stoppedState
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .find((fields) => fields[0] === String(owned.cli));
      if (!leader) throw new Error('Missing owned group leader snapshot');
      expect(
        leader[1],
        'the observed group leader is the server direct child'
      ).to.equal(String(client.transport.pid));
      expect(leader[2]).to.equal(String(owned.cli));
      expect(
        leader[3].startsWith('T'),
        'the observed owned group leader is stopped'
      ).to.equal(true);
      const forcedResult = await forced;
      const afterCleanup = spawnSync(
        'ps',
        [
          '-o',
          'pid=,ppid=,pgid=,stat=,comm=',
          '-p',
          [owned.cli, owned.hook, owned.grandchild].join(','),
        ],
        { encoding: 'utf8' }
      );
      const diagnosticEvidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
      if (diagnosticEvidence) {
        fs.mkdirSync(diagnosticEvidence, { recursive: true });
        fs.writeFileSync(
          path.join(
            diagnosticEvidence,
            `timeout-processes-${process.pid}.json`
          ),
          JSON.stringify(
            {
              server: client.transport.pid,
              pids,
              owned,
              stoppedState,
              result,
              forcedResult,
              afterCleanup: {
                status: afterCleanup.status,
                stdout: afterCleanup.stdout,
                stderr: afterCleanup.stderr,
              },
              foreignLock: foreign,
              foreignControl: controlPid,
              controlStillRunning: isRunning(controlPid),
              ownedLockRemoved: !fs.existsSync(lock),
            },
            null,
            2
          )
        );
      }
      expect(forcedResult).to.include({
        status: 'timeout',
        exitCode: null,
        isError: true,
        truncated: true,
      });
      expect(forcedResult.signal).to.be.oneOf(['SIGINT', 'SIGKILL']);
      expect(forcedResult.message).to.include('5000ms');
      expect(
        Buffer.byteLength(forcedResult.stdout) +
          Buffer.byteLength(forcedResult.stderr)
      ).to.be.at.most(1024);
      expect(forcedResult.stdout).not.to.include('\ufffd');
      expect(forcedResult.stderr).not.to.equal('');
      expect(
        await observe(
          () =>
            !isRunning(owned.cli) &&
            !isRunning(owned.hook) &&
            !isRunning(owned.grandchild)
        )
      ).to.equal(true);
      expect(fs.existsSync(lock)).to.equal(false);
      expect(fs.readFileSync(gitLock, 'utf8')).to.equal(
        'preserve unrelated Git lock bytes'
      );
      expect(fixture.git(['diff', '--cached', '--binary'], linked)).to.equal(
        staged
      );
      expect(isRunning(controlPid)).to.equal(true);
      expect(await run(['show', 'HEAD:other.txt'], linked)).to.include({
        status: 'success',
        stdout: 'other',
      });
      expect(client.errors).to.deep.equal([]);
      expect(client.stderr).to.equal('');
    } finally {
      const stopped = new Promise<void>((resolve) =>
        control.once('exit', () => resolve())
      );
      control.kill('SIGKILL');
      await stopped;
      await active;
    }
  });
});
