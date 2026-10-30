const fs=require('fs');
const path=require('path');
const repo='/private/tmp/anthracite-pr-land-implementation-20261030/review-fixes';
const {RelationCliFixture}=require(repo+'/apps/cli/dist/test/lib/fixtures/relation_cli');
const {prepareLand}=require(repo+'/apps/cli/dist/test/lib/fixtures/land_gh');
const fixture=new RelationCliFixture(); const source=require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
try {
 const github=prepareLand(fixture);
 const policy=JSON.parse(fs.readFileSync(github.policy,'utf8'));
 fs.writeFileSync(github.policy,JSON.stringify({...policy,pendingAfterPush:true}));
 const first=fixture.run(['land','child','--yes']);
 fs.writeFileSync(path.join(fixture.repo,'untracked-blocker'),'dirty');
 const touched=path.join(fixture.repo,'main.txt');fs.utimesSync(touched,new Date(),new Date(Date.now()+5000)); const before=fixture.inspectionSnapshot();
 const preview=fixture.run(['land','child','--dry-run']);
 const after=fixture.inspectionSnapshot();
 const apply=fixture.run(['land','child','--yes']);
 process.stdout.write(JSON.stringify({source,node:process.version,first:{status:first.status,stdout:first.stdout,stderr:first.stderr},preview:{status:preview.status,stdout:preview.stdout,stderr:preview.stderr},unchanged:JSON.stringify(before)===JSON.stringify(after),apply:{status:apply.status,stdout:apply.stdout,stderr:apply.stderr}},null,2)+'\n');
} finally {fixture.cleanup();}
