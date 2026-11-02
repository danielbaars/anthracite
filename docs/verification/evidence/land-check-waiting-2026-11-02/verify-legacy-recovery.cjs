const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

// Arguments are explicit local artifacts; this probe contacts no live service.
const [source, released, candidate, output] = process.argv.slice(2);
assert(source && released && candidate && output);
process.env.ANTHRACITE_TEST_BINARY = candidate;
const { RelationCliFixture } = require(path.join(source, 'apps/cli/dist/test/lib/fixtures/relation_cli.js'));
const { prepareLand } = require(path.join(source, 'apps/cli/dist/test/lib/fixtures/land_gh.js'));
const fixture = new RelationCliFixture();
const github = prepareLand(fixture);
fixture.branch('unpublished', 'tip');
const result = { releasedVersion: execFileSync(released, ['--version'], {encoding: 'utf8'}).trim(), candidate };
assert.equal(result.releasedVersion, '0.6.2');

async function main() {
  const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
  fs.writeFileSync(github.policy, JSON.stringify({...policy, pendingAfterPush: true}));
  process.env.ANTHRACITE_TEST_BINARY = released;
  result.before = fixture.run(['land', 'tip', '--yes']);
  process.env.ANTHRACITE_TEST_BINARY = candidate;
  assert.equal(result.before.status, 1);
  assert.match(result.before.stderr, /Fresh readiness blocked/);
  const recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
  const recordBytes = fs.readFileSync(recordPath);
  const record = JSON.parse(recordBytes);
  assert.equal(record.version, 1);
  result.releasedRecord = record;
  result.releasedRecordSHA256 = createHash('sha256').update(recordBytes).digest('hex');
  const childHead = fixture.git(['rev-parse', 'child']);
  const survivorTree = fixture.git(['rev-parse', 'unpublished^{tree}']);
  const completed = new Set();
  result.after = await new Promise((resolve, reject) => {
    const child = spawn(candidate, ['land', 'tip', '--yes'], {cwd: fixture.repo, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 90000);
    child.stdout.on('data', data => {
      stdout += data.toString();
      for (const number of [18, 19]) if (!completed.has(number) && stdout.includes('Waiting for #' + number)) {
        completed.add(number);
        const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
        for (const pr of prs) { pr.statusCheckRollup = []; pr.mergeStateStatus = 'CLEAN'; }
        fs.writeFileSync(github.state, JSON.stringify(prs));
      }
    });
    child.stderr.on('data', data => stderr += data.toString());
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('close', (status, signal) => {clearTimeout(timer); resolve({status, signal, stdout, stderr});});
  });
  assert.equal(result.after.status, 0, result.after.stdout + result.after.stderr);
  assert.deepEqual([...completed], [18, 19]);
  const final = JSON.parse(fs.readFileSync(github.state, 'utf8'));
  assert.deepEqual(final.map(pr => pr.state), ['MERGED', 'MERGED', 'MERGED']);
  assert.equal(final[1].headRefOid, childHead);
  assert.equal(fixture.git(['rev-parse', 'unpublished^{tree}']), survivorTree);
  assert.equal(fixture.git(['ls-remote', '--heads', 'origin', 'refs/heads/unpublished']), '');
  assert.equal(fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1, 3);
  assert(!fs.existsSync(recordPath));
  result.passed = true;
  result.waitedForBothRemainingPRs = [...completed];
  result.unpublishedSurvivorRemainedLocal = true;
  result.sameReachedChildHead = true;
  result.survivorTreePreserved = true;
  result.noRepeatedConfirmedMerge = true;
  result.recoveryClearedAfterCompletion = true;
}

main().catch(error => {result.error = error.stack; process.exitCode = 1;}).finally(() => {
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  fixture.cleanup();
  console.log(JSON.stringify({passed: result.passed || false, releasedVersion: result.releasedVersion, output}));
});
