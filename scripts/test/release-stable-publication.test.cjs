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
  "stable builds its own exact version, binds approval and preserves independently observed beta",
  { timeout: 900000 },
  () => {
    const f = fixture();
    try {
      // Exercise a same-mode symlink target drift as well as version-only promotion.
      const changelog = path.join(f.checkout, "apps/cli/CHANGELOG.md");
      fs.unlinkSync(changelog);
      fs.symlinkSync("../../CREDITS.md", changelog);
      const betaSource = f.commit("Capture changelog symlink source");
      f.request.source = betaSource;
      f.request.dispatcher = betaSource;
      let state = JSON.parse(fs.readFileSync(f.statePath));
      state.main = betaSource;
      f.write(state);
      const prepared = f.invoke();
      assert.equal(prepared.status, 0, prepared.stderr);
      const betaBytes = fs.readFileSync(
        path.join(f.request.output, "intent.json")
      );
      const beta = JSON.parse(betaBytes);
      const { createHash } = require("node:crypto");
      const digest = createHash("sha256").update(betaBytes).digest("hex");
      state = JSON.parse(fs.readFileSync(f.statePath));
      state.statement = statement(beta);
      f.write(state);
      const betaPublished = f.invoke({ operation: "beta" }, beta);
      assert.equal(betaPublished.status, 0, betaPublished.stderr);
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
      const stable = f.commit(
        "Prepare exact stable version without source changes"
      );
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
      state.practice = practice(beta, digest);
      // The selected immutable beta remains beta.1 even after the moving channel advances.
      state.registry["dist-tags"].beta = "0.7.0-beta.2";
      state.registry.versions["0.7.0-beta.2"] = {
        name: "@danielbaars/anthracite",
        version: "0.7.0-beta.2",
        dist: { integrity: "sha512-newer-beta" },
      };
      const baseline = structuredClone(state);
      f.write(state);
      const input = {
        operation: "stable",
        source: stable,
        dispatcher: stable,
        version: "0.7.0",
        tag: "v0.7.0",
        betaVersion: beta.version,
        practice: state.practiceReference,
        confirmation: "0.7.0",
        output: path.join(f.temp, "stable"),
        run: { id: "2345", attempt: "1", actor: "release-test" },
      };
      const refuse = (changes, mutate, reason) => {
        const current = structuredClone(baseline);
        mutate(current);
        f.write(current);
        const result = f.invoke({
          ...input,
          output: path.join(f.temp, "refused"),
          ...changes,
        });
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, reason);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      };
      for (const [field, value, reason] of [
        ["platform", {}, /platform/],
        ["run", { id: "run", attempt: "0", actor: "release-test" }, /run/],
        [
          "transformation",
          { path: "apps/cli/package.json", from: "0.1.0", to: beta.version },
          /transformation/,
        ],
      ]) {
        refuse(
          {},
          (current) => {
            const bad = { ...beta, [field]: value };
            current.releases["v0.7.0-beta.1"].assets["intent.json"] =
              Buffer.from(JSON.stringify(bad)).toString("base64");
          },
          reason
        );
      }
      refuse({ version: beta.version }, () => {}, /canonical stable/);
      refuse({ confirmation: "0.8.0" }, () => {}, /confirmation/);
      refuse({ betaVersion: "0.8.0-beta.1" }, () => {}, /target/);
      refuse(
        {},
        (current) => {
          current.practice.maintainer.disposition = "pending";
        },
        /not approved/
      );
      fs.unlinkSync(changelog);
      fs.symlinkSync("../../LICENSE", changelog);
      const changed = f.commit("Change only changelog symlink target");
      refuse(
        { source: changed, dispatcher: changed },
        (current) => {
          current.main = changed;
          current.tags["v0.7.0"] = changed;
          current.releases["v0.7.0"].source = changed;
        },
        /Source differs/
      );
      git(f.checkout, "checkout", "--detach", stable);
      f.write(baseline);
      const published = f.invoke(input);
      assert.equal(published.status, 0, published.stderr);
      const result = JSON.parse(published.stdout);
      assert.equal(result.status, "verified");
      assert.equal(result.channel, "stable");
      assert.equal(result.npmWrites, 1);
      const after = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(after.writes.length, 2);
      assert.equal(after.writes[1].channel, "latest");
      assert.equal(after.registry["dist-tags"].latest, "0.7.0");
      assert.equal(after.registry["dist-tags"].beta, "0.7.0-beta.2");
      const stableIntent = JSON.parse(
        fs.readFileSync(path.join(input.output, "intent.json"))
      );
      assert.equal(stableIntent.transformation.from, "0.7.0");
      assert.equal(stableIntent.transformation.to, "0.7.0");
      assert.equal(stableIntent.assessment.beta.version, beta.version);
      assert.equal(stableIntent.assessment.approval.actor, "release-test");
      assert.notEqual(stableIntent.artifact.integrity, beta.artifact.integrity);
      assert.equal(
        after.writes[1].bytes,
        fs
          .readFileSync(path.join(input.output, "danielbaars-anthracite.tgz"))
          .toString("base64")
      );
      assert.equal(
        after.releases["v0.7.0-beta.1"].assets["danielbaars-anthracite.tgz"],
        baseline.releases["v0.7.0-beta.1"].assets["danielbaars-anthracite.tgz"]
      );
      for (const name of [
        "intent.json",
        "danielbaars-anthracite.tgz",
        "SHA256SUMS",
        "tests.json",
        "assessment.json",
        "practice.json",
        "beta-intent.json",
        "beta-verification.json",
      ])
        assert.ok(
          after.releases["v0.7.0"].assets[name],
          `Missing durable stable ${name}`
        );
      const orphaned = structuredClone(baseline);
      orphaned.releases["v0.7.0"] = structuredClone(after.releases["v0.7.0"]);
      delete orphaned.releases["v0.7.0"].assets["intent.json"];
      delete orphaned.releases["v0.7.0"].assets["danielbaars-anthracite.tgz"];
      f.write(orphaned);
      const orphanOutput = path.join(f.temp, "missing-original-intent");
      const orphanRefused = f.invoke({ ...input, output: orphanOutput });
      assert.notEqual(orphanRefused.status, 0);
      assert.match(
        orphanRefused.stderr,
        /Missing original intent; cannot rebuild/
      );
      assert.equal(
        fs.existsSync(path.join(orphanOutput, "intent.json")),
        false
      );
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
      const retained = structuredClone(baseline);
      retained.releases["v0.7.0"] = structuredClone(after.releases["v0.7.0"]);
      for (const name of Object.keys(retained.releases["v0.7.0"].assets))
        if (/^(attempt|verification|observation)-/.test(name))
          delete retained.releases["v0.7.0"].assets[name];
      const originalArtifact = fs.readFileSync(
        path.join(input.output, "danielbaars-anthracite.tgz")
      );
      for (const [flag, reason, writes] of [
        ["moveBetaBeforeWrite", /Beta moved before|assessment.*changed/, 1],
        ["changePracticeBeforeWrite", /not approved/, 1],
        ["invalidateBetaBeforeWrite", /signatures/, 1],
        ["changeArtifactBeforeWrite", /checksum/, 1],
        ["changeDurableBeforeWrite", /Durable tests.json changed/, 1],
        ["moveBetaAfterWrite", /Beta moved/, 2],
        ["wrongLatestAfterWrite", /Latest moved/, 2],
      ]) {
        const remote = structuredClone(retained);
        remote[flag] = true;
        remote.snapshots = 0;
        f.write(remote);
        fs.writeFileSync(
          path.join(input.output, "danielbaars-anthracite.tgz"),
          originalArtifact
        );
        // Independent external worlds must not inherit a prior attempt's local records.
        for (const name of fs.readdirSync(input.output))
          if (/^(attempt|verification|observation)-/.test(name))
            fs.rmSync(path.join(input.output, name));
        const answer = f.invoke(input);
        assert.notEqual(answer.status, 0, answer.stdout);
        assert.match(answer.stderr, reason, flag);
        assert.equal(
          JSON.parse(fs.readFileSync(f.statePath)).writes.length,
          writes,
          flag
        );
        if (writes === 2)
          assert.match(
            answer.stderr,
            /completion unconfirmed.*no automatic republish or tag repair/s
          );
      }
      assert.equal(git(f.checkout, "status", "--porcelain"), "");
    } catch (error) {
      if (process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE)
        fs.cpSync(
          f.temp,
          path.join(
            process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE,
            `failed-${path.basename(f.temp)}`
          ),
          { recursive: true }
        );
      throw error;
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);

