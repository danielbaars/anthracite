# Modern command compatibility

This is a finite description of this source candidate. Use `ch` for Charcoal and `gt` for Graphite. It is not a claim that every Graphite option, service or installed release behaves identically. [The command reference](./DOCUMENTATION.md) describes the actual flags.

The evidence below consists of public CLI subprocess tests with real temporary Git repositories, independent state observations and controlled external tools. Native acceptance runs the same scenario identities against a separately compiled candidate. Local PR adapters prove local workflow behavior, not GitHub or Graphite service acceptance. Build identities, measured counts, final review and publication receipts belong to the implementation delivery report; source test links alone do not assert that a particular build passed.

## Twenty supported standard short forms

Each row has its own positive execution alongside its canonical form. The quoted scenario suffix is literal under the named public test suite, so the delivery report can reconcile it to current JS/native results. Other flags and modes require their own evidence.

| Short form | Canonical target | Scope / default | Public outcome evidence |
| --- | --- | --- | --- |
| `c` | `create` | New branch above current or explicit `--onto`; staged commit | [short options](./apps/cli/test/commands/modern_short_options_cli.test.ts): `creates through c -o on the selected parent with staged content` |
| `m` | `modify` | Amend current commit and restack descendants; `--commit` adds a commit | [short options](./apps/cli/test/commands/modern_short_options_cli.test.ts): `amends through m -e with a real permitted message editor and restacks children` |
| `s` | `submit` | Selected downstack, excluding descendants by default | [submit aliases](./apps/cli/test/commands/modern_submit_aliases_cli.test.ts): `submits downstack through s without publishing descendants or another stack` |
| `ss` | `submit --stack` | Selected ancestors and descendants; later explicit stack booleans override default | [submit aliases](./apps/cli/test/commands/modern_submit_aliases_cli.test.ts): `submits the whole selected stack through ss by default` |
| `co` | `checkout` | Explicit branch or interactive selector | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `co navigates to other while preserving refs and untracked work` |
| `l` | `log` | Existing full stack display; classic selector supported | [classic log](./apps/cli/test/commands/modern_log_classic_cli.test.ts): `keeps l equivalent to its canonical classic form` |
| `ls` | `log short` | Existing short stack display | [classic log](./apps/cli/test/commands/modern_log_classic_cli.test.ts): `keeps ls equivalent to its canonical classic form` |
| `ll` | `log long` | Git commit graph; no stack/classic selectors | [classic log](./apps/cli/test/commands/modern_log_classic_cli.test.ts): `keeps ll and log long as the existing Git commit graph` |
| `u` | `up` | One child level by default; positional steps and `-n`/`--steps` retained | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `u navigates to tip while preserving refs and untracked work` |
| `d` | `down` | One parent level by default; same step forms | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `d navigates to base while preserving refs and untracked work` |
| `t` | `top` | Current stack tip; prompts on ambiguity when permitted | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `t navigates to tip while preserving refs and untracked work` |
| `b` | `bottom` | First feature branch above trunk | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `b navigates to base while preserving refs and untracked work` |
| `rn` | `rename` | Current branch; explicit name required without interaction | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `rn renames the branch and repairs its child parent without rewriting commits` |
| `dl` | `delete` | Selected local branch; existing force/PR rules | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `dl deletes only the selected leaf and retains other refs` |
| `sp` | `split` | Existing interactive by-commit/by-hunk workflow | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `sp splits two commits through real terminal selection and names` |
| `sq` | `squash` | Current branch commits, then descendant restack | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `sq squashes current commits and restacks descendants` |
| `r` | `restack` | Whole selected stack by default; existing scope flags retained | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `r respects branch and only scope while rebasing a stale child` |
| `tr` | `track` | Selected branch; explicit parent/force/downstack retained | [alias compatibility](./apps/cli/test/commands/modern_alias_compatibility_cli.test.ts): `tr tracks a selected untracked downstack without changing refs` |
| `utr` | `untrack` | Selected branch and its tracked descendants | [short options](./apps/cli/test/commands/modern_short_options_cli.test.ts): `untracks a leaf with utr and proves the public inspection outcome` |
| `cont` | `continue` | Resume saved operation after conflict resolution in a new process | [interactive rebase](./apps/cli/test/commands/modern_interactive_rebase_cli.test.ts): `resolves a real interactive conflict in fresh cont processes` |

## New selectors and retained families

