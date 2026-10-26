#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runtime = process.argv[2] || "node";
const shard = Number(process.env.TEST_SHARD || 0);
const count = Number(process.env.TEST_SHARDS || 1);
if (
  !["node", "native"].includes(runtime) ||
  !Number.isInteger(shard) ||
  !Number.isInteger(count) ||
  count < 1 ||
  shard < 0 ||
  shard >= count
)
  throw new Error("Invalid test runtime or shard.");
const testRoot = path.join(root, "apps/cli/dist/test");
function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : entry.name.endsWith(".test.js")
        ? [path.join(directory, entry.name)]
        : []
    );
}
const filter = process.env.TEST_FILTER
  ? new RegExp(process.env.TEST_FILTER)
  : undefined;
const selected = files(testRoot)
  .sort()
  .filter(
    (file) =>
      !file.endsWith("/large_repo.test.js") &&
      (runtime === "node" || file.includes("/test/commands/")) &&
      (!filter || filter.test(file))
  )
  .filter((_, index) => index % count === shard);
if (selected.length === 0) throw new Error("No test files selected.");
const output = path.join(root, ".test-results", runtime, String(shard));
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "anthracite-suite-"));
const results = [];
let next = 0;
async function worker() {
  while (next < selected.length) {
    const file = selected[next++];
    const name = path.relative(testRoot, file).replaceAll(path.sep, "__");
    const env = {
      ...process.env,
      TMPDIR: temporary,
      TERM: "dumb",
      NO_COLOR: "1",
    };
    delete env.FORCE_COLOR;
    if (runtime === "node") {
      delete env.ANTHRACITE_TEST_BINARY;
      delete env.CHARCOAL_TEST_BINARY;
    }
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          path.join(root, "node_modules/mocha/bin/mocha.js"),
          file,
          "--reporter",
          "json",
        ],
        { cwd: path.join(root, "apps/cli"), env, timeout: 20 * 60 * 1000 }
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      child.on("error", (error) => {
        stderr += error.stack;
      });
      child.on("close", (status, signal) =>
        resolve({ status, signal, stdout, stderr })
      );
    });
    fs.writeFileSync(path.join(output, name + ".json"), result.stdout);
    fs.writeFileSync(path.join(output, name + ".stderr"), result.stderr);
    let report;
    try {
      report = JSON.parse(
        result.stdout.slice(result.stdout.indexOf('{\n  "stats":'))
      );
    } catch {
      /* A crashed child is reported as a failure below. */
    }
    const passed = result.status === 0 && report && report.stats.failures === 0;
    results.push({
      file: path.relative(testRoot, file),
      status: result.status,
      signal: result.signal,
      stats: report?.stats,
      passed,
    });
    console.log(
      `${passed ? "PASS" : "FAIL"} ${runtime} ${path.relative(
        testRoot,
        file
      )} (${report?.stats.passes ?? 0} passed, ${
        report?.stats.pending ?? 0
      } pending)`
    );
    if (!passed)
      console.error(
        report
          ? JSON.stringify(report.failures, null, 2)
          : result.stdout + result.stderr
      );
  }
}
async function main() {
  try {
    await Promise.all([worker(), worker()]);
    const summary = {
      runtime,
      shard,
      shards: count,
      files: results.length,
      passes: results.reduce((n, r) => n + (r.stats?.passes || 0), 0),
      pending: results.reduce((n, r) => n + (r.stats?.pending || 0), 0),
      failedFiles: results.filter((r) => !r.passed).length,
      results,
    };
    fs.writeFileSync(
      path.join(output, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n"
    );
    console.log(JSON.stringify({ ...summary, results: undefined }));
    if (summary.failedFiles) process.exitCode = 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
