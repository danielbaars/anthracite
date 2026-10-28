## Review

Solid work, with one real fix. The shape is right: roles are added rather than replaced, every write is read back from GitHub, and the role target is validated before anything is pushed. Draft status is deliberately left alone. The 26 new tests cover the failure paths too — frozen branch, `--update-only`, deselection, `gh` exiting nonzero, partial assignment. CI is green and the evidence directory matches `5285c564`, the last code commit, so it isn't stale.

Also good: `assignees` never leaves the process toward the Graphite API. The widening of `TPRSubmissionInfo` in `apps/cli/src/actions/submit/submit_prs.ts:14` is purely local, and submit runs entirely through `gh`.

---

### 1. `@me` fails with a raw child-process error, and the intended message is unreachable

`apps/cli/src/actions/submit/assignees.ts:22`

```ts
const identity: unknown = JSON.parse(
  execFileSync('gh', ['api', 'user']).toString()
);
```

`execFileSync` throws on a nonzero exit by itself, and by default forwards the child's stderr to the parent's stderr. Measured here against a fake `gh` that exits 1:

```
PROBE: threw -> Command failed: .../fakegh api user
--- parent stderr ---
GitHub authentication required
```

So `an submit --assignees @me` without working gh auth shows gh's own stderr first, then `ERROR: Command failed: gh api user`. The intended message — `Could not verify the GitHub user for @me.` — is only reachable when `gh` exits 0 and returns an unexpected payload. If `gh` is not installed at all, the result is `spawnSync gh ENOENT`, bypassing the install guidance that `cliAuthPrecondition` already has.

The test hides this. `apps/cli/test/commands/submit_assignees_cli.test.ts:166` asserts `/GitHub|authentication/`, which happens to match the fixture's own forwarded line `GitHub authentication required`, not the message in the source.

Suggestion: wrap the call in a `try` with `{ stdio: ['ignore', 'pipe', 'pipe'] }`, throw an `ExitFailedError` pointing at `an auth`, and pin the test to that message instead of the loose regex.

The same stdio point applies to `readAssignees` in `apps/cli/src/actions/submit/request_assignees.ts:19`: `submitPrToGithub` sets the option explicitly, the new read functions do not, so gh's stderr leaks through. (`readReviewState` already had this, so that part is not new.)

### 2. The `--roles-branch` help text promises slightly more than it delivers

`apps/cli/src/commands/submit.ts:53` says "without changing which branches are submitted". The test at `apps/cli/test/commands/submit_roles_branch_cli.test.ts:63` shows otherwise — it expects `child (No-op)`. Without `--roles-branch`, that same branch gets status `REVIEWERS` and is pushed, and its PR is touched.

The behaviour is right: a branch with nothing else to do need not be pushed. The sentence is what's off. Something like "without narrowing the submission scope" covers it, and that is already what `learn.ts` says ("does not narrow the branches submitted by `--branch` or `--stack`"). Note that the literal sentence is asserted in `apps/cli/test/commands/submit_roles_surface_cli.test.ts:60`, so that would have to move with it. `docs/submit.md` already uses the more precise "does not add or remove branches from the submission selection".

### 3. The push catch now swallows a signalled abort

`apps/cli/src/actions/submit/submit_action.ts:204` wraps every error from `pushBranch` in an `ExitFailedError`. A `git` killed by a signal yields a `CommandKilledError`, which `handleGraphiteError` deliberately handles silently ("the user doesn't need a message if they ended an [operation]"). That classification is now lost.

Small in practice: Ctrl-C is already caught by the `SIGINT` handler in `runner.ts:128`, which calls `process.exit(1)` directly, so this only affects SIGKILL/SIGPIPE on the push. An `if (err instanceof CommandKilledError) throw err;` before the wrap keeps it clean.

### 4. Observation, not a request

After this PR, `request_assignees.ts` and `request_reviewers.ts` are structurally near-identical: read, diff, write, read back, verify, compose an error — roughly 60 lines each. The reviewer side has extra logic for teams and for reviews already submitted, so a shared abstraction may well cost more than it returns. I would leave it, but it is worth noting if a third role ever arrives.

---

One thing that stood out and is not a finding: in the gh fixture the `pr create` path still handles `--reviewer` arguments (`apps/cli/test/lib/fixtures/submit_gh.ts:200`), while `submitPrToGithub` no longer passes them on create — reviewers always go through the separate `pr edit`. A dead fixture branch, harmless otherwise.
