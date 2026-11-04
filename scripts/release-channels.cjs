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
  const digest = createHash("sha256");
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    const [mode, type, oid] = entry.slice(0, tab).split(" ");
    const filename = entry.slice(tab + 1);
    let contents = command(checkout, "git", ["cat-file", type, oid], {
      encoding: "buffer",
    });
    if (filename === "apps/cli/package.json") {
      const value = json(contents);
      value.version = "<release-version>";
      contents = Buffer.from(JSON.stringify(value));
    }
    if (filename === ".release-please-manifest.json") {
      const value = json(contents);
      value["apps/cli"] = "<release-version>";
      contents = Buffer.from(JSON.stringify(value));
    }
    if (filename === "apps/cli/CHANGELOG.md")
      contents = Buffer.from("<generated-cli-changelog>");
    digest.update(
      JSON.stringify([mode, type, filename, hash(contents)]) + "\n"
    );
  }
  return { rule: NORMALIZATION, sha256: digest.digest("hex") };
}
function dispatcherIdentity(checkout, commit) {
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
  const digests = {};
  for (const name of files) {
    const tracked = command(checkout, "git", ["show", `${commit}:${name}`], {
      encoding: "buffer",
    });
    assert.equal(
      hash(fs.readFileSync(path.join(checkout, name))),
      hash(tracked),
      `Executing dispatcher differs from captured ${name}`
    );
    if (name.startsWith("scripts/"))
      assert.equal(
        hash(fs.readFileSync(path.join(__dirname, path.basename(name)))),
        hash(tracked),
        `Running process differs from dispatcher ${name}`
      );
    digests[name] = hash(tracked);
  }
  return { commit, files: digests };
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
  assert.equal(record.artifact.filename, "danielbaars-anthracite.tgz");
  assert.ok(
    Number.isSafeInteger(record.artifact.size) && record.artifact.size > 0
  );
  assert.match(record.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(record.artifact.integrity, /^sha512-/);
  assert.equal(record.tests.passed, true);
  assert.equal(record.distTag, record.channel === "beta" ? "beta" : "latest");
  assert.ok(record.run.id && record.run.attempt && record.run.actor);
  assert.ok(
    record.tools.node &&
      record.tools.npm &&
      record.tools.yarn &&
      record.tools.bun
  );
  version(record.before.latest, false);
  return record;
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
async function publishBeta(request, services, context) {
  const tag = `v${request.version}`;
  const localIntent = fs.readFileSync(path.join(request.output, "intent.json"));
  const intent = validateRecord(json(localIntent));
  assert.equal(intent.channel, "beta");
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
  assert.deepEqual(
    intent.source.normalized,
    sourceIdentity(request.checkout, request.source),
    "Retained normalized source differs"
  );
  const sourceManifest = json(
    command(request.checkout, "git", [
      "show",
      `${request.source}:apps/cli/package.json`,
    ])
  );
  assert.deepEqual(
    intent.transformation,
    {
      path: "apps/cli/package.json",
      from: sourceManifest.version,
      to: request.version,
    },
    "Unexpected staged-version transformation"
  );
  const release = await services.github.release(tag);
  assert.ok(release, "Missing durable beta evidence");
  assert.equal(release.tag, tag);
  assert.equal(release.source, request.source);
  assert.equal(release.prerelease, true);
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
      channel: "beta",
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
      after["dist-tags"].beta,
      request.version,
      "Published beta tag does not match intended version"
    );
    assert.equal(
      after["dist-tags"].latest,
      intent.before.latest,
      "Latest moved during beta publication; no tag repair attempted"
    );
    assert.equal(
      after.versions[intent.before.latest]?.dist?.integrity,
      intent.before.latestIntegrity,
      "Latest stable integrity changed"
    );
    const verification = {
      schema: 1,
      status: "verified",
      channel: "beta",
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
      confirmedWrites: ["npm beta publication"],
    };
    const assetName = `verification-${request.run.id}-${request.run.attempt}.json`;
    const verificationBytes = Buffer.from(
      JSON.stringify(verification, null, 2) + "\n"
    );
    await services.github.retain({
      tag,
      source: request.source,
      prerelease: true,
      assets: { [assetName]: verificationBytes },
    });
    fs.writeFileSync(path.join(request.output, assetName), verificationBytes, {
      flag: "wx",
    });
    return {
      ...verification,
      npmWrites: 1,
      next: "Exercise this exact beta and retain practice evidence before explicit stable approval",
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
async function runRelease(
  request,
  services = require("./release-services.cjs").services()
) {
  assert.equal(request.repository, REPOSITORY, "Wrong repository");
  assert.ok(
    ["prepare-beta", "beta"].includes(request.operation),
    "Unsupported release operation"
  );
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
  const parsed = version(request.version, true);
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
  assert.match(request.run?.id || "", /^\d+$/);
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
  for (const existing of Object.keys(metadata.versions)) {
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
  if (request.operation === "beta")
    return publishBeta(request, services, {
      metadata,
      dispatcher,
      tools,
      main,
    });
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
    const manifest = json(fs.readFileSync(manifestPath));
    assert.equal(manifest.name, PACKAGE);
    const previousVersion = manifest.version;
    manifest.version = request.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
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
      channel: "beta",
      package: PACKAGE,
      repository: REPOSITORY,
      version: request.version,
      targetVersion: parsed.target,
      distTag: "beta",
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
    });
    const assets = {
      "intent.json": Buffer.from(JSON.stringify(intent, null, 2) + "\n"),
      "danielbaars-anthracite.tgz": bytes,
      SHA256SUMS: Buffer.from(
        `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
      ),
      "tests.json": Buffer.from(JSON.stringify(tests, null, 2) + "\n"),
    };
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
      prerelease: true,
      assets,
    });
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
