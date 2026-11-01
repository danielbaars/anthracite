import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import time

root = pathlib.Path('/private/tmp/anthracite-sync-updates-implementation-20261101')
worktree = root / 'worktrees/review-fixes'
node = '/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node'
package_home = root / 'review-fixes-package-home'
package_home.mkdir(exist_ok=True)
user_config = root / 'review-fixes-package-npmrc'
global_config = root / 'review-fixes-package-global-npmrc'
user_config.write_text('')
global_config.write_text('')
env = {**os.environ, 'PATH': str(pathlib.Path(node).parent) + ':' + os.environ['PATH'],
       'HOME': str(package_home), 'NPM_CONFIG_USERCONFIG': str(user_config),
       'NPM_CONFIG_GLOBALCONFIG': str(global_config), 'npm_config_cache': str(root / 'review-fixes-package-cache'),
       'npm_config_offline': 'true', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
       'BUN_EXECUTABLE': '/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun'}
for name in ['NODE_OPTIONS', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'ANTHRACITE_TEST_BINARY', 'CHARCOAL_TEST_BINARY']:
    env.pop(name, None)
started = time.monotonic()
with (root / 'review-fixes-npm-build.log').open('w') as log:
    result = subprocess.run([node, 'scripts/build-npm-package.cjs'], cwd=worktree, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=120)
assert result.returncode == 0, 'npm build failed; inspect review-fixes-npm-build.log'
build_seconds = time.monotonic() - started
candidate = root / 'review-fixes-candidate.tgz'
shutil.copy2(worktree / 'release/npm/danielbaars-anthracite.tgz', candidate)
sha = lambda data: hashlib.sha256(data).hexdigest()
with tarfile.open(candidate) as archive:
    files = {member.name: {'sha256': sha(archive.extractfile(member).read()), 'size': member.size} for member in archive.getmembers() if member.isfile()}
artifact = {'kind': 'unpublished candidate; version metadata retained without version bump',
            'tarball': candidate.name, 'tarballSha256': sha(candidate.read_bytes()),
            'files': files, 'buildSeconds': build_seconds,
            'sourceArtifactMap': 'review-fixes-source-artifacts.json',
            'gateCommand': [node, 'scripts/test-npm-package.cjs', str(candidate)]}
(root / 'review-fixes-npm-artifact.json').write_text(json.dumps(artifact, indent=2) + '\n')
print(json.dumps(artifact, indent=2))
