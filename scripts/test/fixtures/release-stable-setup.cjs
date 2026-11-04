const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function fixture() {
  const temp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "anthracite-stable-test-"))
  );
  const checkout = path.join(temp, "source");
  execFileSync("git", ["clone", "--no-hardlinks", root, checkout], {
    stdio: "ignore",
  });
  for (const name of fs
    .readdirSync(path.join(root, "scripts"))
    .filter((name) => /^release.*\.cjs$/.test(name)))
    fs.copyFileSync(
      path.join(root, "scripts", name),
      path.join(checkout, "scripts", name)
    );
  for (const name of fs.readdirSync(path.join(root, "scripts/test/fixtures")))
    fs.copyFileSync(
      path.join(root, "scripts/test/fixtures", name),
      path.join(checkout, "scripts/test/fixtures", name)
    );
  const commit = (message) => {
    git(checkout, "add", "-A");
    git(
      checkout,
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      message
    );
    return git(checkout, "rev-parse", "HEAD");
  };
  const source = commit("Capture tested release process");
  const state = {
    main: source,
    tags: {},
    releases: {},
    writes: [],
    registry: {
      name: "@danielbaars/anthracite",
      "dist-tags": { latest: "0.6.9" },
      versions: {
        "0.6.9": {
          name: "@danielbaars/anthracite",
          version: "0.6.9",
          dist: { integrity: "sha512-stable" },
        },
      },
    },
  };
  const statePath = path.join(temp, "state.json");
  const write = (value) => fs.writeFileSync(statePath, JSON.stringify(value));
  write(state);
  const request = {
    operation: "prepare-beta",
    repository: "danielbaars/anthracite",
    source,
    dispatcher: source,
    version: "0.7.0-beta.1",
    checkout,
    output: path.join(temp, "beta"),
    run: { id: "1234", attempt: "1", actor: "release-test" },
  };
  let invocations = 0;
  const invoke = (changes = {}, intent) => {
    invocations++;
    const started = performance.now();
    const input = path.join(temp, "input.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        process: path.join(checkout, "scripts/release-channels.cjs"),
        request: { ...request, ...changes },
        state: statePath,
        intent,
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(checkout, "scripts/test/fixtures/release-stable-driver.cjs"),
        input,
      ],
      {
        encoding: "utf8",
        timeout: 420000,
        env: process.env,
      }
    );
    if (process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE) {
      const directory = process.env.ANTHRACITE_RELEASE_PROCESS_EVIDENCE;
      fs.mkdirSync(directory, { recursive: true });
      const stem = `${path.basename(temp)}-${invocations}-${
        changes.operation || request.operation
      }`;
      fs.writeFileSync(
        path.join(directory, `${stem}.stdout.log`),
        result.stdout || ""
      );
      fs.writeFileSync(
        path.join(directory, `${stem}.stderr.log`),
        result.stderr || ""
      );
    }
    console.log(
      `Release process ${invocations} ${
        changes.operation || request.operation
      }: ${(performance.now() - started).toFixed(0)}ms, status ${result.status}`
    );
    return result;
  };
  return { temp, checkout, state, statePath, write, request, invoke, commit };
}
function statement(intent) {
  return {
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [
      {
        name: `pkg:npm/%40danielbaars/anthracite@${intent.version}`,
        digest: {
          sha512: Buffer.from(
            intent.artifact.integrity.slice(7),
            "base64"
          ).toString("hex"),
        },
      },
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/danielbaars/anthracite",
            path: ".github/workflows/release.yml",
          },
        },
        resolvedDependencies: [
          { digest: { gitCommit: intent.dispatcher.commit } },
        ],
      },
      runDetails: {
        metadata: {
          invocationId: `https://github.com/danielbaars/anthracite/actions/runs/${intent.run.id}/attempts/${intent.run.attempt}`,
        },
      },
    },
  };
}
function practice(intent, intentSha256) {
  return {
    schema: 1,
    package: "@danielbaars/anthracite",
    repository: "danielbaars/anthracite",
    betaVersion: intent.version,
    source: intent.source.commit,
    artifactIntegrity: intent.artifact.integrity,
    intentSha256,
    startedAt: "2026-11-02T09:00:00Z",
    endedAt: "2026-11-04T09:00:00Z",
    workingDays: 2,
    platform: { os: "darwin", arch: "arm64", node: "24.19.0" },
    rewritesChanged: false,
    scenarios: [
      {
        id: "synthetic-stacks",
        outcome: "passed",
        performedAt: "2026-11-02T09:00:00Z",
        notes: "Synthetic parent/child fixture exercised.",
      },
      {
        id: "daily-use",
        outcome: "passed",
        performedAt: "2026-11-04T09:00:00Z",
        notes: "Summarized personal use; no private project contents.",
      },
      ...[
        "merged-parent-unpublished-work",
        "trunk-advance",
        "conflict-continuation",
        "interruption-resumption",
      ].map((id) => ({
        id,
        outcome: "not-applicable",
        reason:
          "Only release orchestration changed; Git rewrite implementation is unchanged.",
      })),
    ],
    findings: [],
    maintainer: {
      login: "release-test",
      disposition: "approved",
      notes: "Scenarios reviewed for this exact candidate.",
    },
  };
}

module.exports = { fixture, statement, practice, git };
