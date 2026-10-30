import { execFile } from 'child_process';
import { z } from 'zod';
import { ExitFailedError } from '../errors';

/** Synchronous direct merge only: literal JSON, expected head, no queue or bypass. */
export async function mergeGithubLandPr(
  repo: string,
  number: number,
  head: string
): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      'gh',
      [
        'api',
        `repos/${repo}/pulls/${number}/merge`,
        '--hostname',
        'github.com',
        '--method',
        'PUT',
        '--input',
        '-',
      ],
      {
        env: {
          ...process.env,
          GH_HOST: 'github.com',
          GH_PROMPT_DISABLED: '1',
          GH_PAGER: '',
          PAGER: '',
        },
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout) =>
        error
          ? reject(
              new ExitFailedError(
                'Merge response unavailable; outcome uncertain.'
              )
            )
          : resolve(stdout)
    );
    child.stdin?.on('error', () => void 0);
    child.stdin?.end(JSON.stringify({ sha: head, merge_method: 'rebase' }));
  });
  try {
    return z
      .object({
        merged: z.literal(true),
        sha: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .parse(JSON.parse(output)).sha;
  } catch {
    throw new ExitFailedError(
      'Merge response is unconfirmed; outcome uncertain.'
    );
  }
}
