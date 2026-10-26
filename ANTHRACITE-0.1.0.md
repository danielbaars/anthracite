# Anthracite 0.1.0 — local release

Modified from Charcoal on 26 October 2026. Based on the verified freeze/unfreeze candidate `ba5737b877c6c77462517cba87f6bcf0235240bd`. The original LICENSE and upstream attribution remain intact. This local package is private and has not been published to npm or as a GitHub release.

Use `an` or `anthracite`. Both invoke the same native executable; help uses the short spelling. Git and GitHub CLI (`gh`) must be installed. `an auth` checks the existing GitHub CLI authentication.

```sh
an --version
an --help
an init --trunk main
an create my-change --message "My change"
an modify --commit --message "More work"
an log short --stack
an submit --stack --draft
```

The local installation is versioned under `~/.local/share/anthracite/0.1.0/`, with `~/.local/bin/an` and `~/.local/bin/anthracite` symlinks. zsh completion for both names is loaded from that versioned directory by a marked block in `~/.zshrc`. Open a fresh terminal after installation.

Anthracite uses `~/.anthracite_user_config` for its own preferences, without importing Graphite/Charcoal preferences. Existing `GRAPHITE_USER_CONFIG_PATH`, `CH_EDITOR` and `CH_PAGER` overrides remain supported. Repository config, branch metadata, cache/continuation formats and locking are inherited for existing-stack compatibility. Use one stack manager at a time in a repository; switching between Anthracite and Graphite does not synchronize their metadata. `gt` remains Graphite and `ch` remains the existing Charcoal installation.

To uninstall, remove only the two Anthracite symlinks and the marked Anthracite block in `~/.zshrc`. The versioned directory and preferences can be retained for rollback. No public registry package availability is claimed.

Build with the pinned Yarn release and TypeScript dependencies, then compile `apps/cli/dist/src/index.js` using Bun (`bun build --compile ...`). Original Charcoal installation scripts still target Charcoal and must not be used for this local release.
