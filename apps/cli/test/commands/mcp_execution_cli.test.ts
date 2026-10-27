/* eslint-disable max-lines-per-function */
import { rejects } from 'assert';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import { z } from 'zod';
import { McpError, ResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.enum([
    'success',
    'cli_error',
    'invalid_input',
    'spawn_error',
    'timeout',
    'output_limit',
  ]),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
  message: z.string().optional(),
});

// Scenarios 3–4 and 7–8 share the real public SDK/process boundary.
describe('MCP command execution through stdio', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  let connection: McpCliClient;
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
  async function connect() {
    connection = new McpCliClient(fixture.root, fixture.env);
    await connection.connect();
  }
  async function run(args: readonly string[], cwd = fixture.repo) {
    return await call({ args, cwd, why: 'Observe the fixture' });
  }
  async function call(input: Record<string, unknown>) {
    const response = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: input,
    });
    const content = response.content;
    if (
      !Array.isArray(content) ||
      content.length !== 1 ||
      content[0]?.type !== 'text' ||
      typeof content[0].text !== 'string'
    )
      throw new Error('Expected one JSON text result');
    const parsed: unknown = JSON.parse(content[0].text);
    return { ...resultSchema.parse(parsed), isError: response.isError };
  }
  it('scenario 3: matches direct inspection, preserves Git state and launches this build despite PATH sentinels', async () => {
    const before = fixture.snapshot();
    const expected = [['log', 'short'], ['info']].map((args) => ({
      args,
      output: fixture.run(args),
    }));
    const bin = path.join(fixture.root, 'identity-bin');
    fs.mkdirSync(bin);
    for (const name of ['an', 'ch', 'gt'])
      fs.writeFileSync(
        path.join(bin, name),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          path.join(fixture.root, 'wrong-build')
        )}, 'called');process.exit(91);`,
        { mode: 0o755 }
      );
    fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
    await connect();
    for (const { args, output } of expected)
      expect(await run(args)).to.deep.equal({
        status: 'success',
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: 0,
        signal: null,
        truncated: false,
        isError: false,
      });
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'wrong-build'))).to.equal(
      false
    );
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
  });
  it('scenario 4: creates the exact staged commit with literal Unicode and shell-looking arguments', async () => {
    const parent = fixture.git(['rev-parse', 'HEAD']);
    const other = fixture.git(['rev-parse', 'other']);
    const sentinel = path.join(fixture.root, 'expanded');
    const message = `mcp café 空間 ; touch ${sentinel} $(touch ${sentinel}) \`touch ${sentinel}\` $HOME`;
    fs.writeFileSync(
      path.join(fixture.repo, 'literal file 空間.txt'),
      'exact staged bytes\n'
    );
    fixture.git(['add', 'literal file 空間.txt']);
    await connect();
    const result = await run(['create', 'literal-feature', '-m', message]);
    expect(result.status, result.stderr).to.equal('success');
    expect(result.isError).to.equal(false);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'literal-feature'
    );
    expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(message);
    expect(fixture.git(['log', '-1', '--format=%an <%ae>'])).to.equal(
      'Reorder fixture <reorder@example.test>'
    );
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
    expect(fixture.git(['show', 'HEAD:literal file 空間.txt'])).to.equal(
      'exact staged bytes'
    );
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(fs.existsSync(sentinel)).to.equal(false);
  });
  it('scenario 7: refuses malformed inputs and cwd overrides before effects, separates protocol failures and recovers', async () => {
    const before = fixture.snapshot();
    await connect();
    const valid = { args: ['info'], cwd: fixture.repo, why: 'Inspect' };
    const inaccessible = path.join(fixture.root, 'inaccessible');
    fs.mkdirSync(inaccessible, { mode: 0o000 });
    const invalid: Record<string, unknown>[] = [
      {},
      { ...valid, args: [] },
      { ...valid, args: 'info' },
      { ...valid, args: [1] },
      { ...valid, why: '' },
      { ...valid, why: ' \n\t' },
      { ...valid, why: 'bad\0why' },
      { ...valid, args: ['info\0'] },
      { ...valid, cwd: fixture.repo + '\0' },
      { ...valid, extra: true },
      { ...valid, cwd: '.' },
      { ...valid, cwd: inaccessible },
      { ...valid, cwd: path.join(fixture.root, 'missing') },
      { ...valid, cwd: path.join(fixture.repo, 'base.txt') },
      { ...valid, args: ['--cwd', fixture.root, 'create', 'wrong-directory'] },
      { ...valid, args: ['info', '--cwd=..'] },
      { ...valid, args: ['info', '--cwd'] },
      { ...valid, args: ['info', '--cwd=.', '--cwd=.'] },
    ];
    for (const input of invalid) {
      const result = await call(input);
      expect(result.status, JSON.stringify(input)).to.equal('invalid_input');
      expect(result).to.include({
        isError: true,
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: null,
        truncated: false,
      });
      expect(result.message).to.be.a('string').and.not.equal('');
    }
    fs.chmodSync(inaccessible, 0o700);
    expect(fixture.snapshot()).to.deep.equal(before);
    await rejects(
      connection.client.callTool({ name: 'unknown_tool' }),
      (error: unknown) => error instanceof McpError && error.code === -32602
    );
    await rejects(
      connection.client.request({ method: 'unknown/method' }, ResultSchema),
      (error: unknown) => error instanceof McpError && error.code === -32601
    );
    const failure = await run(['unknown-anthracite-command']);
    expect(failure).to.include({
      status: 'cli_error',
      isError: true,
      exitCode: 1,
      signal: null,
      truncated: false,
    });
    expect(failure.stderr).to.include('Unknown');
    const direct = fixture.run(['parent']);
    expect(await run(['parent', '--cwd=.'])).to.include({
      status: 'success',
      stdout: direct.stdout,
      stderr: direct.stderr,
      exitCode: 0,
      isError: false,
    });
    const alias = path.join(fixture.root, 'linked directory 空間');
    fs.symlinkSync(fixture.repo, alias);
    expect(await run(['parent', '--cwd', alias], alias)).to.include({
      status: 'success',
      stdout: 'main\n',
    });
    expect(await run(['--version'], fixture.root)).to.include({
      status: 'success',
      exitCode: 0,
    });
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
  });

  it('scenario 8: forces no UI, closes stdin and keeps recursion, documentation, quiet/debug and raw-Git framing usable', async () => {
    fixture.env.GRAPHITE_INTERACTIVE = '';
    const marker = path.join(fixture.root, 'unexpected-tool');
    const before = fixture.snapshot();
    await connect();
    for (const args of [
      ['checkout', '--interactive=true'],
      ['reorder', '--interactive=true'],
    ]) {
      const result = await run(args);
      expect(result.status, result.stderr).to.equal('cli_error');
      expect(result.stderr).to.match(/interactive|branch|editor/i);
    }
    for (const args of [
      ['mcp'],
      ['--get-yargs-completions=false', 'mcp'],
      ['--interactive=true', '--quiet', 'mcp'],
      ['--cwd=.', 'mcp', '--help=false', '--version=false'],
    ]) {
      const refused = await run(args);
      expect(refused).to.include({
        status: 'invalid_input',
        isError: true,
        exitCode: null,
        signal: null,
      });
      expect(refused.message).to.include('Recursive');
    }
    for (const args of [
      ['mcp', '--help'],
      ['--quiet', 'mcp', '--version'],
      ['mcp', '--help', '--debug'],
    ]) {
      const result = await run(args);
      expect(result.status, result.stderr).to.equal('success');
      expect(result.stdout).not.to.equal('');
    }
    for (const args of [
      ['log', 'short', '--interactive=true'],
      ['log', 'short', '--quiet'],
      ['info', '--debug'],
    ]) {
      const direct = fixture.run([...args, '--no-interactive']);
      expect(await run(args)).to.include({
        status: 'success',
        stdout: direct.stdout,
        stderr: direct.stderr,
        exitCode: direct.status,
      });
    }
    const rawArgs = ['show', 'HEAD:base.txt', '--', '--cwd=literal', 'mcp'];
    const direct = fixture.run(rawArgs);
    expect(await run(rawArgs)).to.include({
      status: direct.status === 0 ? 'success' : 'cli_error',
      stdout: direct.stdout,
      stderr: direct.stderr,
      exitCode: direct.status,
    });
    const stdin = await run(['apply', '--check', '-']);
    expect(stdin.status).to.equal('cli_error');
    expect(stdin.stderr).to.include('No valid patches');
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fs.existsSync(fixture.offered)).to.equal(false);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
  });
});
