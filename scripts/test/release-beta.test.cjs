const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const driver = path.join(__dirname, "fixtures/release-beta-driver.cjs");
function fixture() {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-beta-publish-test-")
  );
  const checkout = path.join(temp, "source");
  execFileSync("git", ["clone", "--no-hardlinks", root, checkout], {
    stdio: "ignore",
  });
  for (const name of fs
    .readdirSync(path.join(root, "scripts"))
    .filter((name) => /^release.*\.cjs$/.test(name)))
    fs.copyFileSync(
      path.join(root, "scripts", name),
      path.join(checkout, "scripts", name)
    );
  fs.copyFileSync(
    driver,
    path.join(checkout, "scripts/test/fixtures/release-beta-driver.cjs")
  );
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
    "Capture release process"
  );
  const source = git(checkout, "rev-parse", "HEAD");
  const state = {
    main: source,
    writes: [],
    registry: {
      name: "@danielbaars/anthracite",
      "dist-tags": { latest: "0.6.9" },
      versions: {
        "0.6.9": {
          name: "@danielbaars/anthracite",
          version: "0.6.9",
          dist: { integrity: "sha512-stable" },
        },
      },
    },
  };
  const request = {
    operation: "prepare-beta",
    repository: "danielbaars/anthracite",
    source,
    dispatcher: source,
    version: "0.7.0-beta.1",
    checkout,
    output: path.join(temp, "output"),
    run: { id: "1234", attempt: "1", actor: "release-test" },
  };
  const statePath = path.join(temp, "state.json");
  const invoke = (changes = {}, intent) => {
    fs.writeFileSync(
      path.join(temp, "input.json"),
      JSON.stringify({
        process: path.join(checkout, "scripts/release-channels.cjs"),
        request: { ...request, ...changes },
        state: statePath,
        intent,
      })
    );
    return spawnSync(
      process.execPath,
      [
        path.join(checkout, "scripts/test/fixtures/release-beta-driver.cjs"),
        path.join(temp, "input.json"),
      ],
      { encoding: "utf8", timeout: 300000, env: process.env }
    );
  };
  const write = (value) => fs.writeFileSync(statePath, JSON.stringify(value));
  write(state);
  return { temp, checkout, statePath, state, request, invoke, write };
}
test(
  "beta publication uses the exact prepared artifact, preserves latest and refuses unsafe retained evidence",
  { timeout: 360000 },
  () => {
    const f = fixture();
    try {
      const prepared = f.invoke();
      assert.equal(prepared.status, 0, prepared.stderr);
      const intent = JSON.parse(
        fs.readFileSync(path.join(f.request.output, "intent.json"))
      );
      const before = JSON.parse(fs.readFileSync(f.statePath));
      before.snapshots = 0;
      before.statement = {
        predicateType: "https://slsa.dev/provenance/v1",
        subject: [
          {
            name: "pkg:npm/%40danielbaars/anthracite@0.7.0-beta.1",
            digest: {
              sha512: Buffer.from(
                intent.artifact.integrity.slice(7),
                "base64"
              ).toString("hex"),
            },
          },
        ],
        predicate: {
          buildDefinition: {
            externalParameters: {
              workflow: {
                ref: "refs/heads/main",
                repository: "https://github.com/danielbaars/anthracite",
                path: ".github/workflows/release.yml",
              },
            },
            resolvedDependencies: [
              { digest: { gitCommit: f.request.dispatcher } },
            ],
          },
          runDetails: {
            metadata: {
              invocationId:
                "https://github.com/danielbaars/anthracite/actions/runs/1234/attempts/1",
            },
          },
        },
      };
      const original = Object.fromEntries(
        [
          "intent.json",
          "danielbaars-anthracite.tgz",
          "SHA256SUMS",
          "tests.json",
        ].map((name) => [
          name,
          fs.readFileSync(path.join(f.request.output, name)),
        ])
      );
      const refuse = (changes, mutate, reason) => {
        const state = JSON.parse(JSON.stringify(before));
        for (const [name, bytes] of Object.entries(original))
          fs.writeFileSync(path.join(f.request.output, name), bytes);
        mutate(state);
        f.write(state);
        const result = f.invoke({ operation: "beta", ...changes }, intent);
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, reason);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      };
      refuse({ channel: "latest" }, () => {}, /Wrong beta channel/);
      refuse({ version: "0.7.0" }, () => {}, /canonical beta version/);
      refuse(
        {},
        () =>
          fs.appendFileSync(
            path.join(f.request.output, "danielbaars-anthracite.tgz"),
            "changed"
          ),
        /disagree|checksum/
      );
      refuse(
        {},
        (state) => {
          state.tag = "a".repeat(40);
        },
        /tag changed source|tag moved/
      );
      const partial = structuredClone(before);
      delete partial.release.assets["tests.json"];
      f.write(partial);
      const recovered = f.invoke();
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.ok(
        JSON.parse(fs.readFileSync(f.statePath)).release.assets["tests.json"]
      );
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      refuse(
        {},
        (state) => {
          state.mutateArtifactBeforeWrite = true;
        },
        /checksum changed/
      );
      refuse(
        {},
        (state) => {
          const bad = { ...intent, tests: { passed: false } };
          const bytes = Buffer.from(JSON.stringify(bad));
          fs.writeFileSync(path.join(f.request.output, "intent.json"), bytes);
          state.release.assets["intent.json"] = bytes.toString("base64");
        },
        /false.*true|false !== true/
      );
      for (const [name, bytes] of Object.entries(original))
        fs.writeFileSync(path.join(f.request.output, name), bytes);
      f.write(before);
      const result = f.invoke({ operation: "beta" }, intent);
      assert.equal(result.status, 0, result.stderr);
      const after = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(after.writes.length, 1);
      assert.equal(after.writes[0].channel, "beta");
      assert.equal(after.registry["dist-tags"].latest, "0.6.9");
      assert.equal(
        after.writes[0].bytes,
        fs
          .readFileSync(
            path.join(f.request.output, "danielbaars-anthracite.tgz")
          )
          .toString("base64")
      );
      const proof = JSON.parse(
        Buffer.from(after.release.assets["verification-1234-1.json"], "base64")
      );
      assert.equal(proof.status, "verified");
      assert.equal(proof.version, "0.7.0-beta.1");
      for (const [flag, reason] of [
        ["moveLatest", /Latest moved/],
        ["invalidSignature", /signatures and attestations/],
        ["foreignSigner", /signer is not the trusted release workflow/],
      ]) {
        const state = JSON.parse(JSON.stringify(before));
        for (const name of fs.readdirSync(f.request.output))
          if (/^(attempt|verification|observation)-/.test(name))
            fs.rmSync(path.join(f.request.output, name));
        state[flag] = true;
        f.write(state);
        const uncertain = f.invoke({ operation: "beta" }, intent);
        assert.notEqual(uncertain.status, 0);
        assert.match(uncertain.stderr, reason);
        const refusedState = JSON.parse(fs.readFileSync(f.statePath));
        assert.equal(refusedState.writes.length, 1);
        assert.equal(
          refusedState.release.assets["verification-1234-1.json"],
          undefined
        );
        assert.equal(
          fs.existsSync(
            path.join(f.request.output, "verification-1234-1.json")
          ),
          false
        );
      }
      assert.equal(git(f.checkout, "status", "--porcelain"), "");
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);

test("an unprepared beta publication refuses before any registry write", () => {
  const f = fixture();
  try {
    const result = f.invoke({ operation: "beta" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retained beta intent/i);
    assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});

test(
  "a failed actual build leaves no publishable intent or registry write",
  { timeout: 180000 },
  () => {
    const f = fixture();
    try {
      const filename = path.join(f.checkout, "apps/cli/package.json");
      const manifest = JSON.parse(fs.readFileSync(filename));
      manifest.scripts.build = "node -e 'process.exit(23)'";
      fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + "\n");
      git(f.checkout, "add", "apps/cli/package.json");
      git(
        f.checkout,
        "-c",
        "user.name=Release test",
        "-c",
        "user.email=release@example.invalid",
        "commit",
        "-m",
        "Fail the actual build"
      );
      const source = git(f.checkout, "rev-parse", "HEAD");
      f.state.main = source;
      f.write(f.state);
      const result = f.invoke({ source, dispatcher: source });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Release build\/install gate failed/);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      assert.equal(
        fs.existsSync(path.join(f.request.output, "intent.json")),
        false
      );
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);
