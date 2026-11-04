const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const shim = require("./fixtures/release-gh.cjs");
function preparedAssets() {
  const bytes = Buffer.from("Synthetic tested-artifact boundary fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entries = Object.fromEntries(
    ["scripts/release-services.cjs", ".github/workflows/release.yml"].map(
      (name) => [name, { mode: "100644", type: "blob" }]
    )
  );
  const intent = {
    schema: 1,
    package: "@danielbaars/anthracite",
    repository: "danielbaars/anthracite",
    channel: "beta",
    version: "0.7.0-beta.1",
    targetVersion: "0.7.0",
    distTag: "beta",
    source: {
      commit: "a".repeat(40),
      normalized: { rule: "anthracite-source-v1", sha256: "0".repeat(64) },
    },
    dispatcher: {
      commit: "a".repeat(40),
      entries,
      files: Object.fromEntries(
        Object.keys(entries).map((name) => [name, "0".repeat(64)])
      ),
    },
    artifact: {
      filename: "danielbaars-anthracite.tgz",
      size: bytes.length,
      sha256,
      integrity:
        "sha512-" + createHash("sha512").update(bytes).digest("base64"),
    },
    tests: {
      passed: true,
      checks: [
        "locked-install",
        "build-lint",
        "typecheck",
        "curated-tarball",
        "isolated-install",
        "commands-completion-MCP",
      ],
    },
    run: { id: "1234", attempt: "1", actor: "release-test" },
    tools: { node: "24.19.0", yarn: "3.2.1", bun: "1.3.14", npm: "11.17.0" },
    platform: { platform: "linux", arch: "x64", runner: "test" },
    transformation: {
      path: "apps/cli/package.json",
      from: "0.6.9",
      to: "0.7.0-beta.1",
    },
    before: { latest: "0.6.9", beta: null, latestIntegrity: "sha512-stable" },
  };
  return {
    "intent.json": JSON.stringify(intent),
    "danielbaars-anthracite.tgz": bytes.toString(),
    SHA256SUMS: `${sha256}  danielbaars-anthracite.tgz\n`,
    "tests.json": JSON.stringify(intent.tests),
  };
}
test("durable adapter never recreates missing releases on append and preserves conflicting assets", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-release-adapter-")
  );
  try {
    fs.writeFileSync(path.join(temporary, "gh"), shim, { mode: 0o755 });
    const statePath = path.join(temporary, "state.json");
    const invoke = (state, request) => {
      fs.writeFileSync(
        statePath,
        JSON.stringify({ calls: [], uploads: 0, assets: {}, ...state })
      );
      fs.writeFileSync(
        path.join(temporary, "request.json"),
        JSON.stringify(request)
      );
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `const fs=require('node:fs');const value=JSON.parse(fs.readFileSync(process.argv[1]));value.assets=Object.fromEntries(Object.entries(value.assets).map(([name,bytes])=>[name,Buffer.from(bytes)]));require(process.argv[2]).services().github.retain(value).catch(error=>{console.error(error.message);process.exitCode=1});`,
          path.join(temporary, "request.json"),
          path.join(root, "scripts/release-services.cjs"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: temporary + path.delimiter + process.env.PATH,
            RELEASE_SERVICE_STATE: statePath,
          },
        }
      );
      return { result, state: JSON.parse(fs.readFileSync(statePath)) };
    };
    const request = {
      tag: "v0.7.0-beta.1",
      source: "a".repeat(40),
      prerelease: true,
      assets: { "verification-1234-1.json": "observed" },
    };
    for (const [changes, pattern] of [
      [{}, /append-only retention cannot recreate/],
      [{ prerelease: false }, /Existing stable GitHub release required/],
      [
        { initialRetention: true },
        /Initial retention requires complete intent/,
      ],
    ]) {
      const answer = invoke({}, { ...request, ...changes });
      assert.notEqual(answer.result.status, 0);
      assert.match(answer.result.stderr, pattern);
      assert.equal(answer.state.uploads, 0);
      assert.ok(answer.state.calls.every((args) => args[0] === "api"));
    }
    const conflict = invoke(
      {
        release: true,
        assets: { "intent.json": Buffer.from("original").toString("base64") },
      },
      { ...request, assets: { "intent.json": "changed" } }
    );
    assert.notEqual(conflict.result.status, 0);
    assert.match(conflict.result.stderr, /Conflicting durable intent/);
    assert.equal(conflict.state.uploads, 0);
    assert.equal(
      Buffer.from(conflict.state.assets["intent.json"], "base64").toString(),
      "original"
    );
    const appended = invoke({ release: true }, request);
    assert.equal(appended.result.status, 0, appended.result.stderr);
    assert.equal(appended.state.uploads, 1);
    const moved = invoke({ release: true, changeAfterUpload: true }, request);
    assert.notEqual(moved.result.status, 0);
    assert.equal(moved.state.uploads, 1);
    assert.ok(
      moved.state.calls
        .filter((args) => args[0] !== "api")
        .every((args) => args[1] === "upload")
    );
    const prepared = preparedAssets();
    const created = invoke(
      { staleList: true },
      { ...request, initialRetention: true, assets: prepared }
    );
    assert.equal(created.result.status, 0, created.result.stderr);
    assert.equal(created.state.creates, 1);
    assert.equal(created.state.uploads, 4);
    for (const [name, contents] of Object.entries(prepared))
      assert.equal(
        Buffer.from(created.state.assets[name], "base64").toString(),
        contents
      );
    const delayed = invoke(
      { staleList: true, directLag: 2 },
      { ...request, initialRetention: true, assets: prepared }
    );
    assert.equal(delayed.result.status, 0, delayed.result.stderr);
    assert.equal(delayed.state.creates, 1);
    assert.equal(delayed.state.uploads, 4);
    const assetsDelayed = invoke(
      { staleList: true, assetLag: 2 },
      { ...request, initialRetention: true, assets: prepared }
    );
    assert.equal(assetsDelayed.result.status, 0, assetsDelayed.result.stderr);
    assert.equal(assetsDelayed.state.creates, 1);
    assert.equal(assetsDelayed.state.uploads, 4);
    for (const lag of [{ directLag: 100 }, { assetLag: 100 }]) {
      const unavailable = invoke(
        { staleList: true, ...lag },
        { ...request, initialRetention: true, assets: prepared }
      );
      assert.notEqual(unavailable.result.status, 0);
      assert.match(
        unavailable.result.stderr,
        /Release evidence is not yet readable/
      );
      assert.doesNotMatch(unavailable.result.stderr, /Cannot read properties/);
      assert.equal(unavailable.state.creates, 1);
      assert.equal(unavailable.state.uploads, lag.directLag ? 0 : 4);
    }
    for (const refusal of [{ forbidden: true }, { inventoryForbidden: true }]) {
      const forbidden = invoke(refusal, {
        ...request,
        initialRetention: true,
        assets: prepared,
      });
      assert.notEqual(forbidden.result.status, 0);
      assert.match(forbidden.result.stderr, /HTTP 403/);
      assert.equal(forbidden.state.creates || 0, 0);
      assert.equal(forbidden.state.uploads, 0);
    }
    const foreign = invoke({ release: true, tag: "v9.0.0" }, request);
    assert.notEqual(foreign.result.status, 0);
    assert.match(foreign.result.stderr, /Release tag identity differs/);
    assert.equal(foreign.state.uploads, 0);
    const appendUncertain = invoke({ release: true, assetLag: 100 }, request);
    assert.notEqual(appendUncertain.result.status, 0);
    assert.match(
      appendUncertain.result.stderr,
      /Inspect release and npm state/
    );
    assert.doesNotMatch(
      appendUncertain.result.stderr,
      /publication was not attempted/
    );
    assert.equal(appendUncertain.state.creates || 0, 0);
    assert.equal(appendUncertain.state.uploads, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
