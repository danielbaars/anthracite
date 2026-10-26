# Installation, upgrades and rollback

Install the standalone binary with `sh scripts/install.sh 0.1.1`. The versioned installer downloads only from this project's GitHub Releases. While the repository is private, an authenticated `gh` installation is required. When `gh` is available it downloads assets with that account; public releases also support curl. Supported assets are `an-macos-arm64`, `an-macos-x64` and `an-linux-x64`. `SHA256SUMS`, `LICENSE` and `CREDITS.md` accompany every release.

For an already downloaded release, set `ANTHRACITE_RELEASE_DIR` to its directory before invoking the installer. The same checksum and version checks apply; this also supports offline installation.

Both commands are symlinks to a versioned binary below `~/.local/share/anthracite`. Existing links owned by this installation may be upgraded. An unrelated `an` or `anthracite` command causes installation to stop before changing the active installation. Reinstalling identical versioned assets is safe; different contents for an existing version are rejected.

The installer generates zsh completion, registers both command names, and manages a marked block in `${ZDOTDIR:-$HOME}/.zshrc`. A pre-change copy stays in the version directory. Other shell configuration is preserved. Open a new terminal after installing. For bash or fish, inspect `an completion` or `an fish` and install the generated script using your shell's normal mechanism.

`sh scripts/uninstall.sh` removes only Anthracite-owned command links and the marked completion block. Version directories, backups and `~/.anthracite_user_config` remain available. To roll back, run the installer for the earlier release using its verified assets; the binary's reported version must match. The private local 0.1.0 build is retained on the original machine as a separate rollback artifact.

Anthracite uses `gh auth` credentials. It does not need a Graphite token. User preferences live in `~/.anthracite_user_config`. Existing `CH_EDITOR`, `CH_PAGER` and `GRAPHITE_USER_CONFIG_PATH` overrides remain supported. Repository config, caches, locking, branch refs and continuation formats remain unchanged for upgrade compatibility. The `charcoal-continuation` marker is intentionally retained so interrupted 0.1.0 operations can continue after upgrading. Old dependency footers are recognized and replaced with an Anthracite footer.

Use one stack manager at a time in a repository. The different CLIs do not synchronize all their metadata. See [the compatibility reference](../COMPATIBILITY.md).
