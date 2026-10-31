import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';
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
});

describe('get CLI and installed MCP delivery', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  let direct: FrozenGetFixture | undefined;
  let connection: McpCliClient;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(async () => {
    await connection?.close();
    fixture.cleanup();
    direct?.cleanup();
  });

  for (const command of ['get', 'g']) {
    it(`${command} help and actual completion expose independent refresh, replay and checkout controls`, () => {
      const help = fixture.ok(command, '--help').output;
      expect(help).to.include('fast-forward only');
      expect(help).to.include('maintenance');
      for (const flag of [
        '--downstack',
        '--restack',
        '--checkout',
        '--no-restack',
        '--no-checkout',
      ])
        expect(help).to.include(flag);
      const completion = fixture
        .ok('--get-yargs-completions', 'an', command, '--')
        .output.split('\n')
        .map((line) => line.split(':')[0]);
      for (const flag of [
        '--downstack',
        '--restack',
        '--checkout',
        '--no-restack',
        '--no-checkout',
      ])
        expect(completion).to.include(flag);
    });
  }

  it('installed get workflow learns explicit options, matches direct Git state and preserves a protected failure', async () => {
    connection = new McpCliClient(fixture.root, fixture.env);
    await connection.connect();
    const tools = await connection.client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).to.deep.equal([
      'learn_an',
      'run_an_cmd',
    ]);
    const learning = await connection.client.callTool({
      name: 'learn_an',
      arguments: {},
    });
    const guide = JSON.stringify(learning.content);
    for (const fragment of [
      '--downstack',
      '--no-restack',
      '--no-checkout',
      'fast-forward',
      'original physical',
      'remote-only',
      'saved get',
    ])
      expect(guide).to.include(fragment);

    direct = new FrozenGetFixture();
    const heads = fixture.advanceBoth();
    const directHeads = direct.advanceBoth();
    expect(heads).to.deep.equal(directHeads);
    for (const current of [fixture, direct])
      current.git(current.consumer, 'switch', 'main');
    const args = [
      'g',
      'parent',
      '--downstack',
      '--no-restack',
      '--no-checkout',
    ];
    const directResult = direct.ok(...args);
    const result = await run(args);
    expect(result).to.deep.equal({
      status: 'success',
      stdout: directResult.stdout,
      stderr: directResult.stderr,
      exitCode: 0,
      signal: null,
      truncated: false,
      isError: false,
    });
    for (const current of [fixture, direct]) {
      current.assertTip('parent', heads.parent);
      current.assertTip('child', current.oldChild);
      expect(
        current.git(current.consumer, 'branch', '--show-current')
      ).to.equal('main');
      expect(current.git(current.consumer, 'status', '--porcelain')).to.equal(
        ''
      );
    }
    for (const gitArgs of [
      [
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
        'refs/branch-metadata',
      ],
      ['ls-files', '--stage'],
      ['rev-parse', 'HEAD^{tree}'],
    ])
      expect(fixture.git(fixture.consumer, ...gitArgs)).to.equal(
        direct.git(direct.consumer, ...gitArgs)
      );

    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'next incoming parent');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.writeFileSync(
      path.join(fixture.consumer, 'main.txt'),
      'protected staged bytes'
    );
    fixture.git(fixture.consumer, 'add', 'main.txt');
    const before = fixture.observe();
    const failed = await run(args);
    expect(failed.status, failed.stderr).to.equal('cli_error');
    expect(failed.isError).to.equal(true);
    expect(failed.exitCode).to.equal(1);
    expect(failed.truncated).to.equal(false);
    expect(fixture.observe()).to.deep.equal(before);
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
  });

  async function run(args: readonly string[]) {
    const response = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: {
        args,
        cwd: fixture.consumer,
        why: 'Refresh the authorized fixture scope and retain the starting checkout',
      },
    });
    const content = response.content;
    if (
      !Array.isArray(content) ||
      content.length !== 1 ||
      content[0]?.type !== 'text' ||
      typeof content[0].text !== 'string'
    )
      throw new Error('Expected one JSON text result');
    const value: unknown = JSON.parse(content[0].text);
    return { ...resultSchema.parse(value), isError: response.isError };
  }
});
