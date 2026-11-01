import hashlib
import json
import pathlib
import sys

root = pathlib.Path('/private/tmp/anthracite-sync-updates-implementation-20261101')
worktree = root / 'worktrees/review-fixes'
manifest = root / 'review-fixes-source-artifacts.json'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def collect(directory, suffix):
    return {str(file.relative_to(worktree)): digest(file.read_bytes())
            for file in sorted((worktree / directory).rglob('*'))
            if file.is_file() and file.suffix == suffix}

current = {
    'source': collect('apps/cli/src', '.ts'),
    'compiled': collect('apps/cli/dist/src', '.js'),
    'testSource': collect('apps/cli/test', '.ts'),
    'testCompiled': collect('apps/cli/dist/test', '.js'),
    'nativeSha256': digest((root / 'review-fixes-an').read_bytes()),
}
current['mapSha256'] = {
    key: digest(json.dumps(value, sort_keys=True).encode())
    for key, value in current.items() if isinstance(value, dict)
}
if sys.argv[1] == 'write':
    manifest.write_text(json.dumps(current, indent=2, sort_keys=True) + '\n')
else:
    expected = json.loads(manifest.read_text())
    assert current == expected, 'Frozen source/artifacts changed'
print(json.dumps({'mapSha256': current['mapSha256'], 'nativeSha256': current['nativeSha256'], 'files': {key: len(value) for key, value in current.items() if isinstance(value, dict) and key != 'mapSha256'}}, indent=2))
