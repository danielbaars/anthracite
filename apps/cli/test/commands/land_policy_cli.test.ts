import fs from 'fs';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing policy guards', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('refuses a noncompleted check even when its conclusion says success', () => {
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'ci',
              status: 'IN_PROGRESS',
              conclusion: 'SUCCESS',
            },
          ],
        }))
      )
    );
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.include('Check ci: IN_PROGRESS');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });
  it('binds classic policy identity to the exact configured repository and trunk', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {
          url: 'https://api.github.com/repos/other/project/branches/main/protection',
          required_pull_request_reviews: null,
          required_status_checks: null,
        },
      })
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('Classic protection identity mismatch');
    expect(result.stdout).not.to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses app-bound classic requirements when the check publisher is unverified', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {
          url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
          required_pull_request_reviews: null,
          required_status_checks: {
            contexts: [],
            checks: [{ context: 'ci', app_id: 42 }],
          },
        },
      })
    );
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'ci',
              status: 'COMPLETED',
              conclusion: 'SUCCESS',
            },
          ],
        }))
      )
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.include(
      'Required check publisher is unsupported: ci (GitHub App 42)'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses app-bound ruleset requirements instead of matching check names alone', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: false,
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [{ context: 'ci', integration_id: 42 }],
            },
          },
        ],
      })
    );
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'ci',
              status: 'COMPLETED',
              conclusion: 'SUCCESS',
            },
          ],
        }))
      )
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.include(
      'Required check publisher is unsupported: ci (GitHub App 42)'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses missing or contradictory completion data and ignores unrelated union fields', () => {
    const checks = [
      ...[
        'QUEUED',
        'WAITING',
        'PENDING',
        'REQUESTED',
        'SUCCESS',
        'NEUTRAL',
        'SKIPPED',
        '',
        null,
        undefined,
      ].map((status) => ({
        __typename: 'CheckRun',
        name: 'ci',
        status,
        conclusion: 'SUCCESS',
      })),
      ...['', null, undefined].map((conclusion) => ({
        __typename: 'CheckRun',
        name: 'ci',
        status: 'COMPLETED',
        conclusion,
        state: 'SUCCESS',
      })),
      {
        __typename: 'StatusContext',
        context: 'ci',
        state: 'PENDING',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
      {
        __typename: 'StatusContext',
        context: 'ci',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
    ];
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    for (const check of checks) {
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({ ...pr, statusCheckRollup: [check] }))
        )
      );
      const result = fixture.run([
        'land',
        'base',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(
        result.status,
        JSON.stringify(check) + result.stdout + result.stderr
      ).to.equal(1);
      expect(result.stdout)
        .to.include('Check ci:')
        .and.not.to.include('Readiness: READY');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    }
  });

  it('rejects classic URL host, branch, suffix, query, fragment and credential mismatches', () => {
    const prefix = 'https://api.github.com/repos/fixture/inspection/branches/';
    const before = fixture.inspectionSnapshot();
    const urls = [
      prefix + 'other/protection',
      prefix + 'Main/protection',
      prefix + 'main/protection/',
      prefix + 'main/protection?anything=true',
      prefix + 'main/protection#anything',
      prefix.replace('api.github.com', 'example.test') + 'main/protection',
      prefix.replace('api.github.com', 'user@api.github.com') +
        'main/protection',
    ];
    for (const url of urls) {
      fs.writeFileSync(
        github.policy,
        JSON.stringify({
          allow_rebase_merge: true,
          protected: true,
          rules: [],
          protection: {
            url,
            required_status_checks: null,
            required_pull_request_reviews: null,
          },
        })
      );
      const result = fixture.run([
        'land',
        'base',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(result.status, url + result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('Classic protection identity mismatch');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('retains known no-requirements and successful unrestricted-check cases', () => {
    const before = fixture.inspectionSnapshot();
    const policies = [
      { allow_rebase_merge: true, protected: false, rules: [] },
      {
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {
          url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
          required_status_checks: null,
          required_pull_request_reviews: null,
        },
      },
    ];
    for (const policy of policies) {
      fs.writeFileSync(github.policy, JSON.stringify(policy));
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({
            ...pr,
            reviewDecision: '',
            statusCheckRollup: [],
          }))
        )
      );
      const result = fixture.run([
        'land',
        'base',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('No required reviews or checks')
        .and.include('Readiness: READY');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    const checkCases = [
      {
        __typename: 'CheckRun',
        name: 'ci',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
      {
        __typename: 'CheckRun',
        name: 'ci',
        status: 'COMPLETED',
        conclusion: 'NEUTRAL',
      },
      {
        __typename: 'CheckRun',
        name: 'ci',
        status: 'COMPLETED',
        conclusion: 'SKIPPED',
      },
      { __typename: 'StatusContext', context: 'ci', state: 'SUCCESS' },
    ];
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {
          url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
          required_status_checks: {
            contexts: [],
            checks: [{ context: 'ci', app_id: -1 }],
          },
          required_pull_request_reviews: null,
        },
      })
    );
    for (const check of checkCases) {
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({ ...pr, statusCheckRollup: [check] }))
        )
      );
      const result = fixture.run([
        'land',
        'base',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.include('Readiness: READY');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('PUT')
      .and.not.to.include('POST');
  });
});
