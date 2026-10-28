import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { McpCliClient } from '../lib/mcp_client';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

const commandResult = z.object({
  status: z.enum(['success', 'cli_error']),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
});

function seedSingleMixedCommit(
  fixture: RelationCliFixture
): Record<string, string> {
  fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected');
  fs.writeFileSync(path.join(fixture.repo, 'remainder.txt'), 'remainder');
  fixture.git(['add', 'selected.txt', 'remainder.txt']);
  fixture.git(['commit', '--amend', '--no-edit']);
  expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('1');
  fixture.ok(['restack']);
  return Object.fromEntries(
    ['main', 'base', 'child', 'tip', 'other'].map((name) => [
      name,
      fixture.git(['rev-parse', `${name}^{tree}`]),
    ])
  );
}

function expectSplit(
  fixture: RelationCliFixture,
  trees: Record<string, string>
): void {
  expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  expect(fixture.git(['ls-tree', '-r', '--name-only', 'base_split'])).to.equal(
    'main.txt\nselected.txt'
  );
  expect(fixture.git(['show', 'base_split:selected.txt'])).to.equal('selected');
  expect(fixture.git(['diff', '--name-only', 'base_split', 'base'])).to.equal(
    'base.txt\nremainder.txt'
  );
  for (const [name, tree] of Object.entries(trees))
    expect(fixture.git(['rev-parse', `${name}^{tree}`]), name).to.equal(tree);
  expect(fixture.parent('base')).to.equal('base_split');
  expect(fixture.parent('base_split')).to.equal('main');
  expect(fixture.git(['merge-base', '--is-ancestor', 'base', 'tip'])).to.equal(
    ''
  );
  expect(fixture.git(['status', '--porcelain'])).to.equal('');
  expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
    false
  );
}

// eslint-disable-next-line max-lines-per-function
describe('file split public surface', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('completes one mixed commit with closed stdin and no-interactive, including mandatory replay', () => {
    const trees = seedSingleMixedCommit(fixture);
    const unrelated = fixture.git(['rev-parse', 'other']);
    const result = fixture.run([
      'split',
      '--file',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      'Extracted selected files into base_split'
    );
    expect(result.stdout).to.include('Restacked child');
    expect(result.stdout).to.include('Restacked tip');
    expectSplit(fixture, trees);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
  });

  it('completes ordinary interactive file mode in a real terminal without any input', () => {
    const trees = seedSingleMixedCommit(fixture);
    const result = runCliInPty(
      getTestCliCommand(['sp', '-f', 'selected.txt']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [],
        timeoutMs: 60000,
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include(
      'Extracted selected files into base_split'
    );
    expect(result.output).to.include('Restacked tip');
    expectSplit(fixture, trees);
  });

  it('keeps quiet closed-stdin success silent and retains an actionable early refusal without effects', () => {
    const trees = seedSingleMixedCommit(fixture);
    const result = fixture.run(['split', '-f', 'selected.txt', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    expectSplit(fixture, trees);
    const before = fixture.inspectionSnapshot();
    const refused = fixture.run(['sp', '--by-file', '.', '--quiet']);
    expect(refused.status).to.equal(1);
    expect(refused.stdout).to.equal('');
    expect(refused.stderr).to.include('remainder');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('uses the existing real stdio MCP tool for file splitting, refusal and a usable subsequent request', async () => {
    const trees = seedSingleMixedCommit(fixture);
    const unrelated = fixture.git(['rev-parse', 'other']);
    const connection = new McpCliClient(fixture.root, fixture.env);
    async function run(args: readonly string[]) {
      const response = await connection.client.callTool({
        name: 'run_an_cmd',
        arguments: {
          args,
          cwd: fixture.repo,
          why: 'Split the synthetic fixture',
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
      const parsed: unknown = JSON.parse(content[0].text);
      return { ...commandResult.parse(parsed), isError: response.isError };
    }
    try {
      await connection.connect();
      const success = await run(['sp', '--file', 'selected.txt']);
      expect(success).to.include({
        status: 'success',
        exitCode: 0,
        signal: null,
        truncated: false,
        isError: false,
        stderr: '',
      });
      expect(success.stdout).to.include(
        'Extracted selected files into base_split'
      );
      expect(success.stdout).to.include('Restacked tip');
      expectSplit(fixture, trees);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
      const before = fixture.inspectionSnapshot();
      const refused = await run(['split', '--by-file', '.']);
      expect(refused).to.include({
        status: 'cli_error',
        exitCode: 1,
        signal: null,
        truncated: false,
        isError: true,
        stdout: '',
      });
      expect(refused.stderr).to.include('remainder');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(await run(['parent'])).to.deep.equal({
        status: 'success',
        stdout: 'base_split\n',
        stderr: '',
        exitCode: 0,
        signal: null,
        truncated: false,
        isError: false,
      });
      expect(connection.errors).to.deep.equal([]);
      expect(connection.stderr).to.equal('');
    } finally {
      await connection.close();
    }
  });

  it('explains file mode and completes its equivalent selectors for split and sp outside Git', () => {
    const before = fixture.inspectionSnapshot();
    for (const command of ['split', 'sp']) {
      const help = fixture.run([command, '--help'], fixture.root);
      expect(help.status, help.stderr).to.equal(0);
      expect(help.stderr).to.equal('');
      const text = help.stdout.replace(/\s+/g, ' ');
      for (const fragment of [
        '--by-file',
        '--file',
        '-f',
        'Repeat selectors',
        'effective cwd',
        'flattens',
        'oldest to newest',
        'original branch',
        'PR identity',
        'complete selection',
        'an continue',
        'hook',
        'rollback',
      ])
        expect(text, command).to.include(fragment);
      const completion = fixture.run(
        ['--get-yargs-completions', 'an', command, '--'],
        fixture.root
      );
      expect(completion.status, completion.stderr).to.equal(0);
      const candidates = completion.stdout
        .split('\n')
        .map((line) => line.split(':')[0]);
      for (const selector of ['--by-file', '--file', '--f'])
        expect(candidates, command).to.include(selector);
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
});
