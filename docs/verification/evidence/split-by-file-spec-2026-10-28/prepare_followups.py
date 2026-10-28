import importlib.util,pathlib,json
ROOT=pathlib.Path('/private/tmp/anthracite-split-spec-2026-10-28')
s=importlib.util.spec_from_file_location('fixture','/Users/danielbaars/Dev/anthracite/docs/verification/evidence/split-by-file-demo-2026-10-28/fixture.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.ROOT=ROOT
fixtures={}
for case in ['cwd','conflict']:
 p=m.prepare(case,'gt')
 if case=='conflict':
  m.run(p,['git','switch','child']);m.write(p/'repo',{'src/api/service.ts':'export const service = "child-specific";\n'});m.run(p,['git','add','.']);m.run(p,['git','commit','--amend','-m','Child edits service and docs']);m.run(p,['git','switch','feature']);m.write(p/'repo',{'src/api/service.ts':'export const service = "source-advanced";\n'});m.run(p,['git','add','.']);m.run(p,['git','commit','-m','Advance source service without restacking child'])
 (p/'before.json').write_text(json.dumps(m.snapshot(p),indent=2)+'\n')
 fixtures[case]={'folder':str(p),'repo':str(p/'repo'),'workingDirectory':str(p/'repo/src') if case=='cwd' else str(p/'repo'),'arguments':['split','--by-file','refactor/**' if case=='cwd' else 'src/refactor/**','--no-interactive'],'environment':{k:v for k,v in m.env_for(p).items() if k in json.loads((ROOT/'fixtures.json').read_text())['multi']['environment']}}
(ROOT/'followup-fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n');print('Prepared cwd and genuine stale-child conflict probes.')
