import { expect } from 'chai';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { FrozenSubmitCliFixture } from '../lib/fixtures/frozen_submit_cli';

describe('submit role progress through the public CLI', function () {
  this.timeout(120000);
  let fixture: FrozenSubmitCliFixture;
  beforeEach(() => {
    fixture = new FrozenSubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('preserves pending reviewers and existing assignees without redundant additions', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--reviewers', 'alice', '--assignees', '@me');
    const before = fixture.prs();
    fixture.clearCalls();
    fixture.succeed(
      'submit',
      '--reviewers',
      'ALICE,alice',
      '--assignees',
      '@me,fixture-user'
    );
    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture
        .calls()
        .filter(
          (call) =>
            call.includes('--add-reviewer') || call.includes('--add-assignee')
        )
    ).to.deep.equal([]);
  });

  it('reports retained reviewer progress and unattempted later work after assignment failure, then safely retries', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('leaf', 'child');
    fixture.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE = 'reject';
    const args = [
      'submit',
      '--stack',
      '--roles-branch',
      'child',
      '--reviewers',
      'alice',
      '--assignees',
      'bob',
    ];
    const failed = fixture.cli(...args);
    expect(failed.status).not.to.equal(0);
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal([
      'base',
      'child',
    ]);
    expect(fixture.prs()[1].reviewRequests).to.deep.equal([{ login: 'alice' }]);
    expect(fixture.remoteSha('child')).to.equal(
      fixture.git('rev-parse', 'child')
    );
    expect(fixture.remoteSha('leaf')).to.equal('');
    expect(
      fixture
        .calls()
        .filter((call) => call[1] === 'edit' && call.includes('--body'))
    ).to.deep.equal([]);
    const output = failed.stdout + failed.stderr;
    expect(output).to.include('Confirmed reviewers: alice');
    expect(output).to.include('Not attempted: submission of leaf');
    expect(output).to.include('dependency footer updates');
    delete fixture.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE;
    fixture.clearCalls();
    fixture.succeed(...args);
    expect(fixture.prs()[1].reviewRequests).to.deep.equal([{ login: 'alice' }]);
    expect(fixture.prs()[1].assignees).to.deep.equal([{ login: 'bob' }]);
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal([
      'base',
      'child',
      'leaf',
    ]);
    expect(
      fixture.calls().some((call) => call.includes('--add-reviewer'))
    ).to.equal(false);
  });

  it('confirms partial reviewer progress even when gh exits nonzero and leaves assignees unattempted', () => {
    fixture.branch('target', 'main');
    fixture.env.ANTHRACITE_TEST_GH_REVIEW_MODE = 'partial-reject';
    const result = fixture.cli(
      'submit',
      '--reviewers',
      'alice,bob',
      '--assignees',
      'charlie'
    );
    expect(result.status).not.to.equal(0);
    expect(fixture.prs()[0].reviewRequests).to.deep.equal([{ login: 'alice' }]);
    expect(fixture.prs()[0].assignees ?? []).to.deep.equal([]);
    const output = result.stdout + result.stderr;
    expect(result.stderr).to.include('ERROR:');
    expect(
      result.stderr.indexOf('review request partially rejected')
    ).to.be.greaterThan(result.stderr.indexOf('ERROR:'));
    expect(
      result.stderr.split('review request partially rejected')
    ).to.have.length(2);
    expect(output).to.include('Confirmed reviewers: alice');
    expect(output).to.include('bob');
    expect(output).to.include('Not attempted: assignees charlie');
    expect(
      fixture.calls().some((call) => call.includes('--add-assignee'))
    ).to.equal(false);
  });

  it('confirms partial assignee progress after a nonzero write instead of hiding reached assignments', () => {
    fixture.branch('target', 'main');
    fixture.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE = 'partial-reject';
    const result = fixture.cli(
      'submit',
      '--reviewers',
      'alice',
      '--assignees',
      'bob,charlie'
    );
    expect(result.status).not.to.equal(0);
    expect(fixture.prs()[0].assignees).to.deep.equal([{ login: 'bob' }]);
    const output = result.stdout + result.stderr;
    expect(result.stderr).to.include('ERROR:');
    expect(
      result.stderr.indexOf('assignment partially rejected')
    ).to.be.greaterThan(result.stderr.indexOf('ERROR:'));
    expect(result.stderr.split('assignment partially rejected')).to.have.length(
      2
    );
    expect(output).to.include('Confirmed assignees: bob');
    expect(output).to.include('Confirmed reviewers: alice');
    expect(output).to.include('charlie');
    expect(output).to.include('dependency footer updates');
  });

  it('preserves a pending team request by slug without reissuing it', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--reviewers', 'fixture/platform');
    expect(fixture.prs()[0].reviewRequests).to.deep.equal([
      { slug: 'platform', organization: { login: 'fixture' } },
    ]);
    const before = fixture.prs();
    fixture.clearCalls();
    fixture.succeed(
      'submit',
      '--reviewers',
      'fixture/platform,FIXTURE/PLATFORM'
    );
    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture.calls().some((call) => call.includes('--add-reviewer'))
    ).to.equal(false);
  });

  it('labels a reached assignment as unverified when readback identifies a different PR head', () => {
    fixture.branch('target', 'main');
    fixture.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE = 'invalid';
    const result = fixture.cli(
      'submit',
      '--reviewers',
      'alice',
      '--assignees',
      'bob'
    );
    expect(result.status).not.to.equal(0);
    expect(fixture.prs()[0].assignees).to.deep.equal([{ login: 'bob' }]);
    const output = result.stdout + result.stderr;
    expect(output).to.include('Unverified assignees: bob');
    expect(output).to.include('Confirmed reviewers: alice');
    expect(output).not.to.include('Confirmed assignees: bob');
    expect(output).to.include('dependency footer updates');
  });

  it('retains reviewer progress and refuses assignment after external discovery freezes the target', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('leaf', 'child');
    fixture.freezeAfterGhView('headRefName,number,assignees', 'child');
    const result = fixture.cli(
      'submit',
      '--stack',
      '--roles-branch',
      'child',
      '--reviewers',
      'alice',
      '--assignees',
      'bob'
    );
    expect(result.status).not.to.equal(0);
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal([
      'base',
      'child',
    ]);
    expect(fixture.prs()[1].reviewRequests).to.deep.equal([{ login: 'alice' }]);
    expect(
      fixture.calls().some((call) => call.includes('--add-assignee'))
    ).to.equal(false);
    expect(fixture.remoteSha('leaf')).to.equal('');
    expect(result.stdout + result.stderr)
      .to.include('frozen branch child')
      .and.include('Confirmed reviewers: alice')
      .and.include('submission of leaf');
    expect(fixture.succeed('info', 'child')).to.include('(frozen)');
  });

  for (const role of ['reviewers', 'assignees']) {
    it(`captures gh ${role} readback diagnostics inside the formatted error`, () => {
      fixture.branch('target', 'main');
      const shim = path.join(fixture.root, 'bin', 'gh');
      const original = shim + '-original';
      const fields =
        role === 'reviewers'
          ? 'headRefName,number,reviewRequests,reviews'
          : 'headRefName,number,assignees';
      fs.renameSync(shim, original);
      fs.writeFileSync(
        shim,
        `#!${process.execPath}
const cp = require('child_process');
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'view' && args[args.indexOf('--json') + 1] === ${JSON.stringify(
          fields
        )}) {
  process.stderr.write('ROLE_READBACK_DIAGNOSTIC');
  process.exitCode = 1;
} else {
  const result = cp.spawnSync(${JSON.stringify(
    original
  )}, args, {stdio: 'inherit'});
  process.exitCode = result.status ?? 1;
}
`
      );
      fs.chmodSync(shim, 0o755);
      const result = fixture.cli('submit', `--${role}`, 'bob');
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('ERROR:');
      expect(
        result.stderr.indexOf('ROLE_READBACK_DIAGNOSTIC')
      ).to.be.greaterThan(result.stderr.indexOf('ERROR:'));
      expect(
        result.stderr.split('ROLE_READBACK_DIAGNOSTIC'),
        result.stderr
      ).to.have.length(2);
      expect(fixture.prs()).to.have.length(1);
      expect(fixture.prs()[0].reviewRequests).to.deep.equal([]);
      expect(fixture.prs()[0].assignees ?? []).to.deep.equal([]);
    });
  }

  it('keeps a signalled push abort silent and stops before PR changes', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const head = fixture.git('rev-parse', 'HEAD');
    const git = execFileSync('which', ['git'], {
      env: fixture.env,
      encoding: 'utf8',
    }).trim();
    const marker = path.join(fixture.root, 'push-signalled');
    const shim = path.join(fixture.root, 'bin', 'git');
    fs.writeFileSync(
      shim,
      `#!${process.execPath}
const fs = require('fs');
const cp = require('child_process');
const args = process.argv.slice(2);
if (args.includes('push')) {
  fs.writeFileSync(${JSON.stringify(marker)}, 'push');
  process.kill(process.pid, 'SIGKILL');
}
const result = cp.spawnSync(${JSON.stringify(git)}, args, {stdio: 'inherit'});
process.exitCode = result.status ?? 1;
`
    );
    fs.chmodSync(shim, 0o755);
    const result = fixture.cli('submit', '--stack', '--assignees', 'bob');
    expect(result.status).not.to.equal(0);
    expect(fs.readFileSync(marker, 'utf8')).to.equal('push');
    expect(result.stderr).not.to.include('ERROR:');
    expect(result.stderr).not.to.include('Command killed');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.remoteSha('base')).to.equal('');
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
    ).to.equal(false);
  });

  it('stops a rejected push before PR roles and later submissions while preserving local work', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const head = fixture.git('rev-parse', 'HEAD');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const result = fixture.cli(
      'submit',
      '--stack',
      '--reviewers',
      'alice',
      '--assignees',
      'bob'
    );
    expect(result.status).not.to.equal(0);
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.remoteSha('base')).to.equal('');
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
    ).to.equal(false);
    expect(result.stdout + result.stderr)
      .to.include('PR and role changes for base')
      .and.include('submission of child');
  });

  it('reports unattempted work when an earlier PR discovery freezes a later branch', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('leaf', 'child');
    fixture.freezeAfterGhView('headRefName,number,assignees', 'child', true);
    const result = fixture.cli(
      'submit',
      '--stack',
      '--reviewers',
      'alice',
      '--assignees',
      'bob'
    );
    expect(result.status).not.to.equal(0);
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal(['base']);
    expect(fixture.prs()[0].reviewRequests).to.deep.equal([{ login: 'alice' }]);
    expect(fixture.prs()[0].assignees).to.deep.equal([{ login: 'bob' }]);
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.remoteSha('leaf')).to.equal('');
    expect(result.stdout + result.stderr)
      .to.include('PR and role changes for child')
      .and.include('submission of leaf')
      .and.include('dependency footer updates');
  });
});
