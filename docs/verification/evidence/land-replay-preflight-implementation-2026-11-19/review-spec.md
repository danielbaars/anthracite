## Spec

**1 finding — P1: refuse checkout-dependent replay configuration instead of flattening it.**

`apps/cli/src/lib/git/landing_replay.ts:106–129` reads effective replay settings once under the original checkout and installs them as unconditional settings in the disposable repository. `includeIf.onbranch` can change those settings when actual landing switches to trunk and then between participants.

The specification requires: “Preserve supported replay-relevant semantics safely; when unsupported configuration prevents faithful isolated simulation, report the limitation and refuse rather than silently ignoring it.”

A public-process reproduction on exact candidate `7d6b4503` configures an `includeIf.onbranch:tip` file with built-in `merge.default=union`, then advances remote trunk with conflicting `child.txt` while local trunk stays stale. `land tip --dry-run` returns zero and “Replay: conflict-free”; `land tip --yes` confirms merge #17 and then hits the child replay conflict. The copied union setting masks the simulated local conflict, but actual maintenance begins on `main`, where the conditional setting is absent. This recreates the partial landing #204 promises to prevent.

Conservatively refuse checkout-dependent conditional includes before claiming a clean assessment, or reproduce their changing applicability faithfully. Add the public preview/application regression proving no first merge or pending landing is created.

Retained reproduction: `/private/tmp/anthracite-204-implementation/review-conditional-config.cjs` and `.json`; only synthetic temporary repositories and controlled gh responses were used. No source edits or live/user-project changes.

No other missing requirement, incorrect implementation or unrequested scope found in the reviewed fixed diff. Final installed-artifact evidence was still being assembled during review.
