#!/usr/bin/env node
// Validate retained evidence identities and case membership; this does not rerun the CLI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = __dirname;
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const hash = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const manifest = read('manifest.json');
assert.equal(manifest.status, 'accepted');
assert.equal(hash(manifest.expectedInventory.relative), manifest.expectedInventory.sha256);
const inventory = read(manifest.expectedInventory.relative);
const key = (file, title) => `${file}::${title}`;
const expected = new Set(inventory.cases.map((entry) => key(entry.file, entry.fullTitle)));
assert.equal(expected.size, 112);
const fileOf = (test) => path.basename(test.file || '');
for (const report of manifest.reports) assert.equal(hash(report.relative), report.sha256, report.relative);
for (const runtime of ['node', 'native']) {
  const result = manifest.runtimes[runtime];
  const actual = new Set();
  for (const entry of result.cases) {
    const report = read(entry.evidence.relative);
    assert.equal(hash(entry.evidence.relative), entry.evidence.sha256);
    assert.ok(report.passes.some((test) => test.fullTitle === entry.fullTitle && fileOf(test) === entry.file));
    actual.add(key(entry.file, entry.fullTitle));
  }
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(result.featureCases, 112);
  assert.equal(new Set(result.legacy.map((entry) => key(entry.file, entry.fullTitle))).size, 7);
  for (const entry of result.legacy) {
    const report = read(entry.evidence.relative);
    assert.ok(report.passes.some((test) => test.fullTitle === entry.fullTitle && fileOf(test) === entry.file));
  }
}
const installed = read(manifest.installed.evidence.relative);
assert.equal(installed.stats.passes, 1);
assert.equal(installed.stats.failures, 0);
assert.equal(manifest.installed.exitCode, 0);
console.log('Verified: 112 feature cases and 7 legacy controls per runtime; installed MCP 1/1; retained report hashes match.');
