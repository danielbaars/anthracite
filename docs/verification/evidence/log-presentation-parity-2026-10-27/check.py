import json,subprocess,base64,re
from pathlib import Path
root=Path(__file__).parent
fixture=json.loads((root/'fixture.json').read_text())
env=fixture['environment']
cases={'default':['log'],'short':['log','short'],'stack':['log','--stack'],'reverse':['log','--reverse'],'classic':['log','--classic'],'zero':['log','--steps','0'],'short-zero':['ls','--steps','0'],'long':['log','long'],'long-stack':['log','long','--stack'],'long-reverse':['ll','--reverse'],'long-unknown':['ll','--parity-unknown']}
records=[]
for name,args in cases.items():
    for tool,exe in [('gt','/opt/homebrew/bin/gt'),('an','/Users/danielbaars/.local/bin/an')]:
        p=subprocess.run([exe,*args,'--no-interactive'],cwd=fixture['repos'][tool],env=env,capture_output=True,timeout=20)
        records.append({'case':name,'tool':tool,'status':p.returncode,'stdout':p.stdout.decode(),'stderr':p.stderr.decode(),'stdoutBase64':base64.b64encode(p.stdout).decode()})
(root/'current-results.json').write_text(json.dumps(records,indent=2)+'\n')
for name in cases:
    pair={r['tool']:r for r in records if r['case']==name}
    print(name, 'statuses',pair['gt']['status'],pair['an']['status'],'same_text',pair['gt']['stdout']==pair['an']['stdout'])
    if name in ['short','short-zero','long-stack']:
        for tool,r in pair.items():
            print(tool+':\n'+r['stdout'][:1300]+r['stderr'][:220])
