# Release installed-package budget repair

## Scope

The manual 0.8.1 patch attempt ([run 43906307127](https://github.com/danielbaars/anthracite/actions/runs/43906307127)) stopped during installed-package validation before npm publication. The parent allowed 180 seconds, although the package script already gives its selected scenarios 300 seconds, separately from installation and alias checks. Its retained error omitted the failed command and timeout.

Only the parent installed-package allowance changes to 480 seconds; other build commands retain 180 seconds. The manual publishing job changes from ten to fifteen minutes. Existing inner deadlines, immutable artifacts, identity checks, provenance, channel selection and publication authority remain unchanged. Eight minutes is an aggregate limit, not the sum of every possible inner allowance.

## Local process acceptance

Runtime: Node 24.19.0 and Bun 1.3.14 on macOS. Tests invoke the existing public release process against temporary Git clones. GitHub and npm writes use controlled boundary responses; these checks do not claim live OIDC publication.

- **Red diagnostic:** an intentional package-process exit 7 failed the new assertion on the original dispatcher because its message omitted the exit status.
- **Green diagnostic:** the same process identifies the package command, exit code 7 and retained failure output, with no publication writes.
- **Red duration:** a real child delayed for 185 seconds was terminated by the original 180-second parent deadline (ETIMEDOUT).
- **Green duration:** that child completes under the repaired dispatcher; the prepare operation returns prepared with no npm writes. The complete scenario took about 208 seconds including the normal build setup. This synthetic gate tests the parent deadline; it is not an installed CLI acceptance claim.
- **Full patch process:** passed outside the sandbox in 296 seconds. The real preparation/publication fixture completed in 291 seconds; its unchanged retry completed in 1.6 seconds with zero additional npm writes. This uses the actual package build and installed CLI/MCP checks. It also verifies that a newer dispatcher can publish an unchanged stable source tag, preserve beta and reconcile without a second npm write.

The first full local attempt reached the actual installed checks beyond the former limit, then failed because the sandbox prohibits the ps command used by the existing MCP cancellation fixture. The unchanged process was rerun outside that sandbox; no production test or application behavior was changed for this environmental restriction.

## Review and release boundaries

Independent standards and specification reviews reported no blocking findings. The specification review prompted the aggregate-budget wording above.

The existing v0.8.1 source remains 9732a77140a2861e0d9fd0daa3f412a6d5cd1817. The repair belongs to the executing dispatcher; the tag must not move. Ordinary CI and the full matrix remain off for this repair/publication attempt. Only the necessary manually selected Release workflow may publish after approval and merge. Local validation does not establish that 0.8.1 has been published.

## Reproduction and receipt

```sh
node --test scripts/test/release-build-gate.test.cjs
node --test scripts/test/release-patch.test.cjs
actionlint .github/workflows/release.yml
```

The slow timing case deliberately takes over three minutes and belongs to local/manual release-process acceptance, not ordinary CI. The complete patch fixture needs normal process visibility for its existing MCP cancellation check.

```text
PASS failed package step reports exit code 7; no publication writes
PASS real 185-second package child completes; no publication writes
Release process 8 stable: 290786ms, status 0
Release process 9 stable: 1552ms, status 0
PASS direct patch waits for install propagation without republishing, preserves beta and reconciles once
PASS actionlint, formatting and git diff --check
```
