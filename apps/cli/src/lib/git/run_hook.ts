import { spawnSync } from 'child_process';
import fs from 'fs';
import tmp from 'tmp';

/** A hook may exit without reading stdin; a file avoids a producer-side EPIPE. */
export function runGitHook(
  hook: string,
  args: readonly string[],
  input: Buffer
): number {
  const file = tmp.fileSync({ prefix: 'an-hook-input-', mode: 0o600 });
  try {
    fs.writeFileSync(file.name, input);
    let result = spawnSync(hook, args, {
      stdio: [file.fd, 'inherit', 'inherit'],
    });
    if (
      result.error &&
      'code' in result.error &&
      result.error.code === 'ENOEXEC'
    ) {
      // Match Git's shell fallback without changing executable interpreter hooks.
      const inputFd = fs.openSync(file.name, 'r');
      try {
        result = spawnSync('/bin/sh', [hook, ...args], {
          stdio: [inputFd, 'inherit', 'inherit'],
        });
      } finally {
        fs.closeSync(inputFd);
      }
    }
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    file.removeCallback();
  }
}
