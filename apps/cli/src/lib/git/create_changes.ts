import { runGitCommand } from './runner';

/** Compare selected user paths, excluding clean departure-only baseline files. */
export function hasCreateChanges(parent: string, all: boolean): boolean {
  const cwd = runGitCommand({
    args: ['rev-parse', '--show-toplevel'],
    onError: 'throw',
    resource: 'createChangesRoot',
  });
  if (
    all &&
    runGitCommand({
      args: ['ls-files', '--others', '--exclude-standard'],
      options: { cwd },
      onError: 'throw',
      resource: 'createUntrackedChanges',
    }).length > 0
  ) {
    return true;
  }
  const paths = runGitCommand({
    args: [
      'diff',
      '--no-ext-diff',
      '--no-renames',
      '--name-only',
      '-z',
      ...(all ? ['HEAD'] : ['--cached']),
    ],
    options: { cwd, noTrim: true },
    onError: 'throw',
    resource: 'createSelectedPaths',
  })
    .split('\0')
    .filter(Boolean);
  return (
    paths.length > 0 &&
    runGitCommand({
      args: [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--shortstat',
        ...(all ? [] : ['--cached']),
        `refs/heads/${parent}`,
        '--',
        ...paths,
      ],
      options: { cwd },
      onError: 'throw',
      resource: 'createChangesOnParent',
    }).length > 0
  );
}
