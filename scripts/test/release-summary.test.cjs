const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");

test(
  "operator display binds verified publication to exact retained checks and beta assessment",
  {
    skip:
      !process.env.ANTHRACITE_DELIVERY_ARTIFACTS &&
      "Supply real retained release-process artifacts",
  },
  () => {
    const directory = process.env.ANTHRACITE_DELIVERY_ARTIFACTS;
    assert.ok(
      directory,
      "Set ANTHRACITE_DELIVERY_ARTIFACTS to retained real release-process artifacts"
    );
    for (const channel of ["beta", "stable"]) {
      const selected = path.join(directory, channel);
      const resultFile = fs
        .readdirSync(selected)
        .find((name) => name.startsWith("verification-"));
      const result = JSON.parse(
        fs.readFileSync(path.join(selected, resultFile))
      );
      result.npmWrites = 0;
      result.publishOutcome = "existing version reconciled read-only";
      result.next =
        channel === "stable"
          ? "Stable publication verified; retained beta and practice evidence preserved"
          : "Exercise this exact beta and retain practice evidence before explicit stable approval";
      const invoke = (input) =>
        spawnSync(
          process.execPath,
          [
            path.join(root, "scripts/release-summary.cjs"),
            path.join(selected, "intent.json"),
          ],
          { input: JSON.stringify(input), encoding: "utf8" }
        );
      const processResult = invoke(result);
      assert.equal(processResult.status, 0, processResult.stderr);
      const { operatorSummary: summary, markdown } = JSON.parse(
        processResult.stdout
      );
      assert.equal(summary.selectedBeta.version, "0.7.0-beta.1");
      assert.equal(
        summary.sourceEquivalent,
        channel === "stable" ? true : null
      );
      assert.equal(summary.checks.passed, true);
      assert.equal(summary.checks.rerunByDisplay, false);
      assert.match(summary.checks.basis, /retained/);
      assert.equal(
        summary.practice.disposition,
        channel === "stable" ? "approved" : "pending"
      );
      assert.equal(summary.npmWritesThisInvocation, 0);
      assert.deepEqual(summary.actualTags, result.tags);
      assert.deepEqual(summary.confirmedWrites, result.confirmedWrites);
      assert.match(markdown, /Selected beta/);
      assert.match(markdown, /retained/);
      assert.match(markdown, /Next action/);
      const prepared = invoke({ ...result, status: "prepared" });
      assert.notEqual(prepared.status, 0);
      assert.match(prepared.stderr, /not verified/);
      const wrong = invoke({ ...result, intentSha256: "0".repeat(64) });
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /intent digest/);
    }
  }
);
