import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGitCommand } from './runner';
import { gitEnvironmentOverrides } from './environment_overrides';

/** Missing remote objects are fetched only into a disposable bare repository. */
export function inspectLandAncestry(
  ancestor: string,
  descendant: string,
  remote: { readonly name: string; readonly trunk: string }
): boolean {
  const source = read(['rev-parse', '--show-toplevel']);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  const hasObject = (oid: string): boolean =>
    Boolean(
      read(['rev-parse', '--verify', `${oid}^{commit}`], undefined, true)
    );
  if (hasObject(ancestor) && hasObject(descendant))
    return (
      read(['merge-base', ancestor, descendant], undefined, true) === ancestor
    );
  const url = read(['remote', 'get-url', remote.name]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'an-land-read-'));
  for (const key of gitEnvironmentOverrides) delete env[key];
  const run = (args: string[]): string =>
    runGitCommand({
      args,
      resource: 'landingObjectInspection',
      onError: 'throw',
      options: { env },
    });
  try {
    const bare = path.join(temporary, 'objects.git');
    run(['clone', '--bare', '--shared', '--no-hardlinks', source, bare]);
    run([
      '-C',
      bare,
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      url,
      `refs/heads/${remote.trunk}`,
    ]);
    return read(['merge-base', ancestor, descendant], bare, true) === ancestor;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function read(args: string[], cwd?: string, ignore = false): string {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  if (cwd) for (const key of gitEnvironmentOverrides) delete env[key];
  return runGitCommand({
    args,
    resource: 'landingObjectInspection',
    onError: ignore ? 'ignore' : 'throw',
    options: { cwd, env },
  });
}
