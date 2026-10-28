"""Validate recorded Graphite outcomes without using candidate rendering."""
import json,pathlib,base64
R=pathlib.Path(__file__).resolve().parent
checks={}
def load(case,phase):return json.loads((R/(case+'-gt')/(phase+'.json')).read_text())
def check(name,value):
 checks[name]=bool(value)
 if not value:raise AssertionError(name)
selected={'multi':['src/refactor/utils.ts','src/refactor/new-helper.ts','src/refactor/late-helper.ts'],'collision':['src/refactor/utils.ts','src/refactor/new-helper.ts'],'patterns':['src/refactor/utils.ts','src/refactor/new-helper.ts','src/refactor/space café.ts','tests/api.test.ts'],'file-types':['assets/delete.txt','assets/rename-from.txt','assets/data.bin'],'occupied-child':['src/refactor/utils.ts','src/refactor/new-helper.ts'],'cwd':['src/refactor/utils.ts','src/refactor/new-helper.ts']}
for case,paths in selected.items():
 b=load(case,'before');a=load(case,'after');created=set(a['branches'])-set(b['branches']);name='feature_split_split' if case=='collision' else 'feature_split';check(case+': expected unique parent',created=={name})
 expected=dict(b['branches']['main']['files'])
 for p in paths:
  if p in b['branches']['feature']['files']:expected[p]=b['branches']['feature']['files'][p]
  else:expected.pop(p,None)
 check(case+': exact pathwise projected parent',a['branches'][name]['files']==expected)
 check(case+': source tree retained',a['branches']['feature']['tree']==b['branches']['feature']['tree'])
 check(case+': current source retained',a['branch']=='feature')
 check(case+': coherent source-parent ancestry',a['branches']['feature']['parents']==[a['branches'][name]['oid']] and a['branches'][name]['parents']==[a['branches']['main']['oid']])
 for branch in ['main','other']:check(case+': '+branch+' unchanged',a['branches'][branch]==b['branches'][branch])
 check(case+': child tree retained',a['branches']['child']['tree']==b['branches']['child']['tree'])
 if case!='occupied-child':check(case+': child replayed on source',a['branches']['child']['parents']==[a['branches']['feature']['oid']])
 else:
  check(case+': occupied child tip skipped',a['branches']['child']['oid']==b['branches']['child']['oid'])
  check(case+': dirty linked work kept',json.loads((R/'occupied-child-gt/linked-after.json').read_text())['content']=='Dirty linked documentation\n')
 check(case+': no sentinel called',a['unexpectedTools']=='')
 if case=='collision':check('collision: existing name untouched',a['branches']['feature_split']==b['branches']['feature_split'])
a=load('all','after');b=load('all','before');check('all: Graphite deletes original name','feature' not in a['branches']);check('all: switches to extracted branch',a['branch']=='feature_split');check('all: preserves full original tree on new name',a['branches']['feature_split']['tree']==b['branches']['feature']['tree']);check('all: child commit unchanged',a['branches']['child']['oid']==b['branches']['child']['oid'])
commits=json.loads((R/'multi-gt/after-commits.json').read_text());message='Add endpoint and refactor helper\n\nSecond source change\n\nThird source change';check('multi: complete observed joined messages',all(commits[n]['message'].strip()==message for n in ['feature','feature_split']));check('multi: generated identities use invoker',all(commits[n]['author']==commits[n]['committer']=='Split demo <split-demo@example.test>' for n in ['feature','feature_split']));check('multi: three source commits were present',len((R/'multi-gt/before-source-history.txt').read_text().splitlines())==3)
b=load('conflict','before');partial=load('conflict','partial');a=load('conflict','after');recovery=json.loads((R/'conflict-gt/recovery.json').read_text());check('conflict: actual unmerged replay',bool(recovery['unmerged']) and recovery['headName'].strip()=='refs/heads/child');check('conflict: extraction completed before replay','feature_split' in partial['branches'] and partial['branches']['feature']['tree']==b['branches']['feature']['tree']);check('continue: returns original branch clean',a['branch']=='feature' and a['status']=='');check('continue: no duplicate extracted branch',set(a['branches'])==set(partial['branches']));check('continue: resolved child bytes retained',base64.b64decode(a['branches']['child']['files']['src/api/service.ts']).decode()=='export const service = "resolved source plus child";\n');check('continue: actual child ancestry',a['branches']['child']['parents']==[a['branches']['feature']['oid']])
ids={}
for case in ['multi','all','collision','patterns','file-types','occupied-child','cwd','conflict']:
 cap=load(case,'capture');check(case+': complete successful REA observation',bool(cap.get('evidence_id')) and cap['normalized_result']['truncated'] is False);check(case+': expected command exit',cap['normalized_result']['exit']['code']==(1 if case=='conflict' else 0));ids[case]=cap['evidence_id']
cap=json.loads((R/'conflict-gt/continue-capture.json').read_text());check('continue: complete zero-exit capture',bool(cap.get('evidence_id')) and cap['normalized_result']['exit']['code']==0 and cap['normalized_result']['truncated'] is False);ids['continue']=cap['evidence_id']
result={'passed':len(checks),'failed':0,'checks':checks,'evidenceIds':ids,'scope':'Nine fresh native process observations plus independent Git snapshots; not Anthracite implementation acceptance.'};(R/'validation.json').write_text(json.dumps(result,indent=2)+'\n');print('Verified',len(checks),'bounded recorded outcome predicates.')
