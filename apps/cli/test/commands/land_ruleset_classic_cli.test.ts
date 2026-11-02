import fs from 'fs';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

const absentClassic = {
  data: {
    repository: {
      nameWithOwner: 'fixture/inspection',
      viewerPermission: 'ADMIN',
      ref: { name: 'main', branchProtectionRule: null },
    },
  },
};

// eslint-disable-next-line max-lines-per-function
describe('public landing with ruleset-only protection', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  let policy: Readonly<Record<string, unknown>>;
  const setPolicy = (changes: Readonly<Record<string, unknown>>): void => {
    policy = { ...policy, ...changes };
    fs.writeFileSync(github.policy, JSON.stringify(policy));
  };
  const preview = (status: number, message: string): void => {
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
    if (status !== 0) expect(result.stdout).not.to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  };
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    policy = {};
    setPolicy({
      allow_rebase_merge: true,
      protected: true,
      rules: [
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 1,
            allowed_merge_methods: ['rebase', 'squash'],
          },
        },
        { type: 'required_linear_history' },
      ],
      classicNotFound: true,
      classicAbsenceResponse: absentClassic,
    });
  });
  afterEach(() => fixture?.cleanup());

  it('previews an approved ruleset-only PR when classic absence is independently verified', () => {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Policy: 1 required approval(s)')
      .and.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });

  it('still refuses a ruleset-required approval after classic absence is verified', () => {
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          reviewDecision: 'REVIEW_REQUIRED',
        }))
      )
    );
    preview(1, 'Required approvals missing');
  });

  it('combines classic and ruleset requirements without dropping the stricter review or either check', () => {
    setPolicy({
      classicNotFound: false,
      protection: {
        url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
        required_pull_request_reviews: { required_approving_review_count: 3 },
        required_status_checks: { contexts: ['unit'] },
      },
      rules: [
        {
          type: 'pull_request',
          parameters: { required_approving_review_count: 1 },
        },
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'lint' }],
          },
        },
      ],
    });
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          statusCheckRollup: ['unit', 'lint'].map((name) => ({
            __typename: 'CheckRun',
            name,
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          })),
        }))
      )
    );
    preview(0, 'Policy: 3 required approval(s); required checks: unit, lint');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
  });

  it('refuses when the independent absence lookup is inaccessible', () => {
    setPolicy({ classicAbsenceResponse: null });
    preview(1, 'Classic protection absence unverified');
  });

  const invalidEvidence = [
    {
      name: 'non-administrator visibility',
      response: {
        data: {
          repository: {
            ...absentClassic.data.repository,
            viewerPermission: 'WRITE',
          },
        },
      },
    },
    {
      name: 'a foreign repository',
      response: {
        data: {
          repository: {
            ...absentClassic.data.repository,
            nameWithOwner: 'other/inspection',
          },
        },
      },
    },
    {
      name: 'a foreign branch',
      response: {
        data: {
          repository: {
            ...absentClassic.data.repository,
            ref: { name: 'other', branchProtectionRule: null },
          },
        },
      },
    },
    {
      name: 'a present classic rule',
      response: {
        data: {
          repository: {
            ...absentClassic.data.repository,
            ref: { name: 'main', branchProtectionRule: { id: 'classic-rule' } },
          },
        },
      },
    },
    {
      name: 'an omitted classic rule field',
      response: {
        data: {
          repository: {
            ...absentClassic.data.repository,
            ref: { name: 'main' },
          },
        },
      },
    },
    {
      name: 'partial data with GraphQL errors',
      response: {
        ...absentClassic,
        errors: [{ message: 'Resource not accessible' }],
      },
    },
  ];
  for (const evidence of invalidEvidence) {
    it(`refuses ${evidence.name} as proof of classic absence`, () => {
      setPolicy({ classicAbsenceResponse: evidence.response });
      preview(1, 'Classic protection absence unverified');
    });
  }

  for (const failure of [
    { message: 'Resource not accessible by integration', status: '403' },
    { message: 'Not Found', status: '404' },
  ]) {
    it(`preserves refusal for an ambiguous ${failure.status}: ${failure.message}`, () => {
      setPolicy({ classicFailure: failure });
      preview(1, 'GitHub identity or policy unavailable');
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
    });
  }

  it('refuses unexplained protected status when no active rules apply', () => {
    setPolicy({ rules: [] });
    preview(1, 'GitHub identity or policy unavailable');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"graphql"');
  });

  it('lands a ruleset-only PR while retaining its mandatory successors', function () {
    fixture.commandTimeoutMs = 90000;
    const childPatch = fixture.git(['diff', '--binary', 'base', 'child']);
    const tipPatch = fixture.git(['diff', '--binary', 'child', 'tip']);
    const result = fixture.run(['land', 'base', '--yes', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Landing complete');
    const prs: ReadonlyArray<{
      readonly number: number;
      readonly state: string;
    }> = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(prs.map((pr) => pr.state)).to.deep.equal(['MERGED', 'OPEN', 'OPEN']);
    expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
    expect(fixture.git(['diff', '--binary', 'main', 'child'])).to.equal(
      childPatch
    );
    expect(fixture.git(['diff', '--binary', 'child', 'tip'])).to.equal(
      tipPatch
    );
  });
});
