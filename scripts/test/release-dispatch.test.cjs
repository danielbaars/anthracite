const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");

test("manual entry refuses automatic events before release effects", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-dispatch-")
  );
  try {
    const event = path.join(temporary, "event.json");
    fs.writeFileSync(event, JSON.stringify({ inputs: { operation: "beta" } }));
    for (const name of ["push", "pull_request", "release", "unknown"]) {
      const result = spawnSync(
        process.execPath,
        [path.join(root, "scripts/release-dispatch.cjs")],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: name,
            GITHUB_EVENT_PATH: event,
          },
        }
      );
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /Release refused: Manual workflow_dispatch required/
      );
      assert.deepEqual(fs.readdirSync(temporary), ["event.json"]);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

const {
  fixture,
  git,
  practice,
} = require("./fixtures/release-stable-setup.cjs");
function dispatchFixture() {
  const f = fixture();
  fs.copyFileSync(
    path.join(root, ".github/workflows/release.yml"),
    path.join(f.checkout, ".github/workflows/release.yml")
  );
  const source = f.commit("Capture actual workflow dispatcher");
  f.request.source = source;
  f.request.dispatcher = source;
  f.state.main = source;
  f.write(f.state);
  const eventPath = path.join(f.temp, "event.json");
  const inputs = {
    operation: "beta",
    beta_source: source,
    beta_version: "0.7.0-beta.1",
    stable_tag: "",
    practice: "",
    confirmation: "",
  };
  const event = {
    inputs,
    repository: { full_name: "danielbaars/anthracite", default_branch: "main" },
    sender: { login: "original-maintainer" },
  };
  const environment = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "danielbaars/anthracite",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: source,
    GITHUB_WORKFLOW_SHA: source,
    GITHUB_WORKFLOW_REF:
      "danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main",
    GITHUB_RUN_ID: "3456",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_ACTOR: "original-maintainer",
    GITHUB_TRIGGERING_ACTOR: "release-test",
    GITHUB_WORKSPACE: f.checkout,
    RUNNER_TEMP: f.temp,
    NPM_TRUSTED_PUBLISHING: "true",
  };
  let count = 0;
  const invoke = (
    inputChanges = {},
    environmentChanges = {},
    eventChanges = {}
  ) => {
    count++;
    const selected = { ...inputs, ...inputChanges };
    fs.writeFileSync(
      eventPath,
      JSON.stringify({ ...event, inputs: selected, ...eventChanges })
    );
    const version = ["stable", "patch"].includes(selected.operation)
      ? selected.stable_tag.slice(1)
      : selected.beta_version;
    const input = path.join(f.temp, "dispatch-input.json");
    const output = path.join(f.temp, `release-${version}`);
    const env = { ...process.env, ...environment, ...environmentChanges };
    fs.writeFileSync(
      input,
      JSON.stringify({
        dispatch: true,
        process: path.join(f.checkout, "scripts/release-dispatch.cjs"),
        state: f.statePath,
        request: {
          ...f.request,
          output,
          version,
          dispatcher: env.GITHUB_SHA,
          run: {
            id: env.GITHUB_RUN_ID,
            attempt: env.GITHUB_RUN_ATTEMPT,
            actor: env.GITHUB_TRIGGERING_ACTOR,
          },
        },
      })
    );
    const start = performance.now();
    const result = spawnSync(
      process.execPath,
      [
        path.join(
          f.checkout,
          "scripts/test/fixtures/release-stable-driver.cjs"
        ),
        input,
      ],
      { encoding: "utf8", env, timeout: 420000 }
    );
    console.log(
      `Dispatch process ${count} ${selected.operation}: ${(
        performance.now() - start
      ).toFixed(0)}ms status ${result.status}`
    );
    if (process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE) {
      fs.mkdirSync(process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE, {
        recursive: true,
      });
      for (const name of ["stdout", "stderr"])
        fs.writeFileSync(
          path.join(
            process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE,
            `${path.basename(f.temp)}-${count}-${name}.log`
          ),
          result[name] || ""
        );
    }
    return { ...result, output };
  };
  return { ...f, event, inputs, environment, invoke };
}

