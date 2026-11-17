import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';

const progressSchema = z
  .object({
    version: z.number(),
    index: z.number(),
    phase: z.string(),
    merges: z.array(
      z
        .object({
          head: z.string(),
          reached: z.object({ head: z.string() }).optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();
const prsSchema = z.array(
  z
    .object({
      number: z.number(),
      state: z.string(),
      body: z.string(),
    })
    .passthrough()
);

// eslint-disable-next-line max-lines-per-function
describe('public partial-stack landing retry', function () {
  this.timeout(600000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 180000;
  });
  afterEach(() => fixture?.cleanup());

  for (const version of [1, 2]) {
    // eslint-disable-next-line max-lines-per-function
    it(`retains reached heads and survivor publication for version ${version}`, function () {
      const producer =
        version === 1
          ? process.env.ANTHRACITE_TEST_LANDING_V1_PRODUCER
          : process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER;
      if (!producer) this.skip();
      fixture.branch('published-sibling', 'base');
      const github = prepareLand(fixture);
      fs.writeFileSync(
        github.state,
        JSON.stringify([
          ...github.prs,
          {
            ...github.pr('published-sibling', 20),
            body: 'Keep survivor prose',
            assignees: [{ login: 'survivor-owner' }],
          },
          {
            ...github.pr('other', 21),
            body: 'Independent description',
            assignees: [{ login: 'independent-owner' }],
          },
        ])
      );
      fixture.branch('local-only', 'base');
      fixture.git(['switch', 'tip']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const other = fixture.git(['rev-parse', 'other']);
      const otherMetadata = fixture.git([
        'rev-parse',
        'refs/branch-metadata/other',
      ]);
      const observer = observeLandingPushes(fixture, github.remote);
      const gh = path.join(github.bin, 'gh');
      const original = fs.readFileSync(gh, 'utf8');
      fs.writeFileSync(
        gh,
        original.replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          "if (endpoint.endsWith('/18/merge')) { process.stderr.write('error connecting to api.github.com: timeout\\n'); process.exit(1); }\nconst input = JSON.parse(fs.readFileSync(0, 'utf8'));"
        )
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
      const file = path.join(fixture.repo, '.git/.anthracite_landing');
      const saved = fs.readFileSync(file, 'utf8');
      const progress = progressSchema.parse(JSON.parse(saved));
      expect(progress.version).to.equal(version);
      expect(progress.index).to.equal(1);
      expect(progress.phase).to.equal('merge-requested');
      const current = progress.merges[1];
      expect(current.reached?.head).not.to.equal(current.head);
      expect(current.reached?.head).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(
        prsSchema
          .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')))
          .map((pr) => pr.state)
      ).to.deep.equal(['MERGED', 'OPEN', 'OPEN', 'OPEN', 'OPEN']);
      const updates = () =>
        observer
          .client()
          .flatMap((event) => event.refs)
          .filter((ref) => ref.next !== '0'.repeat(40))
          .map((ref) => ref.ref);
      expect(updates()).to.have.members(
        version === 1
          ? [
              'refs/heads/child',
              'refs/heads/tip',
              'refs/heads/published-sibling',
            ]
          : ['refs/heads/child', 'refs/heads/published-sibling']
      );
      fs.writeFileSync(
        gh,
        original.replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          "const input = JSON.parse(fs.readFileSync(0, 'utf8')); fs.appendFileSync(process.env.ANTHRACITE_TEST_PR_CALLS, JSON.stringify(input) + '\\n');"
        )
      );
      const calls = fs.readFileSync(github.calls, 'utf8');
      const policy = fs.readFileSync(github.policy, 'utf8');
      if (version === 2)
        fs.writeFileSync(
          github.policy,
          JSON.stringify({ ...JSON.parse(policy), failPrEditNumber: 19 })
        );
      let result = fixture.run([
        'land',
        'tip',
        '--retry-unconfirmed',
        '--yes',
        '--no-interactive',
      ]);
      if (version === 2) {
        expect(result.status, result.stdout + result.stderr).to.equal(1);
        expect(result.stderr).to.include('survivor');
        expect(fs.existsSync(file)).to.equal(true);
        fs.writeFileSync(github.policy, policy);
        result = fixture.run(['land', 'tip', '--yes', '--no-interactive']);
      }
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fs.existsSync(file)).to.equal(false);
      const effects = fs.readFileSync(github.calls, 'utf8').slice(calls.length);
      expect(effects.match(/"PUT"/g)).to.have.length(2);
      expect(effects).not.to.include('/pulls/17/merge');
      expect(effects).to.include(current.reached?.head);
      expect(updates()).to.have.members(
        version === 1
          ? [
              'refs/heads/child',
              'refs/heads/tip',
              'refs/heads/published-sibling',
              'refs/heads/tip',
            ]
          : [
              'refs/heads/child',
              'refs/heads/published-sibling',
              'refs/heads/tip',
            ]
      );
      expect(
        observer
          .client()
          .flatMap((event) => event.refs)
          .filter((ref) => ref.next === '0'.repeat(40))
          .map((ref) => ref.ref)
      ).to.have.members([
        'refs/heads/base',
        'refs/heads/child',
        'refs/heads/tip',
      ]);
      for (const branch of ['base', 'child', 'tip'])
        expect(
          fixture.git([
            'for-each-ref',
            `refs/heads/${branch}`,
            `refs/branch-metadata/${branch}`,
          ])
        ).to.equal('');
      expect(fixture.git(['rev-parse', 'main^{tree}'])).to.equal(tree);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
      expect(fixture.git(['rev-parse', 'main'])).to.equal(
        fixture.git(['rev-parse', 'main'], github.remote)
      );
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/other'])).to.equal(
        otherMetadata
      );
      expect(fixture.git(['rev-parse', 'other'], github.remote)).to.equal(
        other
      );
      expect(
        fixture.git(['for-each-ref', 'refs/heads/local-only'], github.remote)
      ).to.equal('');
      for (const branch of ['published-sibling', 'local-only'])
        expect(fixture.git(['show', `${branch}:${branch}.txt`])).to.equal(
          branch
        );
      expect(
        fixture.git(['rev-parse', 'published-sibling'], github.remote)
      ).to.equal(fixture.git(['rev-parse', 'published-sibling']));
      const prs = prsSchema.parse(
        JSON.parse(fs.readFileSync(github.state, 'utf8'))
      );
      expect(prs[3].body).to.include('Keep survivor prose');
      expect(prs[3].assignees).to.deep.equal([{ login: 'survivor-owner' }]);
      expect(prs[4].body).to.equal('Independent description');
      expect(prs[4].assignees).to.deep.equal([{ login: 'independent-owner' }]);
      const archive = path.join(fixture.repo, '.git/.anthracite_landing_retry');
      expect(
        fs.readFileSync(
          path.join(archive, fs.readdirSync(archive)[0], 'original.json'),
          'utf8'
        )
      ).to.equal(saved);
    });
  }
  it('requires fresh named consent for a later uncertain merge', () => {
    const github = prepareLand(fixture);
    const file = path.join(fixture.repo, '.git/.anthracite_landing');
    const gh = path.join(github.bin, 'gh');
    const original = fs.readFileSync(gh, 'utf8');
    const failMerge = (number: number): void =>
      fs.writeFileSync(
        gh,
        original.replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          `if (endpoint.endsWith('/${number}/merge')) { process.stderr.write('error connecting to api.github.com: timeout\\n'); process.exit(1); }\nconst input = JSON.parse(fs.readFileSync(0, 'utf8'));`
        )
      );
    failMerge(18);
    const stopped = fixture.run(['land', 'tip', '--yes', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(
      progressSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))).index
    ).to.equal(1);
    failMerge(19);
    const retry = fixture.run([
      'land',
      'tip',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(1);
    const saved = progressSchema.parse(
      JSON.parse(fs.readFileSync(file, 'utf8'))
    );
    expect(saved.index).to.equal(2);
    expect(saved.phase).to.equal('merge-requested');
    const calls = fs.readFileSync(github.calls, 'utf8');
    expect(calls.match(/\/pulls\/17\/merge/g)).to.have.length(1);
    expect(calls.match(/\/pulls\/18\/merge/g)).to.have.length(2);
    expect(calls.match(/\/pulls\/19\/merge/g)).to.have.length(1);
    fs.writeFileSync(gh, original);
    const plain = fixture.run(['land', 'tip', '--yes', '--no-interactive']);
    expect(plain.status, plain.stdout + plain.stderr).to.equal(1);
    expect(plain.stderr).to.include('unconfirmed');
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
    const retained = progressSchema.parse(
      JSON.parse(fs.readFileSync(file, 'utf8'))
    );
    expect({ ...retained, cacheLock: undefined }).to.deep.equal({
      ...saved,
      cacheLock: undefined,
    });
    const recovered = fixture.run([
      'land',
      'tip',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
    expect(recovered.status, recovered.stdout + recovered.stderr).to.equal(0);
    const finalCalls = fs.readFileSync(github.calls, 'utf8');
    expect(finalCalls.match(/\/pulls\/17\/merge/g)).to.have.length(1);
    expect(finalCalls.match(/\/pulls\/18\/merge/g)).to.have.length(2);
    expect(finalCalls.match(/\/pulls\/19\/merge/g)).to.have.length(2);
    expect(fs.existsSync(file)).to.equal(false);
  });
});
