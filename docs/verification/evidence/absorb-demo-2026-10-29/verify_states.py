import base64, hashlib, json, pathlib, sys

ROOT=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).parent
captures=json.loads((ROOT/'captures.json').read_text())
checks=[]
def check(name,value):
    assert value,name
    checks.append(name)
def read(case,tool,label):
    return json.loads((ROOT/(case+'-'+tool)/(label+'.json')).read_text())
def text(branch,path):
    return base64.b64decode(branch['files'][path]).decode()

cases=['single','two-targets','no-clear-target','frozen','occupied']
summary={}
for case in cases:
    before=read(case,'gt','before'); dry=read(case,'gt','after-dry'); after=read(case,'gt','after')
    an_before=read(case,'an','before'); an_after=read(case,'an','after')
    check(case+': paired starting commits and files',before['branches']==an_before['branches'] and before['worktreeFiles']==an_before['worktreeFiles'] and before['staged']==an_before['staged'])
    check(case+': Anthracite parser refusal preserves observed state',an_before==an_after)
    response=json.loads(captures[case+'-an']['content'][0]['text'])
    check(case+': Anthracite fails explicitly',response['status']=='cli_error' and response['exitCode']==1 and 'absorb' in response['stderr'])
    check(case+': dry-run preserves logical Git state',all(before[k]==dry[k] for k in ['branch','head','branches','status','staged','unstaged','worktreeFiles','worktree']))
    check(case+': Graphite preserves current checkout and worktree bytes',after['branch']=='tests' and before['worktreeFiles']==after['worktreeFiles'])
    check(case+': trunk and unrelated branch untouched',all(before['branches'][x]==after['branches'][x] for x in ['main','other']))
    check(case+': no external editor/gh/pager called',after['unexpectedTools']==an_after['unexpectedTools']=='')
    check(case+': no unstaged changes introduced',after['unstaged']=='')
    e=captures[case+'-apply']['normalized_result']; d=captures[case+'-dry']['normalized_result']
    check(case+': captures completed without terminal truncation',e['exit']['reason']==d['exit']['reason']=='exited' and not e['truncated'] and not d['truncated'])
    if case=='occupied':
        check('occupied: explicit failure with refs/staging/worktrees intact',e['exit']['code']==1 and all(before[k]==after[k] for k in ['branch','head','branches','status','staged','unstaged','worktreeFiles','worktree']))
    else:
        check(case+': successful Graphite execution',e['exit']['code']==0)
        check(case+': exact feature chain retained',after['branches']['refactor']['parents']==[after['branches']['main']['oid']] and after['branches']['api']['parents']==[after['branches']['refactor']['oid']] and after['branches']['tests']['parents']==[after['branches']['api']['oid']])
        check(case+': original commit subjects retained',all(before['branches'][x]['subject']==after['branches'][x]['subject'] for x in ['refactor','api','tests']))
        if case=='frozen':
            check('frozen: protected target unchanged',before['branches']['refactor']==after['branches']['refactor'])
            check('frozen: eligible API change absorbed',text(after['branches']['api'],'src/api.txt').startswith('api-mode=reviewed\n'))
            check('frozen: protected hunk remains staged',after['status']=='M  src/refactor.txt\n')
        else:
            check(case+': refactor hunk reaches its original commit',text(after['branches']['refactor'],'src/refactor.txt').startswith('helper-mode=reviewed\n'))
            if case=='two-targets':
                check('two-targets: API hunk reaches its own commit',text(after['branches']['api'],'src/api.txt').startswith('api-mode=reviewed\n') and 'src/api.txt' not in after['branches']['refactor']['files'])
            if case=='no-clear-target':
                check('no-clear-target: baseline edit and new file stay staged',after['status']=='M  README.md\nA  new-file.txt\n' and text(after['branches']['tests'],'README.md')=='Baseline documentation\n' and 'new-file.txt' not in after['branches']['tests']['files'])
            else:
                check(case+': index and working copy clean',after['status']==after['staged']=='')
                tip_hashes={p:hashlib.sha256(base64.b64decode(v)).hexdigest() for p,v in after['branches']['tests']['files'].items()}
                check(case+': final tip contains exactly initial working files',tip_hashes==before['worktreeFiles'])
    summary[case]={'graphiteExit':e['exit']['code'],'changedRefs':[x for x in before['branches'] if before['branches'][x]['oid']!=after['branches'][x]['oid']],'remainingStatus':after['status'],'dryRunChangedFields':[k for k in before if before[k]!=dry[k]],'executionChangedFields':[k for k in dry if dry[k]!=after[k]],'anthraciteObservedStateUnchanged':an_before==an_after}
bare=json.loads(captures['single-an-bare']['content'][0]['text']); check('bare absorb fails without relying on force flag',bare['stderr']=='Unknown argument: absorb\n' and bare['exitCode']==1)
result={'status':'passed','predicateCount':len(checks),'checks':checks,'cases':summary}
(ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':result['status'],'predicateCount':len(checks),'cases':summary},indent=2))
