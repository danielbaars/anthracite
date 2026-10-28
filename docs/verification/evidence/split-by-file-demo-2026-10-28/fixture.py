import base64,hashlib,json,os,pathlib,subprocess
ROOT=pathlib.Path('/private/tmp/anthracite-split-demo-2026-10-28')
TOOLS={'gt':'/opt/homebrew/Cellar/graphite/1.8.6/bin/gt','an':'/Users/danielbaars/.local/bin/an'}
def env_for(folder):
 env=dict(os.environ,HOME=str(folder/'home'),XDG_CONFIG_HOME=str(folder/'home'),GH_CONFIG_DIR=str(folder/'home/gh'),GRAPHITE_USER_CONFIG_PATH=str(folder/'user-config'),GRAPHITE_PROFILE='',GH_TOKEN='',GITHUB_TOKEN='',GRAPHITE_AUTH_TOKEN='',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_AUTHOR_DATE='2020-01-01T00:00:00Z',GIT_COMMITTER_DATE='2020-01-01T00:00:00Z',NO_COLOR='1',TERM='dumb',EDITOR=str(folder/'bin/editor'),VISUAL=str(folder/'bin/editor'),GIT_EDITOR=str(folder/'bin/editor'),CH_PAGER=str(folder/'bin/pager'),GT_PAGER=str(folder/'bin/pager'),PATH=str(folder/'bin')+os.pathsep+os.environ['PATH'])
 for key in ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_PREFIX','GIT_CONFIG_COUNT','DEBUG','FORCE_COLOR']:env.pop(key,None)
 return env
def run(folder,args):
 r=subprocess.run(args,cwd=folder/'repo',env=env_for(folder),text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(f'{args}: {r.stdout}\n{r.stderr}')
 return r.stdout
BASE={'README.md':'Demo baseline\n','src/refactor/utils.ts':'export const helper = 1;\n','src/api/service.ts':'export const service = "baseline";\n','tests/api.test.ts':'// baseline test\n'}
FEATURE={'src/refactor/utils.ts':'export const helper = 2;\n','src/refactor/new-helper.ts':'export const extra = true;\n','src/api/service.ts':'export const service = "feature";\n','tests/api.test.ts':'// feature test\n'}
def write(repo,files):
 for name,content in files.items():
  p=repo/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
def prepare(case,tool):
 folder=ROOT/(case+'-'+tool);folder.mkdir();(folder/'repo').mkdir();(folder/'home').mkdir();(folder/'bin').mkdir()
 (folder/'user-config').write_text(json.dumps({'tips':False,'branchDate':False}))
 for name in ['gh','editor','pager']:
  p=folder/'bin'/name;p.write_text('#!/bin/sh\nprintf "%s\\n" "'+name+'" >> "'+str(folder/'unexpected-tools.log')+'"\nexit 99\n');p.chmod(0o755)
 git=lambda *args:run(folder,['git',*args]);cli=lambda *args:run(folder,[TOOLS[tool],*args,'--no-interactive'])
 git('init','--initial-branch=main');git('config','user.name','Split demo');git('config','user.email','split-demo@example.test');git('config','commit.gpgsign','false')
 write(folder/'repo',BASE);git('add','.');git('commit','-m','Baseline');cli('init','--trunk','main')
 git('switch','-c','feature');write(folder/'repo',FEATURE);git('add','.');git('commit','-m','Add endpoint and refactor helper');cli('track','feature','--parent','main')
 git('switch','-c','child');write(folder/'repo',{'docs/follow-up.md':'Follow-up remains above feature\n'});git('add','.');git('commit','-m','Document feature');cli('track','child','--parent','feature')
 git('switch','-c','other','main');write(folder/'repo',{'unrelated.txt':'Unrelated stack\n'});git('add','.');git('commit','-m','Unrelated work');cli('track','other','--parent','main');git('switch','feature')
 if case=='dirty':
  with (folder/'repo/src/api/service.ts').open('a') as f:f.write('// local unstaged work\n')
  (folder/'repo/local-note.txt').write_text('Untracked local note\n')
 return folder

def snapshot(folder):
 git=lambda *args:run(folder,['git','-c','core.quotePath=false',*args]);refs={line.split(' ',1)[0]:line.split(' ',1)[1] for line in git('for-each-ref','--format=%(refname:short) %(objectname)','refs/heads').splitlines()}
 branches={}
 for name,oid in refs.items():
  paths=git('ls-tree','-r','--name-only',name).splitlines()
  branches[name]={'oid':oid,'tree':git('rev-parse',name+'^{tree}').strip(),'parents':git('show','-s','--format=%P',name).strip().split(),'subject':git('show','-s','--format=%s',name).strip(),'files':{p:base64.b64encode(subprocess.check_output(['git','show',name+':'+p],cwd=folder/'repo',env=env_for(folder))).decode() for p in paths}}
 files={str(p.relative_to(folder/'repo')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (folder/'repo').rglob('*') if p.is_file() and '.git' not in p.relative_to(folder/'repo').parts}
 metadata={str(p.relative_to(folder/'repo/.git')):base64.b64encode(p.read_bytes()).decode() for p in (folder/'repo/.git').rglob('*') if p.is_file() and any(part.startswith('.graphite') or part.startswith('graphite') for part in p.relative_to(folder/'repo/.git').parts)}
 index=folder/'repo/.git/index'
 return {'branch':git('branch','--show-current').strip(),'head':git('rev-parse','HEAD').strip(),'branches':branches,'status':git('status','--porcelain=v1','--untracked-files=all'),'staged':git('diff','--cached','--binary'),'unstaged':git('diff','--binary'),'indexSha256':hashlib.sha256(index.read_bytes()).hexdigest(),'worktreeFiles':files,'metadata':metadata,'unexpectedTools':(folder/'unexpected-tools.log').read_text() if (folder/'unexpected-tools.log').exists() else ''}
if __name__=='__main__':
 fixtures={}
 for case in ['basic','no-match','dirty']:
  for tool in ['gt','an']:
   folder=prepare(case,tool);before=snapshot(folder);(folder/'before.json').write_text(json.dumps(before,indent=2)+'\n');fixtures[case+'-'+tool]={'folder':str(folder),'repo':str(folder/'repo'),'environment':{k:v for k,v in env_for(folder).items() if k in ['HOME','XDG_CONFIG_HOME','GH_CONFIG_DIR','GRAPHITE_USER_CONFIG_PATH','GRAPHITE_PROFILE','GH_TOKEN','GITHUB_TOKEN','GRAPHITE_AUTH_TOKEN','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_AUTHOR_DATE','GIT_COMMITTER_DATE','NO_COLOR','TERM','EDITOR','VISUAL','GIT_EDITOR','CH_PAGER','GT_PAGER','PATH']}}
 for case in ['basic','no-match','dirty']:
  a=json.loads((ROOT/(case+'-gt')/'before.json').read_text());b=json.loads((ROOT/(case+'-an')/'before.json').read_text());assert a['branches']==b['branches'];assert a['worktreeFiles']==b['worktreeFiles']
 (ROOT/'fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n');print('Prepared six isolated fixtures; paired Git commits and working files match exactly.')
