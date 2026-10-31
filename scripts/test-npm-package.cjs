#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const tarball = path.resolve(
  process.argv[2] || "release/npm/danielbaars-anthracite.tgz"
);
assert.ok(
  fs.existsSync(tarball),
  "Build the npm tarball before testing installation"
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "anthracite-npm-"));
const prefix = path.join(temporary, "npm prefix");
const home = path.join(temporary, "home");
fs.mkdirSync(home);
const config = path.join(temporary, "npmrc");
const globalConfig = path.join(temporary, "global-npmrc");
fs.writeFileSync(globalConfig, "");
fs.writeFileSync(config, "");
const env = {
  ...process.env,
  HOME: home,
  NODE_PATH: "",
  GRAPHITE_USER_CONFIG_PATH: path.join(home, "user-config"),
  XDG_CONFIG_HOME: path.join(home, "xdg"),
  GH_CONFIG_DIR: path.join(home, "gh"),
  NPM_CONFIG_USERCONFIG: config,
  NPM_CONFIG_GLOBALCONFIG: globalConfig,
  npm_config_cache: path.join(temporary, "cache"),
};
delete env.NODE_OPTIONS;
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;
delete env.NPM_TOKEN;
delete env.NODE_AUTH_TOKEN;
try {
  const installed = spawnSync(
    "npm",
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { env, encoding: "utf8", timeout: 60000 }
  );
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(
        prefix,
        "lib/node_modules/@danielbaars/anthracite/package.json"
      ),
      "utf8"
    )
  );
  const version = require("../apps/cli/package.json").version;
  assert.equal(manifest.name, "@danielbaars/anthracite");
  assert.equal(manifest.version, version);
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.dependencies || {}, {});
  assert.deepEqual(manifest.scripts || {}, {});
  assert.equal(manifest.engines.node, ">=24");
  for (const name of ["an", "anthracite"]) {
    const executable = path.join(prefix, "bin", name);
    for (const args of [
      ["--version"],
      ["--help"],
      ["completion"],
      ["--get-yargs-completions", name, "get", "--"],
    ]) {
      const result = spawnSync(executable, args, {
        cwd: home,
        env,
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(result.stdout.trim());
      if (args[0] === "--version") assert.equal(result.stdout.trim(), version);
      if (args[0] === "--get-yargs-completions")
        for (const option of [
          "--downstack",
          "--restack",
          "--checkout",
          "--no-restack",
          "--no-checkout",
        ])
          assert.ok(result.stdout.includes(option), option);
    }
  }
  const directory = path.join(
    prefix,
    "lib/node_modules/@danielbaars/anthracite"
  );
  for (const name of [
    "LICENSE",
    "CREDITS.md",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
  ])
    assert.ok(fs.statSync(path.join(directory, name)).size > 0, name);
  assert.deepEqual(fs.readdirSync(directory).sort(), [
    "CREDITS.md",
    "LICENSE",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "cli.cjs",
    "package.json",
  ]);
  for (const name of ["LICENSE", "CREDITS.md"])
    assert.equal(
      fs.readFileSync(path.join(directory, name), "utf8"),
      fs.readFileSync(path.join(root, name), "utf8")
    );
  console.log(
    "PASS npm offline installation, both commands, completion and curated contents"
  );
  const scenarios = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/mocha/bin/mocha.js"),
      "apps/cli/dist/test/commands/mcp_execution_cli.test.js",
      "apps/cli/dist/test/commands/mcp_lifecycle_cli.test.js",
      "apps/cli/dist/test/commands/frozen_submit_cli.test.js",
      "apps/cli/dist/test/commands/get_delivery_cli.test.js",
      "--grep",
      "scenario (3:|4:|16:|17:|14: accepts numeric-zero)|rechecks after the original configured pre-push hook|publishes an editable child on an existing frozen base|installed get workflow learns explicit options",
    ],
    {
      cwd: root,
      env: {
        ...env,
        ANTHRACITE_TEST_BINARY: path.join(prefix, "bin/an"),
        CHARCOAL_TEST_BINARY: "",
      },
      encoding: "utf8",
      timeout: 180000,
    }
  );
  process.stdout.write(scenarios.stdout || "");
  assert.equal(
    scenarios.status,
    0,
    scenarios.stderr || scenarios.error?.message
  );
  console.log(
    "PASS installed package real Git stacks, scoped get/MCP, same-build execution and numeric-zero cancellation"
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
