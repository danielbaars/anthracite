import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGitCommand } from './runner';

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Scope fresh checks to managed HEAD writes, including rebase's external editors. */
export function withFrozenCommitGuard(
  branch: string,
  commit: (options: readonly string[], env?: NodeJS.ProcessEnv) => void,
  opts: { readonly sequenceEditor?: boolean; readonly allRefs?: boolean } = {}
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
    const check = [
      ...self,
      'internal-commit-guard',
      branch,
      path.join(proxy, 'absent'),
      'before-mutation',
    ]
      .map(quote)
      .join(' ');
    let env: NodeJS.ProcessEnv | undefined;
    if (opts.sequenceEditor) {
      const editor = runGitCommand({
        args: ['var', 'GIT_SEQUENCE_EDITOR'],
        onError: 'throw',
        resource: 'sequenceEditor',
      });
      const sequence = path.join(proxy, 'sequence-editor');
      fs.writeFileSync(
        sequence,
        `${scriptHeader}${editor} "$@" || exit $?\nexec ${check} </dev/null\n`,
        { mode: 0o700 }
      );
      env = { ...process.env, GIT_SEQUENCE_EDITOR: quote(sequence) };
      const preRebase = path.join(hooks, 'pre-rebase');
      fs.writeFileSync(
        path.join(proxy, 'pre-rebase'),
        `${scriptHeader}if [ -x ${quote(preRebase)} ]; then ${quote(
          preRebase
        )} "$@" || exit $?; fi\nexec ${check} </dev/null\n`,
        { mode: 0o700 }
      );
    }
    fs.writeFileSync(
      path.join(proxy, 'reference-transaction'),
      `${scriptHeader}if [ "$1" != prepared ]; then
  if [ -x ${quote(originalReferenceHook)} ]; then exec ${quote(
        originalReferenceHook
      )} "$@"; fi
  exit 0
fi
exec ${[
        ...self,
        'internal-commit-guard',
        branch,
        originalReferenceHook,
        ...(opts.allRefs ? ['--all-refs'] : []),
      ]
        .map(quote)
        .join(' ')} "$@"\n`,
      { mode: 0o700 }
    );
    commit(['-c', `core.hooksPath=${proxy}`], env);
  } finally {
    fs.rmSync(proxy, { recursive: true, force: true });
  }
}
