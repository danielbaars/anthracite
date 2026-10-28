"""Verify retained specification evidence, then its independent outcome checks."""
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text())
for name,expected in manifest['sha256'].items():
    actual=hashlib.sha256((root/name).read_bytes()).hexdigest()
    if actual!=expected:raise SystemExit(f'Evidence mismatch: {name}')
subprocess.run([sys.executable,str(root/'check_probes.py')],check=True)
print(f"Verified {len(manifest['sha256'])} retained evidence hashes.")
