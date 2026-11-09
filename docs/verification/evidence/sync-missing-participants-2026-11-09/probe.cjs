const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const [helper, binary, output] = process.argv.slice(2);
if (!helper || !binary || !output) throw Error('Usage: node probe.cjs FIXTURE_MODULE PUBLIC_CLI OUTPUT_DIRECTORY');
process.env.ANTHRACITE_TEST_BINARY = path.resolve(binary);
const { FrozenGetFixture } = require(path.resolve(helper));
fs.mkdirSync(output, { recursive: true });
const results = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const scenario of ['missing-leaf', 'missing-parent', 'reused-name']) {
  const result = { scenario, commands: [], snapshots: {}, checks: {} };
  let f;
  try {
    f = new FrozenGetFixture();
    f.commandTimeoutMs = 60000;
    result.fixtureRoot = f.root;
    result.version = f.ok('--version').output.trim();
    assert.equal(result.version, '0.6.15');
    const git = (...args) => f.git(f.consumer, ...args);
    const capture = label => {
      const state = {
        work: f.observe(),
        pins: git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/gt-metadata/get'),
        metadata: Object.fromEntries(git('for-each-ref', '--format=%(refname)', 'refs/branch-metadata').split('\n').filter(Boolean).map(ref => [ref, JSON.parse(git('cat-file', '-p', ref))])),
      };
      result.snapshots[label] = state;
      return state;
    };
    const run = (label, args) => {
      const r = f.run(args);
      result.commands.push({ label, args, ...r });
      return r;
    };
    const ownCommit = (file, contents, message) => {
      fs.writeFileSync(path.join(f.consumer, file), contents + '\n');
      git('add', file);
      f.ok('modify', '--commit', '--message', message);
      return git('rev-parse', 'HEAD');
    };
    const target = scenario === 'missing-leaf' ? 'obsolete-leaf' : scenario === 'missing-parent' ? 'obsolete-parent' : 'reused-work';
    result.target = target;
    f.ok('unfreeze', 'child');
    f.ok('create', target);
    const oldTarget = ownCommit('parent.txt', 'local correction requiring a conflict', 'Local correction before sync');
    result.oldTarget = { sha: oldTarget, commit: git('show', '-s', '--format=%H%n%P%n%an%n%ae%n%B%n%T', oldTarget) };
    if (scenario === 'missing-parent') {
      f.ok('create', 'surviving-child');
      result.survivor = { sha: ownCommit('surviving.txt', 'surviving own committed work', 'Independent child work'), name: 'surviving-child' };
    }
    git('switch', 'main');
    run('initial-log', ['ls']);
    capture('initial');
    f.git(f.producer, 'switch', 'parent');
    result.incomingParent = f.commit(f.producer, 'parent.txt', 'incoming parent correction');
    f.git(f.producer, 'push', 'origin', 'parent');
    const stopped = run('initial-sync-conflict', ['sync', '--no-delete']);
    assert.equal(stopped.status, 1, stopped.output);
    assert.ok(stopped.output.includes('Hit conflict restacking ' + target), stopped.output);
    capture('conflict');
    git('rebase', '--abort');
    git('switch', 'main');
    capture('after-raw-git-abort');
    git('branch', '-D', target);
    if (scenario === 'reused-name') {
      git('switch', '-c', target, 'child');
      fs.writeFileSync(path.join(f.consumer, 'replacement.txt'), 'new work under the same name\n');
      git('add', 'replacement.txt');
      git('-c', 'user.name=Replacement Author', '-c', 'user.email=replacement@example.test', 'commit', '-m', 'Replacement work under a reused name');
      result.replacement = { sha: git('rev-parse', 'HEAD'), commit: git('show', '-s', '--format=%H%n%P%n%an%n%ae%n%B%n%T', 'HEAD') };
      assert.notEqual(result.replacement.sha, oldTarget);
      git('switch', 'main');
    }
    const actor = capture('after-external-branch-change');
    const continued = run('continue-refusal', ['continue', '--all']);
    assert.equal(continued.status, 1, continued.output);
    assert.deepEqual(capture('after-continue'), actor);
    result.checks.continuePreservedAllObservedState = true;
    run('pending-log', ['ls']);
    assert.deepEqual(capture('after-pending-log'), actor);
    result.checks.pendingLogPreservedAllObservedState = true;
    const aborted = run('owned-sync-abandonment', ['sync', '--abort', '--no-interactive']);
    assert.equal(aborted.status, 0, aborted.output);
    assert.deepEqual(capture('after-abandonment'), { ...actor, work: { ...actor.work, recovery: null } });
    result.checks.abandonmentPreservedAllOtherObservedState = true;
    const archive = /^Archive: (.+)$/m.exec(aborted.output)?.[1];
    assert.ok(archive, aborted.output);
    const originalBytes = Buffer.from(actor.work.recovery, 'base64');
    const archivedBytes = fs.readFileSync(path.join(archive, 'recovery.json'));
    assert.ok(archivedBytes.equals(originalBytes));
    result.archive = { path: archive, originalRecoverySha256: hash(originalBytes), archivedRecoverySha256: hash(archivedBytes), files: fs.readdirSync(archive).sort() };
    result.checks.originalRecoveryBytesRetained = true;
    const fresh = run('fresh-default-sync', ['sync']);
    capture('after-fresh-sync');
    if (fresh.status === 1 && fresh.output.includes('Local branch child has diverged from remote')) {
      const beforeControl = capture('before-remote-alignment');
      const remoteBefore = f.git(f.remote, 'rev-parse', 'refs/heads/child');
      const publishedChild = git('rev-parse', 'refs/heads/child');
      const producerBefore = f.git(f.producer, 'rev-parse', 'refs/heads/child');
      assert.equal(git('remote', 'get-url', 'origin'), f.remote);
      git('push', '--force-with-lease=refs/heads/child:' + remoteBefore, 'origin', 'refs/heads/child:refs/heads/child');
      f.git(f.producer, 'fetch', 'origin', 'child');
      f.git(f.producer, 'update-ref', 'refs/heads/child', 'FETCH_HEAD', producerBefore);
      result.remoteAlignmentControl = { remoteBefore, publishedChild, producerBefore, remoteAfter: f.git(f.remote, 'rev-parse', 'refs/heads/child'), purpose: 'Only align the synthetic bare remote and controlled PR head with already reached local child work; do not repair local dependencies.' };
      assert.deepEqual(capture('after-remote-alignment'), beforeControl);
      result.checks.remoteAlignmentPreservedLocalObservedState = true;
      const aligned = run('fresh-sync-after-remote-alignment', ['sync']);
      result.alignedRemoteControlStatus = aligned.status;
      capture('after-aligned-sync');
    }
    run('final-log', ['ls']);
    capture('after-final-log');
    if (scenario === 'missing-parent') run('survivor-info', ['info', '--branch', 'surviving-child']);
    if (scenario === 'reused-name') {
      result.finalReplacement = { sha: git('rev-parse', 'refs/heads/' + target), commit: git('show', '-s', '--format=%H%n%P%n%an%n%ae%n%B%n%T', target) };
      result.checks.replacementTipAuthorMessageTreePreserved = JSON.stringify(result.finalReplacement) === JSON.stringify(result.replacement);
    }
    if (result.survivor) {
      result.finalSurvivor = { sha: git('rev-parse', 'refs/heads/surviving-child'), ownFile: git('show', 'surviving-child:surviving.txt') };
      result.checks.survivorTipAndOwnContentPreserved = result.finalSurvivor.sha === result.survivor.sha && result.finalSurvivor.ownFile === 'surviving own committed work';
    }
    result.oldTargetObjectAvailable = git('cat-file', '-t', oldTarget) === 'commit';
    const oldPins = actor.pins.split('\n').filter(Boolean);
    const newPins = result.snapshots['after-aligned-sync']?.pins.split('\n') ?? result.snapshots['after-fresh-sync'].pins.split('\n');
    result.checks.abandonedSourcePinsRetainedAfterFreshSync = oldPins.every(line => newPins.includes(line));
    result.freshSyncStatus = fresh.status;
    result.ghCalls = fs.readFileSync(f.ghCalls, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    result.ghResponses = fs.readFileSync(f.ghResponses, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (e) {
    result.error = { message: e.message, stack: e.stack };
  }
  results.push(result);
  fs.writeFileSync(path.join(output, scenario + '.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ scenario, version: result.version, freshSyncStatus: result.freshSyncStatus, alignedRemoteControlStatus: result.alignedRemoteControlStatus, checks: result.checks, error: result.error?.message, fixtureRoot: result.fixtureRoot }));
}
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(r => r.error)) process.exitCode = 1;
