import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { expect } from 'chai';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
});

// eslint-disable-next-line max-lines-per-function
describe('public deferred landing delivery', function () {
  this.timeout(600000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 300000;
  });
  afterEach(() => fixture?.cleanup());

  async function run(
    connection: McpCliClient,
    args: string[],
    exitCode = 0
  ): Promise<z.infer<typeof resultSchema>> {
    const response = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: {
        args,
        cwd: fixture.repo,
        why: 'Verify the authorized synthetic deferred landing workflow',
      },
    });
    const content = response.content;
    if (!Array.isArray(content) || content[0]?.type !== 'text')
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
  }

  it('detects early replay conflicts before publication and continues locally before explicit landing', () => {
    const github = prepareLand(fixture);
    const observer = observeLandingPushes(fixture, github.remote);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    const author = fixture.git([
      'log',
      '-1',
      '--format=%an <%ae>%n%B',
      'child',
    ]);
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const stopped = fixture.run(['land', 'tip', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('an continue');
    expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
      'child.txt'
    );
    expect(observer.client()).to.have.length(0);
    expect(
      observer
        .received()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.ref !== 'refs/heads/main')
    ).to.have.length(0);
    const calls = fs.readFileSync(github.calls, 'utf8');
    expect(calls.split('"PUT"').length - 1).to.equal(1);
    expect(calls).not.to.include('"edit"');
    const record = path.join(fixture.repo, '.git/.anthracite_landing');
    z.object({ version: z.literal(2) }).parse(
      JSON.parse(fs.readFileSync(record, 'utf8'))
    );
    const remote = fixture.git(['for-each-ref'], github.remote);
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(0);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
    expect(observer.client()).to.have.length(0);
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('resolved child');
    expect(
      fixture.git(['log', '-1', '--format=%an <%ae>%n%B', 'child'])
    ).to.equal(author);
    expect(fs.existsSync(record)).to.equal(true);
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    const transactions = observer.client().flatMap((entry) => entry.refs);
    expect(observer.client()).to.have.length(5);
    expect(
      transactions
        .filter((entry) => entry.next !== '0'.repeat(40))
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip']);
    expect(
      observer
        .received()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.ref !== 'refs/heads/main')
    ).to.have.deep.members(transactions);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('resolved child');
    expect(fixture.git(['show', 'main:tip.txt'])).to.equal('tip');
    expect(fs.existsSync(record)).to.equal(false);
  });

  it('preserves released version-1 eager scheduling after a partial mandatory PR update', function () {
    const legacy = process.env.ANTHRACITE_TEST_LEGACY_BINARY;
    if (!legacy) this.skip();
    const github = prepareLand(fixture);
    const observer = observeLandingPushes(fixture, github.remote);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, failPrEditNumber: 18 })
    );
    const stopped = spawnSync(
      legacy,
      ['land', 'tip', '--yes', '--no-interactive'],
      {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
        timeout: 180000,
      }
    );
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('survivor maintenance');
    expect(observer.client()).to.have.length(1);
    const file = path.join(fixture.repo, '.git/.anthracite_landing');
    const bytes = fs.readFileSync(file, 'utf8');
    z.object({ version: z.literal(1) }).parse(JSON.parse(bytes));
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(1);
    expect(preview.stdout).not.to.include('publication deferred');
    expect(fs.readFileSync(file, 'utf8')).to.equal(bytes);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const prs = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    for (const pr of prs) {
      pr.mergeStateStatus = 'UNSTABLE';
      pr.statusCheckRollup = [
        {
          __typename: 'CheckRun',
          name: 'optional-preview',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
      ];
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const resumed = fixture.run([
      'land',
      'tip',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(resumed.stdout).to.include('optional-preview: FAILURE');
    const transactions = observer.client().flatMap((entry) => entry.refs);
    expect(observer.client()).to.have.length(6);
    expect(
      transactions
        .filter((entry) => entry.next !== '0'.repeat(40))
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip', 'refs/heads/tip']);
    expect(
      observer
        .received()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.ref !== 'refs/heads/main')
    ).to.have.deep.members(transactions);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    for (const name of ['base', 'child', 'tip'])
      expect(fixture.git(['show', `main:${name}.txt`])).to.equal(name);
    expect(fs.existsSync(file)).to.equal(false);
  });

  it('learns, previews and resumes deferred publication across MCP sessions', async () => {
    const github = prepareLand(fixture, ['unit']);
    const observer = observeLandingPushes(fixture, github.remote);
    const originalTip = fixture.git(['rev-parse', 'tip'], github.remote);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    let connection = new McpCliClient(fixture.repo, fixture.env);
    try {
      await connection.connect();
      const learned = await connection.client.callTool({ name: 'learn_an' });
      expect(JSON.stringify(learned))
        .to.include('later merge targets defer publication')
        .and.include('version-1 landings retain eager publication')
        .and.include('Finish a pending version-2 landing before downgrading');
      expect(fixture.ok(['land', '--help'])).to.include('deferred publication');
      const before = fixture.inspectionSnapshot();
      const preview = await run(connection, ['land', 'tip', '--dry-run']);
      expect(preview.stdout)
        .to.include('tip #19 (publication deferred')
        .and.include('READY for next merge only');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(observer.client()).to.have.length(0);
      fs.writeFileSync(
        github.policy,
        JSON.stringify({ ...policy, pendingAfterPush: true })
      );
      await run(connection, ['land', 'tip', '--yes', '--wait-timeout', '0'], 1);
      expect(fixture.git(['rev-parse', 'tip'], github.remote)).to.equal(
        originalTip
      );
      expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(originalTip);
      expect(observer.client()).to.have.length(2);
      await connection.close();
      connection = new McpCliClient(fixture.repo, fixture.env);
      await connection.connect();
      const state = z
        .array(z.record(z.string(), z.unknown()))
        .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
      for (const pr of state) {
        pr.mergeStateStatus = 'CLEAN';
        pr.statusCheckRollup = [
          {
            __typename: 'CheckRun',
            name: 'unit',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          },
        ];
      }
      fs.writeFileSync(github.state, JSON.stringify(state));
      fs.writeFileSync(github.policy, JSON.stringify(policy));
      const paused = fixture.inspectionSnapshot();
      expect((await run(connection, ['land', 'tip', '--dry-run'])).stdout)
        .to.include('tip #19 (publication deferred')
        .and.include('READY for next merge only');
      expect(fixture.inspectionSnapshot()).to.deep.equal(paused);
      await run(connection, ['land', 'tip', '--yes', '--wait-timeout', '0']);
      const updates = observer.client().flatMap((entry) => entry.refs);
      expect(observer.client()).to.have.length(5);
      expect(
        updates
          .filter((entry) => entry.next !== '0'.repeat(40))
          .map((entry) => entry.ref)
      ).to.deep.equal(['refs/heads/child', 'refs/heads/tip']);
      expect(
        observer
          .received()
          .flatMap((entry) => entry.refs)
          .filter((entry) => entry.ref !== 'refs/heads/main')
      ).to.have.deep.members(updates);
      expect(fixture.git(['rev-parse', 'main^{tree}'])).to.equal(tree);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(3);
      expect(connection.errors).to.deep.equal([]);
    } finally {
      await connection.close();
    }
  });
});
