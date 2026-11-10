import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { z } from 'zod';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';

// eslint-disable-next-line max-lines-per-function
describe('public deferred landing publication', function () {
  this.timeout(600000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 480000;
  });
  afterEach(() => fixture?.cleanup());

  it('publishes each future target only before its own merge in a three-PR chain', () => {
    const github = prepareLand(fixture);
    fixture.git(['switch', 'tip']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const unrelated = fixture.git(['rev-parse', 'other']);
    const observer = observeLandingPushes(fixture, github.remote);
    const result = fixture.run(['land', 'tip', '--yes', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(observer.client()).to.have.length(5);
    expect(
      observer.client().every((entry) => entry.refs.length === 1)
    ).to.equal(true);
    const client = observer.client().flatMap((entry) => entry.refs);
    const updates = client.filter((entry) => entry.next !== '0'.repeat(40));
    const deletions = client.filter((entry) => entry.next === '0'.repeat(40));
    expect(updates.map((entry) => entry.ref)).to.deep.equal([
      'refs/heads/child',
      'refs/heads/tip',
    ]);
    expect(deletions.map((entry) => entry.ref)).to.deep.equal([
      'refs/heads/base',
      'refs/heads/child',
      'refs/heads/tip',
    ]);
    const received = observer.received().flatMap((entry) => entry.refs);
    expect(
      received.filter((entry) => entry.ref !== 'refs/heads/main')
    ).to.have.deep.members(client);
    expect(fixture.git(['rev-parse', 'main^{tree}'])).to.equal(tree);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
    expect(fixture.git(['rev-parse', 'other'], github.remote)).to.equal(
      unrelated
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    expect(result.stdout).to.include('Deferred: tip');
  });

  for (const withSiblings of [false, true]) {
    it(`uses six target updates for seven PRs with sibling maintenance ${withSiblings}`, () => {
      const chain = ['base', 'child', 'tip', 'four', 'five', 'six', 'seven'];
      for (let index = 3; index < chain.length; index++)
        fixture.branch(chain[index], chain[index - 1]);
      if (withSiblings) fixture.branch('published-sibling', 'base');
      const github = prepareLand(fixture, withSiblings ? ['unit'] : []);
      const published = [
        ...chain,
        ...(withSiblings ? ['published-sibling'] : []),
      ];
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          published.map((name, index) => github.pr(name, 17 + index))
        )
      );
      if (withSiblings) fixture.branch('local-only', 'base');
      fixture.git(['switch', 'seven']);
      const tree = fixture.git(['rev-parse', 'seven^{tree}']);
      const unrelated = fixture.git(['rev-parse', 'other']);
      const observer = observeLandingPushes(fixture, github.remote);
      const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
      if (withSiblings)
        fs.writeFileSync(
          github.policy,
          JSON.stringify({ ...policy, pendingAfterPush: true })
        );
      let result = fixture.run([
        'land',
        'seven',
        '--yes',
        '--wait-timeout',
        '0',
      ]);
      if (withSiblings) {
        expect(result.status, result.stdout + result.stderr).to.equal(1);
        expect(result.stderr).to.include('Check wait timed out before #18');
        const first = observer.client().flatMap((entry) => entry.refs);
        expect(
          first
            .filter((entry) => entry.next !== '0'.repeat(40))
            .map((entry) => entry.ref)
        ).to.deep.equal(['refs/heads/child', 'refs/heads/published-sibling']);
        expect(
          first.filter((entry) => entry.next === '0'.repeat(40))
        ).to.have.length(1);
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
        result = fixture.run(['land', 'seven', '--yes', '--wait-timeout', '0']);
      }
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(observer.client()).to.have.length(withSiblings ? 14 : 13);
      expect(
        observer.client().every((entry) => entry.refs.length === 1)
      ).to.equal(true);
      const client = observer.client().flatMap((entry) => entry.refs);
      const updates = client.filter((entry) => entry.next !== '0'.repeat(40));
      expect(updates).to.have.length(withSiblings ? 7 : 6);
      for (const name of chain.slice(1))
        expect(
          updates.filter((entry) => entry.ref === 'refs/heads/' + name)
        ).to.have.length(1);
      expect(
        client.filter((entry) => entry.next === '0'.repeat(40))
      ).to.have.length(7);
      expect(
        observer
          .received()
          .flatMap((entry) => entry.refs)
          .filter((entry) => entry.ref !== 'refs/heads/main')
      ).to.have.deep.members(client);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(7);
      expect(fixture.git(['rev-parse', 'main^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
      expect(fixture.git(['rev-parse', 'other'], github.remote)).to.equal(
        unrelated
      );
      if (withSiblings) {
        expect(
          fixture.git(
            ['for-each-ref', '--format=%(refname)', 'refs/heads/local-only'],
            github.remote
          )
        ).to.equal('');
        for (const branch of ['published-sibling', 'local-only'])
          expect(fixture.git(['show', `${branch}:${branch}.txt`])).to.equal(
            branch
          );
        expect(
          fixture.git(['rev-parse', 'published-sibling'], github.remote)
        ).to.equal(fixture.git(['rev-parse', 'published-sibling']));
      }
    });
  }

  it('resumes a released version-1 record with its eager publication schedule', function () {
    const legacy = process.env.ANTHRACITE_TEST_LEGACY_BINARY;
    if (!legacy) this.skip();
    const github = prepareLand(fixture, ['unit']);
    const observer = observeLandingPushes(fixture, github.remote);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
    const stopped = spawnSync(
      legacy,
      ['land', 'tip', '--yes', '--no-interactive', '--wait-timeout', '0'],
      {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
        timeout: 180000,
      }
    );
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('Check wait timed out before #18');
    z.object({ version: z.literal(1) }).parse(
      JSON.parse(
        fs.readFileSync(
          path.join(fixture.repo, '.git/.anthracite_landing'),
          'utf8'
        )
      )
    );
    expect(
      observer
        .client()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.next !== '0'.repeat(40))
    ).to.have.length(2);
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
    const result = fixture.run(['land', 'tip', '--yes', '--wait-timeout', '0']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      observer
        .client()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.next !== '0'.repeat(40))
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip', 'refs/heads/tip']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
  });

  it('preserves malformed version-2 publication identities before effects', () => {
    const github = prepareLand(fixture, ['unit']);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
    const stopped = fixture.run([
      'land',
      'tip',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    const file = path.join(fixture.repo, '.git/.anthracite_landing');
    const bytes = fs.readFileSync(file, 'utf8');
    for (const malformed of [
      bytes.replace(/"version":2/, '"version":3'),
      bytes.replace(/("reached":\{[^}]*),"remoteHead":"[a-f0-9]{40}"\}/, '$1}'),
    ]) {
      expect(malformed).not.to.equal(bytes);
      fs.writeFileSync(file, malformed);
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      const calls = fs.readFileSync(github.calls, 'utf8');
      const result = fixture.run(['land', 'tip', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('Invalid or foreign landing recovery');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
    }
  });

  it('does not overwrite a deferred target changed externally after the first merge', () => {
    const github = prepareLand(fixture);
    const foreign = fixture.git(
      [
        'commit-tree',
        fixture.git(['rev-parse', 'tip^{tree}']),
        '-p',
        fixture.git(['rev-parse', 'tip']),
        '-m',
        'Concurrent remote tip',
      ],
      github.remote
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-checkout'),
      `#!/bin/sh\ngit --git-dir='${github.remote}' update-ref refs/heads/tip ${foreign}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['land', 'tip', '--yes', '--wait-timeout', '0']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include(
      'Remote head changed for tip; captured-OID lease refused survivor push.'
    );
    expect(fixture.git(['rev-parse', 'tip'], github.remote)).to.equal(foreign);
    const prs = z
      .array(z.object({ state: z.string() }))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    expect(prs.map((pr) => pr.state)).to.deep.equal(['MERGED', 'OPEN', 'OPEN']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
});
