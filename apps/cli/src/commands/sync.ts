export { builder, handler } from './repo-commands/repo_sync';
export const command = 'sync';
export const canonical = 'sync';
export const description =
  'Refresh existing tracked open-PR feature heads across the configured trunk, pull trunk and clean eligible merged/closed branches and repair affected tracked stacks by default. No-pull skips only trunk; no-delete suppresses cleanup. Explicit force may reset a divergent trunk, but never authorizes feature overwrite.';
