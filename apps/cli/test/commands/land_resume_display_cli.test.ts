import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import stripAnsi from 'strip-ansi';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('public resumed landing presentation', function () {
  this.timeout(300000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    // Cold source processes and real survivor replay can exceed one minute.
    fixture.commandTimeoutMs = 180000;
    github = prepareLand(fixture, ['unit']);
  });
  afterEach(() => fixture?.cleanup());

  function pauseLanding(): void {
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
    expect(stopped.stderr).to.include('Check wait timed out before #18');
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    for (const pr of prs) {
      pr.statusCheckRollup = [
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
        },
      ];
      pr.mergeStateStatus = 'CLEAN';
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fs.writeFileSync(github.policy, JSON.stringify(policy));
  }

  function declineMatchingPlan(expectedStatus: number): string {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(
      expectedStatus
    );
    const application = runCliInPty(getTestCliCommand(['land', 'tip']), {
      cwd: fixture.repo,
      env: fixture.env,
      timeoutMs: 60000,
      responses: [{ prompt: 'Resume this landing plan?', input: 'n\n' }],
    });
    expect(application.status, application.output).to.equal(0);
    const report = stripAnsi(application.output).replace(/\r\n/g, '\n');
    const prompt = report.indexOf('? Resume this landing plan?');
    expect(prompt, report).to.be.greaterThan(0);
    expect(report.slice(0, prompt).trimEnd()).to.equal(
      preview.stdout.trimEnd()
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    const addedCalls = fs
      .readFileSync(github.calls, 'utf8')
      .slice(calls.length);
    expect(addedCalls).not.to.include('"PUT"').and.not.to.include('"edit"');
    return preview.stdout;
  }

  it('shows the same freshly checked plan before confirmation as readiness and merge state change', () => {
    pauseLanding();
    expect(declineMatchingPlan(0)).to.include('✅ Readiness: READY');
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    prs[1].mergeStateStatus = 'UNSTABLE';
    prs[1].statusCheckRollup = [
      {
        __typename: 'CheckRun',
        name: 'unit',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
      },
    ];
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const notes = path.join(fixture.repo, 'local-notes.txt');
    fs.writeFileSync(notes, 'Preserve these notes.\n');
    expect(declineMatchingPlan(1))
      .to.include('⛔ Cannot resume landing yet:')
      .and.include('Clean index/worktree')
      .and.include('unit: FAILURE')
      .and.not.include('Readiness: READY');
    fs.unlinkSync(notes);
    const head = fixture.git(['rev-parse', 'child']);
    prs[1].state = 'MERGED';
    prs[1].mergeResult = head;
    prs[1].mergeStateStatus = 'CLEAN';
    prs[1].statusCheckRollup = [
      {
        __typename: 'CheckRun',
        name: 'unit',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
    ];
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fixture.git(['update-ref', 'refs/heads/main', head], github.remote);
    expect(declineMatchingPlan(0))
      .to.include('Cleanup-only 1: child #18')
      .and.not.include('Merge 1: child #18');
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(resumed.stdout).to.include('Cleanup-only 1: child #18');
    for (const name of ['child', 'tip'])
      expect(fixture.git(['show', `main:${name}.txt`])).to.equal(name);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
  });

  it('previews remaining PRs and mandatory maintenance compactly without changing saved progress or local work', () => {
    pauseLanding();
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.match(/^⏸ Pending landing:/);
    expect(preview.stdout)
      .to.include('Merge 1: child #18')
      .and.include('Merge 2: tip #19')
      .and.not.include('Merge 1: base');
    expect(preview.stdout).to.include('After merging #18');
    expect(preview.stdout).to.include('tip #19 (also a merge target)');
    expect(preview.stdout).to.include('Checkout after completion: main');
    expect(preview.stdout).to.include('✅ Readiness: READY');
    for (const pr of github.prs)
      expect(preview.stdout).not.to.include(String(pr.headRefOid));
    for (const branch of ['child', 'tip'])
      expect(preview.stdout).not.to.include(fixture.git(['rev-parse', branch]));
    expect(preview.stdout)
      .not.to.include('phase prepared')
      .and.not.to.include('replay base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });

  it('keeps complete recovery details under debug while disclosing published and unpublished fanout in the normal scope', () => {
    fixture.branch('sibling', 'child');
    fixture.branch('local-only', 'child');
    fixture.git(['push', 'origin', 'sibling']);
    fs.writeFileSync(
      github.state,
      JSON.stringify([...github.prs, github.pr('sibling', 20)])
    );
    pauseLanding();
    const before = fixture.inspectionSnapshot();
    const head = fixture.git(['rev-parse', 'child']);
    const preview = fixture.run(['land', 'tip', '--dry-run', '--debug']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include('sibling #20 (not a merge target)')
      .and.include('local-only (not a merge target)')
      .and.include('push existing branch')
      .and.include('keep local; no push; no PR creation');
    expect(preview.stdout)
      .not.to.include(head)
      .and.not.to.include('phase prepared');
    expect(preview.stderr)
      .to.include('phase prepared')
      .and.include(`reached head ${head}`)
      .and.include(`captured head ${String(github.prs[1]?.headRefOid)}`)
      .and.include('replay base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('puts fresh dirty-worktree and running-check blockers before the conditional recovery scope without changing it', () => {
    pauseLanding();
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    prs[1].mergeStateStatus = 'UNSTABLE';
    prs[1].statusCheckRollup = [
      {
        __typename: 'CheckRun',
        name: 'unit',
        status: 'IN_PROGRESS',
        conclusion: null,
      },
    ];
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fs.writeFileSync(
      path.join(fixture.repo, 'local-notes.txt'),
      'Preserve these notes.\n'
    );
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(1);
    expect(preview.stdout).to.match(/^⛔ Cannot resume landing yet:/);
    expect(preview.stdout.indexOf('Clean index/worktree')).to.be.lessThan(
      preview.stdout.indexOf('Pending landing:')
    );
    expect(preview.stdout.indexOf('unit: IN_PROGRESS')).to.be.lessThan(
      preview.stdout.indexOf('Pending landing:')
    );
    expect(preview.stdout)
      .to.include('Once resolved, this would resume:')
      .and.not.to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('uses the same compact remaining scope during real resumption before completing each remaining merge once', () => {
    pauseLanding();
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(resumed.stdout).to.match(/^⏸ Pending landing:/);
    expect(resumed.stdout)
      .to.include('Merge 1: child #18')
      .and.include('Merge 2: tip #19');
    expect(resumed.stdout.indexOf('Merge 2: tip #19')).to.be.lessThan(
      resumed.stdout.indexOf('Confirmed merged #18')
    );
    expect(resumed.stdout)
      .not.to.include('phase prepared')
      .and.not.to.include('captured head');
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8')).map(
        (pr: { state: string }) => pr.state
      )
    ).to.deep.equal(['MERGED', 'MERGED', 'MERGED']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
  });
});
