const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  fixture,
  statement,
  practice,
  git,
} = require("./fixtures/release-stable-setup.cjs");
test(
  "beta retries preserve original bytes and append actual publishing attempt before reconciling existing versions",
  { timeout: 1200000 },
  async () => {
    const f = fixture();
    let passed = false;
    try {
      const prepared = f.invoke();
      assert.equal(prepared.status, 0, prepared.stderr);
      const original = fs.readFileSync(
        path.join(f.request.output, "intent.json")
      );
      const intent = JSON.parse(original);
      let state = JSON.parse(fs.readFileSync(f.statePath));
      const preparedState = structuredClone(state);
      preparedState.snapshots = 0;
      state.rejectPublish = true;
      state.statement = statement(intent);
      f.write(state);
      const rejected = f.invoke({ operation: "beta" }, intent);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /definite.*reject/i);
      state = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(state.writes.length, 0);
      assert.ok(state.releases["v0.7.0-beta.1"].assets["attempt-1234-1.json"]);
      const observation = JSON.parse(
        Buffer.from(
          state.releases["v0.7.0-beta.1"].assets["observation-1234-1.json"],
          "base64"
        )
      );
      assert.equal(observation.status, "rejected");
      assert.equal(observation.npmWrites, 1);
      state.rejectPublish = false;
      state.lostResponse = true;
      const run = { id: "5678", attempt: "2", actor: "release-test" };
      state.statement = statement({ ...intent, run });
      f.write(state);
      const recovered = f.invoke(
        { operation: "beta", run, output: path.join(f.temp, "fresh-retry") },
        intent
      );
      assert.equal(recovered.status, 0, recovered.stderr);
      state = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(state.writes.length, 1);
      assert.equal(
        state.writes[0].bytes,
        fs
          .readFileSync(
            path.join(f.request.output, "danielbaars-anthracite.tgz")
          )
          .toString("base64")
      );
      assert.equal(
        state.releases["v0.7.0-beta.1"].assets["intent.json"],
        original.toString("base64")
      );
      const verification = JSON.parse(
        Buffer.from(
          state.releases["v0.7.0-beta.1"].assets["verification-5678-2.json"],
          "base64"
        )
      );
      assert.deepEqual(verification.run, run);
      assert.equal(JSON.parse(recovered.stdout).npmWrites, 1);
      const reconciled = f.invoke(
        {
          operation: "beta",
          run: { ...run, attempt: "3" },
          output: path.join(f.temp, "reconcile"),
        },
        intent
      );
      assert.equal(reconciled.status, 0, reconciled.stderr);
      assert.equal(JSON.parse(reconciled.stdout).npmWrites, 0);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      const published = structuredClone(state);
      const freshOutput = (name) => path.join(f.temp, name);
      let number = 100;
      const world = (name, mutate, expected, pattern) => {
        const current = structuredClone(preparedState);
        const run = {
          id: String(++number),
          attempt: "1",
          actor: "release-test",
        };
        current.statement = statement({ ...intent, run });
        mutate(current);
        f.write(current);
        const result = f.invoke(
          { operation: "beta", run, output: freshOutput(name) },
          intent
        );
        assert.equal(result.status, expected, result.stderr);
        if (pattern) assert.match(result.stderr, pattern);
        return { result, state: JSON.parse(fs.readFileSync(f.statePath)), run };
      };
      const delayed = world(
        "delayed",
        (current) => {
          current.lostResponse = true;
          current.delayedManifest = 2;
          current.delayedProvenance = 2;
        },
        0
      );
      assert.equal(delayed.state.writes.length, 1);
      assert.equal(delayed.state.inspectCalls, 5);
      assert.match(
        JSON.parse(delayed.result.stdout).publishOutcome,
        /lost or unavailable/
      );
      const partial = structuredClone(preparedState);
      delete partial.releases["v0.7.0-beta.1"].assets["tests.json"];
      f.write(partial);
      const completed = f.invoke({ operation: "prepare-beta" });
      assert.equal(completed.status, 0, completed.stderr);
      assert.ok(
        JSON.parse(fs.readFileSync(f.statePath)).releases["v0.7.0-beta.1"]
          .assets["tests.json"]
      );
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      const missing = world(
        "missing-original",
        (current) => {
          delete current.releases["v0.7.0-beta.1"].assets[
            "danielbaars-anthracite.tgz"
          ];
        },
        1,
        /Missing original retained.*cannot rebuild/
      );
      assert.equal(missing.state.writes.length, 0);
      const absentRelease = structuredClone(preparedState);
      delete absentRelease.releases["v0.7.0-beta.1"];
      f.write(absentRelease);
      const noRecreate = f.invoke({ operation: "beta" }, intent);
      assert.notEqual(noRecreate.status, 0);
      assert.match(noRecreate.stderr, /append cannot recreate release/);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      for (const [name, mutate, pattern] of [
        [
          "existing-conflict",
          (current) => {
            current.registry.versions[intent.version].dist.integrity =
              "sha512-conflicting";
          },
          /integrity/,
        ],
        [
          "existing-foreign-signer",
          (current) => {
            current.foreignSigner = true;
          },
          /trusted release workflow/,
        ],
        [
          "existing-no-attempt",
          (current) => {
            for (const name of Object.keys(
              current.releases["v0.7.0-beta.1"].assets
            ))
              if (name.startsWith("attempt-"))
                delete current.releases["v0.7.0-beta.1"].assets[name];
          },
          /Missing durable publication attempt/,
        ],
        [
          "existing-foreign-run",
          (current) => {
            current.statement.predicate.runDetails.metadata.invocationId =
              "https://github.com/danielbaars/anthracite/actions/runs/9999/attempts/1";
          },
          /no exact retained identity/,
        ],
      ]) {
        const current = structuredClone(published);
        mutate(current);
        f.write(current);
        const result = f.invoke(
          { operation: "beta", output: freshOutput(name) },
          intent
        );
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, pattern);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      }
      const interrupted = world(
        "interrupted-final",
        (current) => {
          current.failFinalRetention = true;
        },
        1,
        /publication confirmed; durable verification incomplete/
      );
      assert.equal(interrupted.state.writes.length, 1);
      interrupted.state.failFinalRetention = false;
      f.write(interrupted.state);
      const finalized = f.invoke(
        {
          operation: "beta",
          run: { id: "7777", attempt: "1", actor: "release-test" },
          output: freshOutput("final-reconcile"),
        },
        intent
      );
      assert.equal(finalized.status, 0, finalized.stderr);
      assert.equal(JSON.parse(finalized.stdout).npmWrites, 0);
      assert.deepEqual(JSON.parse(finalized.stdout).run, interrupted.run);
      for (const [name, flag, pattern] of [
        ["latest-before", "moveLatestBeforeWrite", /Latest moved before/],
        ["beta-before", "moveBetaBeforeWrite", /Beta moved before/],
        ["latest-after", "moveLatestAfterBeta", /Latest moved during/],
        ["tag-after", "moveTagAfterWrite", /tag moved after/],
      ]) {
        const refused = world(
          name,
          (current) => {
            current[flag] = true;
          },
          1,
          pattern
        );
        assert.equal(
          refused.state.writes.length,
          name.endsWith("after") ? 1 : 0
        );
      }
      const common = path.join(f.checkout, ".git");
      const lock = path.join(common, "anthracite-release-publication.lock");
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), "foreign owner");
      f.write(preparedState);
      const locked = f.invoke({ operation: "beta" }, intent);
      assert.notEqual(locked.status, 0);
      assert.match(locked.stderr, /already held/);
      assert.equal(
        fs.readFileSync(path.join(lock, "owner"), "utf8"),
        "foreign owner"
      );
      // This fixture owns this deliberately created lock; production never removes foreign locks.
      fs.rmSync(lock, { recursive: true });
      const concurrent = structuredClone(preparedState);
      const ownerRun = { id: "8888", attempt: "1", actor: "release-test" };
      concurrent.statement = statement({ ...intent, run: ownerRun });
      concurrent.publishDelayMs = 1500;
      f.write(concurrent);
      const ownerInput = path.join(f.temp, "owner-input.json");
      fs.writeFileSync(
        ownerInput,
        JSON.stringify({
          process: path.join(f.checkout, "scripts/release-channels.cjs"),
          request: {
            ...f.request,
            operation: "beta",
            run: ownerRun,
            output: freshOutput("owner"),
          },
          state: f.statePath,
          intent,
        })
      );
      const { spawn } = require("node:child_process");
      const child = spawn(
        process.execPath,
        [
          path.join(
            f.checkout,
            "scripts/test/fixtures/release-stable-driver.cjs"
          ),
          ownerInput,
        ],
        { env: process.env }
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const finished = new Promise((resolve) =>
        child.on("close", (status) => resolve(status))
      );
      const waitUntil = Date.now() + 30000;
      while (
        !JSON.parse(fs.readFileSync(f.statePath)).publishEntered &&
        Date.now() < waitUntil
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(
        JSON.parse(fs.readFileSync(f.statePath)).publishEntered,
        true
      );
      const contender = f.invoke(
        {
          operation: "beta",
          run: { id: "9999", attempt: "1", actor: "release-test" },
          output: freshOutput("contender"),
        },
        intent
      );
      assert.notEqual(contender.status, 0);
      assert.match(contender.stderr, /already held/);
      assert.equal(child.exitCode, null);
      assert.ok(fs.existsSync(lock));
      assert.equal(await finished, 0, stderr);
      assert.equal(JSON.parse(stdout).npmWrites, 1);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      assert.equal(fs.existsSync(lock), false);

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
      const stableSource = f.commit(
        "Prepare separately versioned stable retry fixture"
      );
      git(f.checkout, "tag", "v0.7.0", stableSource);
      const stableWorld = structuredClone(published);
      stableWorld.main = stableSource;
      stableWorld.tags["v0.7.0"] = stableSource;
      stableWorld.releases["v0.7.0"] = {
        tag: "v0.7.0",
        source: stableSource,
        prerelease: false,
        assets: {},
      };
      stableWorld.practiceReference = "release:v0.7.0-beta.1/practice.json";
      stableWorld.practice = practice(
        intent,
        require("node:crypto")
          .createHash("sha256")
          .update(original)
          .digest("hex")
      );
      stableWorld.registry["dist-tags"].beta = "0.7.0-beta.2";
      stableWorld.registry.versions["0.7.0-beta.2"] = {
        name: "@danielbaars/anthracite",
        version: "0.7.0-beta.2",
        dist: { integrity: "sha512-newer-beta" },
      };
      stableWorld.lostResponse = false;
      const stableInput = {
        operation: "stable",
        source: stableSource,
        dispatcher: stableSource,
        version: "0.7.0",
        tag: "v0.7.0",
        betaVersion: intent.version,
        practice: stableWorld.practiceReference,
        confirmation: "0.7.0",
        output: freshOutput("stable"),
        run: { id: "2345", attempt: "1", actor: "release-test" },
      };
      for (const [field, value] of [
        ["name", "foreign/package"],
        ["version", "0.6.8"],
        ["integrity", "sha512-disagreement"],
      ]) {
        const current = structuredClone(stableWorld);
        current.registry["dist-tags"].latest = "0.6.10";
        current.registry.versions["0.6.10"] = {
          name: "@danielbaars/anthracite",
          version: "0.6.10",
          dist: { integrity: "sha512-other-stable" },
        };
        if (field === "integrity")
          current.registry.versions["0.6.9"].dist.integrity = value;
        else current.registry.versions["0.6.9"][field] = value;
        f.write(current);
        const refused = f.invoke({
          ...stableInput,
          operation: "assess-stable",
          output: freshOutput(`historical-${field}`),
        });
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /Historical latest.*disagree/);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      }
      stableWorld.rejectPublish = true;
      f.write(stableWorld);
      const stableRejected = f.invoke(stableInput);
      assert.notEqual(stableRejected.status, 0, stableRejected.stdout);
      assert.match(stableRejected.stderr, /definite registry rejection/);
      const stableOriginal = fs.readFileSync(
        path.join(stableInput.output, "intent.json")
      );
      const stableIntent = JSON.parse(stableOriginal);
      assert.equal(
        stableIntent.assessment.beta.verificationAsset,
        "verification-5678-2.json"
      );
      let stableState = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(stableState.writes.length, 1);
      assert.ok(stableState.releases["v0.7.0"].assets["attempt-2345-1.json"]);
      const stableRetry = {
        ...stableInput,
        run: { id: "3456", attempt: "2", actor: "release-test" },
        output: freshOutput("stable-retry"),
      };
      const unconfirmed = f.invoke({ ...stableRetry, confirmation: "" });
      assert.notEqual(unconfirmed.status, 0);
      assert.match(unconfirmed.stderr, /confirmation/);
      const foreignActor = f.invoke({
        ...stableRetry,
        run: { ...stableRetry.run, actor: "another-maintainer" },
      });
      assert.notEqual(foreignActor.status, 0);
      assert.match(foreignActor.stderr, /approving maintainer/);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      stableState.rejectPublish = false;
      stableState.lostResponse = true;
      f.write(stableState);
      const stablePublished = f.invoke(stableRetry);
      assert.equal(stablePublished.status, 0, stablePublished.stderr);
      stableState = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(stableState.writes.length, 2);
      assert.equal(stableState.registry["dist-tags"].latest, "0.7.0");
      assert.equal(stableState.registry["dist-tags"].beta, "0.7.0-beta.2");
      assert.equal(
        stableState.releases["v0.7.0"].assets["intent.json"],
        stableOriginal.toString("base64")
      );
      assert.deepEqual(JSON.parse(stablePublished.stdout).run, stableRetry.run);
      assert.equal(
        stableState.writes[1].bytes,
        fs
          .readFileSync(
            path.join(stableInput.output, "danielbaars-anthracite.tgz")
          )
          .toString("base64")
      );
      const stableReconciled = f.invoke({
        ...stableRetry,
        run: { ...stableRetry.run, id: "4567" },
        output: freshOutput("stable-reconcile"),
      });
      assert.equal(stableReconciled.status, 0, stableReconciled.stderr);
      assert.equal(JSON.parse(stableReconciled.stdout).npmWrites, 0);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 2);
      // The budget uses real elapsed time; this one case deliberately observes five minutes.
      git(f.checkout, "checkout", "--detach", f.request.dispatcher);
      const unavailable = structuredClone(preparedState);
      const unavailableRun = {
        id: "6789",
        attempt: "1",
        actor: "release-test",
      };
      unavailable.statement = statement({ ...intent, run: unavailableRun });
      unavailable.registryUnavailableAfterWrite = true;
      unavailable.lostResponse = true;
      f.write(unavailable);
      const began = Date.now();
      const exhausted = f.invoke(
        {
          operation: "beta",
          run: unavailableRun,
          output: freshOutput("exhausted"),
        },
        intent
      );
      const elapsed = Date.now() - began;
      assert.notEqual(exhausted.status, 0);
      assert.match(
        exhausted.stderr,
        /deadline exhausted.*public verification unavailable/s
      );
      assert.ok(
        elapsed >= 299000 && elapsed < 320000,
        `Verification elapsed ${elapsed}ms`
      );
      const exhaustedState = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(exhaustedState.writes.length, 1);
      assert.ok(exhaustedState.deadlines[0] <= 300000);
      assert.ok(exhaustedState.deadlines.at(-1) < 3000);
      assert.equal(
        exhaustedState.releases["v0.7.0-beta.1"].assets[
          "verification-6789-1.json"
        ],
        undefined
      );
      assert.ok(
        exhaustedState.releases["v0.7.0-beta.1"].assets[
          "observation-6789-1.json"
        ]
      );

      passed = true;
    } finally {
      if (passed) fs.rmSync(f.temp, { recursive: true, force: true });
      else console.error("Retry fixture retained:", f.temp);
    }
  }
);
