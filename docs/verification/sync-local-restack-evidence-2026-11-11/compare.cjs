const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {FrozenGetFixture}=require(process.env.ANTHRACITE_RESEARCH_FIXTURE_MODULE || path.resolve(__dirname,'../../../apps/cli/dist/test/lib/fixtures/frozen_get_cli.js'));
const resultDir=process.env.ANTHRACITE_RESEARCH_OUTPUT_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(),'anthracite-sync-restack-results-'));
fs.mkdirSync(resultDir,{recursive:true});
const modes=['unchanged','remote-fast-forward','local-commits','local-restack','restack-plus-local-edit','restack-message-only','restack-whitespace-only','restack-trailing-space-before-newline','restack-then-remote-update','reordered-local-commits'];
const selected=process.argv.slice(2);const results=[];
for(const mode of modes.filter(x=>!selected.length||selected.includes(x))){
 const f=new FrozenGetFixture(false);f.commandTimeoutMs=30000;
 try{
  if(mode==='reordered-local-commits'){
   f.git(f.producer,'switch','parent');f.commit(f.producer,'second.txt','second independent commit');f.git(f.producer,'push','origin','parent');
  }
  if(mode==='restack-trailing-space-before-newline'){
   f.git(f.producer,'switch','parent');fs.writeFileSync(path.join(f.producer,'parent.txt'),'parent-old\n');f.git(f.producer,'add','parent.txt');f.git(f.producer,'commit','--amend','--no-edit');f.git(f.producer,'push','--force-with-lease','origin','parent');
  }
  f.ok('get','parent','--unfrozen');
  const oldTrunk=f.git(f.consumer,'rev-parse','main');
  const oldPublished=f.git(f.remote,'rev-parse','parent');
  const beforeMetadata=JSON.parse(f.git(f.consumer,'show','refs/branch-metadata/parent'));
  let newTrunk=oldTrunk;
  if(mode.startsWith('restack')||mode==='local-restack'||mode==='reordered-local-commits'){
   f.git(f.producer,'switch','main');newTrunk=f.commit(f.producer,'release.txt','independent trunk release');f.git(f.producer,'push','origin','main');f.ok('sync','--no-delete');
  }
  if(mode==='local-commits')f.commit(f.consumer,'local.txt','new unpublished correction');
  if(mode==='remote-fast-forward'||mode==='restack-then-remote-update'){
   f.git(f.producer,'switch','parent');f.commit(f.producer,'incoming.txt','new remote correction');f.git(f.producer,'push','origin','parent');
  }
  if(mode==='restack-plus-local-edit'||mode==='restack-whitespace-only'||mode==='restack-trailing-space-before-newline'){
   fs.writeFileSync(path.join(f.consumer,'parent.txt'),mode==='restack-plus-local-edit'?'local corrected contents':mode==='restack-trailing-space-before-newline'?'parent-old \n':'parent-old ');
   f.git(f.consumer,'add','parent.txt');f.git(f.consumer,'commit','--amend','--no-edit');
  }
  if(mode==='restack-message-only')f.git(f.consumer,'commit','--amend','-m','Corrected audit explanation\n\nPreserve this local commit message.');
  if(mode==='reordered-local-commits'){
   const ids=f.git(f.consumer,'rev-list','--reverse',newTrunk+'..parent').split('\n');assert.equal(ids.length,2);
   f.git(f.consumer,'reset','--hard',newTrunk);for(const oid of ids.reverse())f.git(f.consumer,'cherry-pick',oid);
  }
  const local=f.git(f.consumer,'rev-parse','parent');
  const published=f.git(f.remote,'rev-parse','parent');
  const patchIds=(base,tip)=>{
   const patch=f.git(f.consumer,'log','--reverse','--format=medium','-p','--binary',base+'..'+tip);
   return execFileSync('git',['patch-id','--stable'],{cwd:f.consumer,env:f.env,input:patch,encoding:'utf8'}).trim().split('\n').filter(Boolean).map(x=>x.split(' ')[0]);
  };
  f.git(f.consumer,'fetch','--no-write-fetch-head','origin','parent');
  const remoteBase=f.git(f.consumer,'merge-base',published,newTrunk);
  const remotePatchIds=patchIds(remoteBase,published),localPatchIds=patchIds(newTrunk,local);
  const remoteDiff=f.git(f.consumer,'diff','--binary',remoteBase,published);
  const localDiff=f.git(f.consumer,'diff','--binary',newTrunk,local);
  const rawGit=(...args)=>execFileSync('git',args,{cwd:f.consumer,env:f.env});
  const ownCommits=(base,tip)=>{
   const ids=f.git(f.consumer,'rev-list','--reverse',base+'..'+tip).split('\n').filter(Boolean);
   return ids.map(id=>{
    const parents=f.git(f.consumer,'rev-list','--parents','-n','1',id).split(' ').slice(1);
    if(parents.length!==1)return null;
    return {
     authorAndMessage:rawGit('show','-s','--format=%an%x00%ae%x00%aI%x00%B',id).toString('base64'),
     exactPatch:rawGit('diff','--no-ext-diff','--no-textconv','--no-renames','--no-color','--binary','--full-index',parents[0],id).toString('base64'),
    };
   });
  };
  const remoteOwn=ownCommits(remoteBase,published),localOwn=ownCommits(newTrunk,local);
  const hasNewerLocalBase=remoteBase!==newTrunk&&f.git(f.consumer,'merge-base',remoteBase,newTrunk)===remoteBase;
  const strictRestackEvidence=hasNewerLocalBase&&remoteOwn.length>0&&remoteOwn.every(Boolean)&&localOwn.every(Boolean)&&JSON.stringify(remoteOwn)===JSON.stringify(localOwn);
  const before=f.observe();
  const result=f.run(['sync','--no-delete'],true,[{prompt:'How would you like to handle',input:'\u001b[B\u001b[B\r'}]);
  const prompted=result.output.includes('How would you like to handle');
  if(prompted)assert.deepEqual(f.observe(),before);
  const row={mode,strictRestackEvidence,status:result.status,prompted,oldPublished,published,local,remoteBase,localBase:newTrunk,patchIdsEqual:JSON.stringify(remotePatchIds)===JSON.stringify(localPatchIds),aggregateBranchDiffEqual:remoteDiff===localDiff,remotePatchIds,localPatchIds,beforeMetadata,metadataAfterPreparation:JSON.parse(f.git(f.consumer,'show','refs/branch-metadata/parent')),output:result.output,statePreservedOnAbort:prompted?true:null};
  results.push(row);console.log(JSON.stringify({mode,status:row.status,prompted,patchIdsEqual:row.patchIdsEqual,aggregateBranchDiffEqual:row.aggregateBranchDiffEqual,strictRestackEvidence}));
  fs.writeFileSync(path.join(resultDir,'raw-strict-comparisons.json'),JSON.stringify(results,null,2)+'\n');
  assert.equal(strictRestackEvidence,mode==='local-restack','strict diagnostic evidence for '+mode);
 }finally{f.cleanup();}
}
