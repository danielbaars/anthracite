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
    const result = spawnSync(hook, args, {
      stdio: [file.fd, 'inherit', 'inherit'],
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    file.removeCallback();
  }
}
