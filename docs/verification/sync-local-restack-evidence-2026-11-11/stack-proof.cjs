const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {FrozenGetFixture}=require(process.env.ANTHRACITE_RESEARCH_FIXTURE_MODULE || path.resolve(__dirname,'../../../apps/cli/dist/test/lib/fixtures/frozen_get_cli.js'));
const resultDir=process.env.ANTHRACITE_RESEARCH_OUTPUT_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(),'anthracite-sync-restack-results-'));
fs.mkdirSync(resultDir,{recursive:true});
const f=new FrozenGetFixture();
try{
 f.ok('unfreeze','parent');f.ok('unfreeze','child');
 const oldMain=f.git(f.consumer,'rev-parse','main');
 const remote={parent:f.git(f.remote,'rev-parse','parent'),child:f.git(f.remote,'rev-parse','child')};
 f.git(f.producer,'switch','main');const newMain=f.commit(f.producer,'release.txt','independent release');f.git(f.producer,'push','origin','main');
 const sync=f.ok('sync','--no-delete');
 const local={parent:f.git(f.consumer,'rev-parse','parent'),child:f.git(f.consumer,'rev-parse','child')};
 const git=(...args)=>execFileSync('git',args,{cwd:f.consumer,env:f.env});
 const own=(base,tip)=>f.git(f.consumer,'rev-list','--reverse',base+'..'+tip).split('\n').filter(Boolean).map(id=>{
  const parents=f.git(f.consumer,'rev-list','--parents','-n','1',id).split(' ').slice(1);assert.equal(parents.length,1);
  return {authorMessage:git('show','-s','--format=%an%x00%ae%x00%aI%x00%B',id).toString('base64'),patch:git('diff','--no-ext-diff','--no-textconv','--no-renames','--no-color','--binary','--full-index',parents[0],id).toString('base64')};
 });
 assert.equal(f.git(f.consumer,'merge-base',oldMain,newMain),oldMain);
 assert.deepEqual(own(oldMain,remote.parent),own(newMain,local.parent));
 assert.deepEqual(own(remote.parent,remote.child),own(local.parent,local.child));
 const metadata=JSON.parse(f.git(f.consumer,'show','refs/branch-metadata/child'));
 assert.equal(metadata.parentBranchRevision,local.parent);
 assert.notEqual(f.git(f.consumer,'merge-base',remote.parent,local.parent),remote.parent);
 const before=f.observe();const retry=f.run(['sync','--no-delete'],true,[{prompt:'How would you like to handle',input:'\u001b[B\u001b[B\r'}]);
 assert.equal(retry.status,1);assert.match(retry.output,/How would you like to handle parent/);assert.deepEqual(f.observe(),before);
 for(const [branch,head]of Object.entries(remote))assert.equal(f.git(f.remote,'rev-parse',branch),head);
 const record={version:'0.7.0',oldMain,newMain,remote,local,firstSync:sync,secondSync:retry,rootEquivalent:true,childEquivalentViaPairedParentHeads:true,ordinaryChildBaseAncestryInsufficient:true,preservedAbort:true,remoteUnchanged:true};
 fs.writeFileSync(path.join(resultDir,'stack-proof.json'),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({rootEquivalent:true,childEquivalentViaPairedParentHeads:true,ordinaryChildBaseAncestryInsufficient:true,remoteUnchanged:true,preservedAbort:true}));
}finally{f.cleanup();}
