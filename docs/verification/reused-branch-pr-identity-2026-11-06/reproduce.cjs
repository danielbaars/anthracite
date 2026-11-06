const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
assert.ok(
  path.isAbsolute(process.env.ANTHRACITE_TEST_BINARY || ""),
  "Supply the absolute installed public 0.6.11 binary"
);
assert.ok(
  path.isAbsolute(process.env.ANTHRACITE_139_FIXTURE_MODULE || ""),
  "Supply the absolute compiled SubmitCliFixture module"
);
assert.ok(
  path.isAbsolute(process.env.ANTHRACITE_139_OUTPUT || ""),
  "Supply the absolute output JSON path"
);
const { SubmitCliFixture } = require(process.env.ANTHRACITE_139_FIXTURE_MODULE);
function fixture() {
  const f = new SubmitCliFixture();
  assert.equal(f.succeed("--version").trim(), "0.6.11");
  const base = f.git("rev-parse", "main");
  f.git("checkout", "-b", "reuse");
  const oldHead = f.commit("historical");
  f.git("checkout", "main");
  f.git("merge", "--squash", "reuse");
  f.git("commit", "-m", "Synthetic squash merge");
  f.git("branch", "-D", "reuse");
  f.git("push", "origin", "main");
  f.branch("reuse", "main");
  const old = {
    number: 890,
    url: "https://github.com/fixture/submit/pull/890",
    headRefName: "reuse",
    baseRefName: "main",
    title: "Historical PR",
    body: "Historical body",
    state: "MERGED",
    isDraft: false,
    reviewDecision: "",
    reviewRequests: [],
    author: { login: "fixture" },
    headRefOid: oldHead,
    baseRefOid: base,
    headRepository: { name: "submit" },
    headRepositoryOwner: { login: "fixture" },
    isCrossRepository: false,
  };
  f.setPrs([old]);
  const original = path.join(f.root, "bin/gh-original.cjs");
  fs.renameSync(path.join(f.root, "bin/gh"), original);
  fs.writeFileSync(
    path.join(f.root, "bin/gh"),
    `#!${
      process.execPath
    }\nconst fs=require('node:fs');const args=process.argv.slice(2);const prs=JSON.parse(fs.readFileSync(process.env.ANTHRACITE_TEST_GH_STATE));const value=flag=>args[args.indexOf(flag)+1];const record=()=>fs.appendFileSync(process.env.ANTHRACITE_TEST_GH_LOG,JSON.stringify(args)+'\\n');const fields=(value('--json')||'').split(',');const pick=pr=>Object.fromEntries(fields.map(k=>[k,pr[k]]));const pr=prs.find(p=>p.headRefName===args[2]||String(p.number)===args[2]);if(args[0]==='pr'&&args[1]==='list'){record();let matches=prs.filter(p=>p.headRefName===value('--head'));if(value('--state')==='open')matches=matches.filter(p=>p.state==='OPEN');console.log(JSON.stringify(matches.map(pick)));}else if(args[0]==='pr'&&args[1]==='view'&&pr){record();console.log(JSON.stringify(pick(pr)));}else if(args[0]==='pr'&&args[1]==='ready'&&pr&&pr.state!=='OPEN'){record();console.error('Pull request #'+pr.number+' is closed. Only draft pull requests can be marked as ready for review');process.exitCode=1;}else{require('node:child_process').execFileSync(process.execPath,[${JSON.stringify(
      original
    )},...args],{stdio:'inherit'});}\n`,
    { mode: 0o755 }
  );
  return { f, old };
}
function seed(f, state) {
  const ref = "refs/branch-metadata/reuse";
  const meta = JSON.parse(f.git("cat-file", "-p", ref));
  meta.prInfo = {
    number: 890,
    url: "https://github.com/fixture/submit/pull/890",
    state,
    base: "main",
  };
  const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: f.repo,
    env: f.env,
    input: JSON.stringify(meta),
    encoding: "utf8",
  }).trim();
  f.git("update-ref", ref, oid);
}
const results = [];
{
  const { f, old } = fixture();
  try {
    const before = f.git("for-each-ref", "refs/branch-metadata");
    const inspection = f.cli("pr", "reuse");
    assert.equal(inspection.status, 0, inspection.stderr);
    assert.ok(inspection.stdout.includes("#890"));
    assert.equal(f.git("for-each-ref", "refs/branch-metadata"), before);
    results.push({
      case: "inspection matches old merged PR on different head",
      status: inspection.status,
      localHead: f.git("rev-parse", "reuse"),
      historicalHead: old.headRefOid,
      showsOldPr: inspection.stdout.includes("#890"),
      writesAssociation: false,
    });
    const submit = f.cli("submit");
    assert.notEqual(submit.status, 0);
    assert.ok(
      submit.stderr.includes("890"),
      submit.stdout + "\n" + submit.stderr
    );
    results.push({
      case: "submit attempts old PR ready transition after pushing reused name",
      status: submit.status,
      stderr: submit.stderr.trim(),
      remoteHeadMatchesNewLocal:
        f.remoteSha("reuse") === f.git("rev-parse", "reuse"),
      readyCalls: f.calls().filter((a) => a[1] === "ready"),
    });
  } finally {
    f.cleanup();
  }
}
{
  const { f, old } = fixture();
  try {
    f.setPrs([
      old,
      {
        ...old,
        number: 891,
        url: "https://github.com/fixture/submit/pull/891",
      },
    ]);
    const r = f.cli("pr", "reuse");
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes("Ambiguous"));
    results.push({
      case: "two historical matches cause ambiguity",
      status: r.status,
      stderr: r.stderr.trim(),
    });
  } finally {
    f.cleanup();
  }
}
for (const associated of [false, true]) {
  const { f } = fixture();
  try {
    if (associated) seed(f, "MERGED");
    const before = f.git("rev-parse", "reuse");
    const r = f.cli("sync", "--no-pull", "--delete-all", "--no-restack");
    const exists = f.git("branch", "--list", "reuse").includes("reuse");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(exists, !associated);
    results.push({
      case: associated
        ? "sync with retained old association"
        : "sync with no stored association",
      status: r.status,
      branchSurvives: exists,
      localHeadBefore: before,
      stdout: r.stdout.trim(),
      stderr: r.stderr.trim(),
    });
  } finally {
    f.cleanup();
  }
}
fs.writeFileSync(
  process.env.ANTHRACITE_139_OUTPUT,
  JSON.stringify(results, null, 2) + "\n"
);
console.log(JSON.stringify(results, null, 2));
