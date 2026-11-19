import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { z } from 'zod';
import { prepareLand } from '../lib/fixtures/land_gh';
import { McpCliClient } from '../lib/mcp_client';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('public landing replay delivery', function () {
  this.timeout(300000);
  it('explains the preserving replay gate in public help', () => {
    const fixture = new RelationCliFixture();
    try {
      const help = fixture.run(['land', '--help']);
      expect(help.status, help.stdout + help.stderr).to.equal(0);
      expect(help.stdout.replace(/\s+/g, ' '))
        .to.include('replay conflicts before the first merge')
        .and.to.include('replay feasibility')
        .and.to.include('deferred publication');
    } finally {
      fixture.cleanup();
    }
  });
  it('learns the replay boundary and preserves a known conflict through the existing MCP tools', async () => {
    const fixture = new RelationCliFixture();
    const github = prepareLand(fixture);
    const connection = new McpCliClient(fixture.repo, fixture.env);
    try {
      const clone = path.join(fixture.root, 'independent');
      fixture.git(['clone', github.remote, clone]);
      fixture.git(['switch', 'main'], clone);
      fs.writeFileSync(
        path.join(clone, 'child.txt'),
        'independent trunk work\n'
      );
      fixture.git(['add', 'child.txt'], clone);
      fixture.git(['commit', '-m', 'Independent trunk work'], clone);
      fixture.git(['push', 'origin', 'main'], clone);
      await connection.connect();
      const tools = await connection.client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).to.deep.equal([
        'learn_an',
        'run_an_cmd',
      ]);
      const learned = await connection.client.callTool({ name: 'learn_an' });
      const text = z
        .object({
          content: z.array(
            z.object({ type: z.literal('text'), text: z.string() })
          ),
        })
        .parse(learned)
        .content.map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ');
      expect(text)
        .to.include('isolated replay')
        .and.to.include('before the first merge')
        .and.to.include('future remote changes');
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      const response = await connection.client.callTool({
        name: 'run_an_cmd',
        arguments: {
          args: ['land', 'tip', '--dry-run'],
          cwd: fixture.repo,
          why: 'Inspect the approved synthetic conflict without merging or publishing',
        },
      });
      const payload = z
        .object({
          content: z.array(
            z.object({ type: z.literal('text'), text: z.string() })
          ),
        })
        .parse(response).content[0];
      if (!payload) throw new Error('Missing MCP result');
      const result = z
        .object({
          status: z.string(),
          stdout: z.string(),
          stderr: z.string(),
          exitCode: z.number(),
          signal: z.null(),
          truncated: z.boolean(),
        })
        .parse(JSON.parse(payload.text));
      expect(result).to.include({
        status: 'cli_error',
        exitCode: 1,
        signal: null,
        truncated: false,
      });
      expect(result.stdout)
        .to.include('Replay conflict in child')
        .and.to.include('child.txt')
        .and.not.to.include('READY for next merge');
      expect(response.isError).to.equal(true);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fs.readFileSync(github.calls, 'utf8'))
        .not.to.include('"PUT"')
        .and.not.to.include('"edit"');
    } finally {
      await connection.close();
      fixture.cleanup();
    }
  });
  for (const version of [1, 2] as const)
    it(`preserves supported published version-${version} landing recovery and publication scope`, function () {
      const producer =
        process.env[
          version === 1
            ? 'ANTHRACITE_TEST_LANDING_V1_PRODUCER'
            : 'ANTHRACITE_TEST_LANDING_V2_PRODUCER'
        ];
      if (!producer) this.skip();
      const fixture = new RelationCliFixture();
      fixture.commandTimeoutMs = 240000;
      try {
        const github = prepareLand(fixture);
        const observer = observeLandingPushes(fixture, github.remote);
        const policy = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(fs.readFileSync(github.policy, 'utf8')));
        fs.writeFileSync(
          github.policy,
          JSON.stringify({ ...policy, failPrEditNumber: 18 })
        );
        const stopped = spawnSync(
          producer,
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
        const record = path.join(fixture.repo, '.git/.anthracite_landing');
        const saved = fs.readFileSync(record, 'utf8');
        expect(
          z.object({ version: z.number() }).parse(JSON.parse(saved)).version
        ).to.equal(version);
        const before = fixture.inspectionSnapshot();
        const remote = fixture.git(['for-each-ref'], github.remote);
        const calls = fs.readFileSync(github.calls, 'utf8');
        const preview = fixture.run(['land', 'tip', '--dry-run']);
        expect(preview.status, preview.stdout + preview.stderr).to.be.oneOf([
          0, 1,
        ]);
        expect(preview.stdout)
          .to.include('Pending landing')
          .and.not.to.include('Replay: conflict-free for captured inputs');
        expect(fs.readFileSync(record, 'utf8')).to.equal(saved);
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
        expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
        expect(fs.readFileSync(github.calls, 'utf8').slice(calls.length))
          .not.to.include('"PUT"')
          .and.not.to.include('"edit"');
        fs.writeFileSync(github.policy, JSON.stringify(policy));
        const resumed = fixture.run([
          'land',
          'tip',
          '--yes',
          '--wait-timeout',
          '0',
        ]);
        expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
        expect(resumed.stdout).not.to.include(
          'Replay: conflict-free for captured inputs'
        );
        const transactions = observer.client().flatMap((entry) => entry.refs);
        const updates = transactions
          .filter((entry) => entry.next !== '0'.repeat(40))
          .map((entry) => entry.ref);
        expect(updates).to.deep.equal(
          version === 1
            ? ['refs/heads/child', 'refs/heads/tip', 'refs/heads/tip']
            : ['refs/heads/child', 'refs/heads/tip']
        );
        expect(
          observer
            .received()
            .flatMap((entry) => entry.refs)
            .filter((entry) => entry.ref !== 'refs/heads/main')
        ).to.have.deep.members(transactions);
        expect(
          fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
        ).to.equal(3);
        for (const branch of ['base', 'child', 'tip'])
          expect(fixture.git(['show', `main:${branch}.txt`])).to.equal(branch);
        expect(fs.existsSync(record)).to.equal(false);
      } finally {
        fixture.cleanup();
      }
    });
});
