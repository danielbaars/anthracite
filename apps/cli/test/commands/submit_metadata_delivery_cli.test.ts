import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { z } from 'zod';
import { McpCliClient } from '../lib/mcp_client';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

// Public processes and real Git; only the external gh boundary is controlled.
// eslint-disable-next-line max-lines-per-function
describe('submit metadata confirmation and retries', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('npm metadata: reports failed metadata and safely retries unchanged code', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    const file = path.join(fixture.root, 'body.md');
    fs.writeFileSync(file, 'Approved replacement');
    fixture.env.ANTHRACITE_TEST_GH_BODY_FAILURE_HEAD = 'target';
    const failed = fixture.cli(
      'submit',
      '--title',
      'Approved title',
      '--body-file',
      file
    );
    expect(failed.status).to.equal(1);
    expect(failed.stderr)
      .to.include('metadata')
      .and.include('was already pushed');
    expect(fixture.prs()).to.have.length(1);
    delete fixture.env.ANTHRACITE_TEST_GH_BODY_FAILURE_HEAD;
    fixture.clearCalls();
    fixture.succeed('submit', '--title', 'Approved title', '--body-file', file);
    expect(fixture.prs()).to.have.length(1);
    expect(fixture.prs()[0].title).to.equal('Approved title');
    expect(fixture.prs()[0].body).to.include('Approved replacement');
    expect(fixture.calls().some((call) => call[1] === 'create')).to.equal(
      false
    );
    fixture.clearCalls();
    fixture.succeed('submit', '--title', 'Approved title', '--body-file', file);
    expect(fixture.calls().some((call) => call[1] === 'edit')).to.equal(false);
  });

  it('npm metadata: retries after creation and a partial footer failure without a duplicate PR', () => {
    fixture.branch('target', 'main');
    const file = path.join(fixture.root, 'body.md');
    fs.writeFileSync(file, 'Approved first description');
    fixture.env.ANTHRACITE_TEST_GH_BODY_FAILURE_HEAD = 'target';
    const failed = fixture.cli(
      'submit',
      '--title',
      'Approved',
      '--body-file',
      file
    );
    expect(failed.status).to.equal(1);
    expect(failed.stderr).to.include('Dependency footer update failed');
    expect(fixture.prs()).to.have.length(1);
    delete fixture.env.ANTHRACITE_TEST_GH_BODY_FAILURE_HEAD;
    fixture.clearCalls();
    fixture.succeed('submit', '--title', 'Approved', '--body-file', file);
    expect(fixture.prs()).to.have.length(1);
    expect(fixture.prs()[0].body)
      .to.include('Approved first description')
      .and.include('PR Dependency Tree');
    expect(fixture.calls().some((call) => call[1] === 'create')).to.equal(
      false
    );
  });

  it('refuses a foreign PR identity introduced during confirmation', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();
    const change = `const fs=require('fs');const p=${JSON.stringify(
      fixture.state
    )};const prs=JSON.parse(fs.readFileSync(p));prs[0].headRefName='foreign';fs.writeFileSync(p,JSON.stringify(prs));`;
    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--title',
        'Approved',
        '--interactive',
        '--confirm',
        '--publish',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Continue with this submit operation?',
            input: 'y\r',
            beforeInput: [process.execPath, '-e', change],
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture.calls().some((call) => ['edit', 'create'].includes(call[1]))
    ).to.equal(false);
    expect(fixture.prs()[0].headRefName).to.equal('foreign');
  });

  it('npm metadata: executes literal inputs and a protected refusal through the existing MCP tools', async () => {
    fixture.branch('target', 'main');
    const file = path.join(fixture.root, 'body with spaces.md');
    fs.writeFileSync(file, 'MCP ü\n\nLiteral $(touch nope) `text`');
    const connection = new McpCliClient(fixture.root, fixture.env);
    const schema = z.object({
      status: z.string(),
      exitCode: z.number().nullable(),
      stderr: z.string(),
    });
    try {
      await connection.connect();
      const discovery = await connection.client.listTools();
      expect(discovery.tools.map((tool) => tool.name)).to.include.members([
        'learn_an',
        'run_an_cmd',
      ]);
      const learning = await connection.client.callTool({
        name: 'learn_an',
        arguments: {},
      });
      expect(JSON.stringify(learning)).to.include('--body-file');
      const run = async (args: string[]) => {
        const response = await connection.client.callTool({
          name: 'run_an_cmd',
          arguments: {
            args,
            cwd: fixture.repo,
            why: 'Verify approved metadata submission',
          },
        });
        if (
          !Array.isArray(response.content) ||
          response.content[0]?.type !== 'text'
        )
          throw new Error('Missing text result');
        const value: unknown = JSON.parse(response.content[0].text);
        return schema.parse(value);
      };
      expect(
        await run([
          'submit',
          '--title',
          'MCP literal $(echo no)',
          '--body-file',
          file,
        ])
      ).to.include({ status: 'success', exitCode: 0 });
      expect(fixture.prs()[0].title).to.equal('MCP literal $(echo no)');
      expect(fixture.prs()[0].body).to.include(
        'MCP ü\n\nLiteral $(touch nope) `text`'
      );
      fixture.succeed('freeze', 'target');
      const before = fixture.prs();
      expect(await run(['submit', '--title', 'Forbidden'])).to.include({
        status: 'cli_error',
        exitCode: 1,
      });
      expect(fixture.prs()).to.deep.equal(before);
    } finally {
      await connection.close();
    }
  });

  for (const approve of [true, false]) {
    it(`uses captured file contents when confirmation is ${
      approve ? 'accepted' : 'declined'
    }`, () => {
      fixture.branch('target', 'main');
      const file = path.join(fixture.root, 'body.md');
      fs.writeFileSync(file, 'Captured description');
      const refs = fixture.git('ls-remote', '--heads', 'origin');
      const result = runCliInPty(
        getTestCliCommand([
          'submit',
          '--title',
          'Approved',
          '--body-file',
          file,
          '--interactive',
          '--confirm',
          '--publish',
        ]),
        {
          cwd: fixture.repo,
          env: fixture.env,
          responses: [
            {
              prompt: 'Continue with this submit operation?',
              input: approve ? 'y\r' : 'n\r',
              beforeInput: [
                process.execPath,
                '-e',
                `require('fs').writeFileSync(${JSON.stringify(
                  file
                )},'Later file content')`,
              ],
            },
          ],
        }
      );
      expect(result.status, result.output).to.equal(approve ? 0 : 1);
      if (approve)
        expect(fixture.prs()[0].body)
          .to.include('Captured description')
          .and.not.include('Later file content');
      else {
        expect(fixture.prs()).to.deep.equal([]);
        expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
      }
    });
  }
});
