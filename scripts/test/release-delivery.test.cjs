const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const artifacts = process.env.ANTHRACITE_DELIVERY_ARTIFACTS;

test(
  "selected stable → beta → stable installation reconnects existing MCP discovery and execution",
  {
    skip: !artifacts && "Supply real retained release-process artifacts",
    timeout: 180000,
  },
  async () => {
    const {
      McpCliClient,
    } = require("../../apps/cli/dist/test/lib/mcp_client.js");
    const metadata = JSON.parse(
      fs.readFileSync(path.join(artifacts, "metadata.json"))
    );
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "anthracite-channel-switch-")
    );
    const home = path.join(temporary, "isolated home");
    const prefix = path.join(temporary, "npm prefix");
    fs.mkdirSync(home);
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const hostFiles = [
      ".zshrc",
      ".npmrc",
      ".anthracite_user_config",
      ".codex/config.toml",
    ].map((name) => path.join(os.homedir(), name));
    const snapshot = () =>
      hostFiles.map((name) => [
        name,
        fs.existsSync(name) ? digest(fs.readFileSync(name)) : null,
      ]);
    const before = snapshot();
    const sentinel = path.join(home, ".zshrc");
    fs.writeFileSync(
      sentinel,
      "# host configuration sentinel: no automatic shell changes\n"
    );
    const userconfig = path.join(temporary, "npmrc");
    const globalconfig = path.join(temporary, "global-npmrc");
    fs.writeFileSync(userconfig, "");
    fs.writeFileSync(globalconfig, "");
    const env = {
      ...process.env,
      HOME: home,
      NODE_PATH: "",
      SHELL: "/bin/zsh",
      PATH: path.join(prefix, "bin") + path.delimiter + process.env.PATH,
      GRAPHITE_USER_CONFIG_PATH: path.join(home, "user-config"),
      XDG_CONFIG_HOME: path.join(home, "xdg"),
      GH_CONFIG_DIR: path.join(home, "gh"),
      CODEX_HOME: path.join(home, "codex"),
      NPM_CONFIG_USERCONFIG: userconfig,
      NPM_CONFIG_GLOBALCONFIG: globalconfig,
      npm_config_cache: path.join(temporary, "cache"),
    };
    for (const key of [
      "NODE_OPTIONS",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "NPM_TOKEN",
      "NODE_AUTH_TOKEN",
    ])
      delete env[key];
    function run(command, args) {
      const result = spawnSync(command, args, {
        cwd: home,
        env,
        encoding: "utf8",
        timeout: 60000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout.trim();
    }
    let connection;
    let passed = false;
    try {
      run("git", ["init", "--quiet", home]);
      // Only the external registry selection is controlled; installs/CLI/SDK/server are real.
      const channels = {
        latest: metadata.artifacts.stable.version,
        beta: metadata.artifacts.beta.version,
      };
      for (const [tag, alias] of [
        ["latest", "an"],
        ["beta", "an"],
        ["latest", "anthracite"],
      ]) {
        const selected = Object.values(metadata.artifacts).find(
          (value) => value.version === channels[tag]
        );
        assert.ok(
          selected,
          `Missing exact artifact for captured ${tag} mapping`
        );
        const directory = path.join(
          artifacts,
          tag === "beta" ? "beta" : "stable"
        );
        for (const [filename, record] of Object.entries(selected.files))
          assert.equal(
            digest(fs.readFileSync(path.join(directory, filename))),
            record.sha256,
            filename
          );
        const tarball = path.join(directory, "danielbaars-anthracite.tgz");
        const bytes = fs.readFileSync(tarball);
        assert.equal(digest(bytes), selected.sha256);
        assert.equal(
          "sha512-" + createHash("sha512").update(bytes).digest("base64"),
          selected.integrity
        );
        run("npm", [
          "install",
          "--global",
          "--prefix",
          prefix,
          "--ignore-scripts",
          "--offline",
          "--no-audit",
          "--no-fund",
          tarball,
        ]);
        const packageDirectory = path.join(
          prefix,
          "lib/node_modules/@danielbaars/anthracite"
        );
        const manifest = JSON.parse(
          fs.readFileSync(path.join(packageDirectory, "package.json"))
        );
        assert.equal(manifest.version, channels[tag]);
        assert.equal(manifest.name, "@danielbaars/anthracite");
        for (const name of ["an", "anthracite"]) {
          const executable = path.join(prefix, "bin", name);
          assert.equal(
            fs.realpathSync(executable),
            fs.realpathSync(path.join(packageDirectory, "cli.cjs"))
          );
          assert.equal(
            run("/bin/zsh", ["-f", "-c", `command -v ${name}`]),
            executable
          );
          assert.equal(run(executable, ["--version"]), selected.version);
          assert.match(run(executable, ["--help"]), /Anthracite/i);
          const completion = run(executable, ["completion"]);
          assert.match(completion, /_an_yargs_completions/);
          fs.writeFileSync(path.join(home, "completion.zsh"), completion);
        }
        assert.equal(
          run("/bin/zsh", [
            "-f",
            "-c",
            'autoload -Uz compinit; compinit -D; source "$HOME/completion.zsh"; compdef _an_yargs_completions an anthracite; print -r -- "${_comps[an]} ${_comps[anthracite]}"',
          ]),
          "_an_yargs_completions _an_yargs_completions"
        );
        const executable = path.join(prefix, "bin", alias);
        connection = new McpCliClient(home, env, [executable, "mcp"]);
        try {
          await connection.connect();
          assert.deepEqual(connection.client.getServerVersion(), {
            name: "anthracite",
            version: selected.version,
          });
          const tools = (await connection.client.listTools()).tools.map(
            (tool) => tool.name
          );
          assert.ok(tools.includes("learn_an"));
          assert.ok(tools.includes("run_an_cmd"));
          const response = await connection.client.callTool({
            name: "run_an_cmd",
            arguments: {
              args: ["--version"],
              cwd: home,
              why: "Verify selected installed channel after reconnect",
            },
          });
          assert.equal(response.isError, false);
          assert.equal(response.content.length, 1);
          const result = JSON.parse(response.content[0].text);
          assert.equal(result.exitCode, 0);
          assert.equal(result.stdout.trim(), selected.version);
          assert.equal(result.status, "success");
          console.log(
            JSON.stringify({
              tag,
              selectedVersion: selected.version,
              source: selected.source.commit,
              sha256: selected.sha256,
              executable,
              realpath: fs.realpathSync(executable),
              mcp: "discovery/execution passed; closed before next installation",
            })
          );
        } finally {
          await connection.close();
          connection = undefined;
        }
      }
      assert.equal(
        fs.readFileSync(sentinel, "utf8"),
        "# host configuration sentinel: no automatic shell changes\n"
      );
      assert.deepEqual(snapshot(), before);
      assert.equal(fs.existsSync(env.CODEX_HOME), false);
      passed = true;
    } finally {
      await connection?.close();
      if (passed) fs.rmSync(temporary, { recursive: true, force: true });
      else
        console.error(
          `Preserved failed isolated consumer fixture: ${temporary}`
        );
    }
  }
);
