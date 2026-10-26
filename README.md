# Anthracite

A local fork of [Charcoal](https://github.com/danerwilliams/charcoal), extended toward modern Graphite CLI compatibility. Modified on 26 October 2026.

## Local version 0.1.0

Use **`an`** or **`anthracite`**. See [the local release guide](ANTHRACITE-0.1.0.md) for installation paths, completion, configuration compatibility and rollback. This version is not published to npm, Homebrew or GitHub releases. The original Charcoal installation scripts do not install Anthracite.

## Announcement

Check out my blog post announcement [here](https://danewilliams.com/announcing-charcoal) 🙂

## What is Graphite?

From Graphite:

> [Graphite](https://graphite.dev) is a **fast, simple code review platform** designed for engineers who want to **write and review smaller pull requests, stay unblocked, and ship faster**. Anyone can start using Graphite individually without needing their coworkers to change tools - we'll seamlessly sync your code changes and reviews. We built Graphite because we missed internal code review tools like Phabricator (at Facebook) and Critique (Google) that help engineers create, approve, and ship small, incremental changes, and long-term we’re passionate about creating products & workflows that help fast-moving eng teams achieve more.

## What is Charcoal?

Charcoal is an open-source fork of the formerly public Graphite CLI. It supports local stacked-branch workflows and GitHub PRs through `gh`; it does not implement every current Graphite feature.

On 7/14/2023 the Graphite team announced that they closed open source development of the Graphite CLI and [moved development to their private monorepo](https://github.com/withgraphite/graphite-cli). They also added a pay wall limiting free users to 10 open stacks at a time per organization starting 8/7/2023.

Graphite is an amazing company and you should absolutely check out their products. In addition to a stacking CLI, they have an entire code review platform, merge queue, and more developer productivity tools.

However, many organizations aren't interested in paying for Graphite's team plan at this time.

The Graphite CLI does not need to depend on Graphite's API, so this project lets you use it with your own GitHub repositories, entirely for free.

> [!NOTE]
> Anthracite talks to GitHub through the [GitHub CLI (`gh`)](https://cli.github.com) rather than Graphite's API, so PR features (`submit`, `get`, PR-aware `sync`) require `gh` to be installed and authenticated (`an auth`) and work with **GitHub** repositories. Local stacking commands work with any git repo. (Earlier versions aspired to support GitLab/Bitbucket; that isn't implemented.)

## Commands

Anthracite uses a flat command surface that mirrors modern Graphite, e.g.:

```sh
an create -m "my change"   # create a branch + commit staged changes
an modify -a               # amend the current branch and restack upstack
an freeze                  # protect this branch and its downstack before trunk
an unfreeze                # make this branch and its upstack editable
an get teammate-branch     # new imports from other/unknown authors are frozen
an g 123 -U                # explicitly import new branches editable
an ss                      # push the stack and open/update PRs
an sync                    # sync trunk/PR info, safe cleanup and optional restack
an ls                      # view your stacks
an up / an down            # move through the stack
an checkout                # interactively switch branches
```

See **[DOCUMENTATION.md](./DOCUMENTATION.md)** for the command reference and **[COMPATIBILITY.md](./COMPATIBILITY.md)** for supported aliases, deliberate differences and deferred features. Frozen branches block managed content/structural edits and publication while remaining usable as anchors for editable children. Administration and direct/raw Git have explicit boundaries in the compatibility document. Source-candidate changes do not imply that an installed release already includes them.

> [!NOTE]
> Graphite's own docs (<https://graphite.dev/docs/graphite-cli/>) have diverged
> from this fork — they now require a Graphite account and document commands that
> differ from Charcoal's. Use [DOCUMENTATION.md](./DOCUMENTATION.md) instead.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)
