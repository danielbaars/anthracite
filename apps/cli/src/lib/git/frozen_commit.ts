import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGitCommand } from './runner';

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Guard only this commit's final ref publication, after Git's own editors/hooks. */
export function withFrozenCommitGuard(
  branch: string,
  commit: (options: readonly string[]) => void
): void {
  const hooks = runGitCommand({
    args: ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
    onError: 'throw',
    resource: 'commitHooksPath',
  });
  const proxy = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-commit-hooks-'));
  // Do not propagate our temporary hook override into tools run by user hooks.
  const inheritedConfig = process.env.GIT_CONFIG_PARAMETERS;
  const scriptHeader =
    '#!/bin/sh\n' +
    (inheritedConfig === undefined
      ? 'unset GIT_CONFIG_PARAMETERS\n'
      : `GIT_CONFIG_PARAMETERS=${quote(
          inheritedConfig
        )}\nexport GIT_CONFIG_PARAMETERS\n`);
  try {
    const files =
      fs.existsSync(hooks) && fs.statSync(hooks).isDirectory()
        ? fs.readdirSync(hooks)
        : [];
    for (const name of files) {
      const original = path.join(hooks, name);
      if (!fs.existsSync(original) || !fs.statSync(original).isFile()) continue;
      let proxyMode = 0o600;
      try {
        fs.accessSync(original, fs.constants.X_OK);
        proxyMode = 0o700;
      } catch {
        /* Keep non-executable hooks non-executable. */
      }
      fs.writeFileSync(
        path.join(proxy, name),
        `${scriptHeader}exec ${quote(original)} "$@"\n`,
        { mode: proxyMode }
      );
    }
    const originalReferenceHook = path.join(hooks, 'reference-transaction');
    const self = process.versions.bun
      ? [process.execPath]
      : [process.execPath, path.resolve(__dirname, '../../index.js')];
    fs.writeFileSync(
      path.join(proxy, 'reference-transaction'),
      `${scriptHeader}if [ "$1" != prepared ]; then
  if [ -x ${quote(originalReferenceHook)} ]; then exec ${quote(
        originalReferenceHook
      )} "$@"; fi
  exit 0
fi
exec ${[...self, 'internal-commit-guard', branch, originalReferenceHook]
        .map(quote)
        .join(' ')} "$@"\n`,
      { mode: 0o700 }
    );
    commit(['-c', `core.hooksPath=${proxy}`]);
  } finally {
    fs.rmSync(proxy, { recursive: true, force: true });
  }
}
