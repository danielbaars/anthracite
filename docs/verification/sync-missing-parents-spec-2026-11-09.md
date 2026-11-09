# Missing sync parents: specification record

On 9 November 2026 the maintainer approved the scope and test boundary for the [compact #153 specification](../specs/sync-missing-parents.md).

## Approved boundary

- Detect existing metadata-bearing branches with missing parents or intermediate ancestors before fresh sync updates and metadata repair. Ordinary untracked branches remain outside the blocker.
- Expose orphan branches through preserving full/short log inspection.
- Use deliberate existing parent-repair commands and fresh planning; no automatic skipping, reparenting or resumption.
- Preserve continuation/abandonment and divergence guards, missing-leaf behavior and compatible name reuse.
- Test through public CLI processes with real temporary Git/bare remotes, controlled `gh` answers, focused Node/native and isolated npm checks, and one existing MCP-client smoke. No internal test interface, live GitHub fixture mutation, user-project or installation edits. No CI during specification; the full matrix stays off.

## Evidence and status

The [public 0.6.15 practical report](sync-missing-participants-2026-11-09.md) and its unchanged raw evidence are the measured baseline. The specification distinguishes that baseline from proposed behavior and retains the independent divergence and controlled-remote-alignment qualifications.

This delivery changes documentation only. Local checks validate the required specification sections, numbered stories, relative Markdown links, evidence checksums and whitespace. These checks are not runtime acceptance of the proposed feature. No production code, dependencies, stored formats, installation, live PR fixtures, release or CI workflow is changed or executed.

Publish the specification and this record on the existing documentation branch before updating #153; link the pushed immutable specification from the issue and apply `ready-for-agent`. No implementation PR is created in this step.
