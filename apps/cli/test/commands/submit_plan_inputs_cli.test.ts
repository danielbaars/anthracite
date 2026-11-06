import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

// eslint-disable-next-line max-lines-per-function
describe('submit preserves disclosed local inputs', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('npm reuse: refuses an unplanned head moved during confirmation before pushing', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    fixture.commit('planned');
    const planned = fixture.git('rev-parse', 'feature');
    const remote = fixture.remoteSha('feature');
    const prs = fixture.prs();
    fixture.clearCalls();
    const change = `const cp=require('child_process');const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();const head=git('rev-parse','feature');const tree=git('rev-parse',head+'^{tree}');const next=git('commit-tree',tree,'-p',head,'-m','concurrent unplanned commit');git('update-ref','refs/heads/feature',next,head);`;
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
            beforeInput: [process.execPath, '-e', change],
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Local submission inputs changed');
    expect(fixture.git('rev-parse', 'feature')).not.to.equal(planned);
    expect(fixture.remoteSha('feature')).to.equal(remote);
    expect(fixture.prs()).to.deep.equal(prs);
    expect(
      fixture
        .calls()
        .filter((call) => ['edit', 'ready', 'create'].includes(call[1]))
    ).to.deep.equal([]);
  });

  for (const changed of ['base', 'metadata']) {
    it(`refuses changed ${changed} during confirmation without publishing planned work`, () => {
      fixture.branch('base', 'main');
      fixture.branch('feature', 'base');
      fixture.succeed('submit');
      fixture.commit('planned');
      const base = fixture.git('rev-parse', 'base');
      const remotes = fixture.git('ls-remote', '--heads', 'origin');
      const prs = fixture.prs();
      const change =
        changed === 'base'
          ? `const cp=require('child_process');const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();const head=git('rev-parse','base');const next=git('commit-tree',git('rev-parse',head+'^{tree}'),'-p',head,'-m','concurrent base commit');git('update-ref','refs/heads/base',next,head);`
          : `const cp=require('child_process');const ref='refs/branch-metadata/feature';const meta=JSON.parse(cp.execFileSync('git',['cat-file','-p',ref],{encoding:'utf8'}));meta.prInfo.body='Concurrent local description';const oid=cp.execFileSync('git',['hash-object','-w','--stdin'],{encoding:'utf8',input:JSON.stringify(meta)}).trim();cp.execFileSync('git',['update-ref',ref,oid]);`;
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
              beforeInput: [process.execPath, '-e', change],
            },
          ],
        }
      );
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Local submission inputs changed');
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remotes);
      expect(fixture.prs()).to.deep.equal(prs);
      if (changed === 'base')
        expect(fixture.git('rev-parse', 'base')).not.to.equal(base);
      else
        expect(
          fixture.git('cat-file', '-p', 'refs/branch-metadata/feature')
        ).to.include('Concurrent local description');
    });
  }

  for (const changed of ['parent', 'description']) {
    it(`${
      changed === 'parent' ? 'npm reuse: ' : ''
    }refuses concurrent ${changed} metadata after pushing without overwriting it`, () => {
      fixture.git('branch', 'alternate', 'main');
      fixture.succeed('track', 'alternate', '--parent', 'main');
      fixture.branch('feature', 'main');
      fixture.succeed('submit');
      fixture.commit('planned');
      const head = fixture.git('rev-parse', 'feature');
      const prs = fixture.prs();
      installPostPushMutation(head, changed);
      fixture.clearCalls();
      const result = fixture.cli('submit', '--publish');
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr)
        .to.include('Local submission inputs changed')
        .and.include('was already pushed');
      expect(fixture.remoteSha('feature')).to.equal(head);
      const metadata = fixture.git(
        'cat-file',
        '-p',
        'refs/branch-metadata/feature'
      );
      expect(metadata).to.include('Concurrent local description after push');
      if (changed === 'parent') expect(metadata).to.include('alternate');
      expect(fixture.prs()).to.deep.equal(prs);
      expect(
        fixture
          .calls()
          .filter((call) => ['edit', 'ready', 'create'].includes(call[1]))
      ).to.deep.equal([]);
    });
  }

  it('retains a confirmed new PR but preserves concurrent metadata from its status readback', () => {
    fixture.branch('feature', 'main');
    const head = fixture.git('rev-parse', 'feature');
    installPostPushMutation(head, 'description');
    const result = fixture.cli('submit', '--publish');
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('was already pushed')
      .and.include('https://github.com/fixture/submit/pull/1');
    expect(fixture.remoteSha('feature')).to.equal(head);
    expect(fixture.prs()).to.have.length(1);
    expect(fixture.prs()[0]).to.include({ state: 'OPEN', isDraft: false });
    expect(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/feature')
    ).to.include('Concurrent local description after push');
    expect(fixture.calls().filter((call) => call[1] === 'edit')).to.deep.equal(
      []
    );
  });

  for (const role of ['reviewers', 'assignees']) {
    it(`refuses ${role} additions when their read sees changed post-push metadata`, () => {
      fixture.branch('feature', 'main');
      fixture.succeed('submit');
      fixture.commit('planned');
      const head = fixture.git('rev-parse', 'feature');
      installPostPushMutation(
        head,
        'description',
        role === 'reviewers' ? 'reviewRequests' : 'assignees'
      );
      const result = fixture.cli(
        'submit',
        '--publish',
        `--${role}`,
        'new-person'
      );
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(fixture.remoteSha('feature')).to.equal(head);
      expect(fixture.prs()[0].isDraft).to.equal(false);
      expect(fixture.prs()[0].reviewRequests).to.deep.equal([]);
      expect(fixture.prs()[0].assignees ?? []).to.deep.equal([]);
      expect(
        fixture.git('cat-file', '-p', 'refs/branch-metadata/feature')
      ).to.include('Concurrent local description after push');
      expect(result.stderr)
        .to.include('Local submission inputs changed')
        .and.include('was already pushed');
    });
  }

  function installPostPushMutation(
    head: string,
    changed: string,
    field?: string
  ): void {
    const shim = path.join(fixture.root, 'bin', 'gh');
    const original = `${shim}-original`;
    const marker = path.join(fixture.root, 'metadata-changed');
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${process.execPath}
const fs=require('fs'),cp=require('child_process');const args=process.argv.slice(2);const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();
if(args[1]==='view' && (${JSON.stringify(
        field
      )} === undefined || args[args.indexOf('--json')+1]?.split(',').includes(${JSON.stringify(
        field
      )})) && !fs.existsSync(${JSON.stringify(
        marker
      )}) && git('ls-remote','origin','refs/heads/feature').split(/\\s/)[0]===${JSON.stringify(
        head
      )}) {const ref='refs/branch-metadata/feature';const meta=JSON.parse(git('cat-file','-p',ref));if(${JSON.stringify(
        changed
      )}==='parent')meta.parentBranchName='alternate';meta.prInfo.body='Concurrent local description after push';const oid=cp.execFileSync('git',['hash-object','-w','--stdin'],{encoding:'utf8',input:JSON.stringify(meta)}).trim();git('update-ref',ref,oid);fs.writeFileSync(${JSON.stringify(
        marker
      )},'1');}
const result=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;
`
    );
    fs.chmodSync(shim, 0o755);
  }

  it('retains completed submission but refuses a later branch changed by an earlier PR effect', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    fixture.succeed('checkout', 'base');
    fixture.commit('planned-base');
    fixture.succeed('restack');
    const plannedBase = fixture.git('rev-parse', 'base');
    const plannedChild = fixture.git('rev-parse', 'child');
    const remoteChild = fixture.remoteSha('child');
    const childPr = fixture.prs()[1];
    const shim = path.join(fixture.root, 'bin', 'gh');
    const original = `${shim}-original`;
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${process.execPath}
const cp=require('child_process');const args=process.argv.slice(2);const result=cp.spawnSync(${JSON.stringify(
        original
      )},args,{encoding:'utf8'});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
if(result.status===0 && args[0]==='pr' && args[1]==='ready' && args[2]==='1') {const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();const head=git('rev-parse','child');const next=git('commit-tree',git('rev-parse',head+'^{tree}'),'-p',head,'-m','unplanned child commit');git('update-ref','refs/heads/child',next,head);}
process.exitCode=result.status??1;
`
    );
    fs.chmodSync(shim, 0o755);
    fixture.clearCalls();
    const result = fixture.cli('submit', '--stack', '--publish');
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('Local submission inputs changed for child')
      .and.include('Earlier confirmed submissions remain applied');
    expect(result.stderr).not.to.include(
      'No code was pushed by this submit attempt'
    );
    expect(fixture.remoteSha('base')).to.equal(plannedBase);
    expect(fixture.prs()[0].isDraft).to.equal(false);
    expect(fixture.git('rev-parse', 'child')).not.to.equal(plannedChild);
    expect(fixture.remoteSha('child')).to.equal(remoteChild);
    expect(fixture.prs()[1]).to.deep.equal(childPr);
    expect(
      fixture
        .calls()
        .filter(
          (call) => ['edit', 'ready'].includes(call[1]) && call[2] === '2'
        )
    ).to.deep.equal([]);
  });
});