test("literal manual inputs and authenticated execution identity refuse before publication", () => {
  const f = dispatchFixture();
  try {
    for (const [inputs, env, event, reason] of [
      [{}, { GITHUB_REPOSITORY: "foreign/repository" }, {}, /repository/],
      [{}, { GITHUB_REF: "refs/heads/feature" }, {}, /default.branch/],
      [
        {},
        {
          GITHUB_WORKFLOW_REF:
            "danielbaars/anthracite/.github/workflows/caller.yml@refs/heads/main",
        },
        {},
        /workflow/,
      ],
      [{}, { GITHUB_WORKFLOW_SHA: "a".repeat(40) }, {}, /workflow.*commit/],
      [{}, { GITHUB_SHA: "main" }, {}, /immutable dispatcher/],
      [{}, { GITHUB_RUN_ID: "" }, {}, /run/],
      [{}, { GITHUB_TRIGGERING_ACTOR: "" }, {}, /actor/],
      [
        {},
        {},
        {
          repository: {
            full_name: "danielbaars/anthracite",
            default_branch: "other",
          },
        },
        /repository/,
      ],
      [{}, {}, { sender: { login: "forged-actor" } }, /actor/],
      [{ operation: "" }, {}, {}, /Explicit beta, stable or patch/],
      [{ operation: "select" }, {}, {}, /Explicit beta, stable or patch/],
      [
        {
          operation: "stable",
          beta_source: "",
          stable_tag: "v0.7.0",
          practice: "release:v0.7.0-beta.1/practice.json",
          confirmation: "",
        },
        {},
        {},
        /confirmation/,
      ],
      [{ beta_source: "main" }, {}, {}, /immutable beta source/],
      [{ beta_source: "" }, {}, {}, /immutable beta source/],
      [{ beta_version: "0.7.0" }, {}, {}, /canonical beta/],
      [{ beta_version: "0.7.0-beta.01" }, {}, {}, /canonical beta/],
      [
        { beta_version: "$(touch should-never-exist)" },
        {},
        {},
        /canonical beta/,
      ],
      [{ confirmation: "0.7.0" }, {}, {}, /Contradictory/],
      [{ unknown: "value" }, {}, {}, /Unsupported input/],
      [
        {},
        { NPM_TRUSTED_PUBLISHING: "false" },
        {},
        /Trusted publication is disabled/,
      ],
    ]) {
      const result = f.invoke(inputs, env, event);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, reason);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      assert.equal(fs.existsSync(result.output), false);
    }
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});

