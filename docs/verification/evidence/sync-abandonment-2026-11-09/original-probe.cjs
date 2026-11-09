const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {FrozenGetFixture}=require('/private/tmp/anthracite-149-20261107/apps/cli/dist/test/lib/fixtures/frozen_get_cli.js');
const f=new FrozenGetFixture();
try {
  f.commandTimeoutMs=30000;
  f.ok('unfreeze','child');
  f.ok('create','local-work');
  f.commit(f.consumer,'parent.txt','local conflict');
  f.git(f.consumer,'switch','main');
  f.git(f.producer,'switch','parent');
  f.commit(f.producer,'parent.txt','incoming conflict');
  f.git(f.producer,'push','origin','parent');
  const conflict=f.run(['sync','--no-delete']);
  assert.equal(conflict.status,1);assert.match(conflict.output,/Hit conflict restacking local-work/);
  const file=path.join(f.consumer,'.git','.gtcontinue');
  const saved=fs.readFileSync(file);
  console.log('Real sync restack conflict; saved recovery bytes: '+saved.length);
  for(const args of [['ls'],['log'],['info','--branch','local-work'],['children'],['pr','local-work'],['delete','local-work','--force'],['sync','--abort']]){
    const result=f.run(args);
    if (["ls","log"].includes(args[0])) assert.equal(result.status,1);
    assert.ok(saved.equals(fs.readFileSync(file)));
    console.log(JSON.stringify({args,status:result.status,output:result.output.trim()}));
  }
  f.git(f.consumer,'rebase','--abort');
  const continuation=f.run(['continue']);
  assert.equal(continuation.status,1);
  assert.match(continuation.output,/No matching owned active sync rebase/);
  assert.ok(saved.equals(fs.readFileSync(file)));
  console.log(JSON.stringify({afterRawAbort:true,args:['continue'],status:continuation.status,output:continuation.output.trim()}));
  const inspection=f.run(['ls']);assert.equal(inspection.status,1);assert.match(inspection.output,/Finish the pending sync/);
  console.log(JSON.stringify({afterRawAbort:true,args:['ls'],status:inspection.status,output:inspection.output.trim()}));
} finally {f.cleanup();}
