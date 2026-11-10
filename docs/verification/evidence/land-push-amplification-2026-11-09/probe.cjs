const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const [harness, scenario, output] = process.argv.slice(2);
assert.ok(path.isAbsolute(harness) && path.isAbsolute(output));
const {RelationCliFixture}=require(path.join(harness,'apps/cli/dist/test/lib/fixtures/relation_cli.js'));
const {prepareLand}=require(path.join(harness,'apps/cli/dist/test/lib/fixtures/land_gh.js'));
const fixture=new RelationCliFixture();
fixture.commandTimeoutMs=480000;
const lineups={linear3:['base','child','tip'],linear7:['base','child','tip','four','five','six','seven'],fanout7:['base','child','tip','four','five','six','seven'],conflict3:['base','child','tip']};
const chain=lineups[scenario];assert.ok(chain);
const lines=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
function summary(events){const updates={},deletions={};for(const event of events)for(const ref of event.refs){const target=ref.new==='0'.repeat(40)?deletions:updates;target[ref.ref]=(target[ref.ref]||0)+1;}return {pushInvocations:events.length,featureUpdates:Object.values(updates).reduce((a,b)=>a+b,0),deletions:Object.values(deletions).reduce((a,b)=>a+b,0),updatesByRef:updates,deletionsByRef:deletions};}
try{
 for(let i=3;i<chain.length;i++)fixture.branch(chain[i],chain[i-1]);
 if(scenario==='fanout7')fixture.branch('published-sibling','base');
 const github=prepareLand(fixture,scenario==='fanout7'?['unit']:[]);
 if(scenario==='fanout7')fixture.branch('local-only','base');
 const published=[...chain,...(scenario==='fanout7'?['published-sibling']:[])];
 const prs=published.map((name,i)=>github.pr(name,17+i));
 fs.writeFileSync(github.state,JSON.stringify(prs));
 fixture.git(['switch',chain.at(-1)]);
 const before=fixture.inspectionSnapshot();
 const independent={local:fixture.git(['rev-parse','other']),remote:fixture.git(['rev-parse','other'],github.remote)};
 const expectedTrees=Object.fromEntries(published.map(name=>[name,fixture.git(['rev-parse',name+'^{tree}'])]));
 const commits=Object.fromEntries([...chain,...(scenario==='fanout7'?['published-sibling','local-only']:[])].map(name=>[name,fixture.git(['log','-1','--format=%an <%ae>%n%B',name])]));
 const clientLog=path.join(fixture.root,'client-pushes.jsonl');
 const remoteLog=path.join(fixture.root,'remote-receives.jsonl');
 const hook=`#!${process.execPath}\nconst fs=require('fs');const input=fs.readFileSync(0,'utf8').trim();const record=fs.existsSync('.git/.anthracite_landing')?JSON.parse(fs.readFileSync('.git/.anthracite_landing','utf8')):null;fs.appendFileSync(${JSON.stringify(clientLog)},JSON.stringify({pid:process.pid,index:record?.index??0,phase:record?.phase,merge:record?.merges[record.index??0]?.branch,refs:input.split('\\n').filter(Boolean).map(line=>{const [local,newOid,ref,old]=line.split(/\\s+/);return {local,new:newOid,ref,old};})})+'\\n');\n`;
 fs.writeFileSync(path.join(fixture.repo,'.git/hooks/pre-push'),hook,{mode:0o755});
 fs.writeFileSync(path.join(github.remote,'hooks/post-receive'),`#!${process.execPath}\nconst fs=require('fs');const input=fs.readFileSync(0,'utf8').trim();fs.appendFileSync(${JSON.stringify(remoteLog)},JSON.stringify({pid:process.pid,refs:input.split('\\n').filter(Boolean).map(line=>{const [old,newOid,ref]=line.split(/\\s+/);return {old,new:newOid,ref};})})+'\\n');\n`,{mode:0o755});
 const policy=JSON.parse(fs.readFileSync(github.policy,'utf8'));
 if(scenario==='fanout7')fs.writeFileSync(github.policy,JSON.stringify({...policy,pendingAfterPush:true}));
 if(scenario==='conflict3')fs.writeFileSync(github.policy,JSON.stringify({...policy,replayConflict:true}));
 const preview=fixture.run(['land',chain.at(-1),'--dry-run','--no-interactive']);
 assert.equal(preview.status,0,preview.stdout+preview.stderr);
 assert.equal(lines(clientLog).length,0);assert.deepEqual(fixture.inspectionSnapshot(),before);
 const first=fixture.run(['land',chain.at(-1),'--yes','--no-interactive','--wait-timeout','0']);
 const firstEvents=lines(clientLog);
 const file=path.join(fixture.repo,'.git/.anthracite_landing');
 const saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 let resumed;
 if(scenario==='fanout7'){
  assert.equal(first.status,1,first.stdout+first.stderr);assert.match(first.stderr,/Check wait timed out before #18/);
  assert.equal(summary(firstEvents).featureUpdates,7);
  const state=JSON.parse(fs.readFileSync(github.state,'utf8'));
  for(const pr of state){pr.mergeStateStatus='CLEAN';pr.statusCheckRollup=[{__typename:'CheckRun',name:'unit',status:'COMPLETED',conclusion:'SUCCESS'}];}
  fs.writeFileSync(github.state,JSON.stringify(state));fs.writeFileSync(github.policy,JSON.stringify(policy));
  resumed=fixture.run(['land',chain.at(-1),'--yes','--no-interactive','--wait-timeout','0']);
  assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);
 }else if(scenario==='conflict3'){
  assert.equal(first.status,1,first.stdout+first.stderr);assert.match(first.stderr,/Local replay conflict/);
  assert.notEqual(fixture.git(['ls-files','--unmerged']),'');
  assert.equal(firstEvents.length,0);
 }else assert.equal(first.status,0,first.stdout+first.stderr);
 const events=lines(clientLog),received=lines(remoteLog);
 const calls=fs.readFileSync(github.calls,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
 const state=JSON.parse(fs.readFileSync(github.state,'utf8'));
 const merged=state.filter(pr=>pr.state==='MERGED');
 assert.equal(fixture.git(['rev-parse','other']),independent.local);
 assert.equal(fixture.git(['rev-parse','other'],github.remote),independent.remote);
 const preserved={independent:true,localOnlyNeverPublished:scenario==='fanout7'?true:null,chainContent:scenario!=='conflict3'?true:null,siblingContent:scenario==='fanout7'?true:null};
 if(scenario!=='conflict3'){
  assert.equal(merged.length,chain.length);
  assert.equal(fixture.git(['rev-parse','main^{tree}']),expectedTrees[chain.at(-1)]);
  for(const name of chain){assert.equal(fixture.git(['show','main:'+name+'.txt']),name);assert.equal(fixture.git(['for-each-ref','--format=%(refname)','refs/heads/'+name]),'');}
  assert.equal(fixture.git(['branch','--show-current']),'main');
 }
 if(scenario==='fanout7'){
  assert.equal(fixture.git(['for-each-ref','--format=%(refname)','refs/heads/local-only'],github.remote),'');
  for(const name of ['published-sibling','local-only']){assert.equal(fixture.git(['show',name+':'+name+'.txt']),name);assert.equal(fixture.git(['log','-1','--format=%an <%ae>%n%B',name]),commits[name]);}
  assert.equal(fixture.git(['rev-parse','published-sibling']),fixture.git(['rev-parse','published-sibling'],github.remote));
 }
 const result={scenario,chain,baseline:'a3c9f7055c7a42dfe38daee8fb843f21e1763474',fixtureRoot:fixture.root,cliVersion:fixture.run(['--version']).stdout.trim(),preview:{status:preview.status,stdout:preview.stdout,stderr:preview.stderr},first:{status:first.status,stdout:first.stdout,stderr:first.stderr,counts:summary(firstEvents)},savedAfterFirst:saved,resumed:resumed?{status:resumed.status,stdout:resumed.stdout,stderr:resumed.stderr}:null,clientPushes:events,remoteReceives:received,counts:summary(events),serverMainAdvances:received.flatMap(e=>e.refs).filter(r=>r.ref==='refs/heads/main').length,githubMergeRequests:calls.filter(c=>c.includes('PUT')).length,githubPrEdits:calls.filter(c=>c[0]==='pr'&&c[1]==='edit').map(c=>({number:c[2],base:c[4],body:c[6]})),finalPrs:state,before,after:fixture.inspectionSnapshot(),expectedTrees,commits,preserved,finalLog:fixture.run(['ls']).stdout};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({scenario,counts:result.counts,first:result.first.counts,merges:result.githubMergeRequests,prEdits:result.githubPrEdits.length,mainAdvances:result.serverMainAdvances,preserved}));
}finally{fixture.cleanup();}
