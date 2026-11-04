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
async function runRelease(
  request,
  services = require("./release-services.cjs").services()
) {
  assert.equal(request.repository, REPOSITORY, "Wrong repository");
  assert.equal(
    request.operation,
    "prepare-beta",
    "Unsupported release operation"
  );
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
