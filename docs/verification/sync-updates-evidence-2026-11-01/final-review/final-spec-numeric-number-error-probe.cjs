const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = '/private/tmp/anthracite-sync-updates-implementation-20261101';
const wt = path.join(root, 'worktrees/87');
const { FrozenGetFixture } = require(path.join(wt, 'apps/cli/dist/test/lib/fixtures/frozen_get_cli.js'));
const f = new FrozenGetFixture(false);
try {
  f.git(f.producer, 'switch', 'main');
  f.git(f.producer, 'switch', '-c', '123');
  const old = f.commit(f.producer, 'numeric.txt', 'old');
  f.git(f.producer, 'push', 'origin', '123');
  f.git(f.consumer, 'fetch', 'origin', '123');
  f.git(f.consumer, 'branch', '123', 'FETCH_HEAD');
  f.ok('track', '123', '--parent', 'main');
  const incoming = f.commit(f.producer, 'numeric.txt', 'new');
  f.git(f.producer, 'push', 'origin', '123');
  // A real service has open PR #3 on head 123; PR #123 does not exist.
  fs.writeFileSync(f.prs, JSON.stringify({'123':'main'}));
  const stub = path.join(f.bin, 'gh');
  fs.writeFileSync(stub, '#!' + process.execPath + '\n' + `const fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(f.ghCalls)},JSON.stringify(args)+'\\n'); if(args[0]==='pr'&&args[1]==='view'&&args[2]==='123'){process.stderr.write('GraphQL: Could not resolve to a PullRequest with the number of 123. (repository.pullRequest)\\n');process.exit(1);} process.stderr.write('unexpected controlled GitHub request '+JSON.stringify(args));process.exit(2);`, { mode:0o755 });
  const before = f.observe();
  const result = f.run(['sync','--no-pull','--no-delete','--no-restack']);
  const after = f.observe();
  const observed = { sourceHead:'2dc0c3dfe27e83a9b8d3183600e542d7aef80e0f', artifactSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(wt,'apps/cli/dist/src/actions/sync/sync_refresh.js'))).digest('hex'), branch:'123', serviceFixture:{openPr:{number:3,head:'123',base:'main',headOid:incoming},missingPrNumber:123}, old,incoming,result,actual:f.git(f.consumer,'rev-parse','refs/heads/123'),calls:fs.readFileSync(f.ghCalls,'utf8'),before,after,root:f.root};
  fs.writeFileSync(path.join(root,'final-spec-numeric-number-error-probe.json'),JSON.stringify(observed,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,output:result.output,old,incoming,actual:observed.actual,calls:observed.calls,fixture:f.root}));
} finally { /* Retain exact review fixture for inspection. */ }
