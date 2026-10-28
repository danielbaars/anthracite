import { expect } from 'chai';
import { z } from 'zod';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
});

describe('submit PR roles through the existing MCP execution tool', function () {
  this.timeout(120000);

  it('submits the selected stack with both roles only on the target PR', async () => {
    const fixture = new SubmitCliFixture();
    let connection: McpCliClient | undefined;
    try {
      fixture.branch('base', 'main');
      fixture.branch('child', 'base');
      fixture.branch('tip', 'child');
      fixture.branch('outside', 'main');
      connection = new McpCliClient(fixture.root, fixture.env);
      await connection.connect();
      const response = await connection.client.callTool({
        name: 'run_an_cmd',
        arguments: {
          args: [
            'ss',
            '--branch',
            'base',
            '--reviewers',
            'alice',
            '--assignees',
            '@me,bob',
            '--roles-branch',
            'child',
          ],
          cwd: fixture.repo,
          why: 'Verify the approved per-PR role submission workflow',
        },
      });
      if (
        !Array.isArray(response.content) ||
        response.content.length !== 1 ||
        response.content[0]?.type !== 'text' ||
        typeof response.content[0].text !== 'string'
      )
        throw new Error('Expected one JSON text execution result');
      const value: unknown = JSON.parse(response.content[0].text);
      const result = resultSchema.parse(value);
      expect(result, result.stderr).to.include({
        status: 'success',
        exitCode: 0,
        signal: null,
        truncated: false,
      });
      expect(response.isError).to.equal(false);
      expect(
        fixture
          .prs()
          .map((pr) => [pr.headRefName, pr.reviewRequests, pr.assignees ?? []])
      ).to.deep.equal([
        ['base', [], []],
        [
          'child',
          [{ login: 'alice' }],
          [{ login: 'fixture-user' }, { login: 'bob' }],
        ],
        ['tip', [], []],
      ]);
      for (const branch of ['base', 'child', 'tip'])
        expect(fixture.remoteSha(branch)).to.equal(
          fixture.git('rev-parse', branch)
        );
      expect(fixture.remoteSha('outside')).to.equal('');
      expect(fixture.git('branch', '--show-current')).to.equal('outside');
      expect(fixture.git('status', '--porcelain')).to.equal('');
      expect(connection.errors).to.deep.equal([]);
      expect(connection.stderr).to.equal('');
    } finally {
      await connection?.close();
      fixture.cleanup();
    }
  });
});
