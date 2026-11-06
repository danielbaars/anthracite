import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('submit reused branch names through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('npm reuse: creates a new draft after CLOSED history without editing the retired PR', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    const historical = {
      ...fixture.prs()[0],
      state: 'CLOSED',
      title: 'Historical title',
      body: 'Historical description',
      headRefOid: fixture.git('rev-parse', 'feature'),
    };
    fixture.setPrs([historical]);
    fixture.commit('unpublished-correction');
    fixture.clearCalls();
    fixture.succeed('submit', '--reviewers', 'reviewer', '--assignees', '@me');
    expect(fixture.prs()[0]).to.deep.equal(historical);
    expect(fixture.prs()).to.have.length(2);
    expect(fixture.prs()[1]).to.include({
      state: 'OPEN',
      isDraft: true,
      title: 'feature',
    });
    expect(fixture.prs()[1].reviewRequests).to.deep.equal([
      { login: 'reviewer' },
    ]);
    expect(fixture.prs()[1].assignees).to.deep.equal([
      { login: 'fixture-user' },
    ]);
    expect(fixture.prs()[1].body).to.include('PR #2').and.not.include('PR #1');
    expect(
      fixture
        .calls()
        .filter((call) => ['edit', 'ready'].includes(call[1]))
        .every((call) => call[2] !== '1')
    ).to.equal(true);
  });
  it('npm reuse: updates the unique current open PR among repeated history and unpublished local work', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    const retired = {
      ...fixture.prs()[0],
      state: 'MERGED',
      headRefOid: fixture.git('rev-parse', 'feature'),
      body: 'Retired content',
    };
    const current = {
      ...retired,
      number: 3,
      url: 'https://github.com/fixture/submit/pull/3',
      state: 'OPEN',
      headRefOid: undefined,
      title: 'Current title',
      body: 'Current description',
      reviewRequests: [{ login: 'existing-reviewer' }],
      assignees: [{ login: 'existing-assignee' }],
    };
    fixture.setPrs([
      retired,
      {
        ...retired,
        number: 2,
        url: 'https://github.com/fixture/submit/pull/2',
        headRefOid: fixture.git('rev-parse', 'main'),
      },
      current,
    ]);
    fixture.commit('unpublished');
    fixture.clearCalls();
    fixture.succeed(
      'submit',
      '--publish',
      '--reviewers',
      'new-reviewer',
      '--assignees',
      'new-assignee'
    );
    expect(fixture.prs()).to.have.length(3);
    expect(fixture.prs()[0]).to.deep.equal(retired);
    expect(fixture.prs()[2]).to.include({
      title: 'Current title',
      state: 'OPEN',
      isDraft: false,
    });
    expect(fixture.prs()[2].body)
      .to.include('Current description')
      .and.include('PR #3')
      .and.not.include('PR #1');
    expect(fixture.prs()[2].reviewRequests).to.deep.equal([
      { login: 'existing-reviewer' },
      { login: 'new-reviewer' },
    ]);
    expect(fixture.prs()[2].assignees).to.deep.equal([
      { login: 'existing-assignee' },
      { login: 'new-assignee' },
    ]);
    expect(fixture.calls().some((call) => call[1] === 'create')).to.equal(
      false
    );
    expect(fixture.remoteSha('feature')).to.equal(
      fixture.git('rev-parse', 'feature')
    );
  });

  it('refuses a PR that closes during reviewer readback before adding a reviewer', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    const shim = path.join(fixture.root, 'bin/gh');
    const original = `${shim}-original`;
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${
        process.execPath
      }\nconst fs=require('fs'),cp=require('child_process');const args=process.argv.slice(2);if(args[1]==='view' && args[args.indexOf('--json')+1]?.includes('reviewRequests')) {const file=process.env.ANTHRACITE_TEST_GH_STATE;const prs=JSON.parse(fs.readFileSync(file,'utf8'));prs[0].state='CLOSED';fs.writeFileSync(file,JSON.stringify(prs));} const r=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;`
    );
    fs.chmodSync(shim, 0o755);
    fixture.clearCalls();
    const result = fixture.cli('submit', '--reviewers', 'new-reviewer');
    expect(result.status).not.to.equal(0);
    expect(fixture.prs()[0].reviewRequests).to.deep.equal([]);
    expect(
      fixture
        .calls()
        .filter((call) => call[1] === 'edit' && call.includes('--add-reviewer'))
    ).to.deep.equal([]);
  });
  it('creates a published PR after exact-head MERGED history without a new commit', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    const retired = {
      ...fixture.prs()[0],
      state: 'MERGED',
      headRefOid: fixture.git('rev-parse', 'feature'),
      body: 'Retired merged description',
    };
    fixture.setPrs([retired]);
    fixture.clearCalls();
    const preview = fixture.succeed('submit', '--dry-run', '--publish');
    expect(preview)
      .to.include('feature (Create)')
      .and.include('Publish as ready for review');
    expect(fixture.prs()).to.deep.equal([retired]);
    fixture.succeed('submit', '--publish');
    expect(fixture.prs()[0]).to.deep.equal(retired);
    expect(fixture.prs()[1]).to.include({ isDraft: false, state: 'OPEN' });
  });

  it('discovers reused numeric and shell-sensitive branch names without adopting historical PR numbers', () => {
    for (const name of ['123', 'topic;$()&`literal`']) {
      fixture.branch(name, 'main');
      fixture.succeed('submit');
      const retired = fixture.prs().map((pr) =>
        pr.headRefName === name
          ? {
              ...pr,
              state: 'CLOSED',
              headRefOid: fixture.git('rev-parse', name),
            }
          : pr
      );
      fixture.setPrs(retired);
      fixture.commit(`new-${name}`);
      const ref = `refs/branch-metadata/${name}`;
      const raw = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(fixture.git('cat-file', '-p', ref)));
      delete raw.prInfo;
      const hash = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: fixture.repo,
        env: fixture.env,
        input: JSON.stringify(raw),
        encoding: 'utf8',
      }).trim();
      fixture.git('update-ref', ref, hash);
      fixture.clearCalls();
      fixture.succeed('submit');
      expect(
        fixture
          .prs()
          .filter((pr) => pr.headRefName === name && pr.state === 'OPEN')
      ).to.have.length(1);
      expect(
        fixture
          .calls()
          .filter((call) => call[1] === 'list')
          .every((call) => call[call.indexOf('--head') + 1] === name)
      ).to.equal(true);
      expect(fixture.prs().filter((pr) => pr.state === 'CLOSED')).to.deep.equal(
        retired.filter((pr) => pr.state === 'CLOSED')
      );
    }
  });

  for (const count of [2, 100]) {
    it(`refuses ${
      count === 2 ? 'ambiguous open' : 'incomplete bounded'
    } discovery before pushing new work`, () => {
      fixture.branch('feature', 'main');
      fixture.succeed('submit');
      const original = fixture.prs()[0];
      fixture.setPrs(
        Array.from({ length: count }, (_, i) => ({
          ...original,
          number: i + 1,
          url: `https://github.com/fixture/submit/pull/${i + 1}`,
          state: count === 2 ? 'OPEN' : 'CLOSED',
          headRefOid: fixture.git('rev-parse', 'feature'),
        }))
      );
      fixture.commit('unpublished');
      const remote = fixture.remoteSha('feature');
      const before = fixture.prs();
      fixture.clearCalls();
      const result = fixture.cli('submit');
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include(
        count === 2 ? 'Ambiguous' : 'incomplete'
      );
      expect(fixture.remoteSha('feature')).to.equal(remote);
      expect(fixture.prs()).to.deep.equal(before);
      expect(
        fixture
          .calls()
          .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
      ).to.equal(false);
    });
  }

  it('refuses an obsolete unselected ancestor without pushing the selected child or editing history', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) =>
        pr.headRefName === 'base'
          ? {
              ...pr,
              state: 'CLOSED',
              headRefOid: fixture.git('rev-parse', 'base'),
              body: 'Retired base description',
            }
          : pr
      )
    );
    fixture.commit('child-correction');
    const before = fixture.prs();
    const remote = fixture.remoteSha('child');
    fixture.clearCalls();
    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--interactive',
        '--select',
        '--no-edit',
        '--no-confirm',
        '--draft',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Would you like to submit base?', input: 'n\r' },
          { prompt: 'Would you like to submit child?', input: 'y\r' },
        ],
      }
    );
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.include('No current open PR for base');
    expect(fixture.prs()).to.deep.equal(before);
    expect(fixture.remoteSha('child')).to.equal(remote);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('reconciles an uncertain create on retry instead of duplicating the PR', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        state: 'CLOSED',
        headRefOid: fixture.git('rev-parse', 'feature'),
      }))
    );
    fixture.commit('new-work');
    const shim = path.join(fixture.root, 'bin/gh'),
      original = `${shim}-original`,
      marker = path.join(fixture.root, 'created');
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${
        process.execPath
      }\nconst fs=require('fs'),cp=require('child_process');const args=process.argv.slice(2);const r=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});if(args[1]==='create'&&!fs.existsSync(${JSON.stringify(
        marker
      )})){fs.writeFileSync(${JSON.stringify(
        marker
      )},'1');process.stderr.write('response lost after creation');process.exitCode=1;}else{process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;}`
    );
    fs.chmodSync(shim, 0o755);
    const first = fixture.cli('submit');
    expect(first.status).not.to.equal(0);
    expect(fixture.prs()).to.have.length(2);
    expect(first.stderr).to.include('already pushed');
    fixture.clearCalls();
    fixture.succeed('submit');
    expect(fixture.prs()).to.have.length(2);
    expect(fixture.calls().some((call) => call[1] === 'create')).to.equal(
      false
    );
    expect(fixture.prs()[1].body).to.include('PR #2');
  });

  it('stops after a push if its selected open PR becomes terminal, without mutating that PR', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    fixture.commit('new-work');
    const before = fixture.prs()[0];
    const hook = path.join(fixture.repo, '.git/hooks/pre-push');
    fs.writeFileSync(
      hook,
      `#!${process.execPath}\nconst fs=require('fs');const file=process.env.ANTHRACITE_TEST_GH_STATE;const prs=JSON.parse(fs.readFileSync(file,'utf8'));prs[0].state='CLOSED';fs.writeFileSync(file,JSON.stringify(prs));`
    );
    fs.chmodSync(hook, 0o755);
    fixture.clearCalls();
    const result = fixture.cli(
      'submit',
      '--publish',
      '--reviewers',
      'reviewer'
    );
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('already pushed');
    expect(fixture.remoteSha('feature')).to.equal(
      fixture.git('rev-parse', 'feature')
    );
    expect(fixture.prs()[0]).to.deep.equal({ ...before, state: 'CLOSED' });
    expect(
      fixture.calls().some((call) => ['edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });
  it('rechecks all selected targets after confirmation before the first push', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    fixture.commit('unpublished');
    const remote = fixture.remoteSha('feature');
    fixture.clearCalls();
    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--interactive',
        '--no-edit',
        '--confirm',
        '--publish',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Continue with this submit operation?',
            input: 'y\r',
            beforeInput: [
              process.execPath,
              '-e',
              "const fs=require('fs');const file=process.argv[1];const prs=JSON.parse(fs.readFileSync(file));prs[0].state='CLOSED';fs.writeFileSync(file,JSON.stringify(prs));",
              fixture.state,
            ],
          },
        ],
      }
    );
    expect(result.status, result.output).not.to.equal(0);
    expect(fixture.remoteSha('feature')).to.equal(remote);
    expect(
      fixture
        .calls()
        .some((call) => ['edit', 'ready', 'create'].includes(call[1]))
    ).to.equal(false);
  });
  it('refuses a stale unselected descendant before writing its historical number into a footer', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) =>
        pr.headRefName === 'child'
          ? {
              ...pr,
              state: 'CLOSED',
              headRefOid: fixture.git('rev-parse', 'child'),
            }
          : pr
      )
    );
    fixture.git('checkout', 'base');
    fixture.commit('base-correction');
    const remote = fixture.remoteSha('base');
    const before = fixture.prs();
    fixture.clearCalls();
    const result = fixture.cli('submit');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('child');
    expect(fixture.remoteSha('base')).to.equal(remote);
    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });
  it('reports unavailable GitHub evidence before pushing or creating a replacement PR', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    fixture.commit('unpublished');
    const remote = fixture.remoteSha('feature');
    const before = fixture.prs();
    const shim = path.join(fixture.root, 'bin/gh'),
      original = `${shim}-original`;
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${
        process.execPath
      }\nconst cp=require('child_process');const args=process.argv.slice(2);if(args[0]==='pr'&&['view','list'].includes(args[1])){process.stderr.write('network unavailable');process.exitCode=1;}else{const r=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;}`
    );
    fs.chmodSync(shim, 0o755);
    fixture.clearCalls();
    const result = fixture.cli('submit');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('PR information is unavailable');
    expect(fixture.remoteSha('feature')).to.equal(remote);
    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });
  it('reports confirmed PR creation and unattempted footers when fresh footer discovery fails', () => {
    fixture.branch('feature', 'main');
    const shim = path.join(fixture.root, 'bin/gh'),
      original = `${shim}-original`,
      marker = path.join(fixture.root, 'created');
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${
        process.execPath
      }\nconst fs=require('fs'),cp=require('child_process');const args=process.argv.slice(2);if(args[1]==='view'&&args[args.indexOf('--json')+1]?.includes('headRefOid')&&fs.existsSync(${JSON.stringify(
        marker
      )})){process.stderr.write('network unavailable');process.exitCode=1;}else{const r=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);if(args[1]==='create'&&r.status===0)fs.writeFileSync(${JSON.stringify(
        marker
      )},'1');process.exitCode=r.status??1;}`
    );
    fs.chmodSync(shim, 0o755);
    const result = fixture.cli('submit');
    expect(result.status).not.to.equal(0);
    expect(result.stdout).to.include('(created; draft)');
    expect(result.stderr)
      .to.include('Dependency footer updates not attempted')
      .and.include('confirmed PR submissions remain applied');
    expect(fixture.prs()).to.have.length(1);
    expect(fixture.remoteSha('feature')).to.equal(
      fixture.git('rev-parse', 'feature')
    );
    fs.renameSync(original, shim);
    fixture.clearCalls();
    fixture.succeed('submit');
    expect(fixture.prs()).to.have.length(1);
    expect(fixture.calls().some((call) => call[1] === 'create')).to.equal(
      false
    );
    expect(fixture.prs()[0].body).to.include('PR #1');
  });
  it('preserves concurrent PR metadata changes during discovery before cache writes or pushing', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    fixture.commit('unpublished');
    const remote = fixture.remoteSha('feature');
    const before = fixture.prs();
    const shim = path.join(fixture.root, 'bin/gh'),
      original = `${shim}-original`,
      marker = path.join(fixture.root, 'metadata-changed');
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${
        process.execPath
      }\nconst fs=require('fs'),cp=require('child_process');const args=process.argv.slice(2);if(args[1]==='view'&&!fs.existsSync(${JSON.stringify(
        marker
      )})){const ref='refs/branch-metadata/feature';const meta=JSON.parse(cp.execFileSync('git',['cat-file','-p',ref],{encoding:'utf8'}));meta.prInfo.body='Concurrent local description';const oid=cp.execFileSync('git',['hash-object','-w','--stdin'],{input:JSON.stringify(meta),encoding:'utf8'}).trim();cp.execFileSync('git',['update-ref',ref,oid]);fs.writeFileSync(${JSON.stringify(
        marker
      )},'1');}const r=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;`
    );
    fs.chmodSync(shim, 0o755);
    fixture.clearCalls();
    const result = fixture.cli('submit');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('changed during');
    expect(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/feature')
    ).to.include('Concurrent local description');
    expect(fixture.remoteSha('feature')).to.equal(remote);
    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });
});
