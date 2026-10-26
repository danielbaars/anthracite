# Anthracite

A standalone CLI for stacked Git branches and GitHub pull requests. Use **`an`** or **`anthracite`**.

Anthracite builds on [Charcoal](https://github.com/danerwilliams/charcoal) and the formerly open-source Graphite CLI. See [credits and provenance](CREDITS.md). It supports local stacks and GitHub PRs through `gh`; it does not implement every current Graphite feature or require a Graphite subscription.

## Install

Standalone binaries for macOS ARM64, macOS x64 and Linux x64 are available from [GitHub Releases](https://github.com/danielbaars/anthracite/releases). Node.js and Bun are not required to run a binary. Git is required; GitHub workflows also require an installed, authenticated [GitHub CLI](https://cli.github.com/).

Download and inspect the versioned installer, then run it:

```sh
curl -fsSLO https://raw.githubusercontent.com/danielbaars/anthracite/v0.1.1/scripts/install.sh
sh install.sh 0.1.1
```

The installer checks the release SHA-256 checksum and binary version, installs under `~/.local/share/anthracite/0.1.1`, and creates `~/.local/bin/an` and `~/.local/bin/anthracite`. It refuses to replace unrelated commands. It installs zsh completion for both names and preserves the previous shell configuration. Add `~/.local/bin` to your PATH if needed and open a new terminal.

```sh
an --version
an auth
an init --trunk main
an create my-change --message "Add my change"
an modify --commit --message "Extend my change"
an log short --stack
an submit --stack --draft
```

Stage changes with Git before `create` or `modify`, or choose the command's staging options deliberately. Use `an <command> --help` for details.

To uninstall the command links and completion block, use `sh scripts/uninstall.sh` from a clone. Version directories and preferences are retained for rollback. See [installation and upgrades](docs/installation.md), the [command reference](DOCUMENTATION.md), and [compatibility](COMPATIBILITY.md).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for pinned build tools, tests and release preparation. Source code, documentation, commit messages, issues and pull requests in this repository are written in English.

Licensed under the GNU Affero General Public License version 3; see [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).
