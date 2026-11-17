import { githubFailureKind, githubProcessOptions } from './github_process';
import { execFile } from 'child_process';
import { z } from 'zod';
import { ExitFailedError } from '../errors';

export class GithubLandMergeRejected extends ExitFailedError {
  constructor(status: string, message: string) {
    super(
      `Merge rejected by GitHub (HTTP ${status}): ${JSON.stringify(
        message
      )}. No automatic retry.`
    );
  }
}

function mergeFailure(
  stdout: string,
  stderr: string,
  code: string | number | undefined
): ExitFailedError {
  let detail = '';
  try {
    const body = z
      .object({
        status: z
          .string()
          .regex(/^[45]\d{2}$/)
          .optional(),
        message: z.string().min(1).max(4096),
        merged: z.literal(false).optional(),
      })
      .parse(JSON.parse(stdout));
    const receipt = /^gh: ([^\r\n]+) \(HTTP (\d{3})\)\r?\n?$/.exec(stderr);
    const status = body.status ?? receipt?.[2];
    if (status) {
      detail = ` GitHub reported HTTP ${status}: ${JSON.stringify(
        body.message
      )}.`;
      if (
        ['401', '403', '404', '405', '409', '422'].includes(status) &&
        receipt?.[2] === status &&
        receipt[1] === body.message
      )
        return new GithubLandMergeRejected(status, body.message);
    }
  } catch {
    // Missing or contradictory response evidence never authorizes another merge.
  }
  return new ExitFailedError(
    `Merge response unavailable (${githubFailureKind({
      code,
      stderr,
    })}); outcome uncertain.${detail} Inspect GitHub before another request.`
  );
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
          ? reject(mergeFailure(stdout, stderr, error.code ?? undefined))
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
