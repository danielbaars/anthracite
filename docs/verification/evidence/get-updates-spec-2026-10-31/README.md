# Get specification evidence

Read the [specification](../../../specs/get-updates.md) and [decision record](../../get-updates-spec-2026-10-31.md).

- [Approved boundary](approved-boundary.json) records the approved scope, single main public-CLI seam, existing MCP smoke and no-CI instruction in English.
- [Source bridge](source-bridge.json) compares measured 0.5.0 with released 0.5.1. Ten relevant modules are unchanged; B02 cleanup is explicitly recorded as a different, shipped change. Locked dependency inputs and CLI dependency declarations are separate checks.
- [Historical evidence index](historical-evidence-index.json) selects 23 previously recorded scenario observations. Each capture/before/after reference has an immutable GitHub URL and SHA-256. The complete original ledger and artifact identities remain linked. These are historical observations, not new tests or feature passes.
- [Supporting index](supporting-evidence-index.json) links unchanged help captures and independent audits at the same pushed research commit.
- [Document verification](validation.json) records the publication checks and the retained-file inventory. It does not execute either CLI or certify the future implementation.

Raw captures remain at research commit `78937d87424a331de34c2cf3cf95a8944c8d6ff5`; they are not silently edited or duplicated as executions of 0.5.1. With that commit available locally, `git show <commit>:<sourcePath>` reads the bytes named in the index; compare their SHA-256 with the recorded value. Source versions use immutable release commits. Private authentication copies are not part of this evidence or the original published capture set.

The original process observations have bounded filesystem/process coverage. No actual get conflict, arbitrary dirty state, native-submitted remote discovery or new platform is certified by those observations. See the original report and audits for the detailed limits.
