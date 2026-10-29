import os,pathlib,subprocess,json,hashlib,base64,sys
ROOT=pathlib.Path(os.environ.get('INSERT_RESEARCH_ROOT','$FIXTURE_ROOT'))
NODE='$NODE_PREFIX/bin/node'
TOOLS={'gt':['/opt/homebrew/bin/gt'],'an':[NODE,'$NODE_PREFIX/lib/node_modules/@danielbaars/anthracite/cli.cjs'],'ch':['/opt/homebrew/bin/ch']}
def env_for(f):
 return dict(PATH=str(f/'bin')+':$NODE_PREFIX/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME=str(f/'home'),XDG_CONFIG_HOME=str(f/'home'),GH_CONFIG_DIR=str(f/'home/gh'),GRAPHITE_USER_CONFIG_PATH=str(f/'user-config'),GRAPHITE_PROFILE='',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0',GIT_AUTHOR_DATE='2020-01-01T00:00:00Z',GIT_COMMITTER_DATE='2020-01-01T00:00:00Z',TERM='xterm-256color',SHELL='/bin/zsh',EDITOR=str(f/'bin/editor'),VISUAL=str(f/'bin/editor'),GIT_EDITOR=str(f/'bin/editor'),CH_PAGER='',GT_PAGER='cat',NO_COLOR='1')
def run(f,args,check=True):
 r=subprocess.run(args,cwd=f/'repo',env=env_for(f),capture_output=True,text=True,stdin=subprocess.DEVNULL,timeout=60)
 if check and r.returncode:raise RuntimeError(str(args)+'\n'+r.stdout+r.stderr)
 return r

def git(f,*args):return run(f,['git',*args]).stdout.strip()
def snapshot(f):
 refs=dict(x.split(' ',1) for x in git(f,'for-each-ref','--format=%(refname) %(objectname)').splitlines())
 meta={k:git(f,'show',k) for k in refs if not k.startswith('refs/heads/')}
 files={str(p.relative_to(f/'repo')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (f/'repo').rglob('*') if p.is_file() and '.git' not in p.relative_to(f/'repo').parts}
 configs={str(p.relative_to(f/'repo/.git')):base64.b64encode(p.read_bytes()).decode() for p in (f/'repo/.git').rglob('*') if p.is_file() and p.name.startswith(('.graphite','.gtcontinue'))}
 return dict(branch=git(f,'branch','--show-current'),refs=refs,metadata=meta,configs=configs,files=files,status=git(f,'status','--porcelain=v1'),indexSha256=hashlib.sha256((f/'repo/.git/index').read_bytes()).hexdigest(),trees={k:git(f,'rev-parse',k+'^{tree}') for k in refs if k.startswith('refs/heads/')},unexpected=(f/'unexpected-tools').read_text() if (f/'unexpected-tools').exists() else '')
def prepare(name,tool,children=2,current='parent',staged=True,frozen=False,occupied=False):
 f=ROOT/(name+'-'+tool);f.mkdir();(f/'repo').mkdir();(f/'home').mkdir();(f/'bin').mkdir();(f/'user-config').write_text(json.dumps({'tips':False,'branchDate':False}))
 for name_ in ['gh','editor']:
  p=f/'bin'/name_;p.write_text('#!/bin/sh\necho '+name_+' >> '+str(f/'unexpected-tools')+'\nexit 99\n');p.chmod(0o755)
 cli=lambda *args:run(f,TOOLS[tool]+list(args)+['--no-interactive'])
 git(f,'init','--initial-branch=main');git(f,'config','user.name','Insert comparison');git(f,'config','user.email','insert@example.test');git(f,'config','commit.gpgsign','false');(f/'repo/root.txt').write_text('root\n');git(f,'add','.');git(f,'commit','-m','Root');cli('init','--trunk','main')
 branches=[('parent','main')]
 if children>=1:branches += [('left','parent'),('left-tip','left')]
 if children>=2:branches += [('right','parent'),('right-tip','right')]
 branches += [('unrelated','main')]
 for branch,parent in branches:
  git(f,'switch','-c',branch,parent);(f/'repo'/(branch+'.txt')).write_text(branch+'\n');git(f,'add','.');git(f,'commit','-m',branch);cli('track',branch,'--parent',parent)
 git(f,'switch',current)
 if frozen:cli('freeze','right')
 if occupied:git(f,'worktree','add',str(f/'occupied'),'right')
 if staged:(f/'repo/inserted.txt').write_text('inserted\n');git(f,'add','inserted.txt')
 (f/'before.json').write_text(json.dumps(snapshot(f),indent=2)+'\n')
 return f
if __name__=='__main__':
 if sys.argv[1]=='setup':
  out={}
  for name,kw in [('leaf',{'children':0}),('single',{'children':1}),('fanout',{}),('onto',{'current':'unrelated'}),('empty',{'staged':False}),('interactive-cancel',{}),('interactive-default',{}),('interactive-one',{}),('interactive-all',{}),('interactive-none',{}),('frozen',{'frozen':True}),('occupied',{'occupied':True})]:
   for tool in (['gt','an','ch'] if name in ['leaf','single','fanout'] else ['gt','an']):
    f=prepare(name,tool,**kw);out[name+'-'+tool]=dict(folder=str(f),tool=tool,environment=env_for(f));print(name+'-'+tool,flush=True)
  (ROOT/'fixtures.json').write_text(json.dumps(out,indent=2)+'\n')
 elif sys.argv[1]=='run':
  result={}
  for name in ['leaf','single','fanout','onto','empty','frozen','occupied']:
   for tool in (['gt','an','ch'] if name in ['leaf','single','fanout'] else ['gt','an']):
    f=ROOT/(name+'-'+tool);args=['create','inserted','--insert','--no-interactive']
    if name!='empty':args+=['-m','Inserted work']
    if name=='onto':args+=['--onto','parent']
    r=run(f,TOOLS[tool]+args,False);item=dict(args=args,exit=r.returncode,stdout=r.stdout,stderr=r.stderr); (f/'execution.json').write_text(json.dumps(item,indent=2)+'\n'); (f/'after.json').write_text(json.dumps(snapshot(f),indent=2)+'\n');result[name+'-'+tool]=item;print(name+'-'+tool,r.returncode,r.stdout[:400],r.stderr[:400],flush=True)
  (ROOT/'noninteractive-results.json').write_text(json.dumps(result,indent=2)+'\n')
 elif sys.argv[1]=='snapshot':
  f=ROOT/sys.argv[2];(f/'after.json').write_text(json.dumps(snapshot(f),indent=2)+'\n')
