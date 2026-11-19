const fs = require('node:fs');
const path = require('node:path');
const root = '/private/tmp/anthracite-stable-080-20261116/source/apps/cli/dist/test';
const { RelationCliFixture } = require(root + '/lib/fixtures/relation_cli.js');
const { prepareLand } = require(root + '/lib/fixtures/land_gh.js');
const fixture = new RelationCliFixture();
fixture.commandTimeoutMs = 180000;
const github = prepareLand(fixture);
const results = {};
const run = (name, args) => {
 const x = fixture.run(args);
 results[name] = {status:x.status,stdout:x.stdout,stderr:x.stderr};
 fs.writeFileSync('/private/tmp/anthracite-204-205/results.json', JSON.stringify(results,null,2));
 return x;
};
try {
 const clone=path.join(fixture.root,'independent');
 fixture.git(['clone',github.remote,clone]);
 fixture.git(['switch','main'],clone);
 fs.writeFileSync(path.join(clone,'child.txt'),'independent trunk change\n');
 fixture.git(['add','child.txt'],clone);
 fixture.git(['commit','-m','Independent trunk change'],clone);
 fixture.git(['push','origin','main'],clone);
 results.localTrunk=fixture.git(['rev-parse','main']);
 results.remoteTrunk=fixture.git(['rev-parse','main'],github.remote);
 const before=fixture.inspectionSnapshot();
 run('preview',['land','tip','--dry-run']);
 results.previewPreserved = JSON.stringify(before)===JSON.stringify(fixture.inspectionSnapshot());
 run('application',['land','tip','--yes','--wait-timeout','0']);
 results.conflicts=fixture.git(['diff','--name-only','--diff-filter=U']);
 results.prsAfterFailure=JSON.parse(fs.readFileSync(github.state,'utf8')).map(p=>({number:p.number,state:p.state}));
 if(results.conflicts) {
  fs.writeFileSync(path.join(fixture.repo,'child.txt'),'resolved child\n');
  fixture.git(['add','child.txt']);
  run('continue',['continue']);
  run('pendingPreview',['land','tip','--dry-run']);
  run('resume',['land','tip','--yes','--wait-timeout','0']);
 }
 results.finalPrs=JSON.parse(fs.readFileSync(github.state,'utf8')).map(p=>({number:p.number,state:p.state}));
 fs.writeFileSync('/private/tmp/anthracite-204-205/results.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v&&typeof v==='object'&&'status' in v?{status:v.status}:v])),null,2));
} finally {fixture.cleanup();}
