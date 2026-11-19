import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { expect } from 'chai';
import { z } from 'zod';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';

// eslint-disable-next-line max-lines-per-function
describe('public landing hook selection', function () {
  this.timeout(180000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 180000;
  });
  afterEach(() => fixture?.cleanup());

  function installFailingHook(): string {
    const marker = path.join(fixture.root, 'pre-push-input');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!${
        process.execPath
      }\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(
        marker
      )},fs.readFileSync(0));process.stderr.write('FIXTURE_HOOK_REFUSED\\n');process.exitCode=23;\n`,
      { mode: 0o755 }
    );
    return marker;
  }

  it('skips project hooks for all updates and deletions in a new landing with --no-verify', () => {
    const github = prepareLand(fixture);
    fixture.git(['switch', 'tip']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const observer = observeLandingPushes(fixture, github.remote);
    const marker = installFailingHook();
    const result = fixture.run([
      'land',
      'tip',
      '--yes',
      '--no-verify',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fs.existsSync(marker)).to.equal(false);
    const received = observer
      .received()
      .flatMap((event) => event.refs)
      .filter((ref) => ref.ref !== 'refs/heads/main');
    expect(
      received
        .filter((ref) => ref.next !== '0'.repeat(40))
        .map((ref) => ref.ref)
    ).to.deep.equal(['refs/heads/child', 'refs/heads/tip']);
    expect(
      received
        .filter((ref) => ref.next === '0'.repeat(40))
        .map((ref) => ref.ref)
    ).to.deep.equal(['refs/heads/base', 'refs/heads/child', 'refs/heads/tip']);
    expect(fixture.git(['rev-parse', 'main^{tree}'], github.remote)).to.equal(
      tree
    );
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
  });

  for (const stage of ['update', 'cleanup']) {
    it(`keeps hooks on by default and resumes failed ${stage} with --no-verify`, () => {
      const github = prepareLand(fixture);
      const target = stage === 'cleanup' ? 'leaf' : 'tip';
      if (stage === 'cleanup') {
        fixture.branch(target, 'main');
        fixture.git(['push', 'origin', target]);
        fs.writeFileSync(github.state, JSON.stringify([github.pr(target, 31)]));
      }
      fixture.git(['switch', target]);
      const tree = fixture.git(['rev-parse', `${target}^{tree}`]);
      const marker = installFailingHook();
      const stopped = fixture.run([
        'land',
        target,
        '--yes',
        '--no-interactive',
      ]);
      expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
      expect(stopped.stderr).to.include('FIXTURE_HOOK_REFUSED');
      const input = fs.readFileSync(marker, 'utf8');
      expect(input).to.include(
        stage === 'cleanup' ? '(delete)' : 'refs/heads/child'
      );
      const recovery = path.join(fixture.repo, '.git/.anthracite_landing');
      const saved = fs.readFileSync(recovery);
      const preview = fixture.run([
        'land',
        target,
        '--dry-run',
        '--no-verify',
        '--no-interactive',
      ]);
      expect(preview.stdout).to.include('Pending landing');
      expect(fs.readFileSync(recovery).equals(saved)).to.equal(true);
      expect(fs.readFileSync(marker, 'utf8')).to.equal(input);
      const resumed = fixture.run([
        'land',
        target,
        '--yes',
        '--no-verify',
        '--no-interactive',
      ]);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
      expect(fs.readFileSync(marker, 'utf8')).to.equal(input);
      expect(fixture.git(['rev-parse', 'main^{tree}'], github.remote)).to.equal(
        tree
      );
      expect(
        fixture.git(['ls-remote', '--heads', 'origin', `refs/heads/${target}`])
      ).to.equal('');
      expect(fs.existsSync(recovery)).to.equal(false);
    });
  }

  it('does not retain --no-verify permission across invocations or bypass remote hooks', () => {
    const github = prepareLand(fixture);
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
    const marker = installFailingHook();
    const remoteHook = path.join(github.remote, 'hooks/pre-receive');
    fs.writeFileSync(
      remoteHook,
      '#!/bin/sh\nwhile read old next ref; do\nif [ "$next" = "0000000000000000000000000000000000000000" ]; then\necho FIXTURE_REMOTE_DELETE_REFUSED >&2\nexit 23\nfi\ndone\n',
      { mode: 0o755 }
    );
    const first = fixture.run([
      'land',
      'leaf',
      '--yes',
      '--no-verify',
      '--no-interactive',
    ]);
    expect(first.status, first.stdout + first.stderr).to.equal(1);
    expect(first.stderr).to.include('FIXTURE_REMOTE_DELETE_REFUSED');
    expect(fs.existsSync(marker)).to.equal(false);
    fs.unlinkSync(remoteHook);
    const resumed = fixture.run([
      'land',
      'leaf',
      '--yes',
      '--verify',
      '--no-interactive',
    ]);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(1);
    expect(resumed.stderr).to.include('FIXTURE_HOOK_REFUSED');
    expect(fs.readFileSync(marker, 'utf8')).to.include('(delete)');
    const finished = fixture.run([
      'land',
      'leaf',
      '--yes',
      '--no-verify',
      '--no-interactive',
    ]);
    expect(finished.status, finished.stdout + finished.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
  });

  it('retains required-check protection with --no-verify before any merge', () => {
    const github = prepareLand(fixture, ['unit']);
    const prs = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    for (const pr of prs)
      pr.statusCheckRollup = [
        {
          __typename: 'CheckRun',
          name: 'unit',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
      ];
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const marker = installFailingHook();
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'tip',
      '--yes',
      '--no-verify',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.include('unit').and.include('FAILURE');
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  for (const version of [1, 2] as const) {
    it(`resumes a genuine published version-${version} landing with --no-verify`, function () {
      const producer =
        process.env[
          version === 1
            ? 'ANTHRACITE_TEST_LANDING_V1_PRODUCER'
            : 'ANTHRACITE_TEST_LANDING_V2_PRODUCER'
        ];
      if (!producer) this.skip();
      const github = prepareLand(fixture);
      fixture.git(['switch', 'tip']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const marker = installFailingHook();
      const stopped = spawnSync(
        producer,
        ['land', 'tip', '--yes', '--no-interactive'],
        {
          cwd: fixture.repo,
          env: fixture.env,
          encoding: 'utf8',
          timeout: 180000,
        }
      );
      expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
      expect(stopped.stderr).to.include('FIXTURE_HOOK_REFUSED');
      const recovery = path.join(fixture.repo, '.git/.anthracite_landing');
      z.object({ version: z.literal(version) }).parse(
        JSON.parse(fs.readFileSync(recovery, 'utf8'))
      );
      const hookInput = fs.readFileSync(marker, 'utf8');
      const resumed = fixture.run([
        'land',
        'tip',
        '--yes',
        '--no-verify',
        '--no-interactive',
      ]);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
      expect(fs.readFileSync(marker, 'utf8')).to.equal(hookInput);
      expect(fixture.git(['rev-parse', 'main^{tree}'], github.remote)).to.equal(
        tree
      );
      expect(fs.existsSync(recovery)).to.equal(false);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(3);
    });
  }
});
