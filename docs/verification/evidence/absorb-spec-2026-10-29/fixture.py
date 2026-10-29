import importlib.util, json, pathlib, sys, base64

spec=importlib.util.spec_from_file_location('demo','/private/tmp/absorb_demo.py')
d=importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
ROOT=pathlib.Path('/private/tmp/anthracite-absorb-spec-2026-10-29'); d.ROOT=ROOT
CASES=['multi-commit','same-line','same-file-hunks','mixed-work','all-dry','all-apply','no-force','conflict']

def snap(folder):
    s=d.snapshot(folder)
    s['allRefs']=d.git(folder,'for-each-ref','--format=%(refname) %(objectname)')
    oids=d.git(folder,'rev-list','--all').splitlines()
    s['commitDetails']={oid:base64.b64encode(d.git(folder,'cat-file','commit',oid).encode()).decode() for oid in oids}
    s['indexEntries']=d.git(folder,'ls-files','--stage','-z')
    return s

def setup(case):
    info=d.prepare(case,'gt'); f=pathlib.Path(info['folder'])
    git=lambda *args:d.git(f,*args)
    cli=lambda *args:d.run(f,[d.TOOLS['gt'],*args,'--no-interactive'])
    git('restore','--staged','--worktree','--','.')
    if case=='multi-commit':
        git('switch','refactor')
        git('commit','--amend','--author','Original Helper Author <helper@example.test>','-m','Introduce helper\n\nOriginal helper body.')
        d.write(f/'repo',{'src/second.txt':'second-mode=initial\n'})
        git('add','.'); git('commit','--author','Second Author <second@example.test>','-m','Add independent helper\n\nSecond body.')
        cli('restack','--upstack'); git('switch','tests')
        d.write(f/'repo',{'src/refactor.txt':d.REFACTOR['src/refactor.txt'].replace('initial','reviewed'),'src/second.txt':'second-mode=reviewed\n'}); git('add','.')
    elif case in ['same-line','same-file-hunks']:
        git('switch','api')
        original=d.REFACTOR['src/refactor.txt']
        changed=original.replace('initial','api-owned') if case=='same-line' else original.replace('helper-context-19','api-owned-tail')
        d.write(f/'repo',{'src/refactor.txt':changed}); git('add','.'); git('commit','-m','Update shared helper area')
        cli('restack','--upstack'); git('switch','tests')
        updated=changed.replace('api-owned','reviewed') if case=='same-line' else changed.replace('initial','reviewed').replace('api-owned-tail','reviewed-tail')
        d.write(f/'repo',{'src/refactor.txt':updated}); git('add','.')
    elif case=='conflict':
        d.write(f/'repo',{'src/refactor.txt':d.REFACTOR['src/refactor.txt'].replace('initial','child-owned')}); git('add','.'); git('commit','-m','Child overrides helper')
        git('switch','api')
        d.write(f/'repo',{'src/refactor.txt':d.REFACTOR['src/refactor.txt'].replace('initial','reviewed'),'README.md':'Unabsorbed baseline edit\n'}); git('add','.')
    else:
        d.write(f/'repo',{'src/refactor.txt':d.REFACTOR['src/refactor.txt'].replace('initial','reviewed')})
        if case not in ['all-dry','all-apply']: git('add','src/refactor.txt')
        if case=='mixed-work':
            p=f/'repo/src/refactor.txt'; p.write_text(p.read_text().replace('helper-context-19','unstaged-tail'))
        if case in ['all-dry','all-apply']: d.write(f/'repo',{'untracked.txt':'Do not stage this\n'})
    args=['absorb','--force','--no-interactive']
    if case=='all-dry': args=['absorb','--all','--dry-run','--no-interactive']
    if case=='all-apply': args=['absorb','--all','--force','--no-interactive']
    if case=='no-force': args=['absorb','--no-interactive']
    info['args']=args
    (f/'before.json').write_text(json.dumps(snap(f),indent=2)+'\n')
    return info

if __name__=='__main__':
    if sys.argv[1]=='prepare':
        ROOT.mkdir(); fixtures={case:setup(case) for case in CASES}; (ROOT/'fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n'); print('Prepared eight focused Graphite specification probes.')
    elif sys.argv[1]=='snapshot':
        case,label=sys.argv[2:]; f=ROOT/(case+'-gt'); (f/(label+'.json')).write_text(json.dumps(snap(f),indent=2)+'\n'); print(case,label)
    elif sys.argv[1]=='resolve':
        f=ROOT/'conflict-gt'
        d.write(f/'repo',{'src/refactor.txt':d.REFACTOR['src/refactor.txt'].replace('initial','resolved-child')})
        d.git(f,'add','src/refactor.txt'); print('Staged deliberate conflict resolution; README left as reached.')
