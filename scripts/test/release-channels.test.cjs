const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");
const node = process.execPath;
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

// The driver executes the real release process. Only remote services are controlled.
const driver = `const fs=require('node:fs');const p=process.argv[2];const input=JSON.parse(fs.readFileSync(p));const remote=JSON.parse(fs.readFileSync(input.remote));const assets={};require(${JSON.stringify(
  path.join(root, "scripts/release-channels.cjs")
)}).runRelease(input.request,{registry:{snapshot:async()=>remote.registry},github:{repository:async()=>({full_name:'danielbaars/anthracite',default_branch:'main'}),main:async()=>remote.main,tag:async()=>null,release:async()=>null,retain:async value=>{fs.mkdirSync(input.evidence,{recursive:true});fs.writeFileSync(input.evidence+'/release.json',JSON.stringify({...value,assets:Object.keys(value.assets)}));for(const [name,bytes]of Object.entries(value.assets))fs.writeFileSync(input.evidence+'/'+name,bytes);}}}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1});`;

function fixture() {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-release-test-")
  );
  const checkout = path.join(temp, "source");
  execFileSync("git", ["clone", "--no-hardlinks", root, checkout], {
    stdio: "ignore",
  });
  for (const name of ["release-channels.cjs", "release-services.cjs"]) {
    const file = path.join(root, "scripts", name);
    if (fs.existsSync(file))
      fs.copyFileSync(file, path.join(checkout, "scripts", name));
  }
  git(checkout, "add", "scripts");
  git(
    checkout,
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "Test release process"
  );
  const source = git(checkout, "rev-parse", "HEAD");
  fs.writeFileSync(
    path.join(temp, "remote.json"),
    JSON.stringify({
      main: source,
      registry: {
        name: "@danielbaars/anthracite",
        "dist-tags": { latest: "0.6.9" },
        versions: {
          "0.6.9": {
            name: "@danielbaars/anthracite",
            version: "0.6.9",
            dist: { integrity: "sha512-verified-stable" },
          },
        },
      },
    })
  );
  fs.writeFileSync(path.join(temp, "driver.cjs"), driver);
  const request = {
    operation: "prepare-beta",
    repository: "danielbaars/anthracite",
    source,
    version: "0.7.0-beta.1",
    checkout,
    output: path.join(temp, "output"),
    dispatcher: source,
    run: { id: "1234", attempt: "1", actor: "release-test" },
  };
  return {
    temp,
    checkout,
    request,
    run(changes = {}) {
      fs.writeFileSync(
        path.join(temp, "input.json"),
        JSON.stringify({
          request: { ...request, ...changes },
          remote: path.join(temp, "remote.json"),
          evidence: path.join(temp, "evidence"),
        })
      );
      return spawnSync(
        node,
        [path.join(temp, "driver.cjs"), path.join(temp, "input.json")],
        {
          encoding: "utf8",
          timeout: 240000,
          env: { ...process.env, ANTHRACITE_RELEASE_TEST: "1" },
        }
      );
    },
  };
}

test(
  "prepare beta retains a real tested artifact without changing the maintainer checkout",
  { timeout: 300000 },
  () => {
    const f = fixture();
    try {
      const before = git(f.checkout, "status", "--porcelain");
      const result = f.run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const record = JSON.parse(
        fs.readFileSync(path.join(f.temp, "evidence/intent.json"))
      );
      assert.equal(record.version, "0.7.0-beta.1");
      assert.equal(record.channel, "beta");
      assert.equal(record.source.commit, f.request.source);
      assert.equal(record.dispatcher.commit, f.request.dispatcher);
      assert.equal(record.tests.passed, true);
      assert.ok(
        fs.statSync(path.join(f.temp, "evidence/danielbaars-anthracite.tgz"))
          .size > 100000
      );
      assert.equal(git(f.checkout, "status", "--porcelain"), before);
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(f.checkout, "apps/cli/package.json"))
        ).version,
        "0.6.9"
      );
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);

test("preparation rejects invalid versions and source identities before building or retaining evidence", () => {
  const f = fixture();
  try {
    for (const version of [
      "0.7.0",
      "0.7.0-beta.0",
      "0.7.0-beta.01",
      "0.7.0-beta.1+build",
      "0.7.0-rc.1",
      "00.7.0-beta.1",
      "0.6.9-beta.1",
      "$(touch unsafe)",
    ]) {
      const result = f.run({ version });
      assert.notEqual(result.status, 0, version);
      assert.match(
        result.stderr,
        version === "0.6.9-beta.1"
          ? /Target must be newer/
          : /Expected a canonical beta version/
      );
      assert.equal(fs.existsSync(path.join(f.temp, "evidence")), false);
    }
    for (const source of ["main", "HEAD", "a".repeat(40)]) {
      const result = f.run({ source });
      assert.notEqual(result.status, 0, source);
      assert.match(
        result.stderr,
        source.length === 40
          ? /unknown revision|bad revision|ambiguous argument/
          : /Expected immutable source commit/
      );
      assert.equal(fs.existsSync(path.join(f.temp, "evidence")), false);
    }
    assert.notEqual(f.run({ repository: "foreign/anthracite" }).status, 0);
    assert.equal(git(f.checkout, "status", "--porcelain"), "");
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});

test("preparation rejects reused beta sequences and missing latest package identity", () => {
  const f = fixture();
  try {
    const filename = path.join(f.temp, "remote.json");
    const remote = JSON.parse(fs.readFileSync(filename));
    remote.registry.versions["0.7.0-beta.2"] = {};
    fs.writeFileSync(filename, JSON.stringify(remote));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Beta number must advance/);
    delete remote.registry.versions["0.7.0-beta.2"];
    remote.registry.versions["0.6.9"].name = "foreign";
    fs.writeFileSync(filename, JSON.stringify(remote));
    assert.notEqual(f.run().status, 0);
    delete remote.registry["dist-tags"].latest;
    fs.writeFileSync(filename, JSON.stringify(remote));
    assert.notEqual(f.run().status, 0);
    assert.equal(fs.existsSync(path.join(f.temp, "evidence")), false);
    assert.equal(git(f.checkout, "status", "--porcelain"), "");
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});
