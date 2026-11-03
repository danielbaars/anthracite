import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { expect } from 'chai';
import stripAnsi from 'strip-ansi';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import {
  emptyPrivatePolicyEvidence,
  preparePrivatePlanLand,
} from '../lib/fixtures/land_private_policy';

/* eslint-disable max-lines-per-function */
describe('public private-plan landing recovery freshness', function () {
  this.timeout(300000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof preparePrivatePlanLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 180000;
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
  function activeEvidence(): Record<string, unknown> {
    return emptyPrivatePolicyEvidence({
      rulesets: {
        totalCount: 1,
        nodes: [{ id: 'inherited-rule', enforcement: 'ACTIVE' }],
        pageInfo: { hasNextPage: false, endCursor: 'final' },
      },
    });
  }
  function clearChecks(): void {
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    for (const pr of prs) {
      pr.statusCheckRollup = [];
      pr.mergeStateStatus = 'CLEAN';
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
  }
  function pauseLanding(): void {
    setPolicy({ pendingAfterPush: true });
    const stopped = fixture.run([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '0',
    ]);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('No merge request sent for #18')
      .and.include('Check wait timed out');
    setPolicy({ pendingAfterPush: false });
  }
  function assertProgress(): void {
    const prs: ReadonlyArray<{ readonly state: string }> = JSON.parse(
      fs.readFileSync(github.state, 'utf8')
    );
    expect(prs.map((pr) => pr.state)).to.deep.equal(['MERGED', 'OPEN', 'OPEN']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(fixture.git(['show', 'main:base.txt'])).to.equal('base');
    expect(fixture.git(['rev-list', '--count', 'main..child'])).to.equal('1');
  }
  function preservingInspection(status: number, terminal = false): string {
    const marker = path.join(fixture.root, 'unexpected-resume-push');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        marker
      )}, 'push');process.exitCode=1;`,
      { mode: 0o755 }
    );
    const before = fixture.inspectionSnapshot();
    const recoveryFile = path.join(fixture.repo, '.git/.anthracite_landing');
    const recovery = JSON.parse(fs.readFileSync(recoveryFile, 'utf8'));
    const remote = fixture.git(['for-each-ref'], github.remote);
    const state = fs.readFileSync(github.state, 'utf8');
    const calls = fs.readFileSync(github.calls, 'utf8');
    const result = fixture.run(['land', 'child', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(status);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    if (terminal) {
      const declined = runCliInPty(getTestCliCommand(['land', 'child']), {
        cwd: fixture.repo,
        env: fixture.env,
        timeoutMs: 90000,
        responses: [{ prompt: 'Resume this landing plan?', input: 'n\n' }],
      });
      expect(declined.status, declined.output).to.equal(0);
      const output = stripAnsi(declined.output).replace(/\r\n/g, '\n');
      const prompt = output.indexOf('? Resume this landing plan?');
      expect(prompt, output).to.be.greaterThan(0);
      expect(output.slice(0, prompt).trimEnd()).to.equal(
        result.stdout.trimEnd()
      );
    } else if (status === 1) {
      const resumed = fixture.run([
        'land',
        'child',
        '--yes',
        '--wait-timeout',
        '0',
      ]);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(1);
      expect(resumed.stderr).to.include('No merge request sent for #18');
      expect(resumed.stdout.startsWith(result.stdout)).to.equal(true);
    }
    // Confirmed resumption refreshes lock ownership, but no saved phase or participant.
    if (!terminal && status === 1) {
      const after = JSON.parse(fs.readFileSync(recoveryFile, 'utf8'));
      expect({ ...after, cacheLock: recovery.cacheLock }).to.deep.equal(
        recovery
      );
      const current = fixture.inspectionSnapshot();
      const beforePersistent = before.persistent;
      const currentPersistent = current.persistent;
      if (
        !beforePersistent ||
        typeof beforePersistent !== 'object' ||
        !currentPersistent ||
        typeof currentPersistent !== 'object'
      )
        throw new Error('Missing persistence snapshot.');
      expect({
        ...current,
        persistent: { ...currentPersistent, '.anthracite_landing': null },
      }).to.deep.equal({
        ...before,
        persistent: { ...beforePersistent, '.anthracite_landing': null },
      });
    } else {
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.state, 'utf8')).to.equal(state);
    expect(fs.readFileSync(github.calls, 'utf8').slice(calls.length))
      .not.to.include('"PUT"')
      .and.not.to.include('"edit"');
    expect(fs.existsSync(marker)).to.equal(false);
    fs.unlinkSync(path.join(fixture.repo, '.git/hooks/pre-push'));
    return result.stdout;
  }

  it('shows the same fresh saved policy before terminal confirmation and preserves rejection', () => {
    pauseLanding();
    clearChecks();
    expect(preservingInspection(0, true)).to.include(
      'Independently verified despite plan-restricted REST access.'
    );
    setPolicy({ planAbsenceResponse: activeEvidence() });
    expect(preservingInspection(1, true)).to.include('non-disabled or unknown');
    assertProgress();
  });
  it('refuses changed proof prerequisites on saved inspection and confirmed resumption without losing reached state', () => {
    pauseLanding();
    clearChecks();
    const originalPolicy = fs.readFileSync(github.policy, 'utf8');
    const cases = [
      { planAbsenceResponse: activeEvidence() },
      {
        planAbsenceResponse: emptyPrivatePolicyEvidence({
          viewerPermission: 'WRITE',
        }),
      },
      {
        planAbsenceResponse: emptyPrivatePolicyEvidence({
          nameWithOwner: 'foreign/repository',
        }),
      },
      { planAbsenceResponse: emptyPrivatePolicyEvidence({ isPrivate: false }) },
      {
        planAbsenceResponse: emptyPrivatePolicyEvidence({
          ref: { name: 'main', branchProtectionRule: { id: 'classic' } },
        }),
      },
      { planAbsenceResponse: null },
    ];
    for (const changed of cases) {
      setPolicy(changed);
      expect(preservingInspection(1)).not.to.include('Readiness: READY');
      assertProgress();
      fs.writeFileSync(github.policy, originalPolicy);
    }
    const child = fixture.git(['rev-parse', 'child']);
    const resumed = fixture.run(['land', 'child', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))[1].headRefOid
    ).to.equal(child);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
  });
  it('uses newly available REST reviews, checks and exact-head publishers instead of the old alternate proof', () => {
    pauseLanding();
    clearChecks();
    setPolicy({
      rulesFailure: null,
      rules: [
        {
          type: 'pull_request',
          parameters: { required_approving_review_count: 2 },
        },
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'unit', integration_id: 42 }],
          },
        },
      ],
      checkRuns: [],
    });
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    prs[1].reviewDecision = 'REVIEW_REQUIRED';
    fs.writeFileSync(github.state, JSON.stringify(prs));
    expect(preservingInspection(1))
      .to.include('Required approvals missing')
      .and.include('Required check missing or not successful: unit')
      .and.include('Required check publisher missing or ambiguous: unit');
    prs[1].reviewDecision = 'APPROVED';
    prs[1].statusCheckRollup = [
      { __typename: 'StatusContext', context: 'unit', state: 'SUCCESS' },
    ];
    fs.writeFileSync(github.state, JSON.stringify(prs));
    setPolicy({
      checkRuns: [
        {
          id: 1,
          name: 'unit',
          head_sha: fixture.git(['rev-parse', 'child']),
          status: 'completed',
          conclusion: 'success',
          app: { id: 7 },
        },
      ],
    });
    expect(preservingInspection(1))
      .to.include('GitHub App 42')
      .and.not.include('Independently verified');
    setPolicy({
      checkRuns: [
        {
          id: 1,
          name: 'unit',
          head_sha: fixture.git(['rev-parse', 'child']),
          status: 'completed',
          conclusion: 'success',
          app: { id: 42 },
        },
      ],
    });
    expect(preservingInspection(0))
      .to.include('Readiness: READY')
      .and.not.include('Independently verified');
    assertProgress();
  });

  it('obtains new inherited policy evidence before each next merge after real maintenance', () => {
    setPolicy({ policyAfterMerge: { planAbsenceResponse: activeEvidence() } });
    const result = fixture.run(['land', 'child', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('No merge request sent for #18')
      .and.include('non-disabled or unknown');
    assertProgress();
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))[1].baseRefName
    ).to.equal('main');
    expect(fixture.git(['show-ref', '--heads'], github.remote)).not.to.include(
      'refs/heads/base'
    );
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'child', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(1);
    expect(preview.stdout)
      .to.include('Merge 1: child #18')
      .and.not.include('Merge 1: base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('finishes saved mandatory maintenance despite newly blocked policy then refuses the next merge without replay or push repetition', () => {
    setPolicy({ failPrEdit: true });
    const stopped = fixture.run(['land', 'child', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('survivor maintenance')
      .and.include('Confirmed merged');
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(child);
    setPolicy({ failPrEdit: false, planAbsenceResponse: activeEvidence() });
    const pushed = path.join(fixture.root, 'maintenance-pushes');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(
        pushed
      )}, process.argv[3] + String.fromCharCode(10));`,
      { mode: 0o755 }
    );
    const resumed = fixture.run(['land', 'child', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(1);
    expect(resumed.stdout).to.include('Cannot resume landing yet:');
    expect(resumed.stderr)
      .to.include('No merge request sent for #18')
      .and.include('non-disabled or unknown');
    assertProgress();
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.git(['rev-parse', 'tip'], github.remote)).to.equal(tip);
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))[1].baseRefName
    ).to.equal('main');
    expect(fixture.git(['show-ref', '--heads'], github.remote)).not.to.include(
      'refs/heads/base'
    );
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(true);
    const published = fs.existsSync(pushed)
      ? fs.readFileSync(pushed, 'utf8')
      : '';
    // The child was already pushed; remaining tip publication and landed-base deletion are mandatory.
    expect(published.split('\n').filter(Boolean)).to.have.length(2);
    fs.unlinkSync(path.join(fixture.repo, '.git/hooks/pre-push'));
  });

  async function runWaiting(
    observe: () => void
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const [executable, ...args] = getTestCliCommand([
      'land',
      'child',
      '--yes',
      '--wait-timeout',
      '30',
    ]);
    const child = spawn(executable, args, {
      cwd: fixture.repo,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let sawWaiting = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 180000);
    try {
      return await new Promise((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (!sawWaiting && stdout.includes('Waiting for #18')) {
            sawWaiting = true;
            observe();
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (status) => {
          if (timedOut || !sawWaiting)
            reject(
              new Error(`Waiting was not completed: ${stdout}\n${stderr}`)
            );
          else resolve({ status, stdout, stderr });
        });
      });
    } finally {
      clearTimeout(timer);
    }
  }

  for (const change of [
    'checks pass',
    'inherited rule activates',
    'REST becomes available',
  ] as const) {
    it(`revalidates private-plan policy while resumed checks wait when ${change}`, async () => {
      pauseLanding();
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      const calls = fs.readFileSync(github.calls, 'utf8');
      let waitingRefs: unknown;
      const result = await runWaiting(() => {
        waitingRefs = fixture.inspectionSnapshot().refs;
        clearChecks();
        if (change === 'inherited rule activates')
          setPolicy({ planAbsenceResponse: activeEvidence() });
        if (change === 'REST becomes available')
          setPolicy({
            rulesFailure: null,
            rules: [
              {
                type: 'pull_request',
                parameters: { required_approving_review_count: 2 },
              },
            ],
          });
        if (change === 'REST becomes available') {
          const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
          prs[1].reviewDecision = 'REVIEW_REQUIRED';
          fs.writeFileSync(github.state, JSON.stringify(prs));
        }
      });
      expect(waitingRefs).to.equal(before.refs);
      expect(result.status, result.stdout + result.stderr).to.equal(
        change === 'checks pass' ? 0 : 1
      );
      if (change === 'checks pass') {
        expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
        expect(
          fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
        ).to.equal(2);
        expect(
          fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
        ).to.equal(false);
      } else {
        expect(result.stderr).to.include('No merge request sent for #18');
        expect(result.stderr).to.include(
          change === 'inherited rule activates'
            ? 'non-disabled or unknown'
            : 'Required approvals missing'
        );
        assertProgress();
        expect(fixture.inspectionSnapshot().refs).to.equal(before.refs);
        expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
        expect(fs.readFileSync(github.calls, 'utf8').slice(calls.length))
          .not.to.include('"PUT"')
          .and.not.to.include('"edit"');
        expect(
          fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
        ).to.equal(true);
      }
    });
  }
});
