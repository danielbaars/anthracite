import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGitCommand } from './runner';

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

/** A managed push must recheck after the user's pre-push hook, even with -n. */
export function withFrozenPushGuard(
  opts: { readonly branch: string; readonly noVerify: boolean },
  push: (options: readonly string[]) => void
): void {
  const hooks = runGitCommand({
    args: ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
    onError: 'throw',
    resource: 'pushHooksPath',
  });
  const proxy = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-push-hooks-'));
  const inheritedConfig = process.env.GIT_CONFIG_PARAMETERS;
  const header =
    '#!/bin/sh\n' +
    (inheritedConfig === undefined
      ? 'unset GIT_CONFIG_PARAMETERS\n'
      : `GIT_CONFIG_PARAMETERS=${quote(
          inheritedConfig
        )}\nexport GIT_CONFIG_PARAMETERS\n`);
  try {
    // Leave other push-related hooks with their existing executable semantics.
    if (fs.existsSync(hooks)) {
      for (const name of fs.readdirSync(hooks)) {
        const original = path.join(hooks, name);
        if (!fs.existsSync(original) || !fs.statSync(original).isFile())
          continue;
        let mode = 0o600;
        try {
          fs.accessSync(original, fs.constants.X_OK);
          mode = 0o700;
        } catch {
          /* Keep non-executable hooks non-executable. */
        }
        fs.writeFileSync(
          path.join(proxy, name),
          `${header}exec ${quote(original)} "$@"\n`,
          { mode }
        );
      }
    }
    const prePush = path.join(proxy, 'pre-push');
    fs.rmSync(prePush, { force: true });
    const self = process.versions.bun
      ? [process.execPath]
      : [process.execPath, path.resolve(__dirname, '../../index.js')];
    fs.writeFileSync(
      prePush,
      `${header}exec ${[
        ...self,
        'internal-push-guard',
        opts.branch,
        opts.noVerify
          ? path.join(proxy, 'disabled')
          : path.join(hooks, 'pre-push'),
      ]
        .map(quote)
        .join(' ')} "$@"\n`,
      { mode: 0o700 }
    );
    push(['-c', `core.hooksPath=${proxy}`]);
  } finally {
    fs.rmSync(proxy, { recursive: true, force: true });
  }
}
