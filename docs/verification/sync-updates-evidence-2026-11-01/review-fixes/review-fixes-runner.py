import json, os, pathlib, subprocess, sys, time
root=pathlib.Path('/private/tmp/anthracite-sync-updates-implementation-20261101')
wt=root/'worktrees/review-fixes'
node='/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node'
runtime=sys.argv[1]
env={**os.environ,'PATH':str(pathlib.Path(node).parent)+':'+os.environ['PATH'],'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}
if runtime=='native': env['ANTHRACITE_TEST_BINARY']=str(root/'review-fixes-an')
else:
    env.pop('ANTHRACITE_TEST_BINARY',None)
    env.pop('CHARCOAL_TEST_BINARY',None)
selections=[
('numeric',['sync_numeric_branch_cli'],None),
('refresh',['sync_refresh_cli'],'refreshes existing published heads|rejects a same-name source|retains named local-only|retains an associated|resolves stored PR numbers|does not associate an unpublished|refuses authentication|refuses rate limit|refuses transport|refuses malformed response|refuses missing associated PR'),
('get-number',['get_fast_forward_cli'],'gets a fresh stack via PR number'),
('get-identity',['get_trunk_parent_cli'],'rejects a changed numeric PR identity|does not replace a stored descendant PR association'),
('get-stored',['get_graph_cli'],'does not skip an absent stored PR association'),
('maintenance',['sync_maintenance_cli'],'repairs local-only independent roots and fanout|refuses a late PR metadata change'),
('owned',['sync_recovery_cli'],'continues saved maintenance in a fresh process|continues incoming then maintenance conflicts|resumes successive fanout and independent-root maintenance'),
]
results=[]
for name,files,grep in selections:
    args=[node,'../../node_modules/mocha/bin/mocha.js',*[f'dist/test/commands/{file}.test.js' for file in files]]
    if grep: args+=['--grep',grep]
    log=root/f'review-fixes-{runtime}-{name}.log'
    started=time.monotonic()
    with log.open('w') as stream:
        result=subprocess.run(args,cwd=wt/'apps/cli',env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=480)
    results.append({'name':name,'args':args,'cwd':str(wt/'apps/cli'),'runtime':runtime,'exitCode':result.returncode,'seconds':time.monotonic()-started,'log':log.name})
    (root/f'review-fixes-{runtime}-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(f'{runtime} {name}: exit {result.returncode}',flush=True)
    if result.returncode: sys.exit(result.returncode)
