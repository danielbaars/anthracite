const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { validateRecord } = require("./release-channels.cjs");
const { summarize } = require("./release-summary.cjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Retained records describe their original test boundary; export makes no live registry claim.
try {
  assert.equal(
    process.argv.length,
    5,
    "Usage: node scripts/export-release-artifacts.cjs BETA_ASSETS STABLE_ASSETS OUTPUT"
  );
  const output = path.resolve(process.argv[4]);
  const files = new Map();
  const metadata = {
    schema: 1,
    status:
      "retained-release-records; no live publication verification performed",
    artifacts: {},
  };
  const captured = {};
  for (const [index, channel] of ["beta", "stable"].entries()) {
    const directory = path.resolve(process.argv[index + 2]);
    const assets = {};
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name);
      assert.ok(
        fs.lstatSync(filename).isFile(),
        `Not a regular asset: ${filename}`
      );
      assets[name] = fs.readFileSync(filename);
      files.set(`${channel}/${name}`, assets[name]);
    }
    const read = (name) => {
      assert.ok(assets[name], `Missing ${channel}/${name}`);
      return JSON.parse(assets[name]);
    };
    const intent = validateRecord(read("intent.json"));
    assert.equal(intent.channel, channel);
    assert.equal(intent.tests.passed, true);
    assert.deepEqual(read("tests.json"), intent.tests);
    const tarball = assets["danielbaars-anthracite.tgz"];
    assert.ok(tarball, `Missing ${channel} tarball`);
    assert.equal(hash(tarball), intent.artifact.sha256);
    assert.equal(tarball.length, intent.artifact.size);
    assert.equal(
      "sha512-" + createHash("sha512").update(tarball).digest("base64"),
      intent.artifact.integrity
    );
    assert.equal(
      assets.SHA256SUMS?.toString(),
      `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
    );
    const manifest = JSON.parse(
      execFileSync(
        "tar",
        [
          "-xOf",
          path.join(directory, "danielbaars-anthracite.tgz"),
          "package/package.json",
        ],
        { encoding: "utf8" }
      )
    );
    assert.equal(manifest.name, intent.package);
    assert.equal(manifest.version, intent.version);
    const verifications = Object.keys(assets).filter((name) =>
      /^verification-\d+-\d+\.json$/.test(name)
    );
    assert.ok(verifications.length, `Missing ${channel} verification`);
    for (const name of verifications) {
      const verification = read(name);
      summarize(verification, assets["intent.json"]);
      const attemptName = `attempt-${verification.run.id}-${verification.run.attempt}.json`;
      const attempt = read(attemptName);
      assert.equal(hash(assets[attemptName]), verification.attemptSha256);
      assert.equal(attempt.intentSha256, hash(assets["intent.json"]));
      assert.deepEqual(attempt.artifact, intent.artifact);
      assert.deepEqual(attempt.run, verification.run);
      assert.deepEqual(attempt.dispatcher, verification.dispatcher);
      assert.equal(
        verification.tags[channel === "beta" ? "beta" : "latest"],
        intent.version
      );
    }
    captured[channel] = { assets, intent };
    metadata.artifacts[channel] = {
      package: intent.package,
      version: intent.version,
      sha256: intent.artifact.sha256,
      integrity: intent.artifact.integrity,
      size: intent.artifact.size,
      source: intent.source,
      dispatcher: intent.dispatcher,
      originalIntentRun: intent.run,
      tools: intent.tools,
      platform: intent.platform,
      files: Object.fromEntries(
        Object.entries(assets).map(([name, bytes]) => [
          name,
          { sha256: hash(bytes), size: bytes.length },
        ])
      ),
    };
  }
  const { beta, stable } = captured;
  assert.deepEqual(
    stable.assets["beta-intent.json"],
    beta.assets["intent.json"]
  );
  const assessment = JSON.parse(stable.assets["assessment.json"]);
  assert.deepEqual(assessment, stable.intent.assessment);
  assert.equal(assessment.beta.intentSha256, hash(beta.assets["intent.json"]));
  assert.deepEqual(
    stable.assets["beta-verification.json"],
    beta.assets[assessment.beta.verificationAsset]
  );
  assert.equal(
    hash(stable.assets["beta-verification.json"]),
    assessment.beta.verificationSha256
  );
  assert.equal(
    hash(stable.assets["practice.json"]),
    assessment.practice.sha256
  );
  assert.equal(
    JSON.parse(stable.assets["practice.json"]).betaVersion,
    beta.intent.version
  );
  metadata.practice = assessment.practice;
  files.set(
    "metadata.json",
    Buffer.from(JSON.stringify(metadata, null, 2) + "\n")
  );
  // Preflight the entire destination before writing, including symlink and foreign-file refusal.
  if (fs.existsSync(output)) {
    assert.ok(
      fs.lstatSync(output).isDirectory(),
      "Output must be a regular directory"
    );
    for (const name of fs.readdirSync(output)) {
      assert.ok(
        ["beta", "stable", "metadata.json"].includes(name),
        `Foreign output: ${name}`
      );
      const target = path.join(output, name);
      if (name !== "metadata.json") {
        assert.ok(
          fs.lstatSync(target).isDirectory(),
          `Not a regular directory: ${target}`
        );
        for (const asset of fs.readdirSync(target)) {
          assert.ok(
            files.has(`${name}/${asset}`),
            `Foreign output: ${name}/${asset}`
          );
          assert.ok(
            fs.lstatSync(path.join(target, asset)).isFile(),
            "Output asset must be regular"
          );
        }
      } else
        assert.ok(fs.lstatSync(target).isFile(), "Metadata must be regular");
    }
  }
  for (const [name, bytes] of files) {
    const target = path.join(output, name);
    if (fs.existsSync(target))
      assert.deepEqual(
        fs.readFileSync(target),
        bytes,
        `Conflicting output: ${name}`
      );
  }
  for (const [name, bytes] of files) {
    const target = path.join(output, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: "wx" });
  }
  console.log(path.join(output, "metadata.json"));
} catch (error) {
  console.error(`Artifact export refused: ${error.message}`);
  process.exitCode = 1;
}
