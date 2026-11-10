import fs from 'fs';
import { expect } from 'chai';
import stripAnsi from 'strip-ansi';
import { z } from 'zod';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public deferred landing plans', function () {
  this.timeout(600000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 240000;
  });
  afterEach(() => fixture?.cleanup());

  function matchingPlan(pending: boolean, expectedStatus = 0): string {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(
      expectedStatus
    );
    const prompt = pending
      ? 'Resume this landing plan?'
      : 'Apply this landing plan?';
    const application = runCliInPty(getTestCliCommand(['land', 'tip']), {
      cwd: fixture.repo,
      env: fixture.env,
      timeoutMs: 90000,
      responses: [{ prompt, input: 'n\n' }],
    });
    expect(application.status, application.output).to.equal(0);
    const report = stripAnsi(application.output).replace(/\r\n/g, '\n');
    const offset = report.indexOf('? ' + prompt);
    expect(offset, report).to.be.greaterThan(0);
    expect(report.slice(0, offset).trimEnd()).to.equal(
      preview.stdout.trimEnd()
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    const added = fs.readFileSync(github.calls, 'utf8').slice(calls.length);
    expect(added).not.to.include('"PUT"').and.not.to.include('"edit"');
    return preview.stdout;
  }

  function pauseLanding(): void {
    github = prepareLand(fixture, ['unit']);
    const policy = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(fs.readFileSync(github.policy, 'utf8')));
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
    expect(stopped.stderr).to.include('Check wait timed out before #18');
    const prs = readPrs();
    for (const pr of prs) {
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
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fs.writeFileSync(github.policy, JSON.stringify(policy));
  }

  function readPrs(): Record<string, unknown>[] {
    return z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
  }

  function checkedPreview(expectedStatus: number): string {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(
      expectedStatus
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    const added = fs.readFileSync(github.calls, 'utf8').slice(calls.length);
    expect(added).not.to.include('"PUT"').and.not.to.include('"edit"');
    return preview.stdout;
  }

  it('discloses per-target publication and scopes fresh readiness to the next merge', () => {
    github = prepareLand(fixture);
    const report = matchingPlan(false);
    expect(report).to.include(
      'child #18 (publication deferred until its merge preparation)'
    );
    expect(report).to.include(
      'tip #19 (publication deferred until its merge preparation)'
    );
    expect(report).to.include('READY for next merge only');
    expect(report).not.to.include('READY to merge this plan');
  });

  it('keeps saved plans preserving and distinguishes local replay from deferred publication', () => {
    pauseLanding();
    const report = matchingPlan(true);
    expect(report).to.include(
      'tip #19 (publication deferred until its merge preparation)'
    );
    expect(report).to.include(
      'Verify replay locally; defer push and PR base/footer updates until its merge preparation.'
    );
    expect(report).to.include('READY for next merge only');
    for (const branch of ['child', 'tip'])
      expect(report).not.to.include(fixture.git(['rev-parse', branch]));
    const debug = fixture.run(['land', 'tip', '--dry-run', '--debug']);
    expect(debug.status, debug.stdout + debug.stderr).to.equal(0);
    expect(debug.stderr).to.include(
      'Push: tip; deferred until its merge preparation'
    );
    expect(debug.stderr).to.include(
      'PR update: tip; base/dependency footer deferred with publication'
    );
  });

  it('discloses immediate publication and pending readiness after the current target merges externally', () => {
    pauseLanding();
    const prs = readPrs();
    const child = prs.find((pr) => pr.headRefName === 'child');
    if (!child) throw new Error('Missing child fixture');
    const head = fixture.git(['rev-parse', 'child']);
    child.state = 'MERGED';
    child.mergeResult = head;
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fixture.git(['update-ref', 'refs/heads/main', head], github.remote);
    expect(fixture.git(['rev-parse', 'tip'], github.remote)).not.to.equal(
      fixture.git(['rev-parse', 'tip'])
    );
    const report = matchingPlan(true);
    expect(report)
      .to.include('Cleanup-only 1: child #18')
      .and.include('Merge 2: tip #19 (publication due before its merge)')
      .and.include('After confirmed merge #18')
      .and.include('push existing branch; update existing PR #19 base/footer')
      .and.include('Readiness: PENDING for #19 tip')
      .and.not.include('Readiness: READY')
      .and.not.include('After merging #18')
      .and.not.include('tip #19 (publication deferred');
    const before = fixture.inspectionSnapshot();
    const debug = fixture.run(['land', 'tip', '--dry-run', '--debug']);
    expect(debug.status, debug.stdout + debug.stderr).to.equal(0);
    expect(debug.stderr)
      .to.include('Cleanup-only: child #18')
      .and.include('Push: tip; verify or update existing leased head')
      .and.not.include('Push: tip; deferred');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const refusal of [
    { field: 'isDraft', value: true, message: 'PR is a draft.' },
    {
      field: 'reviewDecision',
      value: 'CHANGES_REQUESTED',
      message: 'Changes requested.',
    },
    {
      field: 'reviewDecision',
      value: 'REVIEW_REQUIRED',
      message: 'Required approvals missing.',
    },
  ])
    it(`retains ${refusal.message} on a deliberately deferred target`, () => {
      pauseLanding();
      const prs = readPrs();
      const tip = prs.find((pr) => pr.headRefName === 'tip');
      if (!tip) throw new Error('Missing tip fixture');
      tip[refusal.field] = refusal.value;
      fs.writeFileSync(github.state, JSON.stringify(prs));
      const report = checkedPreview(1);
      expect(report).to.include('tip: ' + refusal.message);
      expect(report).not.to.include('Readiness: READY');
    });

  it('checks the newly published target rather than authorizing it with an old green head', () => {
    pauseLanding();
    const prs = readPrs();
    for (const branch of ['tip', 'child']) {
      const pr = prs.find((item) => item.headRefName === branch);
      if (!pr) throw new Error('Missing PR fixture');
      pr.mergeStateStatus = 'UNSTABLE';
      pr.statusCheckRollup = [
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
      ];
      fs.writeFileSync(github.state, JSON.stringify(prs));
      const report = checkedPreview(branch === 'tip' ? 0 : 1);
      if (branch === 'tip') {
        expect(report).to.include('READY for next merge only');
        expect(report).not.to.include('Check unit: FAILURE');
        expect(fixture.git(['rev-parse', 'tip'], github.remote)).not.to.equal(
          fixture.git(['rev-parse', 'tip'])
        );
      } else expect(report).to.include('child: Check unit: FAILURE');
    }
    const calls = fs.readFileSync(github.calls, 'utf8');
    const stopped = fixture.run([
      'land',
      'tip',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('No merge request sent for #18');
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
  });

  it('refreshes required policy and allows optional pending or failed checks on resumption', () => {
    pauseLanding();
    const policy = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(fs.readFileSync(github.policy, 'utf8')));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        ...policy,
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [{ context: 'new-policy-check' }],
            },
          },
        ],
      })
    );
    expect(checkedPreview(1)).to.include(
      'Required check missing or not successful: new-policy-check'
    );
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, rules: [], pendingAfterPush: true })
    );
    const prs = readPrs();
    for (const pr of prs) {
      pr.mergeStateStatus = 'UNSTABLE';
      pr.statusCheckRollup = [
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
      ];
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const report = checkedPreview(0);
    expect(report).to.include('Optional check unit: FAILURE (not blocking)');
    const result = fixture.run(['land', 'tip', '--yes', '--wait-timeout', '0']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      'Optional check unit: IN_PROGRESS (not blocking)'
    );
    expect(result.stdout).not.to.include('Waiting for');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
  });
});
