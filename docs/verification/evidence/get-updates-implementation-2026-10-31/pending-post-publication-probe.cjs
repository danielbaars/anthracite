const fs = require('node:fs');
const path = require('node:path');
const { FrozenGetFixture } = require('./worktrees/75/apps/cli/dist/test/lib/fixtures/frozen_get_cli.js');
const fixture = new FrozenGetFixture();
try {
  const ref = 'refs/branch-metadata/child';
  const beforeOid = fixture.git(fixture.consumer, 'rev-parse', ref);
  const before = JSON.parse(fixture.git(fixture.consumer, 'show', ref));
  fs.writeFileSync(fixture.prs, JSON.stringify({parent: 'main', child: 'main'}));
  fixture.git(fixture.producer, 'switch', 'child');
  const incoming = fixture.commit(fixture.producer, 'child-next.txt', 'new child content');
  fixture.git(fixture.producer, 'push', 'origin', 'child');
  fs.writeFileSync(path.join(fixture.consumer, '.git/hooks/reference-transaction'), '#!/bin/sh\nupdates=$(cat)\nif [ "$1" = committed ] && printf "%s" "$updates" | grep -q "refs/branch-metadata/child$" && [ ! -f .git/metadata-publication-once ]; then\n  touch .git/metadata-publication-once\n  git -c core.hooksPath=/dev/null update-ref '+ref+' '+beforeOid+'\nfi\n', {mode: 0o755});
  const result = fixture.run(['get', 'child', '--force', '--downstack', '--no-restack']);
  const afterOid = fixture.git(fixture.consumer, 'rev-parse', ref);
  const after = JSON.parse(fixture.git(fixture.consumer, 'show', ref));
  const receipt = {
    build: 'get-updates-75 at 1eac93a8d4922a7a923af921a535417f32394fc4',
    serviceBoundary: 'real local Git and bare remote; controlled gh; no live writes',
    beforeOid, before, plannedParent: 'main', incoming, result, afterOid, after,
    hookExecuted: fs.existsSync(path.join(fixture.consumer, '.git/metadata-publication-once')),
    childHead: fixture.git(fixture.consumer, 'rev-parse', 'child'),
  };
  receipt.successWithWrongParent = receipt.hookExecuted && result.status === 0 && after.parentBranchName !== receipt.plannedParent;
  fs.writeFileSync(path.join(__dirname, 'probe-post-metadata.json'), JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(JSON.stringify({status: result.status, hookExecuted: receipt.hookExecuted, successWithWrongParent: receipt.successWithWrongParent, actualParent: after.parentBranchName}) + '\n');
} finally {
  fixture.cleanup();
}
