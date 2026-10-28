"""Check declared before/after Git outcomes, independent of either CLI renderer."""
import json,pathlib,base64
ROOT=pathlib.Path(__file__).resolve().parent
read=lambda name,phase:json.loads((ROOT/name/(phase+'.json')).read_text())
checks={}
def check(name,value):
 checks[name]=bool(value)
 if not value:raise AssertionError(name)
b=read('basic-gt','before');a=read('basic-gt','after');refs=a['branches'];old=b['branches']
check('paired initial committed fixtures match',old==read('basic-an','before')['branches'])
check('exactly feature_split added',set(refs)-set(old)=={'feature_split'})
check('current branch remains feature',a['branch']=='feature')
check('new parent based on main',refs['feature_split']['parents']==[refs['main']['oid']])
check('feature based on new parent',refs['feature']['parents']==[refs['feature_split']['oid']])
check('child based on rewritten feature',refs['child']['parents']==[refs['feature']['oid']])
expected=dict(old['main']['files'])
for name in ['src/refactor/utils.ts','src/refactor/new-helper.ts']:expected[name]=old['feature']['files'][name]
check('new parent contains exactly selected changes',refs['feature_split']['files']==expected)
check('remainder contains only API and test changes',sorted(p for p in refs['feature']['files'] if refs['feature']['files'][p]!=refs['feature_split']['files'].get(p))==['src/api/service.ts','tests/api.test.ts'])
for branch in ['feature','child']:check(branch+' final tree unchanged',refs[branch]['tree']==old[branch]['tree'])
for branch in ['main','other']:check(branch+' commit unchanged',refs[branch]==old[branch])
check('source and child rewritten',all(refs[n]['oid']!=old[n]['oid'] for n in ['feature','child']))
check('original message reused for both parts',refs['feature_split']['subject']==refs['feature']['subject']==old['feature']['subject'])
check('clean final worktree',a['status']==a['staged']==a['unstaged']=='')
for name in ['basic-an','no-match-an','dirty-an']:check(name+' exact observed snapshot preserved',read(name,'before')==read(name,'after'))
public=['branch','head','branches','status','staged','unstaged','worktreeFiles']
for name in ['no-match-gt','dirty-gt','dirty-confirm-gt']:check(name+' refs, files and staged/unstaged state preserved',all(read(name,'before')[k]==read(name,'after')[k] for k in public))
for name in ['basic-gt','no-match-gt','dirty-gt','basic-an','no-match-an','dirty-an','dirty-confirm-gt']:check(name+' no gh/editor/pager sentinel used',not read(name,'after')['unexpectedTools'])
result={'checks':checks,'passed':len(checks),'failed':0,'observations':{'noMatchGraphiteOpaqueIndexChanged':read('no-match-gt','before')['indexSha256']!=read('no-match-gt','after')['indexSha256'],'noMatchGraphiteMetadataChanged':read('no-match-gt','before')['metadata']!=read('no-match-gt','after')['metadata'],'dirtyReaCaptureCleanup':'unverified: retained capture error, not a successful complete REA result','dirtyIndependentConfirmation':'fresh direct subprocess exit 1; state preserved','originalFeature':old['feature']['oid'],'newParent':refs['feature_split']['oid'],'remainingFeature':refs['feature']['oid'],'newChild':refs['child']['oid']}}
(ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n');print('Verified',len(checks),'independent outcome predicates.')
