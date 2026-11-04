#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const PACKAGE = "@danielbaars/anthracite";
const REPOSITORY = "danielbaars/anthracite";
const NORMALIZATION = "anthracite-source-v1";
const hash = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
const json = (bytes) => JSON.parse(bytes.toString());
function command(cwd, file, args, options = {}) {
  return execFileSync(file, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}
const git = (cwd, ...args) => command(cwd, "git", args).trim();
function version(value, beta) {
  const match =
    typeof value === "string" &&
    value.match(
      beta
        ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)$/
        : /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
    );
  assert.ok(match, `Expected a canonical ${beta ? "beta" : "stable"} version`);
  return {
    target: match.slice(1, 4).join("."),
    numbers: match.slice(1, 4).map(BigInt),
    beta: beta ? BigInt(match[4]) : null,
  };
}
function newer(left, right) {
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
function sourceIdentity(checkout, commit) {
  const entries = command(checkout, "git", ["ls-tree", "-rz", commit], {
    encoding: "buffer",
  })
    .toString()
    .split("\0")
    .filter(Boolean);
  // One Git process reads the captured objects; framing uses byte lengths, never
  // line splitting, because tracked contents may contain arbitrary bytes.
  const objects = command(checkout, "git", ["cat-file", "--batch"], {
    encoding: "buffer",
    input: Buffer.from(
      entries
        .map((entry) => entry.slice(0, entry.indexOf("\t")).split(" ")[2])
        .join("\n") + "\n"
    ),
    maxBuffer: 256 * 1024 * 1024,
  });
  let offset = 0;
  const digest = createHash("sha256");
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    const [mode, type, oid] = entry.slice(0, tab).split(" ");
    const filename = entry.slice(tab + 1);
    const end = objects.indexOf(10, offset);
    assert.ok(end >= offset, "Incomplete Git object header");
    const [actualOid, actualType, length] = objects
      .subarray(offset, end)
      .toString()
      .split(" ");
    assert.equal(actualOid, oid);
    assert.equal(actualType, type);
    assert.match(length, /^\d+$/);
    const size = Number(length);
    assert.ok(Number.isSafeInteger(size));
    offset = end + 1;
    let contents = objects.subarray(offset, offset + size);
    assert.equal(contents.length, size, "Incomplete Git object bytes");
    offset += size;
    assert.equal(objects[offset++], 10, "Incomplete Git object framing");
    const regular = type === "blob" && ["100644", "100755"].includes(mode);
    if (regular && filename === "apps/cli/package.json") {
      const value = json(contents);
      value.version = "<release-version>";
      contents = Buffer.from(JSON.stringify(value));
    }
    if (regular && filename === ".release-please-manifest.json") {
      const value = json(contents);
      value["apps/cli"] = "<release-version>";
      contents = Buffer.from(JSON.stringify(value));
    }
    if (regular && filename === "apps/cli/CHANGELOG.md")
      contents = Buffer.from("<generated-cli-changelog>");
    digest.update(
      JSON.stringify([mode, type, filename, hash(contents)]) + "\n"
    );
  }
  assert.equal(offset, objects.length, "Unexpected Git object bytes");
  return { rule: NORMALIZATION, sha256: digest.digest("hex") };
}
function trackedDispatcher(checkout, commit) {
  const files = git(checkout, "ls-tree", "-r", "--name-only", commit)
    .split("\n")
    .filter(
      (name) =>
        name === ".github/workflows/release.yml" ||
        /^scripts\/release[^/]*\.cjs$/.test(name)
    );
  assert.ok(
    files.includes("scripts/release-channels.cjs"),
    "Dispatcher has no release process"
  );
  assert.ok(
    files.includes(".github/workflows/release.yml"),
    "Dispatcher workflow is missing"
  );
  const digests = {};
  const entries = {};
  for (const name of files) {
    const tracked = command(checkout, "git", ["show", `${commit}:${name}`], {
      encoding: "buffer",
    });
    const [mode, type] = git(checkout, "ls-tree", commit, "--", name).split(
      " "
    );
    assert.ok(
      mode === "100644" || mode === "100755",
      "Dispatcher inputs must be regular files"
    );
    assert.equal(type, "blob");
    digests[name] = hash(tracked);
    entries[name] = { mode, type };
  }
  return { commit, files: digests, entries };
}
function dispatcherIdentity(checkout, commit) {
  const identity = trackedDispatcher(checkout, commit);
  for (const [name, digest] of Object.entries(identity.files)) {
    assert.equal(
      hash(fs.readFileSync(path.join(checkout, name))),
      digest,
      `Executing dispatcher differs from captured ${name}`
    );
    if (name.startsWith("scripts/"))
      assert.equal(
        hash(fs.readFileSync(path.join(__dirname, path.basename(name)))),
        digest,
        `Running process differs from dispatcher ${name}`
      );
  }
  return identity;
}

