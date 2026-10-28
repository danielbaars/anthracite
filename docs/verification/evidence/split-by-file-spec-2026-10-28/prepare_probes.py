import importlib.util,pathlib,json,subprocess,os
ROOT=pathlib.Path('/private/tmp/anthracite-split-spec-2026-10-28')
source=pathlib.Path('/Users/danielbaars/Dev/anthracite/docs/verification/evidence/split-by-file-demo-2026-10-28/fixture.py')
spec=importlib.util.spec_from_file_location('demo_fixture',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.ROOT=ROOT
GT=m.TOOLS['gt']
def capture_before(folder):
 state=m.snapshot(folder);(folder/'before.json').write_text(json.dumps(state,indent=2)+'\n')
def commit(folder,subject,author=None):
 args=['git','commit','-m',subject]
 if author:args+=['--author',author]
 m.run(folder,args)
def restack(folder):m.run(folder,[GT,'restack','--upstack','--no-interactive'])
fixtures={}
for case in ['multi','all','collision','patterns','file-types','occupied-child']:
 if case=='file-types':m.BASE.update({'assets/delete.txt':'delete me\n','assets/rename-from.txt':'renamed bytes\n','assets/data.bin':'\x00old\x10bytes'})
 p=m.prepare(case,'gt')
 if case=='multi':
  m.write(p/'repo',{'src/refactor/utils.ts':'export const helper = 3;\n','src/refactor/late-helper.ts':'export const late = true;\n','tests/api.test.ts':'// second feature test\n'});m.run(p,['git','add','.']);commit(p,'Second source change','Second Author <second@example.test>')
  m.write(p/'repo',{'src/api/service.ts':'export const service = "third";\n'});m.run(p,['git','add','.']);commit(p,'Third source change','Third Author <third@example.test>');restack(p)
 elif case=='collision':
  m.run(p,['git','switch','-c','feature_split','main']);m.write(p/'repo',{'existing-name.txt':'Existing unrelated branch\n'});m.run(p,['git','add','.']);commit(p,'Occupied split name');m.run(p,[GT,'track','feature_split','--parent','main','--no-interactive']);m.run(p,['git','switch','feature'])
 elif case=='patterns':
  m.write(p/'repo',{'src/refactor/space café.ts':'export const spaced = true;\n'});m.run(p,['git','add','.']);commit(p,'Literal path source change');restack(p)
 elif case=='file-types':
  (p/'repo/assets/delete.txt').unlink();(p/'repo/docs').mkdir(exist_ok=True);m.run(p,['git','mv','assets/rename-from.txt','docs/renamed.txt']);(p/'repo/assets/data.bin').write_bytes(b'\0new\xffbytes');m.run(p,['git','add','-A']);commit(p,'Delete rename and binary source change');restack(p)
 elif case=='occupied-child':
  m.run(p,['git','worktree','add',str(p/'linked'),'child']);(p/'linked/docs/follow-up.md').write_text('Dirty linked documentation\n')
 args=['split','--by-file','src/refactor/**','--no-interactive']
 if case=='all':args=['split','--by-file','.','--no-interactive']
 elif case=='patterns':args=['sp','-f','src/refactor/**','--file','src/refactor/utils.ts','--by-file','tests/*.ts','--no-interactive']
 elif case=='file-types':args=['split','--by-file','assets/**','--no-interactive']
 capture_before(p)
 env={k:v for k,v in m.env_for(p).items() if k in ['HOME','XDG_CONFIG_HOME','GH_CONFIG_DIR','GRAPHITE_USER_CONFIG_PATH','GRAPHITE_PROFILE','GH_TOKEN','GITHUB_TOKEN','GRAPHITE_AUTH_TOKEN','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_AUTHOR_DATE','GIT_COMMITTER_DATE','NO_COLOR','TERM','EDITOR','VISUAL','GIT_EDITOR','CH_PAGER','GT_PAGER','PATH']}
 history=m.run(p,['git','log','main..feature','--format=%H%x09%an <%ae>%x09%s']);(p/'before-source-history.txt').write_text(history)
 fixtures[case]={'folder':str(p),'repo':str(p/'repo'),'arguments':args,'environment':env}
(ROOT/'fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n');print('Prepared six separate bounded Graphite probes.')
