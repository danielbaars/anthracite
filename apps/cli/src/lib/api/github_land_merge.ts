import { githubProcessOptions } from './github_process';
import { execFile } from 'child_process';
import { z } from 'zod';
import { ExitFailedError } from '../errors';

export class GithubLandMergeRejected extends ExitFailedError {
  constructor() {
    super(
      'Merge rejected by GitHub authentication or permission; no automatic retry.'
    );
  }
}

function definiteRejection(stdout: string, stderr: string): boolean {
  try {
    const body = z
      .object({ status: z.enum(['401', '403']), message: z.string().min(1) })
      .parse(JSON.parse(stdout));
    return new RegExp(
      `^gh: [^\\r\\n]+ \\(HTTP ${body.status}\\)\\r?\\n?$`
    ).test(stderr);
  } catch {
    return false;
  }
}

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
      githubProcessOptions(),
      (error, stdout, stderr) =>
        error
          ? reject(
              definiteRejection(stdout, stderr)
                ? new GithubLandMergeRejected()
                : new ExitFailedError(
                    'Merge response unavailable; outcome uncertain. Inspect GitHub before another request.'
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
