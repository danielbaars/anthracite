const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [source, output] = process.argv.slice(2);
const { RelationCliFixture } = require(path.join(source, 'apps/cli/dist/test/lib/fixtures/relation_cli.js'));
const { prepareLand } = require(path.join(source, 'apps/cli/dist/test/lib/fixtures/land_gh.js'));
const fixture = new RelationCliFixture();
const github = prepareLand(fixture);
try {
  const remote = fixture.git(['for-each-ref'], github.remote);
  const ready = fixture.run(['land', 'tip', '--dry-run']);
  assert.equal(ready.status, 0, ready.stderr);
  fs.writeFileSync(path.join(output, 'land-ready-final.txt'), ready.stdout);
  fs.writeFileSync(path.join(fixture.repo, 'local-notes.txt'), 'Preserve synthetic local work.\n');
  const before = fixture.inspectionSnapshot();
  const blocked = fixture.run(['land', 'tip', '--dry-run']);
  assert.equal(blocked.status, 1);
  assert.deepEqual(fixture.inspectionSnapshot(), before);
  assert.equal(fixture.git(['for-each-ref'], github.remote), remote);
  fs.writeFileSync(path.join(output, 'land-blocked-final.txt'), blocked.stdout + blocked.stderr);
  console.log('Captured final ready and blocked previews; repository and remote preserved.');
} finally { fixture.cleanup(); }
