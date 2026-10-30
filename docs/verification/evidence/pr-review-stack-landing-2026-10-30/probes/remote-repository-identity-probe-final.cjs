const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const cp=require('node:child_process');
const {RelationCliFixture}=require('./review-fixes/apps/cli/dist/test/lib/fixtures/relation_cli.js');
const {prepareLand}=require('./review-fixes/apps/cli/dist/test/lib/fixtures/land_gh.js');
const f=new RelationCliFixture();let observation;
try {
  const gh=prepareLand(f);
  f.git(['switch','base']);
  for(const b of ['tip','child']) {const d=f.run(['delete',b,'--force','--no-interactive']);assert.equal(d.status,0,d.stdout+d.stderr);}
  const originalHead=f.git(['rev-parse','base']);const oldTrunk=f.git(['rev-parse','main']);const tree=f.git(['rev-parse','base^{tree}']);
  const merged=f.git(['-c','user.name=GitHub fixture','-c','user.email=merge@example.test','commit-tree',tree,'-p',oldTrunk,'-m','Synthetic already-landed distinct-OID result'],gh.remote);
  assert.notEqual(merged,originalHead);
  f.git(['update-ref','refs/heads/main',merged,oldTrunk],gh.remote);
  const prs=gh.prs.map(pr=>pr.headRefName==='base'?{...pr,state:'MERGED',mergeResult:merged}:pr);
  fs.writeFileSync(gh.state,JSON.stringify(prs));
  const mirror=path.join(f.root,'other-repository.git');f.git(['clone','--mirror',gh.remote,mirror]);
  const declared='https://github.com/other/mirror.git';f.git(['remote','set-url','origin',declared]);f.git(['remote','set-url','--push','origin',declared]);f.git(['config',`url.${mirror}.insteadOf`,declared]);
  const refsA=f.git(['for-each-ref'],gh.remote);const refsB=f.git(['for-each-ref'],mirror);const before=f.inspectionSnapshot();
  const preview=f.run(['land','base','--dry-run','--no-interactive']);assert.deepEqual(f.inspectionSnapshot(),before);
  const applied=f.run(['land','base','--yes','--no-interactive']);
  observation={configuredGithubRepo:'fixture/inspection',declaredGitRemote:declared,transport:'repository-local normal Git insteadOf to a separate real bare mirror',sharedHead:originalHead,sharedMergedResult:merged,preview:{exitCode:preview.status,stdout:preview.stdout,stderr:preview.stderr,repositoryUnchanged:true},application:{exitCode:applied.status,stdout:applied.stdout,stderr:applied.stderr},configuredRepositoryBranchAfter:f.git(['for-each-ref','--format=%(objectname)','refs/heads/base'],gh.remote),otherRepositoryBranchAfter:f.git(['for-each-ref','--format=%(objectname)','refs/heads/base'],mirror),configuredRepositoryUnchanged:f.git(['for-each-ref'],gh.remote)===refsA,otherRepositoryChanged:f.git(['for-each-ref'],mirror)!==refsB,ghCalls:fs.readFileSync(gh.calls,'utf8').split('\n').filter(Boolean).map(JSON.parse)};
  assert.equal(observation.configuredRepositoryBranchAfter,originalHead);
  assert.equal(observation.configuredRepositoryUnchanged,true);
} finally {f.cleanup();}
const source=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'review-fixes'),encoding:'utf8'}).trim();
fs.writeFileSync(path.join(__dirname,'remote-repository-identity-probe-final.json'),JSON.stringify({source,method:'public CLI; real Git and two bare repositories; controlled external gh only; no live service effects',observation},null,2)+'\n');
console.log(JSON.stringify({source,preview:observation.preview,application:observation.application,configuredRepositoryUnchanged:observation.configuredRepositoryUnchanged,otherRepositoryBranchDeleted:!observation.otherRepositoryBranchAfter}));
