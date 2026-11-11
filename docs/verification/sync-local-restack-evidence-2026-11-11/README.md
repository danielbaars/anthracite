# Sync local-restack investigation artifacts

Baseline: public npm `@danielbaars/anthracite@0.7.0`, source `4fc0fa51a3f374c4346842d27aa0daee82baf3dc`, macOS ARM64 / Node 24.19.0. These are controlled GitHub-boundary observations with real temporary Git repositories and bare remotes, not live GitHub or candidate acceptance.

`raw/` contains unchanged JSON capture bytes from the investigation and the earlier stable-release public artifact proof. `baseline-runtime.json` ties the installed CLI bytes used here to that exact retained tarball. The nine-case CLI campaign, five-case initial strict diagnostic campaign, two-case raw-byte refinement and one two-branch probe overlap. They are not seventeen distinct acceptance cases. The probe evolved between those campaigns; the retained comparator is its final raw-byte version. Earlier diagnostic output is historical, not an endorsed proof algorithm.

The three probe scripts were adapted only for portable fixture discovery and output isolation. By default they load the existing compiled CLI fixture from a built checkout. Set `ANTHRACITE_RESEARCH_FIXTURE_MODULE` to an absolute compiled fixture module if using a different build. They require the checkout's existing test dependencies; no new test interface or package is introduced. Results go to a fresh temporary directory unless `ANTHRACITE_RESEARCH_OUTPUT_DIR` explicitly selects another output directory. Historical captures are not overwritten by default.

To reproduce the original failure after building a matching checkout and separately installing the exact public 0.7.0 package into an isolated prefix:

```sh
export ANTHRACITE_TEST_BINARY=/absolute/path/to/isolated/node_modules/.bin/an
export ANTHRACITE_RESEARCH_OUTPUT_DIR="$(mktemp -d)"
node docs/verification/sync-local-restack-evidence-2026-11-11/reproduce.cjs --expect-clear-explanation
```

The public baseline deliberately exits nonzero at the explanatory-message assertion after reproducing the exact menu and verifying abort preservation. Without that assertion switch it exits successfully after recording the baseline. It is not a candidate acceptance test: a corrected candidate should no longer produce the asserted old menu. Select named scenarios as arguments to `compare.cjs`, or run it without arguments for its ten retained scenarios. `stack-proof.cjs` validates paired parent-head comparison with the unchanged baseline CLI.

Only temporary fixtures create branches or write their local bare remotes. The gh executable is controlled by the existing fixture. The scripts do not use live GitHub, user projects or the active installation. Real PTY execution may require local process permissions. `SHA256SUMS` covers every retained file except itself.
