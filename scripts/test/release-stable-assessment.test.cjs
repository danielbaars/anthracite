const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");
const driver = path.join(__dirname, "fixtures/release-stable-driver.cjs");
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

test("stable publication requires its exact version confirmation before external effects", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-stable-input-")
  );
  try {
    const input = path.join(temporary, "input.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        process: path.join(root, "scripts/release-channels.cjs"),
        request: {
          repository: "danielbaars/anthracite",
          operation: "stable",
          version: "0.7.0",
        },
        state: path.join(temporary, "state.json"),
      })
    );
    fs.writeFileSync(
      path.join(temporary, "state.json"),
      JSON.stringify({ writes: [] })
    );
    const result = spawnSync(process.execPath, [driver, input], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stable confirmation must equal/);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(temporary, "state.json"))).writes
        .length,
      0
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function fixture() {
  const temp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "anthracite-stable-test-"))
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
  const commit = (message) => {
    git(checkout, "add", "-A");
    git(
      checkout,
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      message
    );
    return git(checkout, "rev-parse", "HEAD");
  };
  const source = commit("Capture tested release process");
  const state = {
    main: source,
    tags: {},
    releases: {},
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
  const statePath = path.join(temp, "state.json");
  const write = (value) => fs.writeFileSync(statePath, JSON.stringify(value));
  write(state);
  const request = {
    operation: "prepare-beta",
    repository: "danielbaars/anthracite",
    source,
    dispatcher: source,
    version: "0.7.0-beta.1",
    checkout,
    output: path.join(temp, "beta"),
    run: { id: "1234", attempt: "1", actor: "release-test" },
  };
  const invoke = (changes = {}, intent) => {
    const input = path.join(temp, "input.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        process: path.join(checkout, "scripts/release-channels.cjs"),
        request: { ...request, ...changes },
        state: statePath,
        intent,
      })
    );
    return spawnSync(process.execPath, [driver, input], {
      encoding: "utf8",
      timeout: 420000,
      env: process.env,
    });
  };
  return { temp, checkout, state, statePath, write, request, invoke, commit };
}
function statement(intent) {
  return {
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [
      {
        name: `pkg:npm/%40danielbaars/anthracite@${intent.version}`,
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
          { digest: { gitCommit: intent.dispatcher.commit } },
        ],
      },
      runDetails: {
        metadata: {
          invocationId: `https://github.com/danielbaars/anthracite/actions/runs/${intent.run.id}/attempts/${intent.run.attempt}`,
        },
      },
    },
  };
}
function practice(intent, intentSha256) {
  return {
    schema: 1,
    package: "@danielbaars/anthracite",
    repository: "danielbaars/anthracite",
    betaVersion: intent.version,
    source: intent.source.commit,
    artifactIntegrity: intent.artifact.integrity,
    intentSha256,
    startedAt: "2026-11-02T09:00:00Z",
    endedAt: "2026-11-04T09:00:00Z",
    workingDays: 2,
    platform: { os: "darwin", arch: "arm64", node: "24.19.0" },
    rewritesChanged: false,
    scenarios: [
      {
        id: "synthetic-stacks",
        outcome: "passed",
        performedAt: "2026-11-02T09:00:00Z",
        notes: "Synthetic parent/child fixture exercised.",
      },
      {
        id: "daily-use",
        outcome: "passed",
        performedAt: "2026-11-04T09:00:00Z",
        notes: "Summarized personal use; no private project contents.",
      },
      ...[
        "merged-parent-unpublished-work",
        "trunk-advance",
        "conflict-continuation",
        "interruption-resumption",
      ].map((id) => ({
        id,
        outcome: "not-applicable",
        reason:
          "Only release orchestration changed; Git rewrite implementation is unchanged.",
      })),
    ],
    findings: [],
    maintainer: {
      login: "release-test",
      disposition: "approved",
      notes: "Scenarios reviewed for this exact candidate.",
    },
  };
}

