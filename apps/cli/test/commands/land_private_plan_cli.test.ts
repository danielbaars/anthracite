import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import {
  emptyPrivatePolicyEvidence,
  planRulesFailure,
  preparePrivatePlanLand,
  updatePrivatePlanPolicy,
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

  function preservingPreview(
    status: number,
    message: string,
    mode: readonly string[] = ['--dry-run']
  ): void {
    const pushed = path.join(fixture.root, 'unexpected-policy-push');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        pushed
      )}, 'push');process.exitCode=1;`,
      { mode: 0o755 }
    );
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const prs = fs.readFileSync(github.state, 'utf8');
    const result = fixture.run(['land', 'base', ...mode, '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(status);
    expect(result.stdout + result.stderr).to.include(message);
    expect(result.stdout + result.stderr).not.to.include(
      'SENSITIVE_POLICY_DETAIL'
    );
    if (status !== 0) expect(result.stdout).not.to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.state, 'utf8')).to.equal(prs);
    const calls = fs.readFileSync(github.calls, 'utf8');
    expect(calls).not.to.include('"PUT"');
    expect(calls).not.to.include('"edit"');
    expect(fs.existsSync(pushed)).to.equal(false);
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

  it('lands a disabled-rule private-plan prefix and preserves successor work and PR identities', () => {
    updatePrivatePlanPolicy(github, { planAbsenceResponse: inventoryPage() });
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

  it('previews the reported single disabled branch ruleset without changing Git state', () => {
    updatePrivatePlanPolicy(github, {
      planAbsenceResponse: emptyPrivatePolicyEvidence({
        rulesets: {
          totalCount: 1,
          nodes: [{ id: 'rule', enforcement: 'DISABLED', target: 'BRANCH' }],
          pageInfo: { hasNextPage: false, endCursor: 'final' },
        },
      }),
    });
    preservingPreview(0, 'Readiness: READY');
  });

  it('reads complete inherited disabled inventories through a full final nonempty page', () => {
    updatePrivatePlanPolicy(github, {
      planAbsencePages: {
        first: emptyPrivatePolicyEvidence({
          rulesets: {
            totalCount: 101,
            nodes: [{ id: 'local', enforcement: 'DISABLED' }],
            pageInfo: { hasNextPage: true, endCursor: 'inherited' },
          },
        }),
        inherited: emptyPrivatePolicyEvidence({
          rulesets: {
            totalCount: 101,
            nodes: Array.from({ length: 100 }, (_, index) => ({
              id: `inherited-${index}`,
              enforcement: 'DISABLED',
            })),
            pageInfo: { hasNextPage: false, endCursor: 'final' },
          },
        }),
      },
    });
    preservingPreview(0, 'Readiness: READY');
    expect(fs.readFileSync(github.calls, 'utf8')).to.include('after=inherited');
  });

  function inventoryPage(
    changes: Readonly<Record<string, unknown>> = {}
  ): Record<string, unknown> {
    return emptyPrivatePolicyEvidence({
      rulesets: {
        totalCount: 1,
        nodes: [{ id: 'local', enforcement: 'DISABLED' }],
        pageInfo: { hasNextPage: false, endCursor: 'final' },
        ...changes,
      },
    });
  }

  function firstInventoryPage(): Record<string, unknown> {
    return inventoryPage({
      totalCount: 2,
      pageInfo: { hasNextPage: true, endCursor: 'next' },
    });
  }

  for (const invalid of [
    { name: 'a missing later page', response: null },
    {
      name: 'a truncated later inventory',
      response: inventoryPage({ totalCount: 2, nodes: [] }),
    },
    {
      name: 'a changing total',
      response: inventoryPage({
        totalCount: 3,
        nodes: [{ id: 'later', enforcement: 'DISABLED' }],
      }),
    },
    {
      name: 'duplicate IDs across pages',
      response: inventoryPage({ totalCount: 2 }),
    },
    {
      name: 'a repeated cursor',
      response: inventoryPage({
        totalCount: 3,
        nodes: [{ id: 'later', enforcement: 'DISABLED' }],
        pageInfo: { hasNextPage: true, endCursor: 'next' },
      }),
    },
    {
      name: 'a missing next cursor',
      response: inventoryPage({
        totalCount: 3,
        nodes: [{ id: 'later', enforcement: 'DISABLED' }],
        pageInfo: { hasNextPage: true },
      }),
    },
    {
      name: 'a null next cursor',
      response: inventoryPage({
        totalCount: 3,
        nodes: [{ id: 'later', enforcement: 'DISABLED' }],
        pageInfo: { hasNextPage: true, endCursor: null },
      }),
    },
    {
      name: 'an empty next cursor',
      response: inventoryPage({
        totalCount: 3,
        nodes: [{ id: 'later', enforcement: 'DISABLED' }],
        pageInfo: { hasNextPage: true, endCursor: ' ' },
      }),
    },
    {
      name: 'an empty nonterminal page',
      response: inventoryPage({
        totalCount: 2,
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: 'advancing' },
      }),
    },
    {
      name: 'omitted later nodes',
      response: emptyPrivatePolicyEvidence({
        rulesets: {
          totalCount: 2,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    },
    {
      name: 'null later nodes',
      response: inventoryPage({ totalCount: 2, nodes: null }),
    },
    {
      name: 'a null later node',
      response: inventoryPage({ totalCount: 2, nodes: [null] }),
    },
    {
      name: 'later GraphQL errors',
      response: {
        ...inventoryPage({ totalCount: 2 }),
        errors: [{ message: 'SENSITIVE_POLICY_DETAIL' }],
      },
    },
    {
      name: 'a foreign later repository',
      response: emptyPrivatePolicyEvidence({
        nameWithOwner: 'other/inspection',
      }),
    },
    {
      name: 'a foreign later trunk',
      response: emptyPrivatePolicyEvidence({
        ref: { name: 'other', branchProtectionRule: null },
      }),
    },
    {
      name: 'revoked later administrator access',
      response: emptyPrivatePolicyEvidence({ viewerPermission: 'WRITE' }),
    },
    {
      name: 'changed later private visibility',
      response: emptyPrivatePolicyEvidence({ isPrivate: false }),
    },
    {
      name: 'new later classic protection',
      response: emptyPrivatePolicyEvidence({
        ref: { name: 'main', branchProtectionRule: { id: 'classic' } },
      }),
    },
  ]) {
    it(`preserves state when inherited inventory has ${invalid.name}`, () => {
      updatePrivatePlanPolicy(github, {
        planAbsencePages: {
          first: firstInventoryPage(),
          next: invalid.response,
        },
      });
      preservingPreview(1, 'Plan-restricted GitHub policy unverified');
      expect(fs.readFileSync(github.calls, 'utf8')).to.include('after=next');
    });
  }

  for (const invalid of [
    { name: 'negative totals', changes: { totalCount: -1 } },
    { name: 'fractional totals', changes: { totalCount: 1.5 } },
    { name: 'missing totals', changes: { totalCount: undefined } },
    { name: 'more nodes than the total', changes: { totalCount: 0 } },
    { name: 'a terminal count mismatch', changes: { totalCount: 2 } },
    {
      name: 'a duplicate ID on one page',
      changes: {
        totalCount: 2,
        nodes: [
          { id: 'local', enforcement: 'DISABLED' },
          { id: 'local', enforcement: 'DISABLED' },
        ],
      },
    },
    {
      name: 'an empty ID',
      changes: { nodes: [{ id: '', enforcement: 'DISABLED' }] },
    },
    {
      name: 'an omitted ID',
      changes: { nodes: [{ enforcement: 'DISABLED' }] },
    },
    {
      name: 'a blank ID',
      changes: { nodes: [{ id: ' ', enforcement: 'DISABLED' }] },
    },
    {
      name: 'a null ID',
      changes: { nodes: [{ id: null, enforcement: 'DISABLED' }] },
    },
    { name: 'omitted enforcement', changes: { nodes: [{ id: 'local' }] } },
    {
      name: 'null enforcement',
      changes: { nodes: [{ id: 'local', enforcement: null }] },
    },
    {
      name: 'unknown enforcement',
      changes: { nodes: [{ id: 'local', enforcement: 'UNKNOWN' }] },
    },
    {
      name: 'active unrelated-target enforcement',
      changes: {
        nodes: [{ id: 'local', enforcement: 'ACTIVE', target: 'TAG' }],
      },
    },
  ]) {
    it(`refuses disabled inventory evidence with ${invalid.name}`, () => {
      updatePrivatePlanPolicy(github, {
        planAbsenceResponse: inventoryPage(invalid.changes),
      });
      preservingPreview(1, 'Plan-restricted GitHub policy unverified');
    });
  }

  it('accurately refuses evaluate mode without describing it as active enforcement', () => {
    updatePrivatePlanPolicy(github, {
      planAbsenceResponse: inventoryPage({
        nodes: [{ id: 'local', enforcement: 'EVALUATE' }],
      }),
    });
    preservingPreview(
      1,
      'Evaluate-mode rulesets are outside the supported disabled-only policy proof.'
    );
  });

  it('refuses an active inherited rule on a later page before any landing effect', () => {
    updatePrivatePlanPolicy(github, {
      planAbsencePages: {
        first: firstInventoryPage(),
        next: inventoryPage({
          totalCount: 2,
          nodes: [{ id: 'parent', enforcement: 'ACTIVE' }],
        }),
      },
    });
    preservingPreview(1, 'non-disabled or unknown ruleset enforcement state', [
      '--yes',
    ]);
  });

  it('refuses finite pagination exhaustion despite advancing unique disabled pages', () => {
    const pages = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        index === 0 ? 'first' : `cursor-${index}`,
        inventoryPage({
          totalCount: 101,
          nodes: [{ id: `rule-${index}`, enforcement: 'DISABLED' }],
          pageInfo: { hasNextPage: true, endCursor: `cursor-${index + 1}` },
        }),
      ])
    );
    updatePrivatePlanPolicy(github, { planAbsencePages: pages });
    preservingPreview(1, 'Independent policy pagination limit exceeded.');
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
      updatePrivatePlanPolicy(github, {
        planAbsenceResponse: evidence.response,
      });
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
      updatePrivatePlanPolicy(github, prerequisites.changes);
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
      updatePrivatePlanPolicy(github, failure.changes);
      preservingPreview(1, '');
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
    });
  }

  it('does not recognize a plan message from the classic-protection endpoint as rules evidence', () => {
    updatePrivatePlanPolicy(github, {
      rulesFailure: null,
      protected: true,
      classicFailure: planRulesFailure,
    });
    preservingPreview(1, 'GitHub identity or policy unavailable');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
  });

  it('retains a required check from a later normal REST rules page', () => {
    updatePrivatePlanPolicy(github, {
      rulesFailure: null,
      rules: [
        ...Array.from({ length: 100 }, () => ({
          type: 'required_linear_history',
        })),
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'later-required' }],
          },
        },
      ],
    });
    preservingPreview(
      1,
      'Required check missing or not successful: later-required.'
    );
    const calls = fs.readFileSync(github.calls, 'utf8');
    expect(calls).to.include('rules/branches/main?per_page=100&page=2');
    expect(calls).not.to.include('"graphql"');
  });

  it('retains disabled rebase merging as a blocker after policy absence is verified', () => {
    updatePrivatePlanPolicy(github, { allow_rebase_merge: false });
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

  it('reports optional failed checks without blocking when policy absence is verified', () => {
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
    preservingPreview(0, 'Optional check unit: FAILURE');
  });

  it('preserves dirty local work when independent policy evidence is available', () => {
    fs.writeFileSync(path.join(fixture.repo, 'notes.txt'), 'Keep this note.\n');
    preservingPreview(1, 'Clean index/worktree');
  });
});
