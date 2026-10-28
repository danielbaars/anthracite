import path from 'path';

/** Relaunch this installation from source, a Node bundle or a native binary. */
export function getSelfCliCommand(
  args: readonly string[] = []
): [string, ...string[]] {
  if (process.versions.bun && process.argv[1]?.startsWith('/$bunfs/'))
    return [process.execPath, ...args];
  const entryPoint = process.argv[1];
  if (!entryPoint) throw new Error('Cannot locate the running Anthracite CLI');
  return [process.execPath, path.resolve(entryPoint), ...args];
}
