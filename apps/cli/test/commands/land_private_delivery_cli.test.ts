import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import {
  emptyPrivatePolicyEvidence,
  preparePrivatePlanLand,
} from '../lib/fixtures/land_private_policy';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
});

/* eslint-disable max-lines-per-function */
describe('private-plan landing delivery', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof preparePrivatePlanLand>;
  let connection: McpCliClient | undefined;
  let pushed: string;

  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = preparePrivatePlanLand(fixture);
    setEvidence('DISABLED');
    pushed = path.join(fixture.root, 'unexpected-push');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        pushed
      )}, 'push');process.exitCode=1;`,
      { mode: 0o755 }
    );
  });

  afterEach(async () => {
    await connection?.close();
    fixture.cleanup();
  });

  function setEvidence(enforcement: string): void {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(github.policy, 'utf8')),
        planAbsenceResponse: emptyPrivatePolicyEvidence({
          rulesets: {
            totalCount: 1,
            nodes: [
              { id: 'disabled-branch-rule', enforcement, target: 'BRANCH' },
            ],
            pageInfo: { hasNextPage: false, endCursor: 'final' },
          },
        }),
      })
    );
  }

  function observe(): Record<string, unknown> {
    return {
      local: fixture.inspectionSnapshot(),
      remote: fixture.git(['for-each-ref'], github.remote),
      prs: fs.readFileSync(github.state, 'utf8'),
    };
  }

  function assertPreserved(before: Record<string, unknown>): void {
    expect(observe()).to.deep.equal(before);
    expect(fs.existsSync(pushed)).to.equal(false);
    const calls = fs.readFileSync(github.calls, 'utf8');
    expect(calls).not.to.include('"PUT"');
    expect(calls).not.to.include('"edit"');
    expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
  }

  it('direct private-plan delivery previews disabled rules then preserves an invalid-evidence refusal', () => {
    const before = observe();
    const preview = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include(
        'Policy: Independently verified despite plan-restricted REST access.'
      )
      .and.include('Readiness: READY');
    assertPreserved(before);
    setEvidence('EVALUATE');
    const refused = fixture.run(['land', 'base', '--yes', '--no-interactive']);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
    expect(refused.stdout + refused.stderr).to.include(
      'Evaluate-mode rulesets are outside the supported disabled-only policy proof.'
    );
    expect(refused.stdout).not.to.include('Readiness: READY');
    assertPreserved(before);
  });

  it('MCP private-plan delivery previews disabled rules then preserves an invalid-evidence refusal', async () => {
    connection = new McpCliClient(fixture.repo, fixture.env);
    await connection.connect();
    expect(
      (await connection.client.listTools()).tools
        .map((tool) => tool.name)
        .sort()
    ).to.deep.equal(['learn_an', 'run_an_cmd']);
    const run = async (args: readonly string[], exitCode: number) => {
      if (!connection) throw new Error('Expected connected MCP client');
      const response = await connection.client.callTool({
        name: 'run_an_cmd',
        arguments: {
          args,
          cwd: fixture.repo,
          why: 'Inspect synthetic private-plan policy and preserve refused landing state',
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
      const result = resultSchema.parse(JSON.parse(content[0].text));
      expect(result, result.stderr).to.include({
        status: exitCode === 0 ? 'success' : 'cli_error',
        exitCode,
        signal: null,
        truncated: false,
      });
      expect(response.isError).to.equal(exitCode !== 0);
      return result;
    };
    const before = observe();
    const preview = await run(
      ['land', 'base', '--dry-run', '--no-interactive'],
      0
    );
    expect(preview.stdout)
      .to.include(
        'Policy: Independently verified despite plan-restricted REST access.'
      )
      .and.include('Readiness: READY');
    expect(preview.stderr).to.equal('');
    assertPreserved(before);
    setEvidence('EVALUATE');
    const refused = await run(['land', 'base', '--yes', '--no-interactive'], 1);
    expect(refused.stderr).to.include(
      'Evaluate-mode rulesets are outside the supported disabled-only policy proof.'
    );
    expect(refused.stdout).not.to.include('Readiness: READY');
    assertPreserved(before);
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
  });
});
