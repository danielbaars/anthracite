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
      'Required check publisher evidence unavailable or incomplete'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses unavailable ruleset publisher evidence instead of matching names alone', () => {
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
      'Required check publisher evidence unavailable or incomplete'
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
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include(
      '/check-runs?'
    );
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('PUT')
      .and.not.to.include('POST');
  });
  it('verifies an app-bound required check on the exact PR head', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {
          url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
          required_status_checks: { checks: [{ context: 'unit', app_id: 42 }] },
        },
        checkRuns: [
          {
            id: 1,
            name: 'unit',
            head_sha: github.prs[0]?.headRefOid,
            status: 'completed',
            conclusion: 'success',
            app: { id: 42 },
          },
        ],
      })
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Readiness: READY');
    expect(fs.readFileSync(github.calls, 'utf8')).to.include(
      `/commits/${String(github.prs[0]?.headRefOid)}/check-runs?`
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('refuses publisher mismatch, stale head, ambiguous, pending and incomplete check-run evidence', () => {
    const head = String(github.prs[0]?.headRefOid);
    const successful = {
      id: 1,
      name: 'unit',
      head_sha: head,
      status: 'completed',
      conclusion: 'success',
      app: { id: 42 },
    };
    const policy = {
      allow_rebase_merge: true,
      protected: false,
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'unit', integration_id: 42 }],
          },
        },
      ],
    };
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    for (const evidence of [
      { checkRuns: [] },
      { checkRuns: [{ ...successful, app: { id: 7 } }] },
      { checkRuns: [{ ...successful, head_sha: 'f'.repeat(40) }] },
      { checkRuns: [{ ...successful, app: null }] },
      { checkRuns: [successful, { ...successful, id: 2 }] },
      { checkRuns: [{ ...successful, status: 'in_progress' }] },
      { checkRuns: [{ ...successful, status: 'completed', conclusion: null }] },
      { checkRuns: [successful], checkRunsTotal: 2 },
      { checkRuns: [successful], failCheckRunsPage: 1 },
    ]) {
      fs.writeFileSync(
        github.policy,
        JSON.stringify({ ...policy, ...evidence })
      );
      const result = fixture.run([
        'land',
        'base',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(
        result.status,
        JSON.stringify(evidence) + result.stdout + result.stderr
      ).to.equal(1);
      expect(result.stdout)
        .to.include('Required check publisher')
        .and.not.to.include('Readiness: READY');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    }
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, checkRuns: [] })
    );
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          statusCheckRollup: [
            { __typename: 'StatusContext', context: 'unit', state: 'SUCCESS' },
          ],
        }))
      )
    );
    const legacy = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(legacy.status, legacy.stdout + legacy.stderr).to.equal(1);
    expect(legacy.stdout).to.include(
      'Required check publisher missing or ambiguous'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('reads complete check-run pagination and refuses a later-page read failure', () => {
    const head = String(github.prs[0]?.headRefOid);
    const checkRuns = [
      ...Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        name: `unrelated-${index}`,
        head_sha: head,
        status: 'completed',
        conclusion: 'success',
        app: { id: 7 },
      })),
      {
        id: 101,
        name: 'unit',
        head_sha: head,
        status: 'completed',
        conclusion: 'success',
        app: { id: 42 },
      },
    ];
    const policy = {
      allow_rebase_merge: true,
      protected: false,
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'unit', integration_id: 42 }],
          },
        },
      ],
      checkRuns,
    };
    const before = fixture.inspectionSnapshot();
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const complete = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(complete.status, complete.stdout + complete.stderr).to.equal(0);
    expect(fs.readFileSync(github.calls, 'utf8')).to.include(
      'page=2&filter=latest'
    );
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, failCheckRunsPage: 2 })
    );
    const unavailable = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(unavailable.status).to.equal(1);
    expect(unavailable.stdout).to.include('publisher evidence unavailable');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('uses verified publisher readiness during leaf application and refuses a later unavailable read', () => {
    fixture.branch('verified-leaf', 'main');
    fixture.git(['push', 'origin', 'verified-leaf']);
    const pr = github.pr('verified-leaf', 31);
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const policy = {
      allow_rebase_merge: true,
      protected: true,
      rules: [],
      protection: {
        url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
        required_status_checks: { checks: [{ context: 'unit', app_id: 42 }] },
      },
      checkRuns: [
        {
          id: 1,
          name: 'unit',
          head_sha: pr.headRefOid,
          status: 'completed',
          conclusion: 'success',
          app: { id: 42 },
        },
      ],
    };
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, failCheckRunsRead: 4 })
    );
    const remote = fixture.git(['for-each-ref'], github.remote);
    const blocked = fixture.run([
      'land',
      'verified-leaf',
      '--yes',
      '--no-interactive',
    ]);
    expect(blocked.status, blocked.stdout + blocked.stderr).to.equal(1);
    expect(
      blocked.stdout + blocked.stderr,
      blocked.stdout + blocked.stderr
    ).to.include('publisher evidence unavailable');
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('PUT');
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run([
      'land',
      'verified-leaf',
      '--yes',
      '--no-interactive',
    ]);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(fixture.git(['show', 'main:verified-leaf.txt'])).to.equal(
      'verified-leaf'
    );
    expect(fixture.git(['branch', '--list', 'verified-leaf'])).to.equal('');
    expect(
      fixture.git([
        'ls-remote',
        '--heads',
        'origin',
        'refs/heads/verified-leaf',
      ])
    ).to.equal('');
  });
});
