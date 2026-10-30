# Public 0.4.0 test-scope observations

Two isolated marker probes on 30 October 2026 confirm register item B01. These
are observed scope failures, not passing acceptance cases or a Graphite comparison.

The executable is the installed public `@danielbaars/anthracite@0.4.0` npm bundle,
launched with Node 24.19.0. Its bytes match the public tarball previously checked
against release workflow 41017154452 and its signed provenance for source
`9c173deb652509ca55ba9104b1254705b439d396`. No source was rebuilt for these probes.

| Retained identity | SHA-256 |
| --- | --- |
| Public npm tarball | 623e0f6c100ff7ab8ea5c339de87a713d7cd392d348ae7ee6a72be7d73b44c93 |
| Installed cli.cjs | c986a64a420fa1db0894bf2f73096d28873c8ddd11f4726146ccdec4fca969f1 |
| Unchanged observation record | 59e722b29f4593c1d9c5559d1af88c5421ba0a81cc784dd7bfa273fcb2072f6e |

Each invocation uses the real public CLI, a synthetic local Git repository with
`main → base → child → tip`, a private user configuration and disabled GitHub
integration. The checkout starts and finishes on `child`. The supplied external
marker appends `git branch --show-current` to a fixture-owned file outside the
working tree. That independent file supplies the actual executed branch list.

- `--upstack` should execute `child, tip`; it executes `base, child, tip`.
- `--downstack` should execute `base, child`; it executes `base, child, tip`.

[The observation record](test-scope-probe.json) was copied unchanged from the
probe output and byte-verified. `<owned marker command>` is an explicit argv
placeholder for that Node marker, not a claimed literal user command. Captured
stdout/stderr are retained unchanged. A zero exit status and the CLI's success
rows show only that the marker itself succeeded; `matchesRequestedScope: false`
records the defect. The printed output-directory path is not the oracle.

Current command handling computes the requested scope, but the action explicitly
uses `SCOPE.STACK`. The documentation correction does not fix that code or
certify other `test` behavior. No Graphite, live GitHub fixture, full test suite,
CI matrix or user installation change was involved.
