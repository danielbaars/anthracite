## Spec confirmation

**Original P1 resolved** on frozen `14dda978a40a388daa904f906cd59f0cbaf6921c`.

I independently reproduced the original two-target construction conflict using the immutable native candidate (SHA-256 `01d4f344353a877fe683137853fdb774430725418ad5547c58630c5d4c7cdbf7`) in a fresh temporary Git repository. The preview selected the ancestor correction and independent child correction. Application published the ancestor and stopped with an actual unmerged construction index, an owned continuation checkpoint, and executable instructions identifying the construction checkout. I deliberately resolved and staged `shared.txt` there, then invoked fresh public `continue` from the original source. It completed successfully.

Independent Git assertions confirmed the ancestor was not amended twice; the pending child correction was committed; deliberate resolved content survived; author identities/dates, full messages, commit order/count and ancestry remained correct; trunk stayed unchanged; staged leftovers and the exact unstaged sentinel returned to their original roles; the original checkout and metadata parent were retained; and owned artifacts were cleaned. A repeated `continue` refused without changing refs, index or working bytes. This satisfies the previously failing specification requirement at `docs/specs/absorb.md:122`: “Fresh-process continue resumes that replay and the remaining saved plan”.

I also inspected the construction phase/index/commit and Git administration/HEAD ownership checks, pre-staging protection checks, correction-phase conflict handling, and new public tests covering conflicts before/after first publication, pending-correction re-conflict, symlink/foreign-worktree rejection, frozen participants, raw abort and exactly-once restoration. No remaining concrete spec violation found in this fix. Those additional tests were inspected, not rerun as another suite.

Reproduction: `spec-repro-fixed.cjs`; captured output and assertions: `spec-repro-fixed.json`, both beside this report. Fixture: `$REPRO/repo`. Review source/worktree remained unchanged; no rebuild, network, full suite or matrix was run.
