import sys,json,shutil
from harness import ROOT,FIX,PREFIX,git,cli,clone,snapshot
name,tool,variant=sys.argv[1:4]
local=('base','child') if variant=='remote' else ('base','child','tip','sibling')
known=variant.startswith('known');variant=variant.removeprefix('known-') if variant.startswith('known-') else ('normal' if variant=='known' else variant)
source=ROOT/'cases'/'s11-refresh-an' if known and tool=='an' else ROOT/'baselines'/tool
cwd=ROOT/'cases'/name;assert not cwd.exists();shutil.copytree(source,cwd)
if variant=='remote':
 for member in ['tip','sibling']:
  cli(cwd,tool,'untrack',FIX[member]['branch']);git(cwd,'branch','-D',FIX[member]['branch'])
if variant=='no-checkout':git(cwd,'switch',FIX['base']['branch'])
if variant=='dirty':
 file=git(cwd,'ls-files').splitlines()[0]; p=cwd/file;p.write_text(p.read_text()+'\nlocal dirty marker\n')
if variant=='frozen':cli(cwd,tool,'freeze',FIX['child']['branch'])
if variant=='occupied':
 other=ROOT/'occupied'/name;other.parent.mkdir(exist_ok=True);git(cwd,'worktree','add',str(other),FIX['child']['branch'])
if variant in ('diverged-feature','diverged-trunk'):
 branch=FIX['child']['branch'] if variant=='diverged-feature' else 'main';git(cwd,'switch',branch)
 file=cwd/'local-only.txt';file.write_text(name+' local-only commit\n');git(cwd,'add','local-only.txt');git(cwd,'commit','-m','test: retain local-only parity input [skip ci]');git(cwd,'switch','main')
before=snapshot(cwd);(ROOT/(name+'-before.json')).write_text(json.dumps(before,indent=2)+'\n');print(json.dumps({'name':name,'tool':tool,'variant':variant,'branch':before['branch'],'localBranches':[r for r in before['refs'] if r.startswith('refs/heads/')]}))
