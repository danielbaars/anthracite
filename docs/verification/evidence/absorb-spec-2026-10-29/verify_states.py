import base64,json,pathlib,sys
ROOT=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).parent
captures=json.loads((ROOT/'captures.json').read_text()); checks=[]; summary={}
def check(name,predicate):
    assert predicate,name
    checks.append(name)
def content(s,branch,path):
    return base64.b64decode(s['branches'][branch]['files'][path]).decode()
def commits(s,tip,stop):
    result=[]
    while tip!=stop:
        raw=base64.b64decode(s['commitDetails'][tip]).decode(); header,message=raw.split('\n\n',1)
        fields=header.splitlines(); parent=next(x[7:] for x in fields if x.startswith('parent ')); author=next(x for x in fields if x.startswith('author '))
        result.append((tip,author,message)); tip=parent
    return list(reversed(result))
for case,e in captures.items():
    f=ROOT/(case+'-gt'); a=json.loads((f/'before.json').read_text()); b=json.loads((f/'after.json').read_text()); n=e['normalized_result']
    check(case+': process exits normally with complete terminal evidence',n['exit']['reason']=='exited' and n['exit']['code']==0 and not n['truncated'])
    check(case+': working-file bytes retained',a['worktreeFiles']==b['worktreeFiles'])
    check(case+': main and unrelated branch retained',all(a['branches'][x]==b['branches'][x] for x in ['main','other']))
    check(case+': no editor/gh/pager called',b['unexpectedTools']=='')
    if case=='multi-commit':
        old=commits(a,a['branches']['refactor']['oid'],a['branches']['main']['oid']); new=commits(b,b['branches']['refactor']['oid'],b['branches']['main']['oid'])
        check('multi-commit: two commits retain full authors/dates/messages and order',[x[1:] for x in old]==[x[1:] for x in new] and len(new)==2)
        raw=base64.b64decode(b['commitDetails'][new[0][0]]).decode(); first_tree=raw.splitlines()[0]
        check('multi-commit: preview assigns distinct target commit identities',all(x[0][:7] in ''.join(v['data'] for v in n['frames']) for x in old))
        check('multi-commit: both changes incorporated and staging clean',content(b,'refactor','src/refactor.txt').startswith('helper-mode=reviewed\n') and content(b,'refactor','src/second.txt')=='second-mode=reviewed\n' and b['staged']==b['unstaged']=='')
    elif case=='same-line':
        check('same-line: refactor unchanged; most recent touching API commit amended',a['branches']['refactor']==b['branches']['refactor'] and content(b,'api','src/refactor.txt').startswith('helper-mode=reviewed\n'))
    elif case=='same-file-hunks':
        check('same-file-hunks: each hunk reaches its separate commit',content(b,'refactor','src/refactor.txt').startswith('helper-mode=reviewed\n') and content(b,'refactor','src/refactor.txt').endswith('helper-context-19\n') and content(b,'api','src/refactor.txt').endswith('reviewed-tail\n'))
    elif case=='mixed-work':
        check('mixed-work: unstaged delta preserved and absorbed hunk no longer staged',b['staged']=='' and a['unstaged']==b['unstaged'] and 'unstaged-tail' not in content(b,'tests','src/refactor.txt'))
    elif case=='all-dry':
        check('all-dry: no refs changed',a['allRefs']==b['allRefs'])
        check('all-dry: tracked edit really staged despite dry-run',a['staged']=='' and b['staged']!='' and b['unstaged']=='' and 'M  src/refactor.txt' in b['status'])
        check('all-dry: new untracked file excluded','?? untracked.txt' in b['status'] and 'untracked.txt' not in b['indexEntries'])
    elif case=='all-apply':
        check('all-apply: tracked edit absorbed and untracked file remains untracked',content(b,'tests','src/refactor.txt').startswith('helper-mode=reviewed\n') and b['status']=='?? untracked.txt\n' and b['staged']==b['unstaged']=='')
    elif case=='no-force':
        check('no-force: noninteractive invocation previews without applying',all(a[k]==b[k] for k in ['branches','head','branch','staged','unstaged','status']) and 'Dry run complete' in ''.join(v['data'] for v in n['frames']))
    elif case=='conflict':
        check('middle-branch: source api amended',content(b,'api','src/refactor.txt').startswith('helper-mode=reviewed\n'))
        check('middle-branch: upstack tests ref unchanged and stale',a['branches']['tests']==b['branches']['tests'] and a['branches']['api']['oid']!=b['branches']['api']['oid'] and b['branches']['tests']['parents']!=[b['branches']['api']['oid']])
        check('middle-branch: staged leftover retained',b['status']=='M  README.md\n' and b['unstaged']=='')
    summary[case]={'evidenceId':e['evidence_id'],'exitCode':n['exit']['code'],'changedRefs':[x for x in a['branches'] if a['branches'][x]['oid']!=b['branches'][x]['oid']],'status':b['status'],'changedFields':[k for k in a if a[k]!=b[k]]}
extra=json.loads((ROOT/'extra-observations.json').read_text())
check('multi-commit: first amended tree contains only its own selected correction',extra['firstHelper'].startswith('helper-mode=reviewed\n') and 'src/second.txt' not in extra['firstFiles'])
check('multi-commit: second amended tree contains its separate correction',extra['secondHelper']=='second-mode=reviewed\n')
check('observed runs left no active rebase, including the middle-branch probe',all(extra['noActiveRebases'].values()))
result={'status':'passed','predicateCount':len(checks),'cases':summary,'checks':checks,'limits':['Eight Graphite scenarios, not a product acceptance suite.','The scenario named conflict did not produce an absorb conflict: Graphite left the upstack branch stale. No absorb continuation was tested.']}
(ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps({'status':result['status'],'predicateCount':len(checks),'cases':summary},indent=2))
