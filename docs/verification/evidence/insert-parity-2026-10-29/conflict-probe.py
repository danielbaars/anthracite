from fixture import *
for tool in ['gt','an']:
 f=ROOT/('conflict-'+tool)
 if tool=='an':
  prepare('conflict',tool);(f/'repo/inserted.txt').unlink();git(f,'reset','--','inserted.txt');(f/'repo/left.txt').write_text('inserted version\n');git(f,'add','left.txt');(f/'before.json').write_text(json.dumps(snapshot(f),indent=2)+'\n');r=run(f,TOOLS[tool]+['create','inserted','--insert','-m','Inserted conflict','--no-interactive'],False);(f/'execution.json').write_text(json.dumps(dict(exit=r.returncode,stdout=r.stdout,stderr=r.stderr),indent=2)+'\n');(f/'after-conflict.json').write_text(json.dumps(snapshot(f),indent=2)+'\n');print(tool,'create',r.returncode,r.stdout[-400:],r.stderr[-400:],flush=True)
 if tool=='gt':
  r=run(f,TOOLS[tool]+['restack','--no-interactive'],False);(f/'restack.json').write_text(json.dumps(dict(exit=r.returncode,stdout=r.stdout,stderr=r.stderr),indent=2)+'\n');(f/'after-restack.json').write_text(json.dumps(snapshot(f),indent=2)+'\n');print(tool,'restack',r.returncode,r.stdout[-500:],r.stderr[-400:],flush=True)
 assert git(f,'diff','--name-only','--diff-filter=U')=='left.txt'
 (f/'repo/left.txt').write_text('resolved version\n');git(f,'add','left.txt');r=run(f,TOOLS[tool]+['continue','--no-interactive'],False);(f/'continue.json').write_text(json.dumps(dict(exit=r.returncode,stdout=r.stdout,stderr=r.stderr),indent=2)+'\n');(f/'after-continue.json').write_text(json.dumps(snapshot(f),indent=2)+'\n');print(tool,'continue',r.returncode,r.stdout[-500:],r.stderr[-400:],flush=True)