function toolchain(checkout) {
  const tools = {
    node: process.versions.node,
    yarn: command(checkout, process.execPath, [
      ".yarn/releases/yarn-3.2.1.cjs",
      "--version",
    ]).trim(),
    bun: command(checkout, process.env.BUN_EXECUTABLE || "bun", [
      "--version",
    ]).trim(),
    npm: command(checkout, "npm", ["--version"]).trim(),
  };
  assert.deepEqual(
    tools,
    { node: "24.19.0", yarn: "3.2.1", bun: "1.3.14", npm: "11.17.0" },
    "Release tools must match the pinned versions"
  );
  return tools;
}
function validateRecord(record) {
  assert.equal(record.schema, 1, "Unsupported release record");
  assert.equal(record.package, PACKAGE);
  assert.equal(record.repository, REPOSITORY);
  const parsed = version(record.version, record.channel === "beta");
  assert.ok(["beta", "stable"].includes(record.channel));
  assert.equal(record.targetVersion, parsed.target);
  assert.match(record.source.commit, /^[a-f0-9]{40}$/);
  assert.equal(record.source.normalized.rule, NORMALIZATION);
  assert.match(record.source.normalized.sha256, /^[a-f0-9]{64}$/);
  assert.match(record.dispatcher.commit, /^[a-f0-9]{40}$/);
  assert.ok(Object.keys(record.dispatcher.files).length >= 2);
  assert.deepEqual(
    Object.keys(record.dispatcher.entries).sort(),
    Object.keys(record.dispatcher.files).sort(),
    "Dispatcher entries are incomplete"
  );
  for (const [name, entry] of Object.entries(record.dispatcher.entries)) {
    assert.ok(entry.mode === "100644" || entry.mode === "100755");
    assert.equal(entry.type, "blob");
    assert.match(record.dispatcher.files[name], /^[a-f0-9]{64}$/);
  }
  assert.equal(record.artifact.filename, "danielbaars-anthracite.tgz");
  assert.ok(
    Number.isSafeInteger(record.artifact.size) && record.artifact.size > 0
  );
  assert.match(record.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(
    record.artifact.integrity,
    /^sha512-[A-Za-z0-9+/]{86}==$/,
    "Invalid artifact integrity"
  );
  assert.equal(record.tests.passed, true);
  assert.deepEqual(
    record.tests.checks,
    [
      "locked-install",
      "build-lint",
      "typecheck",
      "curated-tarball",
      "isolated-install",
      "commands-completion-MCP",
    ],
    "Required release gates are incomplete"
  );
  assert.equal(record.distTag, record.channel === "beta" ? "beta" : "latest");
  assert.match(record.run.id || "", /^[1-9]\d*$/, "Invalid run ID");
  assert.match(record.run.attempt || "", /^[1-9]\d*$/, "Invalid run attempt");
  assert.match(
    record.run.actor || "",
    /^[A-Za-z0-9][A-Za-z0-9-]*$/,
    "Invalid run actor"
  );
  assert.deepEqual(
    record.tools,
    { node: "24.19.0", yarn: "3.2.1", bun: "1.3.14", npm: "11.17.0" },
    "Incomplete or unsupported release toolchain"
  );
  assert.ok(
    ["linux", "darwin", "win32"].includes(record.platform?.platform),
    "Invalid release platform"
  );
  assert.ok(
    ["arm64", "x64"].includes(record.platform.arch),
    "Invalid release architecture"
  );
  assert.ok(
    record.platform.runner === null ||
      (typeof record.platform.runner === "string" &&
        record.platform.runner.trim().length > 0),
    "Invalid runner context"
  );
  assert.equal(
    record.transformation.path,
    "apps/cli/package.json",
    "Invalid version transformation path"
  );
  assert.equal(
    record.transformation.to,
    record.version,
    "Version transformation target differs"
  );
  assert.match(
    record.transformation.from || "",
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/,
    "Invalid version transformation source"
  );
  if (record.channel === "stable") {
    assert.equal(
      record.transformation.from,
      record.version,
      "Stable manifest must already match"
    );
    assert.equal(
      record.assessment?.sourceEquivalent,
      true,
      "Missing stable source/approval assessment"
    );
    assert.equal(record.assessment.version, record.version);
    assert.equal(record.assessment.approval.actor, record.run.actor);
    assert.deepEqual(record.assessment.approval.run, record.run);
    assert.deepEqual(record.assessment.source, record.source);
    assert.deepEqual(record.assessment.dispatcher, record.dispatcher);
    assert.deepEqual(record.assessment.tools, record.tools);
    assert.deepEqual(record.assessment.before, record.before);
  }
  const latest = version(record.before.latest, false);
  assert.ok(
    newer(parsed.numbers, latest.numbers),
    "Record target must be newer than latest"
  );
  assert.match(
    record.before.latestIntegrity || "",
    /^sha512-/,
    "Missing latest integrity"
  );
  assert.ok(
    record.before.beta === null || typeof record.before.beta === "string",
    "Missing beta mapping"
  );
  if (record.before.beta !== null) version(record.before.beta, true);
  return record;
}
function verifyCapturedRecord(checkout, intent) {
  assert.deepEqual(
    sourceIdentity(checkout, intent.source.commit),
    intent.source.normalized,
    "Captured source identity differs"
  );
  assert.deepEqual(
    trackedDispatcher(checkout, intent.dispatcher.commit),
    intent.dispatcher,
    "Captured dispatcher identity differs"
  );
  const [mode, type] = git(
    checkout,
    "ls-tree",
    intent.source.commit,
    "--",
    "apps/cli/package.json"
  ).split(" ");
  assert.ok(
    ["100644", "100755"].includes(mode) && type === "blob",
    "CLI manifest must be a regular Git file"
  );
  const manifest = json(
    command(checkout, "git", [
      "show",
      `${intent.source.commit}:apps/cli/package.json`,
    ])
  );
  assert.equal(manifest.name, PACKAGE);
  assert.deepEqual(
    intent.transformation,
    {
      path: "apps/cli/package.json",
      from: manifest.version,
      to: intent.version,
    },
    "Unexpected staged-version transformation"
  );
}
function verifyArtifact(bytes, intent) {
  assert.equal(
    hash(bytes),
    intent.artifact.sha256,
    "Retained artifact checksum changed"
  );
  assert.equal(
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    intent.artifact.integrity,
    "Retained artifact integrity changed"
  );
  assert.equal(
    bytes.length,
    intent.artifact.size,
    "Retained artifact size changed"
  );
}
function verifyPackage(filename, intent) {
  const entries = command(path.dirname(filename), "tar", ["-tzf", filename])
    .trim()
    .split("\n")
    .sort();
  assert.deepEqual(
    entries,
    [
      "package/CREDITS.md",
      "package/LICENSE",
      "package/README.md",
      "package/THIRD_PARTY_NOTICES.md",
      "package/cli.cjs",
      "package/package.json",
    ],
    "Unexpected retained package contents"
  );
  const manifest = json(
    command(path.dirname(filename), "tar", [
      "-xOf",
      filename,
      "package/package.json",
    ])
  );
  assert.equal(manifest.name, PACKAGE);
  assert.equal(manifest.version, intent.version);
  assert.deepEqual(manifest.bin, { an: "cli.cjs", anthracite: "cli.cjs" });
  assert.equal(manifest.engines.node, ">=24");
  assert.deepEqual(manifest.scripts || {}, {});
  assert.deepEqual(manifest.dependencies || {}, {});
  assert.equal(manifest.private, undefined);
}
function verifyProvenance(proof, intent) {
  assert.ok(proof, "Published package or provenance is not yet visible");
  assert.equal(
    proof.signaturesVerified,
    true,
    "Registry signatures and attestations must verify"
  );
  assert.equal(proof.manifest.name, PACKAGE);
  assert.equal(proof.manifest.version, intent.version);
  assert.equal(proof.manifest.dist.integrity, intent.artifact.integrity);
  verifyArtifact(Buffer.from(proof.bytes), intent);
  const statement = proof.statement;
  assert.equal(statement.predicateType, "https://slsa.dev/provenance/v1");
  assert.ok(
    statement.subject.some(
      (subject) =>
        subject.name ===
          `pkg:npm/%40danielbaars/anthracite@${intent.version}` &&
        subject.digest.sha512 === hash(Buffer.from(proof.bytes), "sha512")
    ),
    "Provenance subject differs from tested artifact"
  );
  assert.deepEqual(
    statement.predicate.buildDefinition.externalParameters.workflow,
    {
      ref: "refs/heads/main",
      repository: `https://github.com/${REPOSITORY}`,
      path: ".github/workflows/release.yml",
    }
  );
  assert.ok(
    statement.predicate.buildDefinition.resolvedDependencies.some(
      (item) => item.digest?.gitCommit === intent.dispatcher.commit
    ),
    "Provenance dispatcher differs from retained intent"
  );
  assert.equal(
    statement.predicate.runDetails.metadata.invocationId,
    `https://github.com/${REPOSITORY}/actions/runs/${intent.run.id}/attempts/${intent.run.attempt}`,
    "Provenance publication attempt differs from retained intent"
  );
}
async function publishPrepared(request, services, context) {
  const tag = `v${request.version}`;
  const localIntent = fs.readFileSync(path.join(request.output, "intent.json"));
  const intent = validateRecord(json(localIntent));
  const isStable = request.operation === "stable";
  assert.equal(intent.channel, isStable ? "stable" : "beta");
  assert.equal(intent.version, request.version);
  assert.equal(intent.source.commit, request.source);
  assert.deepEqual(
    intent.dispatcher,
    context.dispatcher,
    "Retained dispatcher differs from execution"
  );
  assert.deepEqual(
    intent.tools,
    context.tools,
    "Retained tools differ from execution"
  );
  assert.deepEqual(
    intent.run,
    request.run,
    "Publication must use its retained run and attempt"
  );
  verifyCapturedRecord(request.checkout, intent);
  const release = await services.github.release(tag);
  assert.ok(release, "Missing durable release evidence");
  assert.equal(release.tag, tag);
  assert.equal(release.source, request.source);
  assert.equal(release.prerelease, !isStable);
  assert.equal(
    await services.github.tag(tag),
    request.source,
    "Prepared version tag moved"
  );
  for (const name of [
    "intent.json",
    "danielbaars-anthracite.tgz",
    "SHA256SUMS",
    "tests.json",
    ...(isStable
      ? [
          "assessment.json",
          "practice.json",
          "beta-intent.json",
          "beta-verification.json",
        ]
      : []),
  ]) {
    assert.ok(release.assets[name], `Missing durable ${name}`);
    assert.ok(
      Buffer.from(release.assets[name]).equals(
        fs.readFileSync(path.join(request.output, name))
      ),
      `Local and durable ${name} disagree`
    );
  }
  assert.deepEqual(
    json(release.assets["tests.json"]),
    intent.tests,
    "Retained test results disagree"
  );
  assert.deepEqual(
    intent.tests,
    {
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
    "Missing required release test results"
  );
  const filename = path.join(request.output, "danielbaars-anthracite.tgz");
  const bytes = fs.readFileSync(filename);
  verifyArtifact(bytes, intent);
  assert.equal(
    Buffer.from(release.assets.SHA256SUMS).toString(),
    `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
  );
  verifyPackage(filename, intent);
  if (isStable) {
    const temporaryAssessment = fs.mkdtempSync(
      path.join(os.tmpdir(), "anthracite-stable-recheck-")
    );
    try {
      const fresh = await assessStable(
        { ...request, output: temporaryAssessment },
        services,
        {
          metadata: await services.registry.snapshot(),
          dispatcher: dispatcherIdentity(request.checkout, request.dispatcher),
          tools: toolchain(request.checkout),
          main: await services.github.main(),
        }
      );
      assert.deepEqual(
        fresh,
        intent.assessment,
        "Stable approval/source/beta/practice assessment changed before publication"
      );
      for (const name of [
        "assessment.json",
        "practice.json",
        "beta-intent.json",
        "beta-verification.json",
      ])
        assert.ok(
          fs
            .readFileSync(path.join(temporaryAssessment, name))
            .equals(Buffer.from(release.assets[name])),
          `Stable durable ${name} changed`
        );
    } finally {
      fs.rmSync(temporaryAssessment, { recursive: true, force: true });
    }
  }
  const current = await services.registry.snapshot();
  assert.equal(current.name, PACKAGE);
  assert.equal(
    current["dist-tags"].latest,
    intent.before.latest,
    "Latest moved before publication"
  );
  assert.equal(
    current.versions[intent.before.latest]?.dist?.integrity,
    intent.before.latestIntegrity,
    "Latest stable integrity changed"
  );
  assert.ok(
    !current.versions[request.version],
    "Version already exists; do not publish again"
  );
  assert.equal(
    current["dist-tags"].beta || null,
    intent.before.beta,
    "Beta moved before publication"
  );
  assert.equal(
    await services.github.tag(tag),
    request.source,
    "Prepared version tag moved"
  );
  assert.deepEqual(
    dispatcherIdentity(request.checkout, request.dispatcher),
    intent.dispatcher
  );
  assert.deepEqual(
    sourceIdentity(request.checkout, request.source),
    intent.source.normalized
  );
  assert.deepEqual(
    toolchain(request.checkout),
    intent.tools,
    "Release tools changed before publication"
  );
  verifyArtifact(fs.readFileSync(filename), intent);
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-publish-")
  );
  let sent = false;
  try {
    const publishFile = path.join(temporary, "danielbaars-anthracite.tgz");
    fs.writeFileSync(publishFile, bytes, { flag: "wx", mode: 0o444 });
    sent = true;
    await services.registry.publish({
      tarball: publishFile,
      channel: intent.distTag,
      version: request.version,
    });
    const proof = await services.registry.inspect(request.version);
    verifyProvenance(proof, intent);
    const after = await services.registry.snapshot();
    assert.equal(after.name, PACKAGE);
    assert.equal(
      after.versions[request.version]?.dist?.integrity,
      intent.artifact.integrity,
      "Published version integrity changed"
    );
    assert.equal(
      await services.github.tag(tag),
      request.source,
      "Prepared version tag moved after publication"
    );
    assert.equal(
      after["dist-tags"].beta || null,
      isStable ? intent.before.beta : request.version,
      "Beta moved during publication; no tag repair attempted"
    );
    assert.equal(
      after["dist-tags"].latest,
      isStable ? request.version : intent.before.latest,
      "Latest moved during publication; no tag repair attempted"
    );
    assert.equal(
      after.versions[intent.before.latest]?.dist?.integrity,
      intent.before.latestIntegrity,
      "Latest stable integrity changed"
    );
    const verification = {
      schema: 1,
      status: "verified",
      channel: intent.channel,
      package: PACKAGE,
      repository: REPOSITORY,
      version: request.version,
      source: request.source,
      dispatcher: intent.dispatcher,
      run: intent.run,
      intentSha256: hash(localIntent),
      artifact: intent.artifact,
      provenance: {
        verified: true,
        dispatcher: intent.dispatcher.commit,
        run: intent.run,
      },
      tags: {
        latest: after["dist-tags"].latest,
        beta: after["dist-tags"].beta,
      },
      confirmedWrites: [`npm ${intent.channel} publication`],
    };
    const assetName = `verification-${request.run.id}-${request.run.attempt}.json`;
    const verificationBytes = Buffer.from(
      JSON.stringify(verification, null, 2) + "\n"
    );
    await services.github.retain({
      tag,
      source: request.source,
      prerelease: !isStable,
      assets: { [assetName]: verificationBytes },
    });
    fs.writeFileSync(path.join(request.output, assetName), verificationBytes, {
      flag: "wx",
    });
    return {
      ...verification,
      npmWrites: 1,
      next: isStable
        ? "Stable publication verified; retained beta and practice evidence preserved"
        : "Exercise this exact beta and retain practice evidence before explicit stable approval",
    };
  } catch (error) {
    throw new Error(
      `${
        sent
          ? "Publication requested; completion unconfirmed"
          : "No publication requested"
      } for ${request.version}: ${
        error.message
      }. Retained evidence preserved; inspect registry before retrying; no automatic republish or tag repair.`,
      { cause: error }
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function practiceReference(reference, betaVersion) {
  assert.equal(
    reference,
    `release:v${betaVersion}/practice.json`,
    "Unsupported practice evidence reference; use the selected beta release practice.json asset"
  );
  return reference;
}
function validatePractice(value, intent, intentSha256, actor) {
  assert.equal(value.schema, 1, "Unsupported practice record");
  assert.equal(value.package, PACKAGE);
  assert.equal(value.repository, REPOSITORY);
  assert.equal(value.betaVersion, intent.version, "Practice candidate differs");
  assert.equal(value.source, intent.source.commit, "Practice source differs");
  assert.equal(
    value.artifactIntegrity,
    intent.artifact.integrity,
    "Practice artifact differs"
  );
  assert.equal(value.intentSha256, intentSha256, "Practice intent differs");
  const timestamp = (input) => {
    assert.match(
      input || "",
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/,
      "Practice dates must be UTC ISO timestamps"
    );
    const result = Date.parse(input);
    assert.ok(Number.isFinite(result), "Invalid practice date");
    assert.equal(
      new Date(result).toISOString().replace(".000Z", "Z"),
      input.replace(".000Z", "Z"),
      "Invalid practice date"
    );
    return result;
  };
  const started = timestamp(value.startedAt);
  const ended = timestamp(value.endedAt);
  assert.ok(
    started <= ended && ended <= Date.now(),
    "Practice dates are inconsistent or in the future"
  );
  assert.ok(
    Number.isSafeInteger(value.workingDays) && value.workingDays >= 0,
    "Practice workingDays must be recorded"
  );
  assert.ok(
    value.workingDays <= Math.floor((ended - started) / 86400000) + 1,
    "Practice workingDays contradict the recorded dates"
  );
  const text = (input, message) =>
    assert.ok(typeof input === "string" && input.trim().length > 0, message);
  if (value.workingDays < 2)
    text(
      value.shorterPeriodJustification,
      "An explicitly justified shorter practice period is required"
    );
  for (const field of ["os", "arch", "node"])
    text(value.platform?.[field], `Practice platform ${field} is required`);
  assert.equal(
    typeof value.rewritesChanged,
    "boolean",
    "Practice rewrite applicability must be explicit"
  );
  assert.ok(Array.isArray(value.scenarios), "Practice scenarios are required");
  const required = [
    "synthetic-stacks",
    "daily-use",
    "merged-parent-unpublished-work",
    "trunk-advance",
    "conflict-continuation",
    "interruption-resumption",
  ];
  const scenarios = new Map();
  for (const scenario of value.scenarios) {
    text(scenario.id, "Practice scenario ID required");
    assert.ok(!scenarios.has(scenario.id), "Duplicate practice scenario");
    assert.ok(
      ["passed", "failed", "not-applicable"].includes(scenario.outcome),
      "Invalid practice scenario outcome"
    );
    assert.notEqual(
      scenario.outcome,
      "failed",
      "Failed practice scenario blocks stable release"
    );
    if (scenario.outcome === "not-applicable")
      text(scenario.reason, "Inapplicable scenario needs an explicit reason");
    else {
      text(scenario.notes, "Passed scenario needs retained outcome notes");
      const performed = timestamp(scenario.performedAt);
      assert.ok(
        performed >= started && performed <= ended,
        "Scenario date must lie within the practice period"
      );
    }
    scenarios.set(scenario.id, scenario);
  }
  for (const id of required)
    assert.ok(scenarios.has(id), `Missing practice scenario ${id}`);
  for (const id of ["synthetic-stacks", "daily-use"])
    assert.equal(scenarios.get(id).outcome, "passed", `${id} must pass`);
  assert.ok(
    timestamp(scenarios.get("synthetic-stacks").performedAt) <=
      timestamp(scenarios.get("daily-use").performedAt),
    "Synthetic practice must precede daily use"
  );
  assert.ok(
    Array.isArray(value.findings),
    "Practice findings must be recorded"
  );
  for (const finding of value.findings) {
    text(finding.id, "Finding ID required");
    assert.equal(typeof finding.blocking, "boolean");
    assert.equal(typeof finding.resolved, "boolean");
    text(finding.disposition, "Finding disposition required");
    assert.ok(
      !finding.blocking || finding.resolved,
      "Unresolved release-blocking finding"
    );
  }
  assert.equal(
    value.maintainer?.login,
    actor,
    "Practice decision must identify the approving maintainer"
  );
  assert.equal(
    value.maintainer.disposition,
    "approved",
    "Practice disposition is not approved"
  );
  text(value.maintainer.notes, "Maintainer practice disposition needs notes");
  return value;
}
async function assessStable(request, services, context) {
  const betaParsed = version(request.betaVersion, true);
  assert.equal(
    betaParsed.target,
    request.version,
    "Selected beta target differs from stable version"
  );
  assert.equal(
    request.tag,
    `v${request.version}`,
    "Stable operation requires the exact stable release tag"
  );
  assert.equal(
    await services.github.tag(request.tag),
    request.source,
    "Stable release tag moved or is missing"
  );
  const stableRelease = await services.github.release(request.tag);
  assert.ok(
    stableRelease &&
      stableRelease.source === request.source &&
      stableRelease.prerelease === false,
    "Existing stable GitHub release required"
  );
  const manifest = json(
    command(request.checkout, "git", [
      "show",
      `${request.source}:apps/cli/package.json`,
    ])
  );
  assert.equal(manifest.name, PACKAGE);
  assert.equal(
    manifest.version,
    request.version,
    "Stable source manifest must already match its tag"
  );
  const betaTag = `v${request.betaVersion}`;
  const release = await services.github.release(betaTag);
  assert.ok(
    release && release.prerelease === true && release.tag === betaTag,
    "Missing durable beta release"
  );
  const intentBytes = release.assets["intent.json"];
  assert.ok(intentBytes, "Missing beta intent record");
  const intent = validateRecord(json(intentBytes));
  assert.equal(intent.channel, "beta");
  assert.equal(intent.version, request.betaVersion);
  assert.equal(intent.targetVersion, request.version);
  assert.equal(release.source, intent.source.commit);
  assert.equal(
    await services.github.tag(betaTag),
    intent.source.commit,
    "Selected beta tag moved"
  );
  for (const commit of [intent.source.commit, intent.dispatcher.commit]) {
    assert.equal(
      git(request.checkout, "rev-parse", `${commit}^{commit}`),
      commit
    );
    git(request.checkout, "merge-base", "--is-ancestor", commit, context.main);
  }
  verifyCapturedRecord(request.checkout, intent);
  assert.deepEqual(
    context.dispatcher.files,
    intent.dispatcher.files,
    "Executing dispatcher differs from tested beta; another beta is required"
  );
  assert.deepEqual(
    context.dispatcher.entries,
    intent.dispatcher.entries,
    "Executing dispatcher entry modes/types differ from tested beta"
  );
  assert.deepEqual(
    context.tools,
    intent.tools,
    "Executing tools differ from tested beta"
  );
  const normalized = sourceIdentity(request.checkout, request.source);
  assert.deepEqual(
    normalized,
    intent.source.normalized,
    "Source differs from tested beta; another beta is required"
  );
  assert.deepEqual(
    json(release.assets["tests.json"]),
    intent.tests,
    "Beta retained tests disagree"
  );
  assert.equal(
    Buffer.from(release.assets.SHA256SUMS).toString(),
    `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
  );
  const betaArtifact = Buffer.from(
    release.assets["danielbaars-anthracite.tgz"]
  );
  verifyArtifact(betaArtifact, intent);
  const betaPackage = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-beta-proof-")
  );
  try {
    const filename = path.join(betaPackage, "danielbaars-anthracite.tgz");
    fs.writeFileSync(filename, betaArtifact, { flag: "wx" });
    verifyPackage(filename, intent);
  } finally {
    fs.rmSync(betaPackage, { recursive: true, force: true });
  }
  const verificationName = `verification-${intent.run.id}-${intent.run.attempt}.json`;
  const verificationBytes = release.assets[verificationName];
  assert.ok(verificationBytes, "Missing verified beta record");
  const verification = json(verificationBytes);
  assert.equal(verification.schema, 1);
  assert.equal(verification.status, "verified");
  assert.equal(verification.channel, "beta");
  assert.equal(verification.package, PACKAGE);
  assert.equal(verification.repository, REPOSITORY);
  assert.equal(verification.version, intent.version);
  assert.equal(verification.source, intent.source.commit);
  assert.equal(verification.intentSha256, hash(intentBytes));
  assert.deepEqual(verification.artifact, intent.artifact);
  assert.deepEqual(verification.dispatcher, intent.dispatcher);
  assert.deepEqual(verification.run, intent.run);
  assert.deepEqual(
    verification.confirmedWrites,
    ["npm beta publication"],
    "Beta publication effects are incomplete"
  );
  assert.deepEqual(verification.provenance, {
    verified: true,
    dispatcher: intent.dispatcher.commit,
    run: intent.run,
  });
  assert.equal(verification.tags.beta, intent.version);
  assert.equal(verification.tags.latest, intent.before.latest);
  assert.equal(
    context.metadata.versions[intent.version]?.dist?.integrity,
    intent.artifact.integrity,
    "Published beta integrity disagrees"
  );
  verifyProvenance(await services.registry.inspect(intent.version), intent);
  const reference = practiceReference(request.practice, intent.version);
  const evidence = await services.github.evidence(reference);
  assert.equal(
    evidence.reference,
    reference,
    "Practice evidence identity differs"
  );
  assert.match(
    evidence.author || "",
    /^[A-Za-z0-9][A-Za-z0-9-]*$/,
    "Practice evidence author is unavailable"
  );
  const practiceBytes = Buffer.from(evidence.bytes);
  const practice = validatePractice(
    json(practiceBytes),
    intent,
    hash(intentBytes),
    request.run.actor
  );
  assert.equal(
    await services.github.tag(request.tag),
    request.source,
    "Stable release tag moved during assessment"
  );
  assert.equal(
    await services.github.tag(betaTag),
    intent.source.commit,
    "Selected beta tag moved during assessment"
  );
  const assessment = {
    schema: 1,
    status: "assessed",
    package: PACKAGE,
    repository: REPOSITORY,
    channel: "stable",
    version: request.version,
    tag: request.tag,
    source: { commit: request.source, normalized },
    dispatcher: context.dispatcher,
    tools: context.tools,
    beta: {
      version: intent.version,
      source: intent.source.commit,
      dispatcher: intent.dispatcher,
      intentSha256: hash(intentBytes),
      verificationAsset: verificationName,
      verificationSha256: hash(verificationBytes),
      artifact: intent.artifact,
    },
    practice: {
      reference,
      sha256: hash(practiceBytes),
      author: evidence.author,
      workingDays: practice.workingDays,
      disposition: practice.maintainer.disposition,
    },
    approval: {
      actor: request.run.actor,
      version: request.version,
      run: request.run,
    },
    sourceEquivalent: true,
    before: {
      latest: context.metadata["dist-tags"].latest,
      latestIntegrity:
        context.metadata.versions[context.metadata["dist-tags"].latest].dist
          .integrity,
      beta: context.metadata["dist-tags"].beta || null,
    },
    npmWrites: 0,
    next: "Build and test the separately versioned stable artifact before explicitly authorized publication",
  };
  const assets = {
    "assessment.json": Buffer.from(JSON.stringify(assessment, null, 2) + "\n"),
    "practice.json": practiceBytes,
    "beta-intent.json": Buffer.from(intentBytes),
    "beta-verification.json": Buffer.from(verificationBytes),
  };
  fs.mkdirSync(request.output, { recursive: true });
  for (const [name, bytes] of Object.entries(assets)) {
    const filename = path.join(request.output, name);
    if (fs.existsSync(filename))
      assert.ok(
        fs.readFileSync(filename).equals(bytes),
        `Conflicting retained ${name}`
      );
    else fs.writeFileSync(filename, bytes, { flag: "wx" });
  }
  return assessment;
}

async function runRelease(
  request,
  services = require("./release-services.cjs").services()
) {
  assert.equal(request.repository, REPOSITORY, "Wrong repository");
  assert.ok(
    ["prepare-beta", "beta", "assess-stable", "stable"].includes(
      request.operation
    ),
    "Unsupported release operation"
  );
  if (["assess-stable", "stable"].includes(request.operation)) {
    version(request.version, false);
    assert.ok(
      request.channel === undefined || request.channel === "stable",
      "Wrong stable channel"
    );
    assert.equal(
      request.confirmation,
      request.version,
      "Stable confirmation must equal the intended stable version"
    );
  }
  if (request.operation === "beta") {
    assert.ok(
      typeof request.output === "string" && path.isAbsolute(request.output),
      "Explicit absolute output required"
    );
    assert.ok(
      fs.existsSync(path.join(request.output, "intent.json")),
      "Missing retained beta intent"
    );
    assert.ok(
      request.channel === undefined || request.channel === "beta",
      "Wrong beta channel"
    );
  }
  const isStable = ["assess-stable", "stable"].includes(request.operation);
  const parsed = version(request.version, !isStable);
  for (const field of ["source", "dispatcher"])
    assert.match(
      request[field] || "",
      /^[a-f0-9]{40}$/,
      `Expected immutable ${field} commit`
    );
  assert.ok(
    path.isAbsolute(request.checkout) && path.isAbsolute(request.output),
    "Explicit absolute paths required"
  );
  assert.match(request.run?.id || "", /^[1-9]\d*$/);
  assert.match(request.run?.attempt || "", /^[1-9]\d*$/);
  assert.match(request.run?.actor || "", /^[A-Za-z0-9][A-Za-z0-9-]*$/);
  assert.equal(
    git(request.checkout, "status", "--porcelain", "--untracked-files=no"),
    "",
    "Checkout must have no tracked changes"
  );
  const repository = await services.github.repository();
  assert.equal(repository.full_name, REPOSITORY);
  assert.equal(repository.default_branch, "main");
  const main = await services.github.main();
  assert.match(main, /^[a-f0-9]{40}$/);
  for (const commit of [request.source, request.dispatcher]) {
    assert.equal(
      git(request.checkout, "rev-parse", `${commit}^{commit}`),
      commit
    );
    git(request.checkout, "merge-base", "--is-ancestor", commit, main);
  }
  assert.equal(
    git(request.checkout, "rev-parse", "HEAD"),
    request.dispatcher,
    "Execute the captured dispatcher checkout"
  );
  const dispatcher = dispatcherIdentity(request.checkout, request.dispatcher);
  const tools = toolchain(request.checkout);
  const metadata = await services.registry.snapshot();
  assert.equal(metadata.name, PACKAGE);
  const latest = metadata["dist-tags"]?.latest;
  const stable = version(latest, false);
  assert.ok(
    newer(parsed.numbers, stable.numbers),
    "Target must be newer than latest"
  );
  const stablePackage = metadata.versions?.[latest];
  assert.equal(stablePackage?.name, PACKAGE);
  assert.equal(stablePackage?.version, latest);
  assert.match(stablePackage?.dist?.integrity || "", /^sha512-/);
  assert.ok(
    !metadata.versions[request.version],
    "Version already exists; reconcile retained intent before retrying"
  );
  for (const existing of isStable ? [] : Object.keys(metadata.versions)) {
    if (!/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(existing)) continue;
    const previous = version(existing, true);
    if (previous.target === parsed.target)
      assert.ok(parsed.beta > previous.beta, "Beta number must advance");
  }
  const tag = `v${request.version}`;
  const existingTag = await services.github.tag(tag);
  assert.ok(
    existingTag === null || existingTag === request.source,
    "Existing version tag changed source"
  );
  const context = { metadata, dispatcher, tools, main };
  let assessment;
  if (isStable) {
    assessment = await assessStable(request, services, context);
    if (request.operation === "assess-stable") return assessment;
    if (fs.existsSync(path.join(request.output, "intent.json")))
      return publishPrepared(request, services, context);
  }
  if (request.operation === "beta")
    return publishPrepared(request, services, {
      metadata,
      dispatcher,
      tools,
      main,
    });
  if (!isStable)
    assert.equal(
      await services.github.release(tag),
      null,
      "Release already exists; reconcile retained intent before retrying"
    );
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-release-stage-")
  );
  const stage = path.join(temporary, "source");
  try {
    command(temporary, "git", [
      "clone",
      "--no-hardlinks",
      "--no-checkout",
      request.checkout,
      stage,
    ]);
    command(stage, "git", ["checkout", "--detach", request.source]);
    const manifestPath = path.join(stage, "apps/cli/package.json");
    const [manifestMode, manifestType] = git(
      stage,
      "ls-tree",
      request.source,
      "--",
      "apps/cli/package.json"
    ).split(" ");
    assert.ok(
      ["100644", "100755"].includes(manifestMode) &&
        manifestType === "blob" &&
        fs.lstatSync(manifestPath).isFile(),
      "CLI manifest must be a regular Git and filesystem file"
    );
    const manifest = json(fs.readFileSync(manifestPath));
    assert.equal(manifest.name, PACKAGE);
    const previousVersion = manifest.version;
    if (isStable)
      assert.equal(
        manifest.version,
        request.version,
        "Stable source version must already match"
      );
    else {
      manifest.version = request.version;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }
    const config = path.join(temporary, "npmrc");
    fs.writeFileSync(config, "");
    const globalConfig = path.join(temporary, "global-npmrc");
    fs.writeFileSync(globalConfig, "");
    const buildEnv = {
      ...process.env,
      NPM_CONFIG_USERCONFIG: config,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      npm_config_cache: path.join(temporary, "npm-cache"),
    };
    for (const key of ["NODE_AUTH_TOKEN", "NPM_TOKEN"]) delete buildEnv[key];
    const log = fs.openSync(path.join(temporary, "build.log"), "w");
    const run = (file, args) =>
      command(stage, file, args, {
        stdio: ["ignore", log, log],
        timeout: 180000,
        env: buildEnv,
      });
    try {
      run(process.execPath, [
        ".yarn/releases/yarn-3.2.1.cjs",
        "install",
        "--immutable",
      ]);
      run(process.execPath, [
        ".yarn/releases/yarn-3.2.1.cjs",
        "turbo",
        "run",
        "build",
      ]);
      run(process.execPath, [
        ".yarn/releases/yarn-3.2.1.cjs",
        "workspace",
        PACKAGE,
        "check",
      ]);
      run(process.execPath, ["scripts/build-npm-package.cjs"]);
      run(process.execPath, ["scripts/test-npm-package.cjs"]);
    } catch (error) {
      throw new Error(
        `Release build/install gate failed: ${fs
          .readFileSync(path.join(temporary, "build.log"), "utf8")
          .slice(-6000)}`,
        { cause: error }
      );
    } finally {
      fs.closeSync(log);
    }
    assert.equal(
      await services.github.main(),
      main,
      "Main moved during preparation; select a fresh captured source"
    );
    const finalTag = await services.github.tag(tag);
    assert.ok(
      finalTag === null || finalTag === request.source,
      "Version tag moved during preparation"
    );
    const bytes = fs.readFileSync(
      path.join(stage, "release/npm/danielbaars-anthracite.tgz")
    );
    const tests = {
      passed: true,
      checks: [
        "locked-install",
        "build-lint",
        "typecheck",
        "curated-tarball",
        "isolated-install",
        "commands-completion-MCP",
      ],
    };
    const intent = validateRecord({
      schema: 1,
      channel: isStable ? "stable" : "beta",
      package: PACKAGE,
      repository: REPOSITORY,
      version: request.version,
      targetVersion: parsed.target,
      distTag: isStable ? "latest" : "beta",
      source: {
        commit: request.source,
        normalized: sourceIdentity(request.checkout, request.source),
      },
      dispatcher,
      tools,
      platform: {
        platform: process.platform,
        arch: process.arch,
        runner: process.env.RUNNER_OS || null,
      },
      transformation: {
        path: "apps/cli/package.json",
        from: previousVersion,
        to: request.version,
      },
      run: request.run,
      artifact: {
        filename: "danielbaars-anthracite.tgz",
        sha256: hash(bytes),
        integrity: `sha512-${createHash("sha512")
          .update(bytes)
          .digest("base64")}`,
        size: bytes.length,
      },
      before: {
        latest,
        beta: metadata["dist-tags"].beta || null,
        latestIntegrity: stablePackage.dist.integrity,
      },
      tests,
      ...(isStable ? { assessment } : {}),
    });
    const assets = {
      "intent.json": Buffer.from(JSON.stringify(intent, null, 2) + "\n"),
      "danielbaars-anthracite.tgz": bytes,
      SHA256SUMS: Buffer.from(
        `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
      ),
      "tests.json": Buffer.from(JSON.stringify(tests, null, 2) + "\n"),
    };
    if (isStable)
      for (const name of [
        "assessment.json",
        "practice.json",
        "beta-intent.json",
        "beta-verification.json",
      ])
        assets[name] = fs.readFileSync(path.join(request.output, name));
    fs.mkdirSync(request.output, { recursive: true });
    for (const [name, contents] of Object.entries(assets)) {
      const target = path.join(request.output, name);
      if (fs.existsSync(target))
        assert.equal(
          hash(fs.readFileSync(target)),
          hash(contents),
          `Conflicting retained ${name}`
        );
      else fs.writeFileSync(target, contents, { flag: "wx" });
    }
    await services.github.retain({
      tag,
      source: request.source,
      prerelease: !isStable,
      assets,
    });
    if (isStable) return publishPrepared(request, services, context);
    return {
      status: "prepared",
      channel: "beta",
      version: request.version,
      source: request.source,
      artifact: intent.artifact,
      tests,
      confirmedWrites: ["GitHub release evidence"],
      npmWrites: 0,
      next: "Publish only through the separately authorized beta operation",
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = {
  runRelease,
  validateRecord,
  verifyProvenance,
  sourceIdentity,
  dispatcherIdentity,
  toolchain,
  version,
  hash,
  PACKAGE,
  REPOSITORY,
};
if (require.main === module) {
  Promise.resolve()
    .then(() => {
      assert.equal(
        process.argv.length,
        3,
        "Usage: node scripts/release-channels.cjs request.json"
      );
      return runRelease(json(fs.readFileSync(process.argv[2])));
    })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`Release refused: ${error.message}`);
      process.exitCode = 1;
    });
}
