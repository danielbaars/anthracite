const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const artifacts = process.env.ANTHRACITE_DELIVERY_ARTIFACTS;

test(
  "export retained successful release assets for isolated delivery without replacing foreign files",
  {
    skip: !artifacts && "Supply real retained release-process artifacts",
  },
  () => {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "anthracite-export-")
    );
    const output = path.join(temporary, "delivery");
    const invoke = (
      beta = path.join(artifacts, "beta"),
      stable = path.join(artifacts, "stable"),
      destination = output
    ) =>
      spawnSync(
        process.execPath,
        [
          path.resolve(__dirname, "../export-release-artifacts.cjs"),
          beta,
          stable,
          destination,
        ],
        { encoding: "utf8" }
      );
    try {
      const result = invoke();
      assert.equal(result.status, 0, result.stderr);
      const metadata = JSON.parse(
        fs.readFileSync(path.join(output, "metadata.json"))
      );
      assert.equal(metadata.artifacts.beta.version, "0.7.0-beta.1");
      assert.equal(metadata.artifacts.stable.version, "0.7.0");
      for (const channel of ["beta", "stable"])
        for (const name of fs.readdirSync(path.join(artifacts, channel)))
          assert.deepEqual(
            fs.readFileSync(path.join(output, channel, name)),
            fs.readFileSync(path.join(artifacts, channel, name))
          );
      assert.equal(invoke().status, 0, "Byte-identical export is reusable");
      const copy = path.join(temporary, "beta");
      fs.cpSync(path.join(artifacts, "beta"), copy, { recursive: true });
      const archive = path.join(copy, "danielbaars-anthracite.tgz");
      fs.appendFileSync(archive, "tampered");
      const rejectedOutput = path.join(temporary, "rejected");
      assert.notEqual(
        invoke(copy, path.join(artifacts, "stable"), rejectedOutput).status,
        0
      );
      assert.equal(fs.existsSync(rejectedOutput), false);
      fs.rmSync(archive);
      assert.notEqual(
        invoke(copy, path.join(artifacts, "stable"), rejectedOutput).status,
        0
      );
      assert.equal(fs.existsSync(rejectedOutput), false);
      const metadataPath = path.join(output, "metadata.json");
      fs.writeFileSync(metadataPath, "foreign metadata");
      assert.notEqual(invoke().status, 0);
      assert.equal(fs.readFileSync(metadataPath, "utf8"), "foreign metadata");
      const foreign = path.join(output, "foreign.txt");
      fs.writeFileSync(foreign, "keep");
      assert.notEqual(invoke().status, 0);
      assert.equal(fs.readFileSync(foreign, "utf8"), "keep");
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
);
