import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGitCommand } from './runner';
import { gitEnvironmentOverrides } from './environment_overrides';
import {
  landingTransportArgs,
  withLandingInspection,
} from './landing_inspection_process';

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
  const hooks = path.join(temporary, 'empty-hooks');
  fs.mkdirSync(hooks);
  const deadline = Date.now() + 30000;
  const run = (args: string[]): string =>
    runGitCommand({
      args: [
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'maintenance.auto=false',
        '-c',
        'gc.auto=0',
        '-c',
        'fetch.recurseSubmodules=false',
        ...args,
      ],
      resource: 'landingObjectInspection',
      onError: 'throw',
      options: { env, timeout: Math.max(1, deadline - Date.now()) },
    });
  try {
    const bare = path.join(temporary, 'objects.git');
    run([
      'clone',
      '--bare',
      '--shared',
      '--no-hardlinks',
      `--template=${hooks}`,
      '--',
      source,
      bare,
    ]);
    run([
      '-C',
      bare,
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--',
      url,
      `refs/heads/${remote.trunk}`,
    ]);
    return read(['merge-base', ancestor, descendant], bare, true) === ancestor;
  } catch {
    throw new Error(
      'Landing object inspection could not obtain required remote history.'
    );
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

/** Fresh planning owns its asynchronous acquisition until cancellation and cleanup finish. */
export async function inspectNewLandingAncestry(
  ancestor: string,
  descendant: string,
  remote: { readonly name: string; readonly trunk: string }
): Promise<boolean> {
  try {
    return await withLandingInspection('an-land-read-', async (git) => {
      const source = process.cwd();
      const hasObject = async (oid: string): Promise<boolean> =>
        (
          await git.run(['cat-file', '-e', `${oid}^{commit}`], {
            cwd: source,
            allowFailure: true,
          })
        ).code === 0;
      if ((await hasObject(ancestor)) && (await hasObject(descendant))) {
        const mergeBase = await git.run(['merge-base', ancestor, descendant], {
          cwd: source,
          allowFailure: true,
        });
        return mergeBase.code === 0 && mergeBase.stdout.trim() === ancestor;
      }
      const bare = path.join(git.temporary, 'objects.git');
      const objects = await git.read(
        ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
        source
      );
      await git.run(['init', '--quiet', '--bare', '--template=', bare]);
      fs.writeFileSync(
        path.join(bare, 'objects/info/alternates'),
        objects + '\n'
      );
      const url = (
        await git.run(['remote', 'get-url', remote.name], {
          cwd: source,
          env: git.originalEnvironment,
        })
      ).stdout.trim();
      await git.run(
        [
          ...(await landingTransportArgs(git, source)),
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--',
          url,
          `refs/heads/${remote.trunk}`,
        ],
        {
          cwd: bare,
          env: { ...git.originalEnvironment, GIT_TERMINAL_PROMPT: '0' },
        }
      );
      const mergeBase = await git.run(['merge-base', ancestor, descendant], {
        cwd: bare,
        allowFailure: true,
      });
      return mergeBase.code === 0 && mergeBase.stdout.trim() === ancestor;
    });
  } catch (error: unknown) {
    throw new Error(
      `Landing object inspection could not obtain required remote history safely: ${
        error instanceof Error ? error.message : 'unavailable evidence'
      }`
    );
  }
}

export async function assertNewLandingTrunkAncestry(
  ancestor: string,
  descendant: string,
  remote: { readonly name: string; readonly trunk: string }
): Promise<void> {
  if (!(await inspectNewLandingAncestry(ancestor, descendant, remote)))
    throw new Error('Local trunk is divergent; fast-forward required.');
}
