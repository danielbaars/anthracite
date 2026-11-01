import json, pathlib, re
r=pathlib.Path('/private/tmp/anthracite-sync-updates-implementation-20261101')
report={}
for runtime in ['node','native']:
    results=json.loads((r/f'review-fixes-{runtime}-results.json').read_text())
    assert len(results)==7 and all(x['exitCode']==0 for x in results)
    groups=[]
    for result in results:
        content=(r/result['log']).read_text()
        cases=re.findall(r'^\s*✔ (.*?)(?: \(\d+ms\))?$',content,re.M)
        count=int(re.search(r'(\d+) passing',content)[1])
        assert len(cases)==count,(runtime,result['name'],len(cases),count)
        groups.append({'name':result['name'],'passing':count,'log':result['log'],'cases':cases})
    names=[case for g in groups for case in g['cases']]
    assert len(names)==len(set(names))==34
    report[runtime]={'passing':len(names),'failing':0,'groups':groups}
assert {c for g in report['node']['groups'] for c in g['cases']}=={c for g in report['native']['groups'] for c in g['cases']}
report['qualification']='34 distinct focused identities, repeated on Node/native. Existing controls overlap prior receipts. Earlier165+23 acceptance retains its original source epochs; no full corrected-source matrix claim.'
(r/'review-fixes-actual-cases.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({runtime:report[runtime]['passing'] for runtime in ['node','native']}))
