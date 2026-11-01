import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import time

root = pathlib.Path('/private/tmp/anthracite-sync-updates-implementation-20261101')
worktree = root / 'worktrees/87'
node = '/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node'
package_home = root / '87-package-home'
package_home.mkdir(exist_ok=True)
user_config = root / '87-package-npmrc'
global_config = root / '87-package-global-npmrc'
user_config.write_text('')
global_config.write_text('')
env = {**os.environ, 'PATH': str(pathlib.Path(node).parent) + ':' + os.environ['PATH'],
       'HOME': str(package_home), 'NPM_CONFIG_USERCONFIG': str(user_config),
       'NPM_CONFIG_GLOBALCONFIG': str(global_config), 'npm_config_cache': str(root / '87-package-cache'),
       'npm_config_offline': 'true', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
       'BUN_EXECUTABLE': '/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun'}
for name in ['NODE_OPTIONS', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'ANTHRACITE_TEST_BINARY', 'CHARCOAL_TEST_BINARY']:
    env.pop(name, None)
started = time.monotonic()
with (root / '87-npm-build.log').open('w') as log:
    result = subprocess.run([node, 'scripts/build-npm-package.cjs'], cwd=worktree, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=120)
assert result.returncode == 0, 'npm build failed; inspect 87-npm-build.log'
build_seconds = time.monotonic() - started
candidate = root / 'ticket-87-candidate.tgz'
shutil.copy2(worktree / 'release/npm/danielbaars-anthracite.tgz', candidate)
sha = lambda data: hashlib.sha256(data).hexdigest()
with tarfile.open(candidate) as archive:
    files = {member.name: {'sha256': sha(archive.extractfile(member).read()), 'size': member.size} for member in archive.getmembers() if member.isfile()}
artifact = {'kind': 'unpublished candidate; version metadata retained without version bump',
            'tarball': candidate.name, 'tarballSha256': sha(candidate.read_bytes()),
            'files': files, 'buildSeconds': build_seconds,
            'sourceArtifactMap': 'ticket-87-source-artifacts.json',
            'gateCommand': [node, 'scripts/test-npm-package.cjs', str(candidate)]}
(root / 'ticket-87-npm-artifact.json').write_text(json.dumps(artifact, indent=2) + '\n')
started = time.monotonic()
with (root / '87-npm-gate.log').open('w') as log:
    result = subprocess.run(artifact['gateCommand'], cwd=worktree, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=240)
artifact['gateSeconds'] = time.monotonic() - started
artifact['gateExitCode'] = result.returncode
(root / 'ticket-87-npm-artifact.json').write_text(json.dumps(artifact, indent=2) + '\n')
assert result.returncode == 0, 'exact offline npm gate failed; inspect 87-npm-gate.log'
print(json.dumps(artifact, indent=2))
