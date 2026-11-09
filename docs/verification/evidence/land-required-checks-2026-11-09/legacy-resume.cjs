const fs = require("fs");
const assert = require("assert/strict");
const root = process.argv[2];
assert.ok(root, "Supply the absolute candidate checkout path");
const { RelationCliFixture } = require(root +
  "/apps/cli/dist/test/lib/fixtures/relation_cli.js");
const { prepareLand } = require(root +
  "/apps/cli/dist/test/lib/fixtures/land_gh.js");
const fixture = new RelationCliFixture();
try {
  const github = prepareLand(fixture);
  const policy = JSON.parse(fs.readFileSync(github.policy, "utf8"));
  fs.writeFileSync(
    github.policy,
    JSON.stringify({ ...policy, pendingAfterPush: true })
  );
  const command = process.env.ANTHRACITE_TEST_BINARY;
  process.env.ANTHRACITE_TEST_BINARY = process.argv[3];
  const version = fixture.run(["--version"]);
  assert.match(version.stdout, /0\.6\.15/);
  const stopped = fixture.run([
    "land",
    "child",
    "--yes",
    "--wait-timeout",
    "0",
  ]);
  assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
  assert.match(stopped.stderr, /Check wait timed out before #18/);
  const saved = fs.readFileSync(fixture.repo + "/.git/.anthracite_landing");
  process.env.ANTHRACITE_TEST_BINARY = command;
  fs.writeFileSync(github.policy, JSON.stringify(policy));
  const prs = JSON.parse(fs.readFileSync(github.state, "utf8"));
  for (const pr of prs) {
    pr.mergeStateStatus = "UNSTABLE";
    pr.statusCheckRollup = [
      {
        __typename: "CheckRun",
        name: "publish-beta",
        status: "COMPLETED",
        conclusion: "FAILURE",
      },
    ];
  }
  fs.writeFileSync(github.state, JSON.stringify(prs));
  const before = fixture.inspectionSnapshot();
  const preview = fixture.run(["land", "child", "--dry-run"]);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.deepEqual(fixture.inspectionSnapshot(), before);
  assert.deepEqual(
    fs.readFileSync(fixture.repo + "/.git/.anthracite_landing"),
    saved
  );
  const resumed = fixture.run([
    "land",
    "child",
    "--yes",
    "--wait-timeout",
    "0",
  ]);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.ok(resumed.stdout.startsWith(preview.stdout));
  assert.equal(
    fs.readFileSync(github.calls, "utf8").split('"PUT"').length - 1,
    2
  );
  assert.equal(fixture.git(["show", "main:child.txt"]), "child");
  fs.writeFileSync(
    process.argv[4],
    JSON.stringify(
      {
        producer: version.stdout.trim(),
        version: JSON.parse(saved).version,
        stopped: {
          status: stopped.status,
          stdout: stopped.stdout,
          stderr: stopped.stderr,
        },
        preview: { status: preview.status, stdout: preview.stdout },
        resumed: { status: resumed.status, stdout: resumed.stdout },
        preservingPreview: true,
        mergeRequests: 2,
      },
      null,
      2
    )
  );
  console.log(
    "PASS: real public 0.6.15 recovery resumes with optional failure; two total merges; preview preserves saved bytes."
  );
} finally {
  fixture.cleanup();
}
