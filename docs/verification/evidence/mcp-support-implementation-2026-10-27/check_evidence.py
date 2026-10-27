"""Verify the retained MCP implementation evidence without running the CLI."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text())
for name, expected in manifest['sha256'].items():
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'Evidence mismatch: {name}')
print(f"Verified {len(manifest['sha256'])} retained evidence files.")
