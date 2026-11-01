import os, json, subprocess, pathlib, hashlib, sqlite3, shutil, sys
PREFIX='submit-probe-20261101-'
def bn(name): return name if name=='main' else PREFIX+name
ROOT=pathlib.Path('/private/tmp/anthracite-submit-comparison-20261101')
GT='/opt/homebrew/Cellar/graphite/1.8.6/bin/gt'
NODE='/Users/danielbaars/.local/share/mise/installs/node/24/bin/node'
AN=str(pathlib.Path('/Users/danielbaars/.local/share/mise/installs/npm-danielbaars-anthracite/latest/node_modules/@danielbaars/anthracite/cli.cjs').resolve())
BIN=ROOT/'bin'; BIN.mkdir(exist_ok=True)
for name in ['open','xdg-open','editor']:
 p=BIN/name
 p.write_text('#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$PROBE_SENTINEL_LOG"\nprintf "Blocked external helper in submit comparison\\n" >&2\nexit 97\n'); p.chmod(0o755)
def env(home):
 return {'HOME':str(home),'XDG_CONFIG_HOME':str(home/'config'),'XDG_CACHE_HOME':str(home/'cache'),'GH_CONFIG_DIR':str(home/'gh'), 'PATH':f'{BIN}:{pathlib.Path(NODE).parent}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','PROBE_SENTINEL_LOG':str(ROOT/'sentinel.log'),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_EDITOR':'true','GIT_SEQUENCE_EDITOR':'true','PAGER':'cat','GIT_PAGER':'cat','NO_COLOR':'1','TERM':'dumb','GRAPHITE_DISABLE_TELEMETRY':'1','GRAPHITE_DISABLE_UPGRADE_PROMPT':'1','GRAPHITE_DISABLE_SURVEY':'1'}
def run(cwd,args,home,check=True):
 r=subprocess.run(args,cwd=cwd,env=env(home),text=True,capture_output=True,stdin=subprocess.DEVNULL,timeout=60)
 if check and r.returncode: raise RuntimeError(json.dumps({'args':args,'cwd':str(cwd),'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}))
 return {'argv':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def git(cwd,home,*args): return run(cwd,['git',*args],home)['stdout'].strip()
def cli(cwd,home,tool,*args,check=True):return run(cwd,([GT] if tool=='gt' else [NODE,AN])+list(args)+['--no-interactive'],home,check)
def snap(cwd,home):
 refs=dict(line.split(' ',1) for line in git(cwd,home,'for-each-ref','--format=%(refname) %(objectname)','refs/heads').splitlines())
 s={'refs':refs,'branch':git(cwd,home,'branch','--show-current'),'head':git(cwd,home,'rev-parse','HEAD'),'status':git(cwd,home,'status','--porcelain=v1'),'parents':{},'ancestor':{},'unmerged':git(cwd,home,'diff','--name-only','--diff-filter=U'),'rebase':(cwd/'.git/rebase-merge').exists() or (cwd/'.git/rebase-apply').exists(),'files':{str(p.relative_to(cwd)):hashlib.sha256(p.read_bytes()).hexdigest() for p in cwd.rglob('*') if p.is_file() and '.git' not in p.relative_to(cwd).parts}}
 db=cwd/'.git/.graphite_metadata.db'
 if db.exists():
  with sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True) as c:s['parents']={r[0]:r[1] for r in c.execute('select branch_name,parent_branch_name from branch_metadata')}
 else:
  for ref in git(cwd,home,'for-each-ref','--format=%(refname)','refs/branch-metadata').splitlines():s['parents'][ref.removeprefix('refs/branch-metadata/')]=json.loads(git(cwd,home,'show',ref)).get('parentBranchName')
 for child,parent in s['parents'].items():
  if parent and 'refs/heads/'+parent in refs and 'refs/heads/'+child in refs:s['ancestor'][child]=run(cwd,['git','merge-base','--is-ancestor',parent,child],home,False)['exit']==0
 return s

def build(name,tool,variant='clean',checkout='tip'):
 root=ROOT/name; assert not root.exists(); root.mkdir(); home=root/'home';home.mkdir();cwd=root/'repo';cwd.mkdir()
 git(cwd,home,'init','-b','main')
 for k,v in [('user.name','Submit fixture'),('user.email','submit@example.invalid'),('commit.gpgsign','false'),('core.hooksPath','/dev/null')]:git(cwd,home,'config',k,v)
 (cwd/'root.txt').write_text('root\n');git(cwd,home,'add','.');git(cwd,home,'commit','-m','Root fixture')
 branches=[(bn(b),bn(p)) for b,p in [('base','main'),('child','base'),('tip','child'),('sibling','base'),('other','main')]]
 for branch,parent in branches:
  git(cwd,home,'checkout','-b',branch,parent)
  (cwd/(branch.removeprefix(PREFIX)+'.txt')).write_text(branch+'\n');git(cwd,home,'add','.');git(cwd,home,'commit','-m',branch)
 bare=root/'origin.git'; git(cwd,home,'init','--bare',str(bare));git(cwd,home,'remote','add','origin',str(bare));git(cwd,home,'push','origin','--all')
 git(cwd,home,'config','url.'+str(bare)+'.insteadOf','https://github.com/danielbaars/graphite-charcoal-e2e-2026-10-21.git')
 git(cwd,home,'remote','set-url','origin','https://github.com/danielbaars/graphite-charcoal-e2e-2026-10-21.git')
 cli(cwd,home,tool,'init','--trunk','main')
 config=cwd/'.git/.graphite_repo_config';v=json.loads(config.read_text());v.update({'host':'github.com','owner':'danielbaars','name':'graphite-charcoal-e2e-2026-10-21'});config.write_text(json.dumps(v,indent=2))
 if tool=='gt':
  auth=home/'config/graphite/auth';auth.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(pathlib.Path('/Users/danielbaars/.config/graphite/auth'),auth);auth.chmod(0o600)
 for branch,parent in branches:cli(cwd,home,tool,'track',branch,'--parent',parent)
 git(cwd,home,'checkout',bn('base'))
 if variant=='conflict':
  # Parent adds the same new path already introduced by child: add/add on replay.
  (cwd/'child.txt').write_text('conflicting parent content\n')
 else:(cwd/'base.txt').write_text('base amended\n')
 git(cwd,home,'add','.');git(cwd,home,'commit','--amend','--no-edit')
 git(cwd,home,'checkout',bn(checkout))
 if variant=='frozen':cli(cwd,home,tool,'freeze',bn('child'))
 if variant=='occupied':git(cwd,home,'worktree','add',str(root/'other-worktree'),bn('child'))
 before=snap(cwd,home);(root/'before.json').write_text(json.dumps(before,indent=2)+'\n')
 (root/'spec.json').write_text(json.dumps({'tool':tool,'variant':variant,'checkout':checkout,'env':env(home)},indent=2)+'\n')
 return cwd,home
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='build':
  cwd,home=build(*sys.argv[2:]);print(json.dumps({'cwd':str(cwd),'home':str(home)}))
 elif mode=='run':
  name,tool=sys.argv[2:4]; root=ROOT/name; home=root/'home';cwd=root/'repo'
  result=cli(cwd,home,tool,*sys.argv[4:],check=False);after=snap(cwd,home);(root/'after.json').write_text(json.dumps(after,indent=2)+'\n');(root/'capture.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 elif mode=='snapshot':
  root=ROOT/sys.argv[2];s=snap(root/'repo',root/'home');(root/'after.json').write_text(json.dumps(s,indent=2)+'\n');print(json.dumps(s))
