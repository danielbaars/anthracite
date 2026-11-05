const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { fixture } = require("./fixtures/release-stable-setup.cjs");

test(
  "direct patch publishes tested exact artifact without beta, preserves beta and reconciles once",
  { timeout: 600000 },
  () => {
    const f = fixture();
    try {
      const manifestPath = path.join(f.checkout, "apps/cli/package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      manifest.version = "0.6.10";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      const source = f.commit("Prepare targeted patch release");
      f.state.main = source;
      f.state.tags["v0.6.10"] = source;
      f.state.releases["v0.6.10"] = {
        tag: "v0.6.10",
        source,
        prerelease: false,
        assets: {},
      };
      f.state.registry["dist-tags"].beta = "0.7.0-beta.2";
      const input = {
        operation: "stable",
        source,
        dispatcher: source,
        version: "0.6.10",
        tag: "v0.6.10",
        confirmation: "0.6.10",
        patchReason:
          "Two targeted submit bugfixes with focused regressions and review.",
        output: path.join(f.temp, "patch"),
      };
      for (const [changes, mutate, reason] of [
        [{ patchReason: "" }, () => {}, /reason/],
        [{ betaVersion: "0.7.0-beta.2" }, () => {}, /cannot supply beta/],
        [{ practice: "invented" }, () => {}, /cannot supply beta/],
        [{ confirmation: "0.6.11" }, () => {}, /confirmation/],
        [
          {},
          (s) => {
            s.registry["dist-tags"].latest = "0.6.8";
            s.registry.versions["0.6.8"] = {
              ...s.registry.versions["0.6.9"],
              version: "0.6.8",
            };
          },
          /next patch/,
        ],
        [
          {},
          (s) => {
            s.releases["v0.6.10"].prerelease = true;
          },
          /stable GitHub release/,
        ],
        [
          {},
          (s) => {
            delete s.tags["v0.6.10"];
          },
          /tag moved/,
        ],
      ]) {
        const state = structuredClone(f.state);
        mutate(state);
        f.write(state);
        const result = f.invoke({ ...input, ...changes });
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, reason);
        assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      }
      f.write(f.state);
      const published = f.invoke(input);
      assert.equal(published.status, 0, published.stderr);
      const result = JSON.parse(published.stdout);
      assert.equal(result.status, "verified");
      assert.equal(result.npmWrites, 1);
      const state = JSON.parse(fs.readFileSync(f.statePath));
      assert.equal(state.registry["dist-tags"].latest, "0.6.10");
      assert.equal(state.registry["dist-tags"].beta, "0.7.0-beta.2");
      const intent = JSON.parse(
        fs.readFileSync(path.join(input.output, "intent.json"))
      );
      assert.equal(intent.assessment.mode, "patch");
      assert.equal(intent.assessment.approval.reason, input.patchReason);
      assert.equal(intent.tests.passed, true);
      assert.equal(
        state.releases["v0.6.10"].assets["practice.json"],
        undefined
      );
      const repeated = f.invoke({
        ...input,
        output: path.join(f.temp, "retry"),
      });
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.equal(JSON.parse(repeated.stdout).npmWrites, 0);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 1);
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);
