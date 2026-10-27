/* eslint-disable max-lines-per-function */
import { rejects } from 'assert';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect } from 'chai';
import {
  InitializeResultSchema,
  McpError,
  ResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { bin, version } from '../../package.json';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { McpCliClient } from '../lib/mcp_client';

// Scenarios 1–2 exercise the built executable, never an imported server handler.
describe('MCP startup and learning through stdio', function () {
  this.timeout(30000);
  let root: string;
  let tools: string;
  let connection: McpCliClient;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'an-mcp-'));
    tools = fs.mkdtempSync(path.join(os.tmpdir(), 'an-mcp-tools-'));
    for (const name of ['git', 'gh', 'pager', 'editor'])
      fs.writeFileSync(
        path.join(tools, name),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          path.join(root, 'unexpected-tool')
        )}, ${JSON.stringify(name)});process.exitCode=99;`,
        { mode: 0o755 }
      );
    env = {
      ...process.env,
      HOME: root,
      PATH: `${tools}${path.delimiter}${process.env.PATH ?? ''}`,
      XDG_CONFIG_HOME: path.join(root, 'xdg'),
      GRAPHITE_USER_CONFIG_PATH: path.join(root, 'user-config'),
      GH_CONFIG_DIR: path.join(root, 'gh'),
    };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    connection = new McpCliClient(root, env);
  });
  afterEach(async () => {
    await connection.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(tools, { recursive: true, force: true });
  });

  it('scenario 1: discovers a working learning tool outside Git without credentials', async () => {
    await connection.connect();
    expect(connection.client.getServerVersion()).to.deep.equal({
      name: 'anthracite',
      version,
    });
    expect(connection.client.getServerCapabilities()).to.deep.equal({
      tools: {},
    });
    const inventory = await connection.client.listTools();
    expect(inventory.tools.map((tool) => tool.name)).to.deep.equal([
      'learn_an',
    ]);
    expect(inventory.tools[0].annotations).to.deep.equal({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(inventory.tools[0].inputSchema).to.deep.equal({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
    expect(fs.readdirSync(root)).to.deep.equal([]);
  });

  it('scenario 2: learns a deliberate workflow with explicit cwd and no connection side effects', async () => {
    await connection.connect();
    const absent = await connection.client.callTool({ name: 'learn_an' });
    const empty = await connection.client.callTool({
      name: 'learn_an',
      arguments: {},
    });
    expect(empty).to.deep.equal(absent);
    expect(empty.isError).not.to.equal(true);
    const content = empty.content;
    if (!Array.isArray(content) || content[0]?.type !== 'text')
      throw new Error('Expected learning text');
    const guide: unknown = content[0].text;
    expect(guide).to.be.a('string');
    for (const phrase of [
      'trunk',
      'Downstack',
      'upstack',
      'an log',
      'an info',
      'git add path/to/file',
      'an create feature',
      'an modify',
      'an restack',
      'Frozen',
      'worktree',
      'an continue',
      'an submit',
      'higher-priority user and repository instructions',
      'publication approval',
      'does not promise rollback',
      '"args": ["log"], "cwd": "/absolute/project", "why": "Inspect the stack"',
    ])
      expect(guide).to.include(phrase);
    const invalid = await connection.client.callTool({
      name: 'learn_an',
      arguments: { execute: true },
    });
    expect(invalid.isError).to.equal(true);
    expect(
      await connection.client.callTool({ name: 'learn_an' })
    ).to.deep.equal(absent);
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
    expect(fs.readdirSync(root)).to.deep.equal([]);
  });

  for (const protocolVersion of ['2024-11-05', '2999-01-01'])
    it(`scenario 1: negotiates SDK protocol behavior for ${protocolVersion}`, async () => {
      await connection.connect(protocolVersion);
      const handshake = connection.messages
        .filter((message) => 'result' in message)
        .map((message) =>
          InitializeResultSchema.safeParse(
            'result' in message ? message.result : undefined
          )
        )
        .find((result) => result.success);
      if (!handshake?.success) throw new Error('Missing initialize response');
      expect(handshake.data.protocolVersion).to.equal(
        protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-11-25'
      );
      expect((await connection.client.listTools()).tools[0].name).to.equal(
        'learn_an'
      );
      await rejects(
        connection.client.request(
          { method: 'unsupported/anthracite-method' },
          ResultSchema
        ),
        (error: unknown) => error instanceof McpError && error.code === -32601
      );
      await rejects(
        connection.client.callTool({ name: 'unknown_tool' }),
        (error: unknown) => error instanceof McpError && error.code === -32602
      );
      expect((await connection.client.listTools()).tools[0].name).to.equal(
        'learn_an'
      );
    });

  it('scenario 1: exposes help and completion without starting a server', () => {
    const run = (args: readonly string[]) => {
      const [executable, ...cliArgs] = getTestCliCommand(args);
      return spawnSync(executable, cliArgs, {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 10000,
      });
    };
    const help = run(['--help']);
    expect(help.status, help.stderr).to.equal(0);
    expect(help.stdout).to.include('an mcp');
    const serverHelp = run(['mcp', '--help']);
    expect(serverHelp.status, serverHelp.stderr).to.equal(0);
    expect(serverHelp.stdout).to.include('MCP stdio');
    const serverVersion = run(['mcp', '--version']);
    expect(serverVersion.status, serverVersion.stderr).to.equal(0);
    expect(serverVersion.stdout).to.equal(`${version}\n`);
    const completion = run(['--get-yargs-completions', 'an', '']);
    expect(completion.status, completion.stderr).to.equal(0);
    expect(
      completion.stdout.split('\n').some((line) => line.split(':')[0] === 'mcp')
    ).to.equal(true);
    expect(fs.readdirSync(root)).to.deep.equal([]);
  });

  for (const name of ['an', 'anthracite'])
    it(`scenario 1: starts through the installed ${name} spelling`, async () => {
      expect(bin).to.deep.equal({
        an: 'dist/src/index.js',
        anthracite: 'dist/src/index.js',
      });
      const executable = path.join(root, name);
      const [runtime, ...entry] = getTestCliCommand([]);
      if (entry.length === 0) fs.symlinkSync(runtime, executable);
      else
        fs.writeFileSync(
          executable,
          `#!${runtime}\nrequire(${JSON.stringify(entry[0])});\n`,
          { mode: 0o755 }
        );
      connection = new McpCliClient(root, env, [executable, 'mcp']);
      await connection.connect();
      expect(connection.client.getServerVersion()?.name).to.equal('anthracite');
      expect((await connection.client.listTools()).tools[0].name).to.equal(
        'learn_an'
      );
      expect(connection.stderr).to.equal('');
    });
});