test(
  "stable assessment accepts version-only promotion and refuses untested inputs without publication",
  { timeout: 900000 },
  () => {
    const f = fixture();
    try {
      const prepared = f.invoke();
      assert.equal(prepared.status, 0, prepared.stderr);
      const intentBytes = fs.readFileSync(
        path.join(f.request.output, "intent.json")
      );
      const intent = JSON.parse(intentBytes);
      const { createHash } = require("node:crypto");
      const digest = createHash("sha256").update(intentBytes).digest("hex");
      let state = JSON.parse(fs.readFileSync(f.statePath));
      state.statement = statement(intent);
      f.write(state);
      const published = f.invoke({ operation: "beta" }, intent);
      assert.equal(published.status, 0, published.stderr);
      const manifestPath = path.join(f.checkout, "apps/cli/package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      manifest.version = "0.7.0";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      const trackingPath = path.join(
        f.checkout,
        ".release-please-manifest.json"
      );
      const tracking = JSON.parse(fs.readFileSync(trackingPath));
      tracking["apps/cli"] = "0.7.0";
      fs.writeFileSync(trackingPath, JSON.stringify(tracking, null, 2) + "\n");
      fs.appendFileSync(
        path.join(f.checkout, "apps/cli/CHANGELOG.md"),
        "\n## 0.7.0\n\nCandidate promoted after practice.\n"
      );
      const stable = f.commit("Prepare stable version and changelog only");
      git(f.checkout, "tag", "v0.7.0", stable);
      state = JSON.parse(fs.readFileSync(f.statePath));
      state.main = stable;
      state.tags["v0.7.0"] = stable;
      state.releases["v0.7.0"] = {
        tag: "v0.7.0",
        source: stable,
        prerelease: false,
        assets: {},
      };
      state.practiceReference = "release:v0.7.0-beta.1/practice.json";
      state.practice = practice(intent, digest);
      f.write(state);
      const input = {
        operation: "assess-stable",
        source: stable,
        dispatcher: stable,
        version: "0.7.0",
        tag: "v0.7.0",
        betaVersion: "0.7.0-beta.1",
        practice: state.practiceReference,
        confirmation: "0.7.0",
        output: path.join(f.temp, "assessment"),
        run: { id: "2345", attempt: "1", actor: "release-test" },
      };
      const before = git(f.checkout, "show-ref");
      const result = f.invoke(input);
      assert.equal(result.status, 0, result.stderr);
      const decision = JSON.parse(result.stdout);
      assert.equal(decision.status, "assessed");
      assert.equal(decision.sourceEquivalent, true);
      assert.equal(decision.beta.version, "0.7.0-beta.1");
      assert.equal(decision.approval.actor, "release-test");
      assert.equal(decision.npmWrites, 0);
      assert.equal(git(f.checkout, "show-ref"), before);
      assert.equal(git(f.checkout, "status", "--porcelain"), "");
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      const baseline = JSON.parse(fs.readFileSync(f.statePath));
      const newerBeta = JSON.parse(JSON.stringify(baseline));
      newerBeta.registry["dist-tags"].beta = "0.7.0-beta.2";
      newerBeta.registry.versions["0.7.0-beta.2"] = {
        name: "@danielbaars/anthracite",
        version: "0.7.0-beta.2",
        dist: { integrity: "sha512-newer-beta" },
      };
      f.write(newerBeta);
      const selectedOlder = f.invoke({
        ...input,
        output: path.join(f.temp, "selected-older"),
      });
      assert.equal(selectedOlder.status, 0, selectedOlder.stderr);
      assert.equal(
        JSON.parse(selectedOlder.stdout).beta.version,
        "0.7.0-beta.1"
      );
      const refuse = (changes, mutate, reason) => {
        const remote = JSON.parse(JSON.stringify(baseline));
        mutate(remote);
        f.write(remote);
        const answer = f.invoke({
          ...input,
          output: path.join(f.temp, "refused"),
          ...changes,
        });
        assert.notEqual(answer.status, 0, answer.stdout);
        assert.match(answer.stderr, reason);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      };
      refuse({ confirmation: "0.8.0" }, () => {}, /confirmation/);
      refuse({ version: "0.7.0-beta.1" }, () => {}, /canonical stable/);
      refuse({ betaVersion: "0.8.0-beta.1" }, () => {}, /target/);
      refuse(
        { practice: "https://foreign.invalid/practice.json" },
        () => {},
        /practice evidence reference/
      );
      refuse(
        {},
        (s) => {
          s.practice.betaVersion = "0.7.0-beta.2";
        },
        /candidate/
      );
      refuse(
        {},
        (s) => {
          s.practice.findings = [
            {
              id: "loss",
              blocking: true,
              resolved: false,
              disposition: "Investigating",
            },
          ];
        },
        /blocking finding/
      );
      refuse(
        {},
        (s) => {
          s.practice.scenarios = s.practice.scenarios.filter(
            (x) => x.id !== "conflict-continuation"
          );
        },
        /scenario/
      );
      refuse(
        {},
        (s) => {
          s.practice.scenarios.find(
            (x) => x.outcome === "not-applicable"
          ).reason = "";
        },
        /reason/
      );
      refuse(
        {},
        (s) => {
          s.practice.workingDays = 1;
          s.practice.endedAt = "2026-11-03T09:00:00Z";
          s.practice.scenarios[1].performedAt = s.practice.endedAt;
        },
        /shorter practice/
      );
      refuse(
        {},
        (s) => {
          s.invalidSignature = true;
        },
        /signatures/
      );
      refuse(
        {},
        (s) => {
          delete s.releases["v0.7.0-beta.1"].assets["verification-1234-1.json"];
        },
        /verified beta record/
      );
      refuse(
        {},
        (s) => {
          s.tags["v0.7.0-beta.1"] = "a".repeat(40);
        },
        /beta tag/
      );
      for (const [name, mutate, reason] of [
        [
          "CLI code",
          () =>
            fs.appendFileSync(
              path.join(f.checkout, "apps/cli/src/index.ts"),
              "\n// Untested code input.\n"
            ),
          /Source differs/,
        ],
        [
          "packaging",
          () =>
            fs.appendFileSync(
              path.join(f.checkout, "scripts/build-npm-package.cjs"),
              "\n// Untested package input.\n"
            ),
          /Source differs/,
        ],
        [
          "dependency field",
          () => {
            const value = JSON.parse(fs.readFileSync(manifestPath));
            value.dependencies.chalk = "9.9.9";
            fs.writeFileSync(
              manifestPath,
              JSON.stringify(value, null, 2) + "\n"
            );
          },
          /Source differs/,
        ],
        [
          "extra tracked file",
          () =>
            fs.writeFileSync(
              path.join(f.checkout, "extra-release-input.txt"),
              "untested\n"
            ),
          /Source differs/,
        ],
        [
          "test input",
          () =>
            fs.appendFileSync(
              path.join(f.checkout, "scripts/test-npm-package.cjs"),
              "\n// Untested input.\n"
            ),
          /Source differs/,
        ],
        [
          "lockfile",
          () =>
            fs.appendFileSync(
              path.join(f.checkout, "yarn.lock"),
              "\n# Untested lockfile.\n"
            ),
          /Source differs/,
        ],
        [
          "file mode",
          () => fs.chmodSync(path.join(f.checkout, "README.md"), 0o755),
          /Source differs/,
        ],
        [
          "file type",
          () => {
            fs.unlinkSync(path.join(f.checkout, "README.md"));
            fs.symlinkSync("CREDITS.md", path.join(f.checkout, "README.md"));
          },
          /Source differs/,
        ],
        [
          "dispatcher workflow",
          () =>
            fs.appendFileSync(
              path.join(f.checkout, ".github/workflows/release.yml"),
              "\n# Untested dispatcher\n"
            ),
          /dispatcher.*differs|Dispatcher.*differs/,
        ],
        [
          "tool pin",
          () => fs.writeFileSync(path.join(f.checkout, ".nvmrc"), "24.20.0\n"),
          /Source differs/,
        ],
      ]) {
        git(f.checkout, "checkout", "--detach", stable);
        mutate();
        const changed = f.commit(`Change ${name}`);
        const remote = JSON.parse(JSON.stringify(baseline));
        remote.main = changed;
        remote.tags["v0.7.0"] = changed;
        remote.releases["v0.7.0"].source = changed;
        f.write(remote);
        const answer = f.invoke({
          ...input,
          source: changed,
          dispatcher: changed,
          output: path.join(f.temp, "drift"),
        });
        assert.notEqual(answer.status, 0, answer.stdout);
        assert.match(answer.stderr, reason, name);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
        git(f.checkout, "checkout", "--detach", stable);
      }
      const workflow = path.join(f.checkout, ".github/workflows/release.yml");
      fs.appendFileSync(workflow, "\n# Changed actual dispatcher only\n");
      const dispatcher = f.commit(
        "Change actual dispatcher while selecting old stable tag"
      );
      const remote = JSON.parse(JSON.stringify(baseline));
      remote.main = dispatcher;
      f.write(remote);
      const hidden = f.invoke({
        ...input,
        dispatcher,
        output: path.join(f.temp, "hidden"),
      });
      assert.notEqual(hidden.status, 0);
      assert.match(hidden.stderr, /dispatcher.*differs|Dispatcher.*differs/);
      git(f.checkout, "checkout", "--detach", stable);
      const short = JSON.parse(JSON.stringify(baseline));
      short.practice.workingDays = 1;
      short.practice.endedAt = "2026-11-03T09:00:00Z";
      short.practice.scenarios[1].performedAt = short.practice.endedAt;
      short.practice.shorterPeriodJustification =
        "Release-only changes; complete synthetic and local operator checks reviewed explicitly.";
      f.write(short);
      const shortened = f.invoke({
        ...input,
        output: path.join(f.temp, "shortened"),
      });
      assert.equal(shortened.status, 0, shortened.stderr);
      assert.equal(git(f.checkout, "status", "--porcelain"), "");
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);
