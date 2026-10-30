const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const {RelationCliFixture}=require('./review-fixes/apps/cli/dist/test/lib/fixtures/relation_cli.js');
const {prepareLand}=require('./review-fixes/apps/cli/dist/test/lib/fixtures/land_gh.js');
const f=new RelationCliFixture();let observation;
try{
 const gh=prepareLand(f);fs.writeFileSync(gh.policy,JSON.stringify({allow_rebase_merge:true,protected:false,rules:[],protection:null,replayConflict:true}));
 const foreign='{"foreign":"preserve-this-exact-file"}\n';
 fs.writeFileSync(path.join(f.repo,'.git/hooks/pre-rebase'), '#!/bin/sh\nprintf \'%s\\n\' \'{"foreign":"preserve-this-exact-file"}\' > "$(git rev-parse --git-path .gtcontinue)"\nexit 0\n',{mode:0o755});
 const result=f.run(['land','base','--yes','--no-interactive']);const file=path.join(f.repo,'.git/.gtcontinue');const after=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 observation={expectedForeignBytes:foreign,exitCode:result.status,stdout:result.stdout,stderr:result.stderr,foreignBytesAfter:after,foreignFilePreserved:after===foreign,gitUnmerged:f.git(['ls-files','--unmerged']),landingRecordPreserved:fs.existsSync(path.join(f.repo,'.git/.anthracite_landing')),ghState:JSON.parse(fs.readFileSync(gh.state,'utf8'))};
}finally{f.cleanup()}
const source=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'review-fixes'),encoding:'utf8'}).trim();fs.writeFileSync(path.join(__dirname,'foreign-continuation-publication-probe-final.json'),JSON.stringify({source,method:'public CLI; real Git and bare remote; external gh controlled only; ordinary pre-rebase hook creates foreign recovery before first conflict publication',observation},null,2)+'\n');
console.log(JSON.stringify({source,exitCode:observation.exitCode,foreignFilePreserved:observation.foreignFilePreserved,hasRealConflict:!!observation.gitUnmerged,landingRecordPreserved:observation.landingRecordPreserved,stderr:observation.stderr}));
