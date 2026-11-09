import fs from 'fs';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing required versus optional checks', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('reports an optional failed check without blocking an otherwise mergeable UNSTABLE PR', () => {
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          mergeStateStatus: 'UNSTABLE',
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'publish-beta',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
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
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Readiness: READY');
    expect(result.stdout).to.include('Optional check publish-beta: FAILURE');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('keeps real blockers ahead of optional failure warnings', () => {
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          mergeStateStatus: 'UNSTABLE',
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'publish-beta',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
            },
          ],
        }))
      )
    );
    fs.writeFileSync(fixture.repo + '/notes.txt', 'Keep local notes.');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'base', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.match(/^⛔ Cannot land yet:/);
    expect(result.stdout.indexOf('Clean index/worktree')).to.be.lessThan(
      result.stdout.indexOf('Optional check publish-beta: FAILURE')
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const required of [false, true]) {
    it(`handles unavailable check results with required checks ${required}`, () => {
      const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
      fs.writeFileSync(
        github.policy,
        JSON.stringify({
          ...policy,
          rules: required
            ? [
                {
                  type: 'required_status_checks',
                  parameters: { required_status_checks: [{ context: 'unit' }] },
                },
              ]
            : [],
        })
      );
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({ ...pr, statusCheckRollup: null }))
        )
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['land', 'base', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(
        required ? 1 : 0
      );
      expect(result.stdout).to.include(
        required ? 'Checks unavailable' : 'Readiness: READY'
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  for (const state of ['IN_PROGRESS', 'FAILURE'] as const) {
    it(`does not block on optional check runs or commit statuses in ${state}`, () => {
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({
            ...pr,
            mergeStateStatus: 'UNSTABLE',
            statusCheckRollup: [
              {
                __typename: 'CheckRun',
                name: 'pages-preview',
                status: state === 'IN_PROGRESS' ? state : 'COMPLETED',
                conclusion: state === 'FAILURE' ? state : null,
              },
              {
                __typename: 'StatusContext',
                context: 'publication',
                state: state === 'IN_PROGRESS' ? 'PENDING' : state,
              },
            ],
          }))
        )
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['land', 'base', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include(`Optional check pages-preview: ${state}`)
        .and.include('Optional check publication:');
      expect(result.stdout).not.to.include('Waiting for #');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  for (const state of ['BLOCKED', 'DIRTY', 'UNKNOWN', 'BEHIND']) {
    it(`retains unexplained ${state} as a blocker despite optional checks`, () => {
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({ ...pr, mergeStateStatus: state }))
        )
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['land', 'base', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.include(`GitHub readiness is ${state}`);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  for (const state of [
    'IN_PROGRESS',
    'FAILURE',
    'MISSING',
    'SUCCESS',
  ] as const) {
    it(`enforces a required check in ${state} independently of optional failure`, () => {
      const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
      fs.writeFileSync(
        github.policy,
        JSON.stringify({
          ...policy,
          rules: [
            {
              type: 'required_status_checks',
              parameters: { required_status_checks: [{ context: 'unit' }] },
            },
          ],
        })
      );
      fs.writeFileSync(
        github.state,
        JSON.stringify(
          github.prs.map((pr) => ({
            ...pr,
            mergeStateStatus: 'UNSTABLE',
            statusCheckRollup: [
              {
                __typename: 'CheckRun',
                name: 'publish-beta',
                status: 'COMPLETED',
                conclusion: 'FAILURE',
              },
              ...(state === 'MISSING'
                ? []
                : [
                    {
                      __typename: 'CheckRun',
                      name: 'unit',
                      status: state === 'IN_PROGRESS' ? state : 'COMPLETED',
                      conclusion: state === 'IN_PROGRESS' ? null : state,
                    },
                  ]),
            ],
          }))
        )
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['land', 'base', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(
        state === 'SUCCESS' ? 0 : 1
      );
      expect(result.stdout).to.include('Optional check publish-beta: FAILURE');
      expect(result.stdout).to.include(
        state === 'SUCCESS'
          ? 'Readiness: READY'
          : state === 'MISSING'
          ? 'Required check missing'
          : `Check unit: ${state}`
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  it('finishes the chain without waiting for optional checks triggered by its own pushes', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
    const result = fixture.run([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Optional check unit: IN_PROGRESS')
      .and.not.include('Waiting for #');
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8')).map(
        (pr: { state: string }) => pr.state
      )
    ).to.deep.equal(['MERGED', 'MERGED', 'OPEN']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
  });

  it('previews and resumes saved progress with optional failed checks without repeating a confirmed merge', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    const rule = {
      type: 'required_status_checks',
      parameters: { required_status_checks: [{ context: 'unit' }] },
    };
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, rules: [rule], pendingAfterPush: true })
    );
    const paused = fixture.run([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(paused.status, paused.stdout + paused.stderr).to.equal(1);
    expect(paused.stderr).to.include('Check wait timed out before #18');
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, rules: [rule] })
    );
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    for (const pr of prs) {
      pr.mergeStateStatus = 'UNSTABLE';
      pr.statusCheckRollup = [
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
        },
        {
          __typename: 'CheckRun',
          name: 'publish-beta',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
      ];
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const preview = fixture.run(['land', 'child', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include('Optional check publish-beta: FAILURE')
      .and.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    const resumed = fixture.run([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(resumed.stdout.startsWith(preview.stdout)).to.equal(true);
    expect(resumed.stdout).not.to.include('Waiting for #');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
  });
});
