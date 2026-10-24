import { runGitCommand } from './runner';

export function showCommits(
  base: string,
  head: string,
  opts: { readonly shouldShowPatch: boolean; readonly shouldShowStat?: boolean }
): string {
  return runGitCommand({
    args: [
      `-c`,
      `color.ui=always`,
      `--no-pager`,
      `log`,
      ...(opts.shouldShowPatch ? [opts.shouldShowStat ? '--stat' : '-p'] : []),
      `${base}..${head}`,
      `--`,
    ],
    onError: 'throw',
    resource: 'showCommits',
  });
}
