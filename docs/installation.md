# Installation, upgrades and rollback

## npm installation

```sh
npm install --global @danielbaars/anthracite@latest
command -v an
command -v anthracite
an --version
anthracite --version
an --help
anthracite --help
```

Node.js 24+ and Git are required. GitHub workflows additionally require `gh auth login`. Bun and Yarn are build tools and are not required by npm users. The package bundles its dependencies and has no lifecycle scripts. npm does not configure completion automatically.

An unqualified installation also selects `latest`, the deliberately approved stable channel. Opt into `beta` only when a candidate has been published, or pin the exact version exercised:

```sh
npm install --global @danielbaars/anthracite@beta
# Example candidate version; this example does not assert public availability:
npm install --global @danielbaars/anthracite@0.7.0-beta.1
```

After every switch, run the resolution, version and help checks above. Both names must resolve to the selected npm prefix and the same installed package entry. With Node available, inspect their real paths:

```sh
node -e 'for (const p of process.argv.slice(1)) console.log(require("node:fs").realpathSync(p))' "$(command -v an)" "$(command -v anthracite)"
```

Check PATH order and refresh your shell's command cache or open a new terminal if an older executable still wins. Returning to `@latest` follows the current approved stable; `@0.6.9` is an exact known stable return option, after completing compatible pending recovery. See [release channels and practice acceptance](npm-release.md).

For example, after finishing compatible recovery, choose one stable return:

```sh
npm install --global @danielbaars/anthracite@latest
# Or pin the known stable executable instead of following the channel:
npm install --global @danielbaars/anthracite@0.6.9
```

Repeat the executable checks after returning. For zsh, regenerate a completion file from the selected executable:

```sh
mkdir -p "$HOME/.zsh/completions"
SHELL=/bin/zsh an completion > "$HOME/.zsh/completions/anthracite.zsh"
```

Source it after `compinit` in your shell configuration:

```zsh
autoload -Uz compinit
compinit
source "$HOME/.zsh/completions/anthracite.zsh"
compdef _an_yargs_completions an anthracite
```

Open a new terminal. Bash users can save `an completion` and source the file; fish users can save `an fish` as `~/.config/fish/completions/an.fish` and add `source ~/.config/fish/completions/an.fish` to a separate `anthracite.fish` file so either command loads the shared definitions. Check the relevant command output before changing existing completion configuration.

To switch from the standalone installer, first finish any interrupted Anthracite operation, then run `sh scripts/uninstall.sh` from a clone to remove only its managed links and completion block. Install the npm package and configure completion as above. Verify `command -v an`, `command -v anthracite` and both versions; an earlier PATH entry can mask the npm commands. Existing stacks and preferences remain usable. Do not force npm to overwrite unrelated commands.

Upgrade with `npm install --global @danielbaars/anthracite@latest`; roll back with an explicit previously published version. Uninstall with `npm uninstall --global @danielbaars/anthracite` and remove completion you configured manually. npm does not remove your stack data or preferences. Finish a pending rewrite before downgrading across recovery-format changes. Finish any pending get workflow and its continuation before downgrading; older releases cannot resume its graph-aware saved intent. Finish any pending new sync workflow before downgrading too; older releases cannot resume its saved graph, cleanup consent and checkout policy. Raw Git abort does not undo completed phases, and a saved record without a verified live rebase requires inspection rather than automatic retry. The [sync guide](sync.md) explains default maintenance, repository-wide refresh and the absence of an exact old PR-information-only flag recipe. Complete owned get, sync, absorb or land recovery using a compatible executable before downgrading. Inspect blockers and preserve recovery records; do not delete records or reset refs to make a downgrade proceed. Switching executables does not undo rewritten Git history, pushed commits, merged PRs or completed cleanup.

Existing MCP configurations using `an mcp` or `anthracite mcp` can stay unchanged when they resolve to the selected installation. Close the client's current MCP connection/server before updating; then restart or reconnect the client so it launches the selected executable. A running server does not replace itself when npm changes the executable on disk. Check the server-reported version, discover `run_an_cmd` and `learn_an`, and use `run_an_cmd` with `args: ["--version"]`, an absolute test-repository `cwd` and a nonempty `why` to confirm the selected version. See [the existing MCP interface](mcp.md). Installation and verification do not automatically edit shell configuration, MCP registration or stored stack/recovery metadata.

## Standalone installation

Install the standalone binary with `sh scripts/install.sh 0.1.1`. The versioned installer downloads only from this project's GitHub Releases. When `gh` is available it downloads assets with that account; public releases also support curl. Supported assets are `an-macos-arm64`, `an-macos-x64` and `an-linux-x64`. `SHA256SUMS`, `LICENSE` and `CREDITS.md` accompany every release.

For an already downloaded release, set `ANTHRACITE_RELEASE_DIR` to its directory before invoking the installer. The same checksum and version checks apply; this also supports offline installation.

Both commands are symlinks to a versioned binary below `~/.local/share/anthracite`. Existing links owned by this installation may be upgraded. An unrelated `an` or `anthracite` command causes installation to stop before changing the active installation. Reinstalling identical versioned assets is safe; different contents for an existing version are rejected.

The installer generates zsh completion, registers both command names, and manages a marked block in `${ZDOTDIR:-$HOME}/.zshrc`. A pre-change copy stays in the version directory. Other shell configuration is preserved. Open a new terminal after installing. For bash or fish, inspect `an completion` or `an fish` and install the generated script using your shell's normal mechanism.

`sh scripts/uninstall.sh` removes only Anthracite-owned command links and the marked completion block. Version directories, backups and `~/.anthracite_user_config` remain available. To roll back, run the installer for the earlier release using its verified assets; the binary's reported version must match. The private local 0.1.0 build is retained on the original machine as a separate rollback artifact.

Anthracite uses `gh auth` credentials. It does not need a Graphite token. User preferences live in `~/.anthracite_user_config`. Existing `CH_EDITOR`, `CH_PAGER` and `GRAPHITE_USER_CONFIG_PATH` overrides remain supported. Repository config, caches, locking, branch refs and continuation formats remain unchanged for upgrade compatibility. The `charcoal-continuation` marker is intentionally retained so interrupted 0.1.0 operations can continue after upgrading. Old dependency footers are recognized and replaced with an Anthracite footer.

Use one stack manager at a time in a repository. The different CLIs do not synchronize all their metadata. See [the compatibility reference](../COMPATIBILITY.md).

Historical context: the [get-update candidate verification](verification/get-updates-implementation-2026-10-31.md) used a temporary artifact with unchanged package metadata, distinguished by its recorded source/hash from public 0.5.1, which did not ship that update. These updates subsequently shipped; use the [get compatibility recipe and recovery limits](get.md) for current behavior.