test(
  "manual beta and stable use actual captured source and exact artifacts with fresh dispatch identity",
  { timeout: 900000 },
  () => {
    const f = dispatchFixture();
    let passed = false;
    try {
      const published = f.invoke();
      assert.equal(published.status, 0, published.stderr);
      const result = JSON.parse(published.stdout);
      assert.equal(result.status, "verified");
      assert.equal(result.channel, "beta");
      assert.equal(result.npmWrites, 1);
      const betaBytes = fs.readFileSync(
        path.join(published.output, "intent.json")
      );
      const beta = JSON.parse(betaBytes);
      assert.deepEqual(beta.run, {
        id: "3456",
        attempt: "2",
        actor: "release-test",
        originalActor: "original-maintainer",
        triggeringActor: "release-test",
      });
      assert.equal(beta.source.commit, f.inputs.beta_source);
      assert.equal(beta.dispatcher.commit, f.environment.GITHUB_SHA);
      assert.ok(beta.dispatcher.files["scripts/release-dispatch.cjs"]);
      assert.deepEqual(
        beta.dispatcher.entries["scripts/release-dispatch.cjs"],
        { mode: "100644", type: "blob" }
      );
      let state = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(state.writes.length, 1);
      assert.equal(state.registry["dist-tags"].latest, "0.6.9");
      assert.equal(state.registry["dist-tags"].beta, "0.7.0-beta.1");
      const retainedArtifact = state.writes[0].bytes;
      assert.equal(
        retainedArtifact,
        fs
          .readFileSync(
            path.join(published.output, "danielbaars-anthracite.tgz")
          )
          .toString("base64")
      );
      fs.rmSync(published.output, { recursive: true, force: true });
      const reconciled = f.invoke(
        {},
        { GITHUB_RUN_ID: "3457", GITHUB_RUN_ATTEMPT: "1" }
      );
      assert.equal(reconciled.status, 0, reconciled.stderr);
      assert.equal(JSON.parse(reconciled.stdout).npmWrites, 0);
      assert.equal(
        fs.readFileSync(path.join(reconciled.output, "intent.json")).toString(),
        betaBytes.toString()
      );
      assert.equal(
        fs
          .readFileSync(
            path.join(reconciled.output, "danielbaars-anthracite.tgz")
          )
          .toString("base64"),
        retainedArtifact
      );
      const manifestPath = path.join(f.checkout, "apps/cli/package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      manifest.version = "0.7.0";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      fs.writeFileSync(
        path.join(f.checkout, ".release-please-manifest.json"),
        JSON.stringify({ "apps/cli": "0.7.0" }) + "\n"
      );
      const stable = f.commit("Prepare stable version and manifest only");
      git(f.checkout, "tag", "v0.7.0", stable);
      const dispatcher = f.commit(
        "Capture later default-branch dispatch commit"
      );
      const stableEnv = {
        GITHUB_SHA: dispatcher,
        GITHUB_WORKFLOW_SHA: dispatcher,
        GITHUB_RUN_ID: "4567",
        GITHUB_RUN_ATTEMPT: "1",
      };
      const stableInputs = {
        operation: "stable",
        beta_source: "",
        stable_tag: "v0.7.0",
        practice: "release:v0.7.0-beta.1/practice.json",
        confirmation: "0.7.0",
      };
      state = JSON.parse(fs.readFileSync(f.statePath));
      state.main = dispatcher;
      state.tags["v0.7.0"] = stable;
      state.releases["v0.7.0"] = {
        tag: "v0.7.0",
        source: stable,
        prerelease: false,
        assets: {},
      };
      state.practiceReference = stableInputs.practice;
      state.practice = practice(
        beta,
        require("node:crypto")
          .createHash("sha256")
          .update(betaBytes)
          .digest("hex")
      );
      f.write(state);
      const baseline = structuredClone(state);
      const refusedActor = f.invoke(stableInputs, {
        ...stableEnv,
        GITHUB_TRIGGERING_ACTOR: "different-maintainer",
      });
      assert.notEqual(refusedActor.status, 0);
      assert.match(refusedActor.stderr, /actor|maintainer/i);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      f.write(baseline);
      const stablePublished = f.invoke(stableInputs, stableEnv);
      assert.equal(stablePublished.status, 0, stablePublished.stderr);
      assert.equal(JSON.parse(stablePublished.stdout).status, "verified");
      assert.equal(JSON.parse(stablePublished.stdout).channel, "stable");
      const stableIntent = JSON.parse(
        fs.readFileSync(path.join(stablePublished.output, "intent.json"))
      );
      assert.equal(stableIntent.source.commit, stable);
      assert.equal(stableIntent.dispatcher.commit, dispatcher);
      assert.notEqual(
        stableIntent.source.commit,
        stableIntent.dispatcher.commit
      );
      assert.equal(stableIntent.run.actor, "release-test");
      assert.equal(stableIntent.run.originalActor, "original-maintainer");
      assert.equal(stableIntent.assessment.approval.actor, "release-test");
      assert.equal(stableIntent.assessment.approval.version, "0.7.0");
      assert.equal(stableIntent.assessment.beta.version, "0.7.0-beta.1");
      assert.equal(stableIntent.assessment.sourceEquivalent, true);
      assert.notEqual(stableIntent.artifact.integrity, beta.artifact.integrity);
      state = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(state.writes.length, 2);
      assert.equal(state.writes[1].channel, "latest");
      assert.equal(state.registry["dist-tags"].latest, "0.7.0");
      assert.equal(state.registry["dist-tags"].beta, "0.7.0-beta.1");
      assert.equal(
        state.writes[1].bytes,
        fs
          .readFileSync(
            path.join(stablePublished.output, "danielbaars-anthracite.tgz")
          )
          .toString("base64")
      );
      const retry = f.invoke(stableInputs, {
        ...stableEnv,
        GITHUB_RUN_ID: "4568",
      });
      assert.equal(retry.status, 0, retry.stderr);
      assert.equal(JSON.parse(retry.stdout).npmWrites, 0);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 2);
      assert.equal(git(f.checkout, "status", "--porcelain"), "");
      console.log(
        `Captured beta source ${beta.source.commit}; stable source ${stable}; actual stable dispatcher ${dispatcher}`
      );
      if (process.env.ANTHRACITE_EXPORT_DELIVERY_ARTIFACTS) {
        // Export durable captured assets only after every real process assertion passes.
        const inputs = path.join(f.temp, "delivery-export-inputs");
        for (const [channel, version] of [
          ["beta", beta.version],
          ["stable", stableIntent.version],
        ]) {
          const directory = path.join(inputs, channel);
          fs.mkdirSync(directory, { recursive: true });
          for (const [name, bytes] of Object.entries(
            state.releases[`v${version}`].assets
          )) {
            assert.equal(path.basename(name), name);
            fs.writeFileSync(
              path.join(directory, name),
              Buffer.from(bytes, "base64")
            );
          }
        }
        const exported = spawnSync(
          process.execPath,
          [
            path.join(root, "scripts/export-release-artifacts.cjs"),
            path.join(inputs, "beta"),
            path.join(inputs, "stable"),
            process.env.ANTHRACITE_EXPORT_DELIVERY_ARTIFACTS,
          ],
          { encoding: "utf8" }
        );
        assert.equal(exported.status, 0, exported.stderr);
        console.log(
          `Exported successful controlled process artifacts: ${exported.stdout.trim()}`
        );
      }
      passed = true;
    } finally {
      if (passed) fs.rmSync(f.temp, { recursive: true, force: true });
      else console.log(`Preserved failed dispatch fixture: ${f.temp}`);
    }
  }
);

