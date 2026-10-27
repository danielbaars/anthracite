import json,subprocess
from pathlib import Path
root=Path(__file__).parent
fixture=json.loads((root/'fixture.json').read_text())
repo=Path(fixture['repos']['gt'])
env=fixture['environment']
def git(*args,extra=None):
    return subprocess.check_output(['git',*args],cwd=repo,env={**env,**(extra or {})},text=True).strip()
original={line.split(' ',1)[0]:line.split(' ',1)[1] for line in git('for-each-ref','--format=%(refname:short) %(objectname)','refs/heads').splitlines()}
def date_tip(branch,date):
    sha=original[branch]
    tree=git('rev-parse',sha+'^{tree}')
    parents=git('show','-s','--format=%P',sha).split()
    args=['commit-tree',tree]
    for parent in parents:args+=['-p',parent]
    args+=['-m',git('show','-s','--format=%s',sha)]
    new=git(*args,extra={'GIT_AUTHOR_DATE':date,'GIT_COMMITTER_DATE':date})
    git('update-ref','refs/heads/'+branch,new)
def restore():
    git('switch','search')
    for branch,sha in original.items():git('update-ref','refs/heads/'+branch,sha)
records=[]
for name in ['baseline','maintenance-newest','deep-tip-newest','current-maintenance','equal-subtree-tips']:
    restore()
    if name=='maintenance-newest':date_tip('maintenance','2026-10-26T12:00:00Z')
    if name=='deep-tip-newest':
        date_tip('maintenance','2026-10-26T12:00:00Z')
        date_tip('feature/café-long-branch-name-for-terminal-width','2026-10-26T13:00:00Z')
    if name=='current-maintenance':git('switch','maintenance')
    if name=='equal-subtree-tips':date_tip('maintenance','2026-10-25T12:11:00Z')
    p=subprocess.run(['/opt/homebrew/bin/gt','log','short','--no-interactive'],cwd=repo,env=env,capture_output=True,text=True,timeout=15)
    assert p.returncode==0,p.stderr
    records.append({'case':name,'stdout':p.stdout,'stderr':p.stderr,'current':git('branch','--show-current')})
    print(name+'\n'+p.stdout)
restore()
(root/'ordering-results.json').write_text(json.dumps(records,indent=2)+'\n')
