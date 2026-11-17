import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import stripAnsi from 'strip-ansi';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { leaveLandingUnconfirmed } from '../lib/fixtures/landing_retry';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  truncated: z.boolean(),
});

// eslint-disable-next-line max-lines-per-function
describe('public landing retry delivery', function () {
  this.timeout(180000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  let recordPath: string;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
    recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
  });
  afterEach(() => fixture?.cleanup());

  it('delivery: discovers explicit target consent and matches preserving preview before application confirmation', () => {
    const help = fixture.run(['land', '--help']);
    expect(help.stdout.replace(/\s+/g, ' ')).to.include(
      'explicit original target'
    );
    expect(help.stdout)
      .to.include('--retry-unconfirmed')
      .and.include('--dry-run')
      .and.include('--yes');
    const completion = fixture.run([
      '--get-yargs-completions',
      'an',
      'land',
      '--',
    ]);
    expect(completion.stdout).to.include('--retry-unconfirmed');
    leaveLandingUnconfirmed(
      fixture,
      github,
      process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER
    );
    const saved = fs.readFileSync(recordPath, 'utf8');
    const before = fixture.inspectionSnapshot();
    const calls = fs.readFileSync(github.calls, 'utf8');
    const args = ['land', 'leaf', '--retry-unconfirmed'];
    const preview = fixture.run([...args, '--dry-run']);
    expect(preview.status, preview.stderr).to.equal(0);
    const application = runCliInPty(getTestCliCommand(args), {
      cwd: fixture.repo,
      env: fixture.env,
      timeoutMs: 60000,
      responses: [
        { prompt: 'Send at most one new merge request', input: 'n\n' },
      ],
    });
    expect(application.status, application.output).to.equal(0);
    const output = stripAnsi(application.output).replace(/\r\n/g, '\n');
    const prompt = output.indexOf('? Send at most one new merge request');
    expect(prompt, output).to.be.greaterThan(0);
    expect(output.slice(0, prompt).trimEnd()).to.equal(
      preview.stdout.trimEnd()
    );
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
    expect(
      fs.existsSync(
        path.join(fixture.repo, '.git', '.anthracite_landing_retry')
      )
    ).to.equal(false);
  });

  it('delivery: existing MCP client learns, previews and explicitly executes one bounded retry', async () => {
    leaveLandingUnconfirmed(
      fixture,
      github,
      process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER
    );
    const saved = fs.readFileSync(recordPath, 'utf8');
    const head = fixture.git(['rev-parse', 'leaf']);
    const gh = path.join(github.bin, 'gh');
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          "const input = JSON.parse(fs.readFileSync(0, 'utf8')); fs.appendFileSync(process.env.ANTHRACITE_TEST_PR_CALLS, JSON.stringify(input) + '\\n');"
        )
    );
    const calls = fs.readFileSync(github.calls, 'utf8');
    const connection = new McpCliClient(fixture.repo, fixture.env);
    try {
      await connection.connect();
      const learned = await connection.client.callTool({ name: 'learn_an' });
      const learning = JSON.stringify(learned);
      expect(learning)
        .to.include('--retry-unconfirmed')
        .and.include('explicit original target')
        .and.include('earlier request failed');
      const run = async (args: string[], exitCode = 0) => {
        const response = await connection.client.callTool({
          name: 'run_an_cmd',
          arguments: {
            args,
            cwd: fixture.repo,
            why: 'Verify explicitly authorized synthetic landing retry',
          },
        });
        const content = response.content;
        if (
          !Array.isArray(content) ||
          content[0]?.type !== 'text' ||
          typeof content[0].text !== 'string'
        )
          throw new Error('Expected JSON command result');
        const result = resultSchema.parse(JSON.parse(content[0].text));
        expect(result, result.stderr).to.include({
          status: exitCode ? 'cli_error' : 'success',
          exitCode,
          truncated: false,
        });
        return result;
      };
      await run(['land', 'leaf', '--yes'], 1);
      const before = fs.readFileSync(recordPath, 'utf8');
      const preview = await run([
        'land',
        'leaf',
        '--retry-unconfirmed',
        '--dry-run',
      ]);
      expect(preview.stdout)
        .to.include('Proposed retry: #31 leaf')
        .and.include(head);
      expect(fs.readFileSync(recordPath, 'utf8')).to.equal(before);
      expect(
        fs.readFileSync(github.calls, 'utf8').slice(calls.length)
      ).not.to.include('"PUT"');
      await run(['land', 'leaf', '--retry-unconfirmed'], 1);
      expect(fs.readFileSync(recordPath, 'utf8')).to.equal(before);
      const completed = await run([
        'land',
        'leaf',
        '--retry-unconfirmed',
        '--yes',
      ]);
      expect(completed.stdout).to.include('Landing complete: leaf');
      const requests = fs
        .readFileSync(github.calls, 'utf8')
        .slice(calls.length);
      expect(requests.match(/"PUT"/g)).to.have.length(1);
      expect(requests).to.include(
        JSON.stringify({ sha: head, merge_method: 'rebase' })
      );
      expect(fixture.git(['rev-parse', 'main'])).to.equal(
        fixture.git(['rev-parse', 'main'], github.remote)
      );
      expect(fixture.git(['show', 'main:leaf.txt'])).to.equal('leaf');
      expect(
        fixture.git([
          'for-each-ref',
          'refs/heads/leaf',
          'refs/branch-metadata/leaf',
        ])
      ).to.equal('');
      expect(fs.existsSync(recordPath)).to.equal(false);
      const archive = path.join(
        fixture.repo,
        '.git',
        '.anthracite_landing_retry'
      );
      const attempts = fs.readdirSync(archive);
      expect(attempts).to.have.length(1);
      // Plain resumption may renew cache ownership; the retry archives that exact source.
      const original = JSON.parse(
        fs.readFileSync(
          path.join(archive, attempts[0], 'original.json'),
          'utf8'
        )
      );
      expect({ ...original, cacheLock: undefined }).to.deep.equal({
        ...JSON.parse(saved),
        cacheLock: undefined,
      });
      expect(connection.errors).to.deep.equal([]);
    } finally {
      await connection.close();
    }
  });
});
