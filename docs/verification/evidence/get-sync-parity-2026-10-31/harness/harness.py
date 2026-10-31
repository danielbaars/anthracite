import os,json,subprocess,pathlib,hashlib,sqlite3,time,sys
ROOT=pathlib.Path('/private/tmp/anthracite-get-sync-research-20261031')
META=json.loads((ROOT/'published-fixtures.json').read_text()); FIX={f['branch'].removeprefix('get-sync-20261031-'):f for f in META['created']}
REPO=META['repository']; PREFIX='get-sync-20261031-'; NODE='/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node'; GT='/opt/homebrew/Cellar/graphite/1.8.6/bin/gt'; AN='/private/tmp/anthracite-npm-0.5.0-20261030/public-install/node_modules/@danielbaars/anthracite/cli.cjs'
def env():
 e=dict(os.environ); home=ROOT/'private-runtime/home'; e.update({'PATH':str(ROOT/'bin')+':'+str(pathlib.Path(NODE).parent)+':'+e['PATH'],'HOME':str(home),'XDG_CONFIG_HOME':str(home/'config'),'XDG_CACHE_HOME':str(home/'cache'),'GH_CONFIG_DIR':os.environ.get('GH_CONFIG_DIR',str(pathlib.Path(os.environ.get('XDG_CONFIG_HOME',str(pathlib.Path.home()/'.config')))/'gh')),'NO_COLOR':'1','TERM':'dumb','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_EDITOR':'true','GIT_SEQUENCE_EDITOR':'true','GRAPHITE_DISABLE_TELEMETRY':'1','GRAPHITE_DISABLE_UPGRADE_PROMPT':'1','GRAPHITE_DISABLE_SURVEY':'1'}); return e
def run(cwd,args,check=True,timeout=90):
 t=time.monotonic(); p=subprocess.run(args,cwd=cwd,env=env(),text=True,capture_output=True,timeout=timeout); r={'cwd':str(cwd),'argv':args,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'seconds':round(time.monotonic()-t,3)}
 with (ROOT/'preparation.jsonl').open('a') as f:f.write(json.dumps(r)+'\n')
 if check and p.returncode:raise RuntimeError(json.dumps(r))
 return r
def git(cwd,*args):return run(cwd,['git',*args])['stdout'].strip()
def cli(cwd,tool,*args):return run(cwd,([GT] if tool=='gt' else [NODE,AN])+list(args)+['--no-interactive'])
def clone(name,tool,local=('base','child','tip','sibling'),checkout='main'):
 cwd=ROOT/'cases'/name; assert not cwd.exists(); cwd.parent.mkdir(exist_ok=True)
 run(ROOT,['git','clone','--no-hardlinks','--branch','main',str(ROOT/'github-fixture'),str(cwd)])
 for k,v in [('user.name','Parity Fixture'),('user.email','parity@example.invalid'),('commit.gpgsign','false'),('core.hooksPath','/dev/null')]:git(cwd,'config',k,v)
 git(cwd,'config','credential.helper','')
 git(cwd,'config','--add','credential.helper','!gh auth git-credential')
 git(cwd,'remote','set-url','origin','https://github.com/'+REPO+'.git')
 for n in local:git(cwd,'branch',FIX[n]['branch'],FIX[n]['head'])
 cli(cwd,tool,'init','--trunk','main')
 for n in local:cli(cwd,tool,'track',FIX[n]['branch'],'--parent',FIX[n]['parent'])
 git(cwd,'switch',PREFIX+checkout if checkout!='main' else 'main')
 return cwd
def snapshot(cwd):
 refs={line.split(' ',1)[0]:line.split(' ',1)[1] for line in git(cwd,'for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/branch-metadata').splitlines()}
 result={'head':git(cwd,'rev-parse','HEAD'),'branch':git(cwd,'branch','--show-current'),'refs':refs,'status':git(cwd,'status','--porcelain=v1'),'indexSHA256':hashlib.sha256((cwd/'.git/index').read_bytes()).hexdigest(),'trees':{n:git(cwd,'rev-parse',f'refs/heads/{PREFIX+n}^{{tree}}') for n in FIX if f'refs/heads/{PREFIX+n}' in refs},'parents':{},'files':{str(p.relative_to(cwd)):hashlib.sha256(p.read_bytes()).hexdigest() for p in cwd.rglob('*') if p.is_file() and '.git' not in p.relative_to(cwd).parts}}
 if (cwd/'.git/.graphite_metadata.db').exists():
  with sqlite3.connect('file:'+str(cwd/'.git/.graphite_metadata.db')+'?mode=ro',uri=True) as c:
   result['parents']={r[0]:{'parent':r[1],'state':r[2]} for r in c.execute('select branch_name,parent_branch_name,state from branch_metadata')}
 else:
  for ref in refs:
   if ref.startswith('refs/branch-metadata/'):
    result['parents'][ref.removeprefix('refs/branch-metadata/')]=json.loads(git(cwd,'show',ref))
 return result
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='prepare':
  name,tool=sys.argv[2:4]; local=tuple(sys.argv[4].split(',')) if len(sys.argv)>4 else ('base','child','tip','sibling'); checkout=sys.argv[5] if len(sys.argv)>5 else 'main'; cwd=clone(name,tool,local,checkout); before=snapshot(cwd); (ROOT/(name+'-before.json')).write_text(json.dumps(before,indent=2)+'\n');print(json.dumps({'name':name,'cwd':str(cwd),'branch':before['branch'],'parents':before['parents']}))
 elif mode=='snapshot':
  name=sys.argv[2]; s=snapshot(ROOT/'cases'/name);(ROOT/(name+'-after.json')).write_text(json.dumps(s,indent=2)+'\n');print(json.dumps({'name':name,'branch':s['branch'],'heads':{k:v for k,v in s['refs'].items() if k.startswith('refs/heads')}}))