test(
  "stable build failure cannot inherit the beta's passing exact-artifact gate",
  { timeout: 600000 },
  () => {
    const f = fixture();
    try {
      const builder = path.join(f.checkout, "scripts/build-npm-package.cjs");
      const original = fs.readFileSync(builder, "utf8");
      fs.writeFileSync(
        builder,
        original.replace(
          'const fs = require("node:fs");',
          'if (require("../apps/cli/package.json").version === "0.7.0") throw new Error("Controlled stable-version build failure");\nconst fs = require("node:fs");'
        )
      );
      assert.notEqual(
        fs.readFileSync(builder, "utf8"),
        original,
        "Controlled failure must actually change the captured build input"
      );
      const source = f.commit(
        "Capture a build that fails for the separately versioned stable artifact"
      );
      f.request.source = source;
      f.request.dispatcher = source;
      let state = JSON.parse(fs.readFileSync(f.statePath));
      state.main = source;
      f.write(state);
      const prepared = f.invoke();
      assert.equal(prepared.status, 0, prepared.stderr);
      const betaBytes = fs.readFileSync(
        path.join(f.request.output, "intent.json")
      );
      const beta = JSON.parse(betaBytes);
      state = JSON.parse(fs.readFileSync(f.statePath));
      state.statement = statement(beta);
      f.write(state);
      const published = f.invoke({ operation: "beta" }, beta);
      assert.equal(published.status, 0, published.stderr);
      const manifestPath = path.join(f.checkout, "apps/cli/package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      manifest.version = "0.7.0";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      const stable = f.commit("Prepare stable manifest only");
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
      state.practice = practice(
        beta,
        require("node:crypto")
          .createHash("sha256")
          .update(betaBytes)
          .digest("hex")
      );
      f.write(state);
      const output = path.join(f.temp, "failed-stable");
      const failed = f.invoke({
        operation: "stable",
        source: stable,
        dispatcher: stable,
        version: "0.7.0",
        tag: "v0.7.0",
        betaVersion: beta.version,
        practice: state.practiceReference,
        confirmation: "0.7.0",
        output,
        run: { id: "2345", attempt: "1", actor: "release-test" },
      });
      assert.notEqual(failed.status, 0);
      assert.match(
        failed.stderr,
        /Release build\/install gate failed.*Controlled stable-version build failure/s
      );
      const after = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(after.writes.length, 1);
      assert.equal(after.registry["dist-tags"].latest, "0.6.9");
      assert.equal(fs.existsSync(path.join(output, "intent.json")), false);
      assert.deepEqual(after.releases["v0.7.0"].assets, {});
    } catch (error) {
      if (process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE)
        fs.cpSync(
          f.temp,
          path.join(
            process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE,
            `failed-${path.basename(f.temp)}`
          ),
          { recursive: true }
        );
      throw error;
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);
