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
    const local = fs.lstatSync(path.join(checkout, name));
    assert.ok(local.isFile(), `Executing dispatcher must be regular: ${name}`);
    if (process.platform !== "win32")
      assert.equal(
        Boolean(local.mode & 0o111),
        identity.entries[name].mode === "100755",
        `Executing dispatcher mode differs: ${name}`
      );
    if (name.startsWith("scripts/")) {
      const running = fs.lstatSync(path.join(__dirname, path.basename(name)));
      assert.ok(running.isFile(), `Running process must be regular: ${name}`);
      if (process.platform !== "win32")
        assert.equal(
          Boolean(running.mode & 0o111),
          identity.entries[name].mode === "100755",
          `Running process mode differs: ${name}`
        );
    }
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
function verifyProvenance(proof, intent, attempt = intent) {
  assert.ok(proof, "Published package or provenance is not yet visible");
  assert.equal(
    proof.signaturesVerified,
    true,
    "Registry signatures and attestations must verify"
  );
  assert.equal(
    proof.signerIdentity,
    "https://github.com/danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main",
    "Provenance signer is not the trusted release workflow"
  );
  assert.equal(proof.manifest.name, PACKAGE);
  assert.equal(proof.manifest.version, intent.version);
  assert.equal(
    proof.manifest.dist.integrity,
    intent.artifact.integrity,
    "Published artifact integrity disagrees"
  );
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
      (item) => item.digest?.gitCommit === attempt.dispatcher.commit
    ),
    "Provenance dispatcher differs from retained intent"
  );
  assert.equal(
    statement.predicate.runDetails.metadata.invocationId,
    `https://github.com/${REPOSITORY}/actions/runs/${attempt.run.id}/attempts/${attempt.run.attempt}`,
    "Provenance publication attempt differs from retained intent"
  );
}
const retainedNames = (stable) => [
  "intent.json",
  "danielbaars-anthracite.tgz",
  "SHA256SUMS",
  "tests.json",
  ...(stable
    ? [
        "assessment.json",
        "practice.json",
        "beta-intent.json",
        "beta-verification.json",
      ]
    : []),
];
function equalFile(filename, bytes, label) {
  if (fs.existsSync(filename))
    assert.ok(
      fs.readFileSync(filename).equals(bytes),
      `Conflicting retained ${label}`
    );
  else fs.writeFileSync(filename, bytes, { flag: "wx" });
}
function historicalLatest(metadata, intent) {
  const historical = metadata.versions?.[intent.before.latest];
  assert.equal(
    historical?.name,
    PACKAGE,
    "Historical latest package identity disagrees"
  );
  assert.equal(
    historical?.version,
    intent.before.latest,
    "Historical latest version disagrees"
  );
  assert.equal(
    historical?.dist?.integrity,
    intent.before.latestIntegrity,
    "Historical latest integrity disagrees"
  );
}
function validateAttempt(bytes, name, intent, intentBytes, checkout) {
  const attempt = json(bytes);
  assert.equal(attempt.schema, 1);
  assert.equal(attempt.status, "publication-intended");
  assert.equal(attempt.intentSha256, hash(intentBytes));
  assert.deepEqual(attempt.artifact, intent.artifact);
  assert.deepEqual(attempt.source, intent.source);
  assert.deepEqual(attempt.tools, intent.tools);
  assert.deepEqual(
    attempt.before,
    { latest: intent.before.latest, beta: intent.before.beta },
    "Retained attempt channel observations disagree"
  );
  assert.match(attempt.run?.id || "", /^[1-9]\d*$/);
  assert.match(attempt.run?.attempt || "", /^[1-9]\d*$/);
  assert.match(attempt.run?.actor || "", /^[A-Za-z0-9][A-Za-z0-9-]*$/);
  assert.equal(name, `attempt-${attempt.run.id}-${attempt.run.attempt}.json`);
  assert.deepEqual(
    trackedDispatcher(checkout, attempt.dispatcher.commit),
    attempt.dispatcher
  );
  assert.deepEqual(attempt.dispatcher.files, intent.dispatcher.files);
  assert.deepEqual(attempt.dispatcher.entries, intent.dispatcher.entries);
  if (intent.channel === "stable") {
    assert.equal(attempt.approval?.actor, attempt.run.actor);
    assert.equal(attempt.approval?.version, intent.version);
    assert.deepEqual(attempt.approval?.run, attempt.run);
    assert.equal(attempt.practiceSha256, intent.assessment.practice.sha256);
  }
  return attempt;
}
function publicationAttempts(release, intent, intentBytes, checkout) {
  return Object.entries(release.assets)
    .filter(([name]) => /^attempt-[1-9]\d*-[1-9]\d*\.json$/.test(name))
    .map(([name, bytes]) => ({
      name,
      bytes: Buffer.from(bytes),
      value: validateAttempt(bytes, name, intent, intentBytes, checkout),
    }));
}
function proofAttempt(proof, attempts, intent) {
  assert.ok(attempts.length, "Missing durable publication attempt");
  const invocation =
    proof?.statement?.predicate?.runDetails?.metadata?.invocationId;
  const selected = attempts.filter(
    ({ value }) =>
      invocation ===
      `https://github.com/${REPOSITORY}/actions/runs/${value.run.id}/attempts/${value.run.attempt}`
  );
  assert.equal(
    selected.length,
    1,
    "Provenance publication attempt has no exact retained identity"
  );
  verifyProvenance(proof, intent, selected[0].value);
  return selected[0];
}
function assertChannels(metadata, intent) {
  assert.equal(metadata.name, PACKAGE);
  historicalLatest(metadata, intent);
  assert.equal(
    metadata.versions[intent.version]?.dist?.integrity,
    intent.artifact.integrity,
    "Published version integrity changed"
  );
  assert.equal(
    metadata["dist-tags"].beta || null,
    intent.channel === "stable" ? intent.before.beta : intent.version,
    "Beta moved during publication; no tag repair attempted"
  );
  assert.equal(
    metadata["dist-tags"].latest,
    intent.channel === "stable" ? intent.version : intent.before.latest,
    "Latest moved during publication; no tag repair attempted"
  );
}
function verifyRetainedSet(release, intent, assets) {
  assert.ok(release, "Missing durable release evidence");
  assert.equal(release.tag, `v${intent.version}`);
  assert.equal(
    release.source,
    intent.source.commit,
    "Durable release source changed"
  );
  assert.equal(
    release.prerelease,
    intent.channel === "beta",
    "Durable release channel changed"
  );
  for (const [name, bytes] of Object.entries(assets))
    assert.ok(
      release.assets[name] && Buffer.from(release.assets[name]).equals(bytes),
      `Durable ${name} changed`
    );
}
async function hydratePrepared(request, services, release) {
  const local = path.join(request.output, "intent.json");
  const intentBytes = fs.existsSync(local)
    ? fs.readFileSync(local)
    : release?.assets["intent.json"];
  assert.ok(
    intentBytes,
    "Missing retained beta intent or durable original intent"
  );
  const intent = validateRecord(json(intentBytes));
  const stable = intent.channel === "stable";
  assert.equal(intent.version, request.version);
  assert.equal(intent.source.commit, request.source);
  verifyCapturedRecord(request.checkout, intent);
  const assets = {};
  for (const name of retainedNames(stable)) {
    const filename = path.join(request.output, name);
    const localBytes = fs.existsSync(filename)
      ? fs.readFileSync(filename)
      : null;
    const remote = release?.assets[name];
    if (localBytes && remote)
      assert.ok(
        localBytes.equals(Buffer.from(remote)),
        `Local and durable ${name} disagree`
      );
    assert.ok(
      localBytes || remote,
      `Missing original retained ${name}; cannot rebuild`
    );
    assets[name] = Buffer.from(localBytes || remote);
  }
  verifyArtifact(assets["danielbaars-anthracite.tgz"], intent);
  assert.deepEqual(
    json(assets["tests.json"]),
    intent.tests,
    "Retained test results disagree"
  );
  assert.equal(
    assets.SHA256SUMS.toString(),
    `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
  );
  if (stable) {
    assert.deepEqual(json(assets["assessment.json"]), intent.assessment);
    assert.equal(
      hash(assets["practice.json"]),
      intent.assessment.practice.sha256
    );
    assert.equal(
      hash(assets["beta-intent.json"]),
      intent.assessment.beta.intentSha256
    );
    assert.equal(
      hash(assets["beta-verification.json"]),
      intent.assessment.beta.verificationSha256
    );
  }
  fs.mkdirSync(request.output, { recursive: true });
  for (const [name, bytes] of Object.entries(assets))
    equalFile(path.join(request.output, name), bytes, name);
  verifyPackage(
    path.join(request.output, "danielbaars-anthracite.tgz"),
    intent
  );
  if (release) {
    assert.equal(release.tag, `v${request.version}`);
    assert.equal(release.source, request.source);
    assert.equal(release.prerelease, !stable);
    assert.equal(
      await services.github.tag(release.tag),
      request.source,
      "Prepared version tag moved"
    );
    // Complete interrupted uploads only with the already validated original bytes.
    if (retainedNames(stable).some((name) => !release.assets[name])) {
      await services.github.retain({
        tag: release.tag,
        source: request.source,
        prerelease: !stable,
        assets,
      });
      release = await services.github.release(release.tag);
    }
  } else {
    assert.equal(
      request.operation,
      "prepare-beta",
      "Missing durable release evidence; append cannot recreate release"
    );
    await services.github.retain({
      tag: `v${request.version}`,
      source: request.source,
      prerelease: true,
      assets,
      initialRetention: true,
    });
    release = await services.github.release(`v${request.version}`);
  }
  for (const [name, bytes] of Object.entries(assets))
    assert.ok(
      release?.assets[name] && Buffer.from(release.assets[name]).equals(bytes),
      `Missing durable ${name}`
    );
  return { intent, intentBytes: Buffer.from(intentBytes), release, assets };
}
function substantiveAssessment(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.approval.run;
  delete copy.dispatcher.commit;
  // Current mutable mappings are checked separately for an absent-version write.
  delete copy.before;
  return copy;
}
async function publishPrepared(request, services, context) {
  const tag = `v${request.version}`;
  const retained = await hydratePrepared(
    request,
    services,
    await services.github.release(tag)
  );
  const { intent, intentBytes } = retained;
  let release = retained.release;
  const isStable = request.operation === "stable";
  assert.equal(intent.channel, isStable ? "stable" : "beta");
  assert.deepEqual(
    intent.dispatcher.files,
    context.dispatcher.files,
    "Retained dispatcher differs from execution"
  );
  assert.deepEqual(
    intent.dispatcher.entries,
    context.dispatcher.entries,
    "Retained dispatcher entry modes differ from execution"
  );
  assert.deepEqual(
    intent.tools,
    context.tools,
    "Retained tools differ from execution"
  );
  const current = await services.registry.snapshot();
  historicalLatest(current, intent);
  const existing = Boolean(current.versions[request.version]);
  let attempts = publicationAttempts(
    release,
    intent,
    intentBytes,
    request.checkout
  );
  const deadline = Date.now() + 300000;
  let freshAssessment;
  if (isStable) {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "anthracite-stable-recheck-")
    );
    try {
      freshAssessment = await assessStable(
        { ...request, output: temporary },
        services,
        {
          metadata: current,
          dispatcher: context.dispatcher,
          tools: context.tools,
          main: await services.github.main(),
        }
      );
      assert.deepEqual(
        substantiveAssessment(freshAssessment),
        substantiveAssessment(intent.assessment),
        "Stable approval/source/beta/practice assessment changed before publication"
      );
      for (const name of [
        "practice.json",
        "beta-intent.json",
        "beta-verification.json",
      ])
        assert.ok(
          fs
            .readFileSync(path.join(temporary, name))
            .equals(retained.assets[name]),
          `Stable durable ${name} changed`
        );
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const finalRepository = await services.github.repository();
  assert.equal(finalRepository.full_name, REPOSITORY);
  assert.equal(finalRepository.default_branch, "main");
  const main = await services.github.main();
  for (const commit of [request.source, request.dispatcher])
    git(request.checkout, "merge-base", "--is-ancestor", commit, main);
  assert.equal(
    git(request.checkout, "rev-parse", "HEAD"),
    request.dispatcher,
    "Dispatcher checkout moved before publication"
  );
  assert.equal(
    git(request.checkout, "status", "--porcelain", "--untracked-files=no"),
    "",
    "Dispatcher checkout changed before publication"
  );
  assert.deepEqual(
    dispatcherIdentity(request.checkout, request.dispatcher),
    context.dispatcher
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
  assert.equal(
    await services.github.tag(tag),
    request.source,
    "Prepared version tag moved"
  );
  const filename = path.join(request.output, "danielbaars-anthracite.tgz");
  verifyArtifact(fs.readFileSync(filename), intent);
  let sent = false;
  let publishOutcome = existing
    ? "existing version; read-only reconciliation"
    : "no publication requested";
  let selected;
  let attempted;
  let publicVersionVisible = existing;
  let lastMappings = {
    latest: current["dist-tags"].latest,
    beta: current["dist-tags"].beta || null,
  };
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-publish-")
  );
  try {
    if (!existing) {
      const latest = version(current["dist-tags"].latest, false);
      assert.ok(
        newer(version(intent.version, !isStable).numbers, latest.numbers),
        "Target must be newer than latest"
      );
      assert.equal(
        current["dist-tags"].latest,
        intent.before.latest,
        "Latest moved before publication"
      );
      assert.equal(
        current["dist-tags"].beta || null,
        intent.before.beta,
        "Beta moved before publication"
      );
      if (!isStable)
        for (const value of Object.keys(current.versions)) {
          if (!/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(value)) continue;
          const previous = version(value, true),
            next = version(intent.version, true);
          if (previous.target === next.target)
            assert.ok(next.beta > previous.beta, "Beta number must advance");
        }
      const absent = await services.registry.inspect(request.version, {
        deadline,
      });
      assert.equal(
        absent,
        null,
        "Version existence changed before publication; reconcile before retrying"
      );
      const attempt = {
        schema: 1,
        status: "publication-intended",
        intentSha256: hash(intentBytes),
        source: intent.source,
        artifact: intent.artifact,
        tools: context.tools,
        dispatcher: context.dispatcher,
        run: request.run,
        before: {
          latest: current["dist-tags"].latest,
          beta: current["dist-tags"].beta || null,
        },
        ...(isStable
          ? {
              approval: freshAssessment.approval,
              practiceSha256: freshAssessment.practice.sha256,
            }
          : {}),
      };
      const name = `attempt-${request.run.id}-${request.run.attempt}.json`;
      assert.ok(
        !release.assets[name],
        "Previously attempted identity; use a new explicit run/attempt after verified absence"
      );
      const bytes = Buffer.from(JSON.stringify(attempt, null, 2) + "\n");
      validateAttempt(bytes, name, intent, intentBytes, request.checkout);
      equalFile(path.join(request.output, name), bytes, name);
      await services.github.retain({
        tag,
        source: request.source,
        prerelease: !isStable,
        assets: { [name]: bytes },
      });
      release = await services.github.release(tag);
      verifyRetainedSet(release, intent, retained.assets);
      assert.ok(
        release?.assets[name] &&
          Buffer.from(release.assets[name]).equals(bytes),
        "Attempt retention incomplete before publication"
      );
      attempts = publicationAttempts(
        release,
        intent,
        intentBytes,
        request.checkout
      );
      attempted = { name, bytes, value: attempt };
      const finalState = await services.registry.snapshot({ deadline });
      historicalLatest(finalState, intent);
      assert.equal(
        finalState["dist-tags"].latest,
        intent.before.latest,
        "Latest moved before publication"
      );
      assert.equal(
        finalState["dist-tags"].beta || null,
        intent.before.beta,
        "Beta moved before publication"
      );
      assert.ok(
        !finalState.versions[request.version],
        "Version existence changed before publication; reconcile before retrying"
      );
      assert.equal(
        await services.registry.inspect(request.version, { deadline }),
        null,
        "Version existence changed before publication; reconcile before retrying"
      );
      assert.equal(
        await services.github.tag(tag),
        request.source,
        "Prepared version tag moved before publication"
      );
      assert.deepEqual(
        dispatcherIdentity(request.checkout, request.dispatcher),
        context.dispatcher
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
      const publishFile = path.join(temporary, "danielbaars-anthracite.tgz");
      fs.writeFileSync(
        publishFile,
        retained.assets["danielbaars-anthracite.tgz"],
        { flag: "wx", mode: 0o444 }
      );
      sent = true;
      try {
        await services.registry.publish({
          tarball: publishFile,
          channel: intent.distTag,
          version: request.version,
        });
        publishOutcome = "publication accepted response";
      } catch (error) {
        publishOutcome =
          error.definiteRejection ||
          ["E403", "E400", "E401", "E409"].includes(error.code)
            ? `definite registry rejection: ${error.message}`
            : `publication response lost or unavailable: ${error.message}`;
      }
    }
    let proof,
      after,
      lastObservation = "package or provenance not yet visible";
    while (Date.now() < deadline) {
      try {
        after = await services.registry.snapshot({ deadline });
        assert.equal(after.name, PACKAGE);
        historicalLatest(after, intent);
        lastMappings = {
          latest: after["dist-tags"].latest,
          beta: after["dist-tags"].beta || null,
        };
        publicVersionVisible = Boolean(after.versions[request.version]);
        const expected = {
          latest: isStable ? intent.version : intent.before.latest,
          beta: isStable ? intent.before.beta : intent.version,
        };
        for (const channel of ["latest", "beta"])
          assert.ok(
            lastMappings[channel] === expected[channel] ||
              (sent && lastMappings[channel] === intent.before[channel]),
            `${
              channel === "latest" ? "Latest" : "Beta"
            } moved during publication; no tag repair attempted`
          );
        if (publicVersionVisible) {
          const published = after.versions[request.version];
          assert.equal(
            published.name,
            PACKAGE,
            "Published package identity disagrees"
          );
          assert.equal(
            published.version,
            request.version,
            "Published package version disagrees"
          );
          assert.equal(
            published.dist?.integrity,
            intent.artifact.integrity,
            "Published version integrity changed"
          );
        }
        proof = await services.registry.inspect(request.version, { deadline });
        if (proof) {
          const candidate = proofAttempt(proof, attempts, intent);
          after = await services.registry.snapshot({ deadline });
          lastMappings = {
            latest: after["dist-tags"].latest,
            beta: after["dist-tags"].beta || null,
          };
          publicVersionVisible = Boolean(after.versions[request.version]);
          assertChannels(after, intent);
          assert.equal(
            await services.github.tag(tag),
            request.source,
            "Prepared version tag moved after publication"
          );
          selected = candidate;
          break;
        }
        lastObservation = "Published package or provenance is not yet visible";
        if (publishOutcome.startsWith("definite registry rejection"))
          throw Error(`${publishOutcome}; version verified absent`);
      } catch (error) {
        if (!error.retryable) throw error;
        lastObservation = `public verification unavailable: ${error.message}`;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(2000, remaining))
      );
    }
    assert.ok(
      selected,
      `Public verification deadline exhausted: ${lastObservation}`
    );
    const actual = selected.value;
    const verification = {
      schema: 1,
      status: "verified",
      channel: intent.channel,
      package: PACKAGE,
      repository: REPOSITORY,
      version: request.version,
      source: request.source,
      dispatcher: actual.dispatcher,
      run: actual.run,
      intentSha256: hash(intentBytes),
      attemptSha256: hash(selected.bytes),
      artifact: intent.artifact,
      provenance: {
        verified: true,
        signerIdentity: proof.signerIdentity,
        dispatcher: actual.dispatcher.commit,
        run: actual.run,
      },
      tags: {
        latest: after["dist-tags"].latest,
        beta: after["dist-tags"].beta || null,
      },
      confirmedWrites: [`npm ${intent.channel} publication`],
    };
    const assetName = `verification-${actual.run.id}-${actual.run.attempt}.json`;
    const verificationBytes = Buffer.from(
      JSON.stringify(verification, null, 2) + "\n"
    );
    try {
      await services.github.retain({
        tag,
        source: request.source,
        prerelease: !isStable,
        assets: { [assetName]: verificationBytes },
      });
      const saved = await services.github.release(tag);
      verifyRetainedSet(saved, intent, retained.assets);
      assert.ok(
        saved.assets[selected.name] &&
          Buffer.from(saved.assets[selected.name]).equals(selected.bytes),
        "Durable publishing attempt changed"
      );
      assert.ok(
        saved?.assets[assetName] &&
          Buffer.from(saved.assets[assetName]).equals(verificationBytes),
        "Final durable verification readback failed"
      );
      equalFile(
        path.join(request.output, assetName),
        verificationBytes,
        assetName
      );
    } catch (error) {
      throw Error(
        `Package publication confirmed; durable verification incomplete: ${error.message}`
      );
    }
    return {
      ...verification,
      npmWrites: sent ? 1 : 0,
      publishOutcome,
      next: isStable
        ? "Stable publication verified; retained beta and practice evidence preserved"
        : "Exercise this exact beta and retain practice evidence before explicit stable approval",
    };
  } catch (error) {
    if (attempted) {
      const name = `observation-${attempted.value.run.id}-${attempted.value.run.attempt}.json`;
      const observation = Buffer.from(
        JSON.stringify(
          {
            schema: 1,
            status: publishOutcome.startsWith("definite registry rejection")
              ? "rejected"
              : "unconfirmed",
            intentSha256: hash(intentBytes),
            attemptSha256: hash(attempted.bytes),
            run: attempted.value.run,
            npmWrites: sent ? 1 : 0,
            publishOutcome,
            tags: lastMappings,
            publicVersionVisible,
            diagnostic: error.message,
          },
          null,
          2
        ) + "\n"
      );
      try {
        await services.github.retain({
          tag,
          source: request.source,
          prerelease: !isStable,
          assets: { [name]: observation },
        });
        equalFile(path.join(request.output, name), observation, name);
      } catch (retentionError) {
        error.message += `; observation retention incomplete: ${retentionError.message}`;
      }
    }
    throw new Error(
      `${
        sent
          ? "Publication requested; completion unconfirmed"
          : "No publication requested"
      } for ${request.version}: ${publishOutcome}; ${
        error.message
      }. Public version visible: ${publicVersionVisible}; observed tags: ${JSON.stringify(
        lastMappings
      )}. Retained evidence preserved; inspect registry before retrying; no automatic republish or tag repair.`,
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
  historicalLatest(context.metadata, intent);
  const attempts = publicationAttempts(
    release,
    intent,
    intentBytes,
    request.checkout
  );
  const selected = proofAttempt(
    await services.registry.inspect(intent.version),
    attempts,
    intent
  );
  const actual = selected.value;
  git(
    request.checkout,
    "merge-base",
    "--is-ancestor",
    actual.dispatcher.commit,
    context.main
  );
  const verificationName = `verification-${actual.run.id}-${actual.run.attempt}.json`;
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
  assert.deepEqual(verification.dispatcher, actual.dispatcher);
  assert.equal(verification.attemptSha256, hash(selected.bytes));
  assert.deepEqual(verification.run, actual.run);
  assert.deepEqual(
    verification.confirmedWrites,
    ["npm beta publication"],
    "Beta publication effects are incomplete"
  );
  assert.deepEqual(verification.provenance, {
    verified: true,
    signerIdentity:
      "https://github.com/danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main",
    dispatcher: actual.dispatcher.commit,
    run: actual.run,
  });
  assert.equal(verification.tags.beta, intent.version);
  assert.equal(verification.tags.latest, intent.before.latest);
  assert.equal(
    context.metadata.versions[intent.version]?.dist?.integrity,
    intent.artifact.integrity,
    "Published beta integrity disagrees"
  );
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

function validateRequest(request) {
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
    typeof request.checkout === "string" &&
      typeof request.output === "string" &&
      path.isAbsolute(request.checkout) &&
      path.isAbsolute(request.output),
    "Explicit absolute paths required"
  );
  assert.match(request.run?.id || "", /^[1-9]\d*$/);
  assert.match(request.run?.attempt || "", /^[1-9]\d*$/);
  assert.match(request.run?.actor || "", /^[A-Za-z0-9][A-Za-z0-9-]*$/);
  return { isStable, parsed };
}
async function runReleaseOwned(
  request,
  services = require("./release-services.cjs").services()
) {
  const { isStable, parsed } = validateRequest(request);
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
  const context = { metadata, dispatcher, tools, main };
  const retainedRelease = await services.github.release(`v${request.version}`);
  if (
    ["beta", "stable", "prepare-beta"].includes(request.operation) &&
    (retainedRelease?.assets["intent.json"] ||
      fs.existsSync(path.join(request.output, "intent.json")))
  ) {
    if (request.operation === "prepare-beta") {
      const retained = await hydratePrepared(
        request,
        services,
        retainedRelease
      );
      return {
        status: "prepared",
        channel: "beta",
        version: request.version,
        source: request.source,
        artifact: retained.intent.artifact,
        tests: retained.intent.tests,
        confirmedWrites: ["GitHub release evidence"],
        npmWrites: 0,
        next: "Publish only through the separately authorized beta operation",
      };
    }
    return publishPrepared(request, services, context);
  }
  if (request.operation === "beta")
    throw Error("Missing retained beta intent or durable original intent");
  assert.ok(
    request.operation === "assess-stable" ||
      !retainedRelease ||
      Object.keys(retainedRelease.assets).length === 0,
    "Missing original intent; cannot rebuild retained artifact"
  );
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
  let assessment;
  if (isStable) {
    assessment = await assessStable(request, services, context);
    if (request.operation === "assess-stable") return assessment;
  }
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
      initialRetention: !isStable,
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
async function runRelease(
  request,
  services = require("./release-services.cjs").services()
) {
  validateRequest(request);
  if (!["prepare-beta", "beta", "stable"].includes(request.operation))
    return runReleaseOwned(request, services);
  assert.ok(
    path.isAbsolute(request.checkout),
    "Explicit absolute checkout required"
  );
  const common = git(
    request.checkout,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  );
  const lock = path.join(common, "anthracite-release-publication.lock");
  const owner = `${process.pid}-${require("node:crypto").randomUUID()}`;
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "Owned release publication boundary is already held; preserving the existing owner and lock"
      );
    throw error;
  }
  const token = path.join(lock, "owner");
  try {
    fs.writeFileSync(token, owner, { flag: "wx" });
    return await runReleaseOwned(request, services);
  } finally {
    if (fs.existsSync(token) && fs.readFileSync(token, "utf8") === owner) {
      fs.unlinkSync(token);
      fs.rmdirSync(lock);
    }
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
