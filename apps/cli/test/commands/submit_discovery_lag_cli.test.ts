import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// eslint-disable-next-line max-lines-per-function
describe('submit GitHub discovery propagation through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  let oldHead: string;
  afterEach(() => fixture?.cleanup());

  function prepare(): void {
    fixture = new SubmitCliFixture();
    fixture.branch('feature', 'main');
    fixture.succeed('submit');
    oldHead = fixture.git('rev-parse', 'feature');
    const prs = fixture.prs();
    prs[0].body = `Current description\n\n${prs[0].body.replace(
      'PR #1',
      'PR #999'
    )}`;
    fixture.setPrs(prs);
    fixture.commit('correction');
    fixture.clearCalls();
  }

  // Only the external gh response is controlled; Git pushes use a real bare remote.
  function interceptAfterPush(script: string): void {
    const marker = path.join(fixture.root, 'pushed');
    const shim = path.join(fixture.root, 'bin/gh');
    const original = `${shim}-original`;
    fs.renameSync(shim, original);
    fs.writeFileSync(
      shim,
      `#!${process.execPath}
const fs=require('fs'),cp=require('child_process'),args=process.argv.slice(2);
const r=cp.spawnSync(${JSON.stringify(original)},args,{encoding:'utf8'});
let out=r.stdout;
if(r.status===0 && ['view','list'].includes(args[1]) && args[args.indexOf('--json')+1]?.includes('headRefOid') && fs.existsSync(${JSON.stringify(
        marker
      )})) {
  const data=JSON.parse(out), prs=Array.isArray(data)?data:[data];
  const counter=${JSON.stringify(marker + '-reads')};
  ${script}
  out=JSON.stringify(data);
}
process.stdout.write(out);process.stderr.write(r.stderr);process.exitCode=r.status??1;
`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        marker
      )},'1');`,
      { mode: 0o755 }
    );
  }

  function delayHead(endpoint: 'view' | 'list' | 'both', reads: number): void {
    interceptAfterPush(`if(${JSON.stringify(
      endpoint
    )}==='both'||args[1]===${JSON.stringify(endpoint)}) {
      const n=Number(fs.existsSync(counter)?fs.readFileSync(counter,'utf8'):0)+1;
      fs.writeFileSync(counter,String(n));
      if(n<=${reads}) for(const pr of prs) pr.headRefOid=${JSON.stringify(
      oldHead
    )};
    }`);
  }

  function expectComplete(): void {
    expect(fixture.remoteSha('feature')).to.equal(
      fixture.git('rev-parse', 'feature')
    );
    expect(fixture.prs()).to.have.length(1);
    expect(fixture.prs()[0].body)
      .to.include('Current description')
      .and.include('PR #1')
      .and.not.include('PR #999');
    expect(fixture.prs()[0].isDraft).to.equal(true);
    expect(fixture.calls().some((call) => call[1] === 'create')).to.equal(
      false
    );
  }

  it('completes its push and stale footer repair while the list head lags', () => {
    prepare();
    delayHead('list', 1000);
    fixture.succeed('submit');
    expectComplete();
  });

  for (const endpoint of ['view', 'both'] as const) {
    it(`finishes the same submit when ${endpoint} snapshots initially lag its push`, () => {
      prepare();
      delayHead(endpoint, 2);
      fixture.succeed('submit');
      expectComplete();
    });
  }

  it('reports unconfirmed visibility without claiming an outside change, then repairs on an unchanged retry', () => {
    prepare();
    const beforeBody = fixture.prs()[0].body;
    delayHead('both', 1000);
    const result = fixture.cli('submit');
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include('PR visibility remains unconfirmed')
      .and.include('already pushed')
      .and.include('Not attempted: dependency footer updates');
    expect(result.stderr).not.to.include('identity or state changed');
    expect(fixture.remoteSha('feature')).to.equal(
      fixture.git('rev-parse', 'feature')
    );
    expect(fixture.prs()[0].body).to.equal(beforeBody);
    expect(
      fixture.calls().some((call) => ['edit', 'ready'].includes(call[1]))
    ).to.equal(false);
    fs.renameSync(
      path.join(fixture.root, 'bin/gh-original'),
      path.join(fixture.root, 'bin/gh')
    );
    fixture.succeed('submit');
    expectComplete();
  });

  it('refuses a real remote change after its push and preserves the external head', () => {
    prepare();
    const foreign = fixture.git('rev-parse', 'main');
    const beforeBody = fixture.prs()[0].body;
    interceptAfterPush(
      `cp.execFileSync('git',['--git-dir',${JSON.stringify(
        fixture.remote
      )},'update-ref','refs/heads/feature',${JSON.stringify(foreign)}]);`
    );
    const result = fixture.cli('submit');
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include(
        "Remote branch feature no longer confirms this submit's pushed commit"
      )
      .and.include('already pushed');
    expect(fixture.remoteSha('feature')).to.equal(foreign);
    expect(fixture.prs()[0].body).to.equal(beforeBody);
    expect(
      fixture.calls().some((call) => ['edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('refuses a closed target after pushing without treating it as a new PR', () => {
    prepare();
    interceptAfterPush("for(const pr of prs) pr.state='CLOSED';");
    const result = fixture.cli('submit');
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include('Open PR target changed')
      .and.include('already pushed');
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('validates repository identity again when reading past a lagging snapshot', () => {
    prepare();
    interceptAfterPush(`if(args[1]==='view') {
      const n=Number(fs.existsSync(counter)?fs.readFileSync(counter,'utf8'):0)+1;fs.writeFileSync(counter,String(n));
      if(n<=2) for(const pr of prs) pr.headRefOid=${JSON.stringify(oldHead)};
      else for(const pr of prs) pr.url='https://github.com/foreign/repository/pull/1';
    }`);
    const result = fixture.cli('submit');
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include('identity mismatch')
      .and.include('already pushed');
    expect(
      fixture.calls().some((call) => ['edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('preserves sync reconciliation protection after inspecting through list lag', () => {
    prepare();
    interceptAfterPush(
      `if(args[1]==='list') for(const pr of prs) pr.headRefOid='${'b'.repeat(
        40
      )}';`
    );
    fs.writeFileSync(path.join(fixture.root, 'pushed'), '1');
    const head = fixture.git('rev-parse', 'feature');
    const index = fixture.git('ls-files', '--stage');
    const result = fixture.cli(
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include('has diverged from remote')
      .and.not.include('changed during discovery');
    expect(fixture.git('rev-parse', 'feature')).to.equal(head);
    expect(fixture.git('ls-files', '--stage')).to.equal(index);
    expect(fixture.git('branch', '--show-current')).to.equal('feature');
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('lets sync finish for matching local and remote heads despite a stale list head', () => {
    prepare();
    fixture.git('push', 'origin', 'feature');
    interceptAfterPush(
      `if(args[1]==='list') for(const pr of prs) pr.headRefOid='${'b'.repeat(
        40
      )}';`
    );
    fs.writeFileSync(path.join(fixture.root, 'pushed'), '1');
    const head = fixture.git('rev-parse', 'feature');
    fixture.succeed('sync', '--no-pull', '--no-delete', '--no-restack');
    expect(fixture.git('rev-parse', 'feature')).to.equal(head);
    expect(fixture.git('branch', '--show-current')).to.equal('feature');
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });
});
