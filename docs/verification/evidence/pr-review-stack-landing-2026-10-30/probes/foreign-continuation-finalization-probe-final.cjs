const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const assert=require('node:assert/strict');
const {RelationCliFixture}=require('./review-fixes/apps/cli/dist/test/lib/fixtures/relation_cli.js');const {prepareLand}=require('./review-fixes/apps/cli/dist/test/lib/fixtures/land_gh.js');
const f=new RelationCliFixture();let observation;
try{
 const gh=prepareLand(f);f.git(['switch','base']);const deleted=f.run(['delete','tip','--force','--no-interactive']);assert.equal(deleted.status,0,deleted.stderr);
 fs.writeFileSync(gh.policy,JSON.stringify({allow_rebase_merge:true,protected:false,rules:[],protection:null,replayConflict:true}));
 const initial=f.run(['land','base','--yes','--no-interactive']);assert.notEqual(initial.status,0);assert.notEqual(f.git(['ls-files','--unmerged']),'');
 fs.writeFileSync(path.join(f.repo,'child.txt'),'resolved child\n');f.git(['add','child.txt']);
 const foreign='{"foreign":"preserve-this-final-file"}\n';fs.writeFileSync(path.join(f.repo,'.git/hooks/post-rewrite'),'#!/bin/sh\nprintf \'%s\\n\' \'{"foreign":"preserve-this-final-file"}\' > "$(git rev-parse --git-path .gtcontinue)"\nexit 0\n',{mode:0o755});
 const beforeRemote=f.git(['for-each-ref'],gh.remote);const result=f.run(['continue','--no-interactive']);const file=path.join(f.repo,'.git/.gtcontinue');const after=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 observation={expectedForeignBytes:foreign,exitCode:result.status,stdout:result.stdout,stderr:result.stderr,foreignBytesAfter:after,foreignFilePreserved:after===foreign,remoteUnchangedDuringContinue:f.git(['for-each-ref'],gh.remote)===beforeRemote,gitUnmerged:f.git(['ls-files','--unmerged']),landingRecordPreserved:fs.existsSync(path.join(f.repo,'.git/.anthracite_landing'))};
}finally{f.cleanup()}
const source=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'review-fixes'),encoding:'utf8'}).trim();fs.writeFileSync(path.join(__dirname,'foreign-continuation-finalization-probe-final.json'),JSON.stringify({source,method:'public CLI; real Git/bare remote; external gh controlled only; final replay post-rewrite hook creates foreign recovery before continuation completion',observation},null,2)+'\n');console.log(JSON.stringify({source,...observation}));
