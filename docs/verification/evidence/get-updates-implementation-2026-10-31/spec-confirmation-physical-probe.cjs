const fs = require('fs'); const path = require('path');
const {FrozenGetFixture} = require('/private/tmp/anthracite-get-updates-implementation-20261031/worktrees/review-fixes/apps/cli/dist/test/lib/fixtures/frozen_get_cli.js');
const f = new FrozenGetFixture();
try {
 const metadata=f.git(f.consumer,'rev-parse','refs/branch-metadata/child');
 f.git(f.consumer,'switch','-c','inspection','main');
 fs.writeFileSync(f.prs, JSON.stringify({parent:'main',child:'main'}));
 const incoming=f.advanceChild();
 fs.writeFileSync(path.join(f.consumer,'.git','hooks','reference-transaction'), `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = committed ] && printf '%s' "$updates" | grep -q ' 0000000000000000000000000000000000000000 refs/gt-metadata/get/' && [ ! -f .git/cleanup-once ]; then touch .git/cleanup-once; git -c core.hooksPath=/dev/null switch --detach HEAD; fi\n`, {mode:0o755});
 const result=f.run(['get','child','--downstack','--no-restack','--no-checkout','--quiet']);
 console.log(JSON.stringify({runtime:process.env.ANTHRACITE_TEST_BINARY || 'Node WT76 exact production',...result,incoming,actualChild:f.git(f.consumer,'rev-parse','child'),actualCheckout:f.git(f.consumer,'branch','--show-current'),metadataBefore:metadata,metadataAfter:f.git(f.consumer,'rev-parse','refs/branch-metadata/child'),parentAfter:f.ok('info','child').output,recoveryExists:fs.existsSync(path.join(f.consumer,'.git','.gtcontinue'))},null,2));
} finally { f.cleanup(); }
