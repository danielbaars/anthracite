import base64, hashlib, json, os, pathlib, subprocess, sys

ROOT = pathlib.Path('/private/tmp/anthracite-absorb-demo-2026-10-29')
TOOLS = {'gt': '/opt/homebrew/bin/gt', 'an': '/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/an'}
CASES = ['single', 'two-targets', 'no-clear-target', 'frozen', 'occupied']
BASE = {'README.md': 'Baseline documentation\n'}
REFACTOR = {'src/refactor.txt': 'helper-mode=initial\n' + ''.join(f'helper-context-{i}\n' for i in range(20))}
API = {'src/api.txt': 'api-mode=initial\n' + ''.join(f'api-context-{i}\n' for i in range(20))}

def env_for(folder):
    return dict(PATH=str(folder/'bin')+':/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME=str(folder/'home'), XDG_CONFIG_HOME=str(folder/'home'), GH_CONFIG_DIR=str(folder/'home/gh'), GRAPHITE_USER_CONFIG_PATH=str(folder/'user-config'), GRAPHITE_PROFILE='', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0', GIT_AUTHOR_DATE='2020-01-01T00:00:00Z', GIT_COMMITTER_DATE='2020-01-01T00:00:00Z', NO_COLOR='1', TERM='dumb', SHELL='/bin/zsh', EDITOR=str(folder/'bin/editor'), VISUAL=str(folder/'bin/editor'), GIT_EDITOR=str(folder/'bin/editor'), CH_PAGER=str(folder/'bin/pager'), GT_PAGER=str(folder/'bin/pager'))

def run(folder, args):
    r = subprocess.run(args, cwd=folder/'repo', env=env_for(folder), text=True, capture_output=True, timeout=40)
    if r.returncode:
        raise RuntimeError(f'{args}: {r.stdout}\n{r.stderr}')
    return r.stdout

def git(folder, *args):
    return run(folder, ['git', *args])

def write(repo, files):
    for name, content in files.items():
        p=repo/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(content)

