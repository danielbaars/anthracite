## Spec recheck

Reviewed the focused diff `dfde742a...495de590bdf23e2c2f862e7b894792319de10c35` and connected abandonment/recovery code. Both original findings are resolved.

- **Retained autostash validation:** verification now runs before every gate release, including retries without a live rebase. A private, immutable `quit.json` records the original marker or explicit null before quit. Missing/corrupt autostash evidence, foreign pin identities and missing/changed pinned commits refuse while preserving the gate. The marker receipt also detects simultaneous disappearance of the autostash evidence and pin. A genuine no-autostash quit records null; raw-aborted operations without retained autostash evidence remain supported. The completion report follows successful verification rather than merely file existence.
- **Explicit conflicting options:** the guard now canonicalizes negation and camel-case expansion and includes all registered short alias names in their long form. The added public-process regression covers sixteen accepted alternate spellings before effects.

The focused tests exercise genuine Git-generated autostash/recovery, post-quit failure, six retained-evidence mutations, successful retry without repeated quit, and preservation of reached state. No further material mismatch with the approved specification was identified in this recheck.

Read-only review: no tests, builds, edits to repository files or CI runs performed. Test and installed-artifact acceptance results remain the responsibility of the separate running campaigns.

Remaining findings: **0**.
