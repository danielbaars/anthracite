import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { spawn } from 'child_process';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';

// eslint-disable-next-line max-lines-per-function
describe('public deferred landing recovery', function () {
  this.timeout(300000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 240000;
  });
  afterEach(() => fixture?.cleanup());

  for (const at of ['before push', 'before PR edit', 'before cleanup']) {
    it(`refuses a concurrent recovery change ${at}`, () => {
      const github = prepareLand(fixture);
      const observer = observeLandingPushes(fixture, github.remote);
      const executable = path.join(github.bin, 'gh');
      const original = fs.readFileSync(executable, 'utf8');
      const progress = path.join(fixture.repo, '.git/.anthracite_landing');
      const marker = path.join(fixture.root, 'concurrent-record');
      fs.writeFileSync(
        executable,
        `#!${process.execPath}\n{
        const io = require('fs');
        const file = ${JSON.stringify(progress)};
        const marker = ${JSON.stringify(marker)};
        if (io.existsSync(file) && !io.existsSync(marker)) {
          const bytes = io.readFileSync(file, 'utf8');
          const saved = JSON.parse(bytes);
          const child = saved.merges[1];
          const state = JSON.parse(io.readFileSync(${JSON.stringify(
            github.state
          )}, 'utf8'));
          const pr = state.find(item => item.number === 18);
          const stage = ${JSON.stringify(at)};
          if (saved.phase === 'trunk-advanced' && child.reached && (
            stage === 'before push' && child.reached.head !== child.reached.remoteHead ||
            stage === 'before PR edit' && child.reached.head === child.reached.remoteHead && pr.baseRefName === 'base' ||
            stage === 'before cleanup' && pr.baseRefName === 'main'
          )) {
            io.writeFileSync(file, bytes + '\\n');
            io.writeFileSync(marker, bytes + '\\n');
          }
        }
      }\n${original.slice(original.indexOf('\n') + 1)}`,
        { mode: 0o755 }
      );
      const result = fixture.run(['land', 'tip', '--yes']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('Landing recovery changed concurrently');
      expect(fs.readFileSync(progress, 'utf8')).to.equal(
        fs.readFileSync(marker, 'utf8')
      );
      expect(observer.client()).to.have.length(at === 'before push' ? 0 : 1);
      expect(
        observer
          .received()
          .flatMap((entry) => entry.refs)
          .map((entry) => entry.ref)
      ).to.deep.equal(
        at === 'before push'
          ? ['refs/heads/main']
          : ['refs/heads/main', 'refs/heads/child']
      );
      if (at !== 'before cleanup')
        expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"edit"');
      expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(
        fixture.git(['rev-parse', 'base'])
      );
    });
  }

  it('retains an acknowledged push and reconciles fresh PR content without republishing on retry', () => {
    const github = prepareLand(fixture);
    const observer = observeLandingPushes(fixture, github.remote);
    const originalTip = fixture.git(['rev-parse', 'tip'], github.remote);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, failPrEditNumber: 18 })
    );
    const stopped = fixture.run(['land', 'tip', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include(
      'Survivor maintenance incomplete for child'
    );
    expect(stopped.stderr)
      .to.include('Reached local work is retained')
      .and.include('publication/base/footer work remains unconfirmed');
    const child = fixture.git(['rev-parse', 'child']);
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'], github.remote)).to.equal(
      originalTip
    );
    expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(originalTip);
    const progress = path.join(fixture.repo, '.git/.anthracite_landing');
    const saved = z
      .object({
        version: z.literal(2),
        phase: z.literal('trunk-advanced'),
        merges: z.array(
          z.object({
            reached: z
              .object({ head: z.string(), remoteHead: z.string() })
              .optional(),
          })
        ),
      })
      .parse(JSON.parse(fs.readFileSync(progress, 'utf8')));
    expect(saved.merges[1].reached?.remoteHead).to.equal(child);
    expect(saved.merges[2].reached?.remoteHead).to.equal(originalTip);
    expect(observer.client()).to.have.length(1);
    expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(
      fixture.git(['rev-parse', 'base'])
    );

    const prs = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    for (const pr of prs.filter((item) => item.state === 'OPEN')) {
      pr.body = `Fresh description for #${pr.number}\n\nUnmanaged bot note\n`;
      pr.title = `Fresh title for #${pr.number}`;
      pr.assignees = [{ login: 'owner' }];
      pr.reviewRequests = [{ login: 'reviewer' }];
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    const updates = observer
      .client()
      .flatMap((entry) => entry.refs)
      .filter((entry) => entry.next !== '0'.repeat(40));
    expect(updates.map((entry) => entry.ref)).to.deep.equal([
      'refs/heads/child',
      'refs/heads/tip',
    ]);
    const received = observer
      .received()
      .flatMap((entry) => entry.refs)
      .filter((entry) => entry.ref !== 'refs/heads/main');
    expect(received).to.have.deep.members(
      observer.client().flatMap((entry) => entry.refs)
    );
    const after = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    for (const pr of after.slice(1)) {
      expect(pr.body)
        .to.include(`Fresh description for #${pr.number}`)
        .and.include('Unmanaged bot note');
      expect(pr.title).to.equal(`Fresh title for #${pr.number}`);
      expect(pr.assignees).to.deep.equal([{ login: 'owner' }]);
      expect(pr.reviewRequests).to.deep.equal([{ login: 'reviewer' }]);
      expect(pr.isDraft).to.equal(false);
      expect(pr.state).to.equal('MERGED');
    }
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    expect(fs.existsSync(progress)).to.equal(false);
  });

  for (const at of ['before publication', 'after acknowledged push']) {
    it(`resumes SIGINT ${at} without losing deferred obligations or repeating pushes`, () => {
      const github = prepareLand(fixture);
      const observer = observeLandingPushes(fixture, github.remote);
      const executable = path.join(github.bin, 'gh');
      const original = fs.readFileSync(executable, 'utf8');
      const progress = path.join(fixture.repo, '.git/.anthracite_landing');
      const marker = path.join(fixture.root, 'interrupted-once');
      const originalTip = fixture.git(['rev-parse', 'tip'], github.remote);
      fs.writeFileSync(
        executable,
        `#!${process.execPath}\n{
        const io = require('fs');
        const file = ${JSON.stringify(progress)};
        const marker = ${JSON.stringify(marker)};
        if (io.existsSync(file) && !io.existsSync(marker)) {
          const saved = JSON.parse(io.readFileSync(file, 'utf8'));
          const child = saved.merges[1];
          const before = ${JSON.stringify(at === 'before publication')};
          if (saved.phase === 'trunk-advanced' && child.reached &&
            (child.reached.head === child.reached.remoteHead) !== before) {
            io.writeFileSync(marker, 'interrupted');
            process.kill(saved.cacheLock.pid, 'SIGINT');
            process.exit(1);
          }
        }
      }\n${original.slice(original.indexOf('\n') + 1)}`,
        { mode: 0o755 }
      );
      const stopped = fixture.run(['land', 'tip', '--yes']);
      expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
      expect(stopped.stderr).to.include('Landing interrupted');
      expect(stopped.stderr).to.include(
        'pending publication/base/footer obligations'
      );
      expect(fs.existsSync(marker)).to.equal(true);
      expect(
        fs.existsSync(path.join(fixture.repo, '.git/.graphite_cache_lock'))
      ).to.equal(false);
      expect(observer.client()).to.have.length(
        at === 'before publication' ? 0 : 1
      );
      expect(fixture.git(['rev-parse', 'tip'], github.remote)).to.equal(
        originalTip
      );
      const tip = fixture.git(['rev-parse', 'tip']);
      expect(tip).not.to.equal(originalTip);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"edit"');
      const saved = z
        .object({
          version: z.literal(2),
          phase: z.literal('trunk-advanced'),
          merges: z.array(
            z.object({
              reached: z
                .object({ head: z.string(), remoteHead: z.string() })
                .optional(),
            })
          ),
        })
        .parse(JSON.parse(fs.readFileSync(progress, 'utf8')));
      expect(saved.merges[2].reached?.head).to.equal(tip);
      expect(saved.merges[2].reached?.remoteHead).to.equal(originalTip);
      fs.writeFileSync(executable, original, { mode: 0o755 });
      const resumed = fixture.run(['land', 'tip', '--yes']);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
      const updates = observer
        .client()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.next !== '0'.repeat(40));
      expect(updates.map((entry) => entry.ref)).to.deep.equal([
        'refs/heads/child',
        'refs/heads/tip',
      ]);
      expect(
        observer
          .received()
          .flatMap((entry) => entry.refs)
          .filter((entry) => entry.ref !== 'refs/heads/main')
      ).to.have.deep.members(observer.client().flatMap((entry) => entry.refs));
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(3);
      expect(fs.existsSync(progress)).to.equal(false);
    });
  }

  it('keeps failed publication unconfirmed and withholds PR edits and cleanup until retry', () => {
    const github = prepareLand(fixture);
    const observer = observeLandingPushes(fixture, github.remote);
    const oldChild = fixture.git(['rev-parse', 'child'], github.remote);
    const hook = path.join(github.remote, 'hooks/pre-receive');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nwhile read old next ref; do\nif [ "$ref" = refs/heads/child ]; then exit 1; fi\ndone\n',
      { mode: 0o755 }
    );
    const stopped = fixture.run(['land', 'tip', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include(
      'Survivor maintenance incomplete for child'
    );
    expect(stopped.stderr)
      .to.include('Reached local work is retained')
      .and.include('publication/base/footer work remains unconfirmed');
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
      oldChild
    );
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(oldChild);
    expect(
      observer
        .received()
        .flatMap((entry) => entry.refs)
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/main']);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"edit"');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    fs.unlinkSync(hook);
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(
      observer
        .client()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.next !== '0'.repeat(40))
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/child', 'refs/heads/tip']);
    expect(
      observer
        .received()
        .flatMap((entry) => entry.refs)
        .filter(
          (entry) =>
            entry.ref !== 'refs/heads/main' && entry.next !== '0'.repeat(40)
        )
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
  });

  it('retains a deferred target across SIGINT during required-check waiting', async () => {
    const github = prepareLand(fixture, ['unit']);
    const observer = observeLandingPushes(fixture, github.remote);
    const originalTip = fixture.git(['rev-parse', 'tip'], github.remote);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
    const [executable, ...args] = getTestCliCommand(['land', 'tip', '--yes']);
    const child = spawn(executable, args, {
      cwd: fixture.repo,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let interrupted = false;
    const timer = setTimeout(() => child.kill('SIGTERM'), 90000);
    let status: number | null;
    try {
      status = await new Promise<number | null>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (!interrupted && stdout.includes('Waiting for #18')) {
            interrupted = true;
            child.kill('SIGINT');
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    expect(interrupted, stdout + stderr).to.equal(true);
    expect(status, stdout + stderr).to.equal(1);
    expect(stderr).to.include('Landing interrupted');
    expect(stderr).to.include('pending publication/base/footer obligations');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.graphite_cache_lock'))
    ).to.equal(false);
    expect(
      observer
        .client()
        .flatMap((entry) => entry.refs)
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/base']);
    expect(fixture.git(['rev-parse', 'tip'], github.remote)).to.equal(
      originalTip
    );
    expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(originalTip);
    const prs = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
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
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(
      observer
        .client()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.next !== '0'.repeat(40))
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
  });

  it('reconciles an uncertain PR edit by fresh read without repeating an already matching write', () => {
    const github = prepareLand(fixture);
    const observer = observeLandingPushes(fixture, github.remote);
    const executable = path.join(github.bin, 'gh');
    const original = fs.readFileSync(executable, 'utf8');
    const marker = path.join(fixture.root, 'lost-pr-ack');
    fs.writeFileSync(
      executable,
      `${original}\n{
      const io = require('fs');
      const marker = ${JSON.stringify(marker)};
      if (process.argv[2] === 'pr' && process.argv[3] === 'edit' && process.argv[4] === '18' && !io.existsSync(marker)) {
        io.writeFileSync(marker, 'lost response after completed edit');
        process.exit(1);
      }
    }\n`,
      { mode: 0o755 }
    );
    const stopped = fixture.run(['land', 'tip', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(fs.existsSync(marker)).to.equal(true);
    const prs = z
      .array(z.object({ number: z.number(), baseRefName: z.string() }))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    expect(prs.find((pr) => pr.number === 18)?.baseRefName).to.equal('main');
    expect(observer.client()).to.have.length(1);
    expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    const calls = fs.readFileSync(github.calls, 'utf8').trim().split('\n');
    expect(
      calls.filter((call) => call.startsWith('["pr","edit","18"'))
    ).to.have.length(1);
    expect(calls.filter((call) => call.includes('"PUT"'))).to.have.length(3);
    expect(
      observer
        .client()
        .flatMap((entry) => entry.refs)
        .filter((entry) => entry.next !== '0'.repeat(40))
        .map((entry) => entry.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip']);
  });
});
