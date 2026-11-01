import datetime
import json
import os
import pathlib
import re
import subprocess
import sys

root = pathlib.Path('/private/tmp/anthracite-sync-updates-implementation-20261101')
worktree = root / 'worktrees/87'
node = '/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node'
files = [
    'sync_refresh_cli', 'sync_authority_cli', 'sync_delete_all_cli',
    'sync_cleanup_descendants_cli', 'sync_survivor_cli', 'sync_maintenance_cli',
    'sync_completion_cli', 'sync_recovery_cli', 'sync_late_guards_cli',
    'sync_delivery_cli',
]
env = dict(os.environ, PATH=str(pathlib.Path(node).parent) + ':' + os.environ['PATH'],
           GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1',
           ANTHRACITE_TEST_BINARY=str(root / 'ticket-87-an'))
results = []
for name in files:
    command = [node, '../../node_modules/mocha/bin/mocha.js',
               'dist/test/commands/' + name + '.test.js']
    log = root / ('87-native-' + name + '.log')
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with log.open('w') as output:
        result = subprocess.run(command, cwd=worktree / 'apps/cli', env=env,
                                stdout=output, stderr=subprocess.STDOUT)
    text = log.read_text()
    entry = dict(file=name, command=command, cwd=str(worktree / 'apps/cli'),
                 log=log.name, started=start,
                 ended=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 exitCode=result.returncode,
                 passing=int(re.search(r'(\d+) passing', text).group(1)) if re.search(r'(\d+) passing', text) else 0,
                 failing=int(re.search(r'(\d+) failing', text).group(1)) if re.search(r'(\d+) failing', text) else 0)
    results.append(entry)
    (root / '87-native-sync-results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(entry), flush=True)
sys.exit(0 if all(result['exitCode'] == 0 for result in results) else 1)
