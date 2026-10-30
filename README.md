# Anthracite

A CLI for stacked Git branches and GitHub pull requests. Use **`an`** or **`anthracite`**.

Anthracite builds on [Charcoal](https://github.com/danerwilliams/charcoal) and the formerly open-source Graphite CLI. See [credits and provenance](CREDITS.md). It supports local stacks and GitHub PRs through `gh`; it does not implement every current Graphite feature or require a Graphite subscription.

See the [0.4.0 Graphite parity register](docs/graphite-parity.md) for shipped work, remaining interfaces, deliberate differences and evidence limits.

## Install

Install the npm package with Node.js 24 or newer:

```sh
npm install --global @danielbaars/anthracite
an --version
```

Git is required; GitHub workflows also require an installed, authenticated [GitHub CLI](https://cli.github.com/). npm installs both `an` and `anthracite`. It does not modify shell configuration. See [completion and migration from the standalone installer](docs/installation.md).

Standalone binaries for macOS ARM64, macOS x64 and Linux x64 are also available from [GitHub Releases](https://github.com/danielbaars/anthracite/releases). They do not require Node.js or Bun. From a clone, run `sh scripts/install.sh 0.1.1` to install that standalone release with checksum verification and zsh completion.

```sh
an --version
an auth
an init --trunk main
an create my-change --message "Add my change"
an modify --commit --message "Extend my change"
an log short --stack
an submit --stack --draft
```

For a shared prerequisite below selected branches, see [targeted insertion](docs/targeted-insertion.md).

Stage changes with Git before `create` or `modify`, or choose the command's staging options deliberately. Use `an <command> --help` for details.

Use `an split --by-file 'path/**'` or `an sp -f path` to extract selected committed files into a prerequisite while retaining the original branch. See [file splitting, history and recovery](docs/split.md).

Use `an submit --reviewers alice --assignees @me --roles-branch my-change` to add roles only to one selected PR while retaining the usual submission scope. See [reviewers, assignees and submission scope](docs/submit.md).

Use `an pr [branch]` for fresh GitHub PR information, `--stack` for its connected stack, or `--web` to explicitly open the selected PR. See [PR inspection and preserved local state](docs/pr.md).

Use `an review [branch]` to inspect its diff or submit one explicit review bound to `--head`; see [review actions and uncertain responses](docs/review.md).

Use `an land [branch] --dry-run` to preview scoped bottom-up rebase landing, mandatory surviving-branch maintenance and readiness blockers. Application currently refuses before writes. See [scoped landing preview](docs/land.md).

To uninstall an npm installation, run `npm uninstall --global @danielbaars/anthracite`. For a standalone installation, remove the command links and managed completion block using `sh scripts/uninstall.sh` from a clone. Version directories and preferences are retained for rollback. See [installation and upgrades](docs/installation.md), the [command reference](DOCUMENTATION.md), and [compatibility](COMPATIBILITY.md).

## MCP

Coding agents can use `an mcp` or `anthracite mcp` as a local stdio server. See [MCP configuration, tools and recovery](docs/mcp.md) for a generic client configuration, explicit request arguments, execution limits and interruption behavior.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for pinned build tools, tests and release preparation. Source code, documentation, commit messages, issues and pull requests in this repository are written in English.

Licensed under the GNU Affero General Public License version 3; see [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).
