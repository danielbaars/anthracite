import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

describe('public landing check waiting', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  function pendingAfterPush(): void {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
  }

  async function runLanding(
    args: readonly string[],
    observe: (output: string, interrupt: () => void) => void
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const [executable, ...cliArgs] = getTestCliCommand(args);
    const child = spawn(executable, cliArgs, {
      cwd: fixture.repo,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 90000);
    try {
      return await new Promise((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          observe(stdout, () => child.kill('SIGINT'));
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (status) => {
          if (timedOut)
            reject(new Error(`Landing test timed out: ${stdout}\n${stderr}`));
          else resolve({ status, stdout, stderr });
        });
      });
    } finally {
      clearTimeout(timer);
    }
  }

  it('waits for checks after its own push and completes the approved chain without restarting or repeating a merge', async () => {
    pendingAfterPush();
    let sawWaiting = false;
    const result = await runLanding(['land', 'child', '--yes'], (output) => {
      if (sawWaiting || !output.includes('Waiting for #18')) return;
      sawWaiting = true;
      const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
      for (const pr of prs) {
        pr.mergeStateStatus = 'CLEAN';
        pr.statusCheckRollup = [];
      }
      fs.writeFileSync(github.state, JSON.stringify(prs));
    });
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(sawWaiting).to.equal(true);
    const after = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(after.map((pr: { state: string }) => pr.state)).to.deep.equal([
      'MERGED',
      'MERGED',
      'OPEN',
    ]);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
  });

  it('times out before sending the next merge request and resumes the saved heads without repeating completed work', () => {
    pendingAfterPush();
    const stopped = fixture.run([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '1',
    ]);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('Check wait timed out before #18');
    expect(stopped.stderr).to.include('No merge request sent for #18');
    expect(stopped.stderr).not.to.include('Merge unconfirmed or uncertain');
    const head = fixture.git(['rev-parse', 'child']);
    const tipTree = fixture.git(['rev-parse', 'tip^{tree}']);
    const tipCommit = fixture.git([
      'log',
      '--format=%an <%ae>%n%B',
      'child..tip',
    ]);
    const after = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(after.map((pr: { state: string }) => pr.state)).to.deep.equal([
      'MERGED',
      'OPEN',
      'OPEN',
    ]);
    for (const pr of after) {
      pr.statusCheckRollup = [];
      pr.mergeStateStatus = 'CLEAN';
    }
    fs.writeFileSync(github.state, JSON.stringify(after));
    const resumed = fixture.run(['land', 'child', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    const final = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(final[1].headRefOid).to.equal(head);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tipTree);
    expect(
      fixture.git(['log', '--format=%an <%ae>%n%B', 'main..tip'])
    ).to.equal(tipCommit);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
  });

  for (const change of [
    'failed check',
    'dismissed approval',
    'local work',
    'remote head',
    'policy',
    'unknown readiness',
  ] as const) {
    it(`stops before the next merge when ${change} changes while checks are running`, async () => {
      pendingAfterPush();
      let changed = false;
      let concurrent = '';
      const result = await runLanding(['land', 'child', '--yes'], (output) => {
        if (changed || !output.includes('Waiting for #18')) return;
        changed = true;
        const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
        const child = prs[1];
        if (change === 'failed check')
          child.statusCheckRollup[0] = {
            __typename: 'CheckRun',
            name: 'unit',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
          };
        if (change === 'dismissed approval')
          child.reviewDecision = 'CHANGES_REQUESTED';
        if (change === 'unknown readiness') child.mergeable = 'UNKNOWN';
        if (change === 'local work')
          fs.writeFileSync(
            path.join(fixture.repo, 'local-note.txt'),
            'Preserve this note.\n'
          );
        if (change === 'policy') {
          const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
          fs.writeFileSync(
            github.policy,
            JSON.stringify({
              ...policy,
              rules: [
                {
                  type: 'pull_request',
                  parameters: { required_approving_review_count: 2 },
                },
              ],
            })
          );
          child.reviewDecision = 'REVIEW_REQUIRED';
        }
        if (change === 'remote head') {
          concurrent = fixture.git([
            'commit-tree',
            fixture.git(['rev-parse', 'child^{tree}']),
            '-p',
            child.headRefOid,
            '-m',
            'Concurrent remote work',
          ]);
          fixture.git(['push', 'origin', `${concurrent}:refs/heads/child`]);
        }
        fs.writeFileSync(github.state, JSON.stringify(prs));
      });
      expect(changed).to.equal(true);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('No merge request sent for #18');
      expect(result.stderr).not.to.include('Merge unconfirmed or uncertain');
      expect(
        JSON.parse(fs.readFileSync(github.state, 'utf8')).map(
          (pr: { state: string }) => pr.state
        )
      ).to.deep.equal(['MERGED', 'OPEN', 'OPEN']);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      if (change === 'local work')
        expect(
          fs.readFileSync(path.join(fixture.repo, 'local-note.txt'), 'utf8')
        ).to.equal('Preserve this note.\n');
      if (change === 'remote head')
        expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
          concurrent
        );
      expect(
        fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
      ).to.equal(true);
    });
  }

  it('preserves progress and releases its lock on Ctrl-C while waiting, then resumes with fresh checks', async () => {
    pendingAfterPush();
    let interrupted = false;
    const result = await runLanding(
      ['land', 'child', '--yes'],
      (output, interrupt) => {
        if (interrupted || !output.includes('Waiting for #18')) return;
        interrupted = true;
        interrupt();
      }
    );
    expect(interrupted).to.equal(true);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('Landing interrupted');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.graphite_cache_lock'))
    ).to.equal(false);
    const head = fixture.git(['rev-parse', 'child']);
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    for (const pr of prs) {
      pr.statusCheckRollup = [];
      pr.mergeStateStatus = 'CLEAN';
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const resumed = fixture.run(['land', 'child', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))[1].headRefOid
    ).to.equal(head);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
  });

  it('waits for an exact-head app-bound required check and revalidates its publisher before resuming', async () => {
    pendingAfterPush();
    const stopped = fixture.run([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    const head = fixture.git(['rev-parse', 'child']);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    policy.protected = true;
    policy.protection = {
      url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
      required_status_checks: { checks: [{ context: 'unit', app_id: 42 }] },
    };
    policy.checkRuns = [
      {
        id: 1,
        name: 'unit',
        head_sha: head,
        status: 'in_progress',
        conclusion: null,
        app: { id: 42 },
      },
    ];
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    let completed = false;
    const resumed = await runLanding(['land', 'child', '--yes'], (output) => {
      if (completed || !output.includes('Waiting for #18')) return;
      completed = true;
      policy.checkRuns[0].status = 'completed';
      policy.checkRuns[0].conclusion = 'success';
      fs.writeFileSync(github.policy, JSON.stringify(policy));
      const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
      prs[1].mergeStateStatus = 'CLEAN';
      prs[1].statusCheckRollup = [
        { __typename: 'StatusContext', context: 'unit', state: 'SUCCESS' },
      ];
      fs.writeFileSync(github.state, JSON.stringify(prs));
    });
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(completed).to.equal(true);
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))[1].headRefOid
    ).to.equal(head);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
  });

  it('reports running checks immediately in a preserving dry-run and rejects invalid wait limits', () => {
    const prs = github.prs.map((pr) => ({
      ...pr,
      mergeStateStatus: 'UNSTABLE',
      statusCheckRollup: [
        {
          __typename: 'CheckRun',
          name: 'publish-beta',
          status: 'IN_PROGRESS',
          conclusion: null,
        },
      ],
    }));
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run(['land', 'child', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.include('publish-beta: IN_PROGRESS');
    expect(result.stdout).not.to.include('Waiting for #');
    for (const value of ['-1', '1.5', 'Infinity', '86401', 'nope']) {
      const invalid = fixture.run([
        'land',
        'child',
        '--yes',
        '--wait-timeout',
        value,
      ]);
      expect(invalid.status, invalid.stdout + invalid.stderr).to.equal(1);
      expect(invalid.stderr).to.include('--wait-timeout requires an integer');
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
});
