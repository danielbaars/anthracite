import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import {
  emptyPrivatePolicyEvidence,
  planRulesFailure,
  preparePrivatePlanLand,
} from '../lib/fixtures/land_private_policy';

/* eslint-disable max-lines-per-function */
describe('public landing with independently verified private-plan policy', function () {
  this.timeout(180000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof preparePrivatePlanLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 120000;
    github = preparePrivatePlanLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  function setPolicy(changes: Readonly<Record<string, unknown>>): void {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(github.policy, 'utf8')),
        ...changes,
      })
    );
  }

  function preservingPreview(status: number, message: string): void {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(status);
    expect(result.stdout + result.stderr).to.include(message);
    expect(result.stdout + result.stderr).not.to.include(
      'SENSITIVE_POLICY_DETAIL'
    );
    if (status !== 0) expect(result.stdout).not.to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  }

  it('previews a private trunk after plan denial only when independent empty protection evidence is complete', () => {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      'Policy: Independently verified despite plan-restricted REST access.'
    );
    expect(result.stdout).to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('lands a verified private-plan prefix and preserves successor work and PR identities', () => {
    const childPatch = fixture.git(['diff', '--binary', 'base', 'child']);
    const tipPatch = fixture.git(['diff', '--binary', 'child', 'tip']);
    const unrelated = fixture.git(['rev-parse', 'other']);
    const result = fixture.run(['land', 'base', '--yes', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      'Independently verified despite plan-restricted REST access.'
    );
    expect(result.stdout).to.include('Landing complete');
    const prs: ReadonlyArray<{
      readonly number: number;
      readonly state: string;
      readonly baseRefName: string;
    }> = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(prs.map((pr) => [pr.number, pr.state])).to.deep.equal([
      [17, 'MERGED'],
      [18, 'OPEN'],
      [19, 'OPEN'],
    ]);
    expect(prs[1]?.baseRefName).to.equal('main');
    expect(prs[2]?.baseRefName).to.equal('child');
    expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
    expect(fixture.git(['diff', '--binary', 'main', 'child'])).to.equal(
      childPatch
    );
    expect(fixture.git(['diff', '--binary', 'child', 'tip'])).to.equal(
      tipPatch
    );
    expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(fixture.git(['show-ref', '--heads'], github.remote)).not.to.include(
      'refs/heads/base'
    );
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
  });

  for (const evidence of [
    { name: 'unavailable evidence', response: null },
    {
      name: 'public visibility',
      response: emptyPrivatePolicyEvidence({ isPrivate: false }),
    },
    {
      name: 'non-administrator visibility',
      response: emptyPrivatePolicyEvidence({ viewerPermission: 'WRITE' }),
    },
    {
      name: 'a foreign repository',
      response: emptyPrivatePolicyEvidence({
        nameWithOwner: 'other/inspection',
      }),
    },
    {
      name: 'a foreign trunk',
      response: emptyPrivatePolicyEvidence({
        ref: { name: 'other', branchProtectionRule: null },
      }),
    },
    {
      name: 'a missing trunk',
      response: emptyPrivatePolicyEvidence({ ref: null }),
    },
    {
      name: 'present classic protection',
      response: emptyPrivatePolicyEvidence({
        ref: { name: 'main', branchProtectionRule: { id: 'classic' } },
      }),
    },
    {
      name: 'omitted classic protection',
      response: emptyPrivatePolicyEvidence({ ref: { name: 'main' } }),
    },
    {
      name: 'an incomplete zero-count inventory',
      response: emptyPrivatePolicyEvidence({ rulesets: { totalCount: 0 } }),
    },
    {
      name: 'a nonempty inventory in the empty-only slice',
      response: emptyPrivatePolicyEvidence({
        rulesets: {
          totalCount: 1,
          nodes: [{ id: 'rule', enforcement: 'DISABLED' }],
          pageInfo: { hasNextPage: false, endCursor: 'final' },
        },
      }),
    },
    {
      name: 'an inconsistent terminal page',
      response: emptyPrivatePolicyEvidence({
        rulesets: {
          totalCount: 0,
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: null },
        },
      }),
    },
    {
      name: 'partial data with GraphQL errors',
      response: {
        ...emptyPrivatePolicyEvidence(),
        errors: [{ message: 'SENSITIVE_POLICY_DETAIL' }],
      },
    },
    { name: 'a null repository', response: { data: { repository: null } } },
  ]) {
    it(`refuses ${evidence.name} as proof of absent private policy`, () => {
      setPolicy({ planAbsenceResponse: evidence.response });
      preservingPreview(1, 'Plan-restricted GitHub policy unverified');
    });
  }

  for (const prerequisites of [
    {
      name: 'public REST visibility',
      changes: { repository: { private: false, permissions: { admin: true } } },
    },
    {
      name: 'missing REST visibility',
      changes: { repository: { permissions: { admin: true } } },
    },
    {
      name: 'missing REST administrator access',
      changes: { repository: { private: true } },
    },
    {
      name: 'non-administrator REST access',
      changes: { repository: { private: true, permissions: { admin: false } } },
    },
    { name: 'a protected REST trunk', changes: { protected: true } },
  ]) {
    it(`refuses ${prerequisites.name} before querying independent proof`, () => {
      setPolicy(prerequisites.changes);
      preservingPreview(1, 'Plan-restricted GitHub policy unverified');
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
    });
  }

  for (const failure of [
    {
      name: 'generic 403',
      changes: { rulesFailure: { message: 'Forbidden', status: '403' } },
    },
    {
      name: 'authentication 401',
      changes: { rulesFailure: { message: 'Bad credentials', status: '401' } },
    },
    {
      name: 'ambiguous 404',
      changes: { rulesFailure: { message: 'Not Found', status: '404' } },
    },
    {
      name: 'a wrong documentation URL',
      changes: {
        rulesFailure: {
          ...planRulesFailure,
          documentation_url: 'https://example.com/foreign',
        },
      },
    },
    {
      name: 'a numeric body status',
      changes: { rulesFailure: { ...planRulesFailure, status: 403 } },
    },
    { name: 'malformed JSON', changes: { rulesFailureRaw: '{broken' } },
    {
      name: 'a contradictory gh status',
      changes: { rulesFailureStderr: 'gh: Not Found (HTTP 404)\n' },
    },
    {
      name: 'a rate limit',
      changes: {
        rulesFailureStderr: 'gh: API rate limit exceeded (HTTP 403)\n',
      },
    },
    {
      name: 'a transport failure',
      changes: { rulesFailureStderr: 'network: TLS connection failed\n' },
    },
    {
      name: 'a successful process carrying an error body',
      changes: { rulesFailureExitCode: 0 },
    },
    {
      name: 'a later rules page failure',
      changes: {
        rules: Array.from({ length: 100 }, () => ({
          type: 'required_linear_history',
        })),
        rulesFailurePage: 2,
      },
    },
  ]) {
    it(`does not substitute private absence evidence for ${failure.name}`, () => {
      setPolicy(failure.changes);
      preservingPreview(1, '');
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
    });
  }

  it('does not recognize a plan message from the classic-protection endpoint as rules evidence', () => {
    setPolicy({
      rulesFailure: null,
      protected: true,
      classicFailure: planRulesFailure,
    });
    preservingPreview(1, 'GitHub identity or policy unavailable');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
  });

  it('retains disabled rebase merging as a blocker after policy absence is verified', () => {
    setPolicy({ allow_rebase_merge: false });
    preservingPreview(1, 'Rebase merging is disabled');
  });

  it('retains required readiness when policy absence is verified', () => {
    const prs = github.prs.map((pr) => ({
      ...pr,
      reviewDecision: 'REVIEW_REQUIRED',
    }));
    fs.writeFileSync(github.state, JSON.stringify(prs));
    preservingPreview(1, 'Required approvals missing');
  });

  it('retains failed checks when policy absence is verified', () => {
    const prs = github.prs.map((pr) => ({
      ...pr,
      statusCheckRollup: [
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
      ],
    }));
    fs.writeFileSync(github.state, JSON.stringify(prs));
    preservingPreview(1, 'unit: FAILURE');
  });

  it('preserves dirty local work when independent policy evidence is available', () => {
    fs.writeFileSync(path.join(fixture.repo, 'notes.txt'), 'Keep this note.\n');
    preservingPreview(1, 'Clean index/worktree');
  });
});
