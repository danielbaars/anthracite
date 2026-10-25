export type TInteractionPolicy = {
  readonly quiet: boolean;
  readonly interactive: boolean;
  readonly canPrompt: boolean;
  readonly canPage: boolean;
  readonly canEdit: boolean;
};

export function resolveInteractionPolicy(opts?: {
  readonly interactive?: boolean;
  readonly quiet?: boolean;
}): TInteractionPolicy {
  const quiet = opts?.quiet ?? false;
  const hasTerminal = !!process.stdin.isTTY && !!process.stdout.isTTY;
  const interactive =
    !quiet &&
    !process.env.GRAPHITE_INTERACTIVE &&
    (opts?.interactive ?? hasTerminal);
  return {
    quiet,
    interactive,
    canPrompt: interactive && hasTerminal,
    canPage: interactive && hasTerminal,
    canEdit: interactive,
  };
}
