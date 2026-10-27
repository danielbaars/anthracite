import json,subprocess
from pathlib import Path
root=Path(__file__).parent
fixture=json.loads((root/'fixture.json').read_text())
repo=fixture['repos']['gt'];env=fixture['environment']
def run(args):
    p=subprocess.run(['/opt/homebrew/bin/gt',*args,'--no-interactive'],cwd=repo,env=env,capture_output=True,text=True,timeout=20)
    assert p.returncode==0,(args,p.stderr)
    return p.stdout
order=['maintenance','base','api','api-followup','search','feature/café-long-branch-name-for-terminal-width','ui','empty-tip']
subprocess.run(['git','update-ref','refs/heads/api',fixture['apiOld']],cwd=repo,env=env,check=True,capture_output=True)
run(['init','--reset','--trunk','main'])
for branch in order:run(['track',branch,'--parent',fixture['parents'][branch]])
subprocess.run(['git','update-ref','refs/heads/api',fixture['apiNew']],cwd=repo,env=env,check=True,capture_output=True)
result={'tracking_order':order,'short':run(['log','short']),'classic':run(['log','--classic'])}
(root/'tracking-order-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
