# Sync specification evidence

This is specification/provenance evidence, not a new runtime test result. See the [decision record](../../sync-updates-spec-2026-10-31.md) and [full specification](../../../specs/sync-updates.md).

- [Approved boundary](approved-boundary.json): the owner's scope/test-seam approval and excluded actions.
- [Source bridge](source-bridge.json): five sync surface modules unchanged since released0.5.1, historical0.5.0 comparison and the changed shared get boundaries at merged main26c8b643.
- [Historical index](historical-evidence-index.json): nine selected original observations, with27 capture/before/after JSON files reused through their original immutable GitHub URLs and SHA-256. The existing durable captures are not duplicated here. The [original ledger](historical-ledger.json) is unchanged context for the full35-observation research; neither count is a test-pass count for this feature.
- [Validation](validation.json): documentation-only structure, scope, link and checksum checks performed before publication.

Source commit for historical captures:78937d87424a331de34c2cf3cf95a8944c8d6ff5. Measured tools:Graphite1.8.6 and Anthracite0.5.0, Node24.19.0/macOS ARM64; their identities remain in the ledger. C23 is historical B02 evidence; the repair shipped in0.5.1. S12 measures Graphite's default replay only, not a paired Anthracite default run. The implementation baseline26c8b643 includes merged get work, not a released npm version containing it.

No private credential material or new runtime data is added. Original snapshots are retained within their existing coverage and service boundaries. New intended policies, including repository-wide single-trunk selection and continuation safety, require the future public-CLI acceptance in the specification. No live fixture writes, implementation, CI, full matrix, package publication or owner-installation change occurs here.
