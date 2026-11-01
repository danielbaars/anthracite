const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = '/private/tmp/anthracite-sync-updates-implementation-20261101';
const wt = path.join(root, 'worktrees/review-fixes');
const binary = path.join(root, 'review-fixes-an');
process.env.ANTHRACITE_TEST_BINARY = binary;
const { FrozenGetFixture } = require(path.join(wt, 'apps/cli/dist/test/lib/fixtures/frozen_get_cli.js'));
const f = new FrozenGetFixture(false);
const receipt = { sourceHead:'e9779bbc61cee4852c28c89e389177d4f3ceeb76', previousSourceHead:'2dc0c3dfe27e83a9b8d3183600e542d7aef80e0f', binary, nativeSha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), compiledRefreshSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(wt,'apps/cli/dist/src/actions/sync/sync_refresh.js'))).digest('hex'), fixtureRoot:f.root, probes:[] };
try {
  f.git(f.producer,'switch','main'); f.git(f.producer,'switch','-c','123');
  const old = f.commit(f.producer,'numeric.txt','numeric original own content');
  f.git(f.producer,'push','origin','123'); f.git(f.consumer,'fetch','origin','123'); f.git(f.consumer,'branch','123','FETCH_HEAD');
  f.ok('track','123','--parent','main');
  const incoming = f.commit(f.producer,'numeric.txt','numeric incoming content');
  f.git(f.producer,'push','origin','123');
  const service = path.join(f.root,'numeric-service.json');
  const pr = { headRefName:'123',baseRefName:'main',headRefOid:incoming,number:3,url:'https://github.com/get-fixture/repo/pull/3',state:'OPEN',headRepository:{nameWithOwner:'get-fixture/repo'} };
  fs.writeFileSync(service,JSON.stringify(pr));
  const stub = path.join(f.bin,'gh');
  fs.writeFileSync(stub,'#!'+process.execPath+'\n'+`const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(f.ghCalls)},JSON.stringify(a)+'\\n'); const pr=JSON.parse(fs.readFileSync(${JSON.stringify(service)},'utf8')); if(a[0]==='pr'&&a[1]==='view'&&a[2]==='123'){process.stderr.write('GraphQL: Could not resolve to a PullRequest with the number of 123. (repository.pullRequest)\\n');process.exit(1);} if(JSON.stringify(a.slice(0,11))===JSON.stringify(['pr','list','--head','123','--state','open','--limit','2','--repo','get-fixture/repo','--json'])){process.stdout.write(JSON.stringify([pr]));process.exit(0);} if(JSON.stringify(a.slice(0,6))===JSON.stringify(['pr','view','3','--repo','get-fixture/repo','--json'])){process.stdout.write(JSON.stringify(pr));process.exit(0);}process.stderr.write('unexpected controlled external call '+JSON.stringify(a));process.exit(2);`,{mode:0o755});
  const args=['sync','--no-pull','--no-delete','--no-restack'];
  for(const label of ['literal-numeric-open-head','stored-number-repeat']) {
    const before=f.observe();const result=f.run(args);const after=f.observe();
    const actual=f.git(f.consumer,'rev-parse','refs/heads/123');
    const metadata=f.git(f.consumer,'cat-file','-p','refs/branch-metadata/123');
    receipt.probes.push({label,args:[...args,'--no-interactive'],command:[binary,...args,'--no-interactive'],before,result,after,actual,metadata,calls:fs.readFileSync(f.ghCalls,'utf8')});
    assert.equal(result.status,0,result.output);assert.equal(actual,incoming);assert.equal(JSON.parse(metadata).prInfo.number,3);assert.equal(f.git(f.consumer,'show','123:numeric.txt'),'numeric incoming content');assert.equal(f.git(f.consumer,'branch','--show-current'),'main');assert.equal(f.git(f.consumer,'status','--porcelain'),'');assert.equal(after.recovery,null);
  }
  assert.notEqual(old,incoming);
  receipt.old=old;receipt.incoming=incoming;receipt.calls=fs.readFileSync(f.ghCalls,'utf8');receipt.passed=true;
  console.log(JSON.stringify({passed:true,nativeSha256:receipt.nativeSha256,sourceHead:receipt.sourceHead,old,incoming,actual:f.git(f.consumer,'rev-parse','refs/heads/123'),calls:receipt.calls}));
} catch(error) { receipt.passed=false;receipt.error=error.stack;throw error; }
finally { fs.writeFileSync(path.join(root,'final-spec-fix-confirmation-probe.json'),JSON.stringify(receipt,null,2)+'\n'); }