| Entry / family | Supported behavior | Evidence and limits |
| --- | --- | --- |
| `create -o` | Same tracked local parent selection as `--onto`; insert affects the selected parent's children | [short-option CLI](./apps/cli/test/commands/modern_short_options_cli.test.ts), existing create-onto suites. No remote branch selector or new staging mode. |
| `modify -e` | Existing explicit message editor; message/no-edit precedence retained | [short-option CLI](./apps/cli/test/commands/modern_short_options_cli.test.ts). Editor permission still required. |
| `modify` / `m --interactive-rebase` | Existing current-branch rebase, real editor change, descendant restack and saved continuation | [interactive-rebase CLI](./apps/cli/test/commands/modern_interactive_rebase_cli.test.ts). Other operation flags are ignored only when selector is true. Global interaction/cwd rules remain. Conflicts can preserve partial progress; no universal rollback. |
| `log` / `l --classic` | Existing full classic renderer; effective false retains ordinary display | [classic-log CLI](./apps/cli/test/commands/modern_log_classic_cli.test.ts). Classic ignores reverse/stack/steps/show-untracked display selectors. Global pager/quiet rules remain. |
| `auth` | Existing GitHub CLI authentication | [auth-input CLI](./apps/cli/test/commands/modern_auth_input_cli.test.ts). Token/t refused before tools without echo/storage. Diagnostic priority for mixed invalid input can depend on cwd; no universal ordering claim. |
| `move --onto/--source/--only` | Existing selected branch move; only mode leaves children on old parent | Existing move CLI suites; [modern mv guard](./apps/cli/test/commands/modern_mv_cli.test.ts). `mv` is raw Git file movement, never a branch alias. |
| `fold --stack`, `reorder --stack` | Existing full feature-chain fold/reorder with their worktree, selector and recovery guards | Existing fold/reorder CLI suites. Fold retains separate commits; it is not squash. |
| `info [branch]` / `--branch`, `--stat` | Existing selected local tracked-branch inspection, without checkout | Existing info CLI suites; [legacy routes](./apps/cli/test/commands/modern_legacy_routes_cli.test.ts). No general machine-output format. |
| `--cwd`, quiet, interaction | Existing real argument boundaries, literal string values, data channels and editor/pager policy | Existing cwd/interaction suites and [completion CLI](./apps/cli/test/commands/modern_completion_cli.test.ts). Verify/no-verify keeps commit/push scope; it is not a general rebase-hook switch. |
| Extra `i`, `g`, `ro`, `ut`, `edit`/`e` | Registered legacy inspection/get/reorder/untrack/rebase entries remain | [legacy routes](./apps/cli/test/commands/modern_legacy_routes_cli.test.ts) exercises each. `g` uses a local bare remote and controlled PR adapter. |
| `repo i`, `repo s`, `log s`, `log l`, `repo`/`user` | Local nested meanings retained; root aliases do not replace them | [legacy routes](./apps/cli/test/commands/modern_legacy_routes_cli.test.ts). Representative read/write workflow, not every setter or route mode certified. |
| Bash/zsh/Fish completion | Actual public root/option/branch queries; generated Bash/zsh scripts and available shell smoke; Fish script content | [completion CLI](./apps/cli/test/commands/modern_completion_cli.test.ts). Fish uses local branches for move/track etc. and remote branches for get/g. No branch suggestions for mv. Full interactive Fish runtime certification remains unmeasured. |
| Submit/get/sync PR workflows | Existing GitHub CLI integration and scoped local branch/PR behavior | Existing public CLI adapter suites. Live GitHub/Graphite acceptance, installation and release remain separate assignments. |

## Deliberate differences and deferred functionality

| Feature | Status / boundary |
| --- | --- |
| Central `config` UI / configurable aliases / Graphite alias files | Unsupported. Existing `repo`/`user` configuration is not that UI; standard forms above are fixed registrations. |
| `mg`, PR review/merge or merge queue | Unsupported. Raw `ch merge` and `ch revert` retain Git semantics and do not operate Graphite PRs. |
| Graphite token transport | Unsupported; rejected explicitly. Existing `ch auth` uses `gh`, not Graphite activation. |
| Feedback message service | Unsupported. Existing `feedback debug-context` is a local diagnostic route, not a message submission service. |
| Freeze/unfreeze, absorb, multitrunk | Deferred; no success stubs or newly introduced metadata/guards in this round. |
| Extra staging/selection/restack modes, split-by-file, extra get/submit/sync/delete/checkout modes | Deferred unless explicitly documented in the command reference. A similar existing option does not imply all modern Graphite modes. |
| AI, update/verbose/into/reset-author, MCP and Graphite browser/service integrations | Outside this compatibility round. Unregistered internal source modules are not supported public commands. |
| Quiet interactive-rebase behavior | Deliberate Charcoal choice: quiet blocks the editor before mutation. The investigated Graphite invocation opened an editor. |
| `ss` boolean overrides | Explicit fixed contract: later stack booleans replace its true default. Graphite backend scope with these combinations was not live measured. |
| Raw Git prefixes | Existing direct cwd selection retained; other unsupported prefix positions may fail. No automatic branch fallback and no new generic Git-prefix grammar. |
| Runtime / service coverage | JS/native local workflows and available shell checks are bounded evidence. No overall Graphite-parity percentage, cross-platform certification or live-service claim follows. |

Historical research, failures, timeouts and incomplete reverse-engineering captures retain their original status. The delivery report reconciles all 81 stories to current runtime IDs or explicit documentation/process controls, with final reviews and publication tracked separately.