test("production npm boundary requires the publication flag and uses explicit exact-artifact channel arguments", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-npm-route-")
  );
  try {
    const record = path.join(temporary, "npm-call.json");
    const tarball = path.join(temporary, "exact-tested.tgz");
    fs.writeFileSync(tarball, "controlled external npm boundary artifact");
    fs.writeFileSync(
      path.join(temporary, "npm"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.NPM_BOUNDARY_RECORD, JSON.stringify({args:process.argv.slice(2),bytes:require('node:fs').readFileSync(process.argv[3]).toString()}));\n`,
      { mode: 0o755 }
    );
    for (const [flag, channel, version] of [
      ["", "beta", "0.7.0-beta.1"],
      ["false", "latest", "0.7.0"],
      ["TRUE", "beta", "0.7.0-beta.1"],
      ["true", "beta", "0.7.0-beta.1"],
      ["true", "latest", "0.7.0"],
    ]) {
      fs.rmSync(record, { force: true });
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `require(process.argv[1]).services().registry.publish({tarball:process.argv[2],channel:process.argv[3],version:process.argv[4]}).catch(error=>{console.error(error.message);process.exitCode=1;});`,
          path.join(root, "scripts/release-services.cjs"),
          tarball,
          channel,
          version,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: temporary + path.delimiter + process.env.PATH,
            NPM_BOUNDARY_RECORD: record,
            NPM_TRUSTED_PUBLISHING: flag,
            GITHUB_ACTIONS: "true",
            GITHUB_EVENT_NAME: "workflow_dispatch",
            GITHUB_REPOSITORY: "danielbaars/anthracite",
            GITHUB_REF: "refs/heads/main",
          },
        }
      );
      if (flag !== "true") {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Trusted publication is disabled/);
        assert.equal(fs.existsSync(record), false);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const call = JSON.parse(fs.readFileSync(record));
        assert.deepEqual(call.args, [
          "publish",
          tarball,
          "--tag",
          channel,
          "--access",
          "public",
          "--provenance",
          "--registry=https://registry.npmjs.org",
        ]);
        assert.equal(call.bytes, "controlled external npm boundary artifact");
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("direct patch manual input requires reason and rejects beta contradictions before writes", () => {
  const f = dispatchFixture();
  try {
    for (const [changes, reason] of [
      [{ patch_reason: "" }, /reason/],
      [{ beta_version: "0.7.0-beta.1" }, /cannot supply beta/],
      [{ practice: "invented" }, /cannot supply beta/],
      [{ confirmation: "0.6.11" }, /confirmation/],
    ]) {
      const result = f.invoke({
        operation: "patch",
        beta_source: "",
        beta_version: "",
        stable_tag: "v0.6.10",
        confirmation: "0.6.10",
        patch_reason: "Targeted bugfix",
        ...changes,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, reason);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
    }
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});