def snapshot(folder):
    refs=dict(line.split(' ',1) for line in git(folder,'for-each-ref','--format=%(refname:short) %(objectname)','refs/heads').splitlines())
    branches={}
    for name, oid in refs.items():
        paths=git(folder,'ls-tree','-r','--name-only',name).splitlines()
        branches[name]={'oid':oid,'tree':git(folder,'rev-parse',name+'^{tree}').strip(),'parents':git(folder,'show','-s','--format=%P',name).strip().split(),'subject':git(folder,'show','-s','--format=%s',name).strip(),'files':{p:base64.b64encode(git(folder,'show',name+':'+p).encode()).decode() for p in paths}}
    repo=folder/'repo'; g=repo/'.git'
    files={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in repo.rglob('*') if p.is_file() and '.git' not in p.relative_to(repo).parts}
    metadata={str(p.relative_to(g)):base64.b64encode(p.read_bytes()).decode() for p in g.rglob('*') if p.is_file() and any(x.startswith(('.graphite','.gtcontinue')) for x in p.relative_to(g).parts)}
    worktrees={}
    if (folder/'worktree').exists():
        worktrees={'head':run_at(folder,['git','rev-parse','HEAD'],folder/'worktree').strip(),'status':run_at(folder,['git','status','--porcelain=v1'],folder/'worktree'),'files':{str(p.relative_to(folder/'worktree')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (folder/'worktree').rglob('*') if p.is_file() and p.name!='.git'}}
    return {'branch':git(folder,'branch','--show-current').strip(),'head':git(folder,'rev-parse','HEAD').strip(),'branches':branches,'status':git(folder,'status','--porcelain=v1','--untracked-files=all'),'staged':git(folder,'diff','--cached','--binary'),'unstaged':git(folder,'diff','--binary'),'indexSha256':hashlib.sha256((g/'index').read_bytes()).hexdigest(),'worktreeFiles':files,'metadata':metadata,'worktree':worktrees,'unexpectedTools':(folder/'unexpected-tools.log').read_text() if (folder/'unexpected-tools.log').exists() else ''}

def run_at(folder,args,cwd):
    r=subprocess.run(args,cwd=cwd,env=env_for(folder),capture_output=True,text=True,timeout=30)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout

def prepare(case,tool):
    f=ROOT/(case+'-'+tool); f.mkdir(); (f/'repo').mkdir(); (f/'home').mkdir(); (f/'bin').mkdir()
    (f/'user-config').write_text(json.dumps({'tips':False,'branchDate':False}))
    for name in ['gh','editor','pager']:
        p=f/'bin'/name; p.write_text('#!/bin/sh\nprintf "%s\\n" "'+name+'" >> "'+str(f/'unexpected-tools.log')+'"\nexit 99\n'); p.chmod(0o755)
    cli=lambda *args:run(f,[TOOLS[tool],*args,'--no-interactive'])
    git(f,'init','--initial-branch=main'); git(f,'config','user.name','Absorb demo'); git(f,'config','user.email','absorb-demo@example.test'); git(f,'config','commit.gpgsign','false')
    write(f/'repo',BASE); git(f,'add','.'); git(f,'commit','-m','Baseline'); cli('init','--trunk','main')
    for name,parent,files,message in [('refactor','main',REFACTOR,'Introduce helper'),('api','refactor',API,'Introduce API'),('tests','api',{'tests.txt':'Test coverage\n'},'Add tests'),('other','main',{'other.txt':'Unrelated stack\n'},'Unrelated work')]:
        git(f,'switch','-c',name,parent); write(f/'repo',files); git(f,'add','.'); git(f,'commit','-m',message); cli('track',name,'--parent',parent)
    git(f,'switch','tests')
    if case=='frozen': cli('freeze','refactor')
    if case=='occupied': git(f,'worktree','add',str(f/'worktree'),'refactor')
    changes={'src/refactor.txt':REFACTOR['src/refactor.txt'].replace('initial','reviewed')}
    if case in ['two-targets','frozen','occupied']: changes['src/api.txt']=API['src/api.txt'].replace('initial','reviewed')
    if case=='no-clear-target':
        changes['README.md']='Review edit to baseline-only documentation\n'
        changes['new-file.txt']='New staged file has no feature-commit owner\n'
    write(f/'repo',changes); git(f,'add','.')
    (f/'before.json').write_text(json.dumps(snapshot(f),indent=2)+'\n')
    return {'folder':str(f),'repo':str(f/'repo'),'environment':env_for(f)}

if __name__=='__main__':
    if sys.argv[1]=='prepare':
        ROOT.mkdir(); fixtures={case+'-'+tool:prepare(case,tool) for case in CASES for tool in TOOLS}
        for case in CASES:
            a=json.loads((ROOT/(case+'-gt')/'before.json').read_text()); b=json.loads((ROOT/(case+'-an')/'before.json').read_text()); assert a['branches']==b['branches']; assert a['worktreeFiles']==b['worktreeFiles']; assert a['staged']==b['staged']
        (ROOT/'fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n')
        identities={tool:{'path':str(pathlib.Path(binary).resolve()),'version':subprocess.check_output([binary,'--version'],text=True).strip(),'sha256':hashlib.sha256(pathlib.Path(binary).resolve().read_bytes()).hexdigest()} for tool,binary in TOOLS.items()}
        identities['anthraciteSourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd='/Users/danielbaars/Dev/anthracite',text=True).strip()
        (ROOT/'identities.json').write_text(json.dumps(identities,indent=2)+'\n')
        print('Prepared ten isolated repositories with equal paired commits, files and staged diffs.')
    elif sys.argv[1]=='snapshot':
        key,label=sys.argv[2:]; f=ROOT/key; (f/(label+'.json')).write_text(json.dumps(snapshot(f),indent=2)+'\n'); print(key,label)
