# Submit comparison evidence

The [report](../../../research/submit-comparison-2026-11-01.md) describes the boundary and conclusions. This directory retains seven paired cases, five separate Anthracite component controls, and one earlier successful exploratory Graphite capture. It is not a product regression suite or live-publication certification.

- `observations.json`: independent real-Git before/after state, Anthracite command results, separate restack controls, and local bare-remote observations.
- `rea-captures.json`: complete accepted REA records for the seven Graphite cases and one exploratory preview. Case name `apply` means explicit `--restack=false`; every accepted submit command was a dry-run, not a publication attempt.
- `identities.json`: installed versions, SHA-256 digests and released source identity.
- `gt-submit-help.txt`, `an-submit-help.txt`: combined stdout/stderr help captures. Graphite writes its help to stderr with exit 0.
- `source-options.md`: secondary help/source findings. These are not live metadata/review observations.
- `gh-fixture.cjs`, `helper-calls.jsonl`: exact controlled helper and its calls; no real `gh` was executed by that helper.
- `live-pr-boundary.json`, `source-comparison.json`: bounded read-only live PR absence and examined release-source blob comparison.
- `fixture.py`: actual fixture builder and ordinary-process helpers, with original scratch paths and tool locations. No credential value is embedded; Graphite setup copies an existing auth file privately.
- `verify_states.py`: read-only checks over the retained JSON.
- `validation.json`, `manifest.json`: retained-outcome verification and hashes of the selected evidence files.

Run `python3 docs/verification/evidence/submit-comparison-2026-11-01/verify_states.py` from the repository to recheck outcomes. It starts no CLI and uses no network.

Execution replay needs a fresh scratch root, the pinned tools and separately available Graphite read access. Update the fixture's root/tool constants and unique branch prefix in a copy; verify that those heads have no PRs. The original root already exists, so its builder refuses to overwrite cases. Use only submit dry-runs; real publication is outside this record. GitHub repository identity is explicit and Git transports resolve to per-case local bare remotes. Copy `gh-fixture.cjs` to the fixture root's `bin/gh` and make that copy executable (no PR for branch, successful auth-status, all other operations rejected); do not substitute a real publishing helper for these Anthracite controls.

The fixture helper's environment is explicit. REA invokes Graphite directly with those overrides, a 120-column/35-row terminal and 1500 scrollback lines, with no input events. The seven cases use default submit, `--restack`, `--restack=false`, fanout `--restack --stack`, conflict, frozen child and occupied child respectively, always with `--dry-run --no-interactive`. Anthracite receives corresponding arguments through ordinary subprocesses. Its separate chain controls use `restack --downstack`; fanout uses ordinary restack from base. Successful local controls are followed by a fresh submit preview.

Transient administrative files, auth copies, full repositories and failed setup attempts are not the retained artifact set. Private auth copies were removed after capture. Early failed network/auth probes and the partial ownership-unverified REA attempt do not supply accepted outcomes. No unverified process was killed. The successful captures' process cleanup guarantees do not establish that every host/background process or service-side effect was traced.
