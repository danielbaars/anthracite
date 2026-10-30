import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
});

describe('MCP head-bound review and scoped landing through stdio', function () {
  this.timeout(180000);
  it('inspects, reviews one head, lands a synthetic fanout prefix and reconnects for local-only recovery', async () => {
    const fixture = new RelationCliFixture();
    const connections: McpCliClient[] = [];
    try {
      const github = prepareLand(fixture);
      fixture.branch('sibling', 'base');
      const siblingTree = fixture.git(['rev-parse', 'sibling^{tree}']);
      fixture.git(['push', 'origin', 'sibling']);
      fs.writeFileSync(
        github.state,
        JSON.stringify([...github.prs, github.pr('sibling', 20)])
      );
      const landGh = path.join(github.bin, 'land.cjs');
      fs.copyFileSync(path.join(github.bin, 'gh'), landGh);
      const reviewGh = path.join(
        __dirname,
        '../lib/fixtures/review_gh_boundary.js'
      );
      fixture.env.ANTHRACITE_TEST_REVIEW_REMOTE = github.remote;
      fixture.env.ANTHRACITE_TEST_REVIEWS = path.join(
        fixture.root,
        'reviews.json'
      );
      fs.writeFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS, '[]');
      fs.writeFileSync(
        path.join(github.bin, 'gh'),
        `#!${
          process.execPath
        }\nconst a=process.argv.slice(2);require(a[0]==='api' && (a[1]==='user'||a[1].includes('/reviews')||a.includes('Accept: application/vnd.github.diff')) ? ${JSON.stringify(
          reviewGh
        )} : ${JSON.stringify(landGh)});`,
        { mode: 0o755 }
      );
      const connect = async (): Promise<McpCliClient> => {
        const connection = new McpCliClient(fixture.repo, fixture.env);
        connections.push(connection);
        await connection.connect();
        return connection;
      };
      const run = async (
        connection: McpCliClient,
        args: string[],
        exitCode = 0
      ) => {
        const response = await connection.client.callTool({
          name: 'run_an_cmd',
          arguments: {
            args,
            cwd: fixture.repo,
            why: 'Verify explicit selected synthetic review and landing',
          },
        });
        const content = response.content;
        if (
          !Array.isArray(content) ||
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
      const connection = await connect();
      const before = fixture.inspectionSnapshot();
      const remoteBefore = fixture.git(['for-each-ref'], github.remote);
      const learned = await connection.client.callTool({ name: 'learn_an' });
      expect(JSON.stringify(learned)).to.include('local-only');
      expect((await run(connection, ['pr', 'base'])).stdout).to.include(
        String(github.prs[0].headRefOid)
      );
      expect(
        (await run(connection, ['land', 'base', '--dry-run'])).stdout
      ).to.include('sibling');
      await run(connection, ['land', 'base'], 1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(
        remoteBefore
      );
      await run(connection, [
        'review',
        'base',
        '--comment',
        '--head',
        String(github.prs[0].headRefOid),
        '--body',
        'Reviewed this exact synthetic head.',
      ]);
      const reviews = JSON.parse(
        fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS, 'utf8')
      );
      expect(reviews).to.have.length(1);
      expect(reviews[0]).to.include({
        state: 'COMMENTED',
        commit_id: github.prs[0].headRefOid,
        body: 'Reviewed this exact synthetic head.',
      });
      const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
      fs.writeFileSync(
        github.policy,
        JSON.stringify({ ...policy, replayConflict: true })
      );
      expect(
        (await run(connection, ['land', 'base', '--yes'], 1)).stderr
      ).to.include('an continue');
      const remotePaused = fixture.git(['for-each-ref'], github.remote);
      const callsPaused = fs.readFileSync(github.calls, 'utf8');
      await connection.close();
      connections.splice(connections.indexOf(connection), 1);
      const fresh = await connect();
      const paused = fixture.inspectionSnapshot();
      const pausedPrs = fs.readFileSync(github.state, 'utf8');
      const preview = await run(fresh, ['land', 'base', '--dry-run'], 1);
      expect(preview.stdout)
        .to.include('Pending landing')
        .and.include('Local replay incomplete');
      expect(preview.stderr).to.include('Pending landing preview blocked');
      expect(fixture.inspectionSnapshot()).to.deep.equal(paused);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(
        remotePaused
      );
      expect(fs.readFileSync(github.state, 'utf8')).to.equal(pausedPrs);
      const afterPreviewCalls = fs.readFileSync(github.calls, 'utf8');
      expect(afterPreviewCalls).to.include(callsPaused);
      fs.writeFileSync(
        path.join(fixture.repo, 'child.txt'),
        'resolved child\n'
      );
      fixture.git(['add', 'child.txt']);
      await run(fresh, ['continue']);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(
        remotePaused
      );
      expect(fs.readFileSync(github.calls, 'utf8')).to.equal(afterPreviewCalls);
      fs.writeFileSync(github.policy, JSON.stringify(policy));
      await run(fresh, ['land', 'base', '--yes']);
      expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
      expect(fixture.ok(['info', 'sibling'])).to.include('Parent: main');
      expect(fixture.git(['rev-parse', 'sibling^{tree}'])).not.to.equal(
        siblingTree
      );
      expect(fixture.git(['show', 'sibling:sibling.txt'])).to.equal('sibling');
      expect(fixture.git(['show', 'tip:child.txt'], github.remote)).to.equal(
        'resolved child'
      );
      for (const branch of ['child', 'tip', 'sibling'])
        expect(fixture.git(['rev-parse', branch], github.remote)).to.equal(
          fixture.git(['rev-parse', branch])
        );
      const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
      expect(prs.map((pr: { state: string }) => pr.state)).to.deep.equal([
        'MERGED',
        'OPEN',
        'OPEN',
        'OPEN',
      ]);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      expect(
        JSON.parse(fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS, 'utf8'))
      ).to.have.length(1);
      expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
      for (const current of connections) {
        expect(current.errors).to.deep.equal([]);
        expect(current.stderr).to.equal('');
      }
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
      fixture.cleanup();
    }
  });
});
