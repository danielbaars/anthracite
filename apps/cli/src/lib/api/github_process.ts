import { z } from 'zod';

/** Shared noninteractive gh process policy; callers retain effect/error semantics. */
export function githubProcessOptions(): {
  readonly env: NodeJS.ProcessEnv;
  readonly maxBuffer: number;
} {
  return {
    env: {
      ...process.env,
      GH_HOST: 'github.com',
      GH_PROMPT_DISABLED: '1',
      GH_PAGER: '',
      PAGER: '',
    },
    maxBuffer: 16 * 1024 * 1024,
  };
}

export function githubFailureKind(
  error: unknown
): 'missing' | 'rate-limit' | 'authentication' | 'network' | 'request' {
  const failure = z
    .object({
      code: z.union([z.string(), z.number()]).optional(),
      stderr: z.string().optional(),
    })
    .safeParse(error);
  const detail = failure.success ? failure.data.stderr ?? '' : '';
  if (failure.success && failure.data.code === 'ENOENT') return 'missing';
  if (/rate.?limit|HTTP 429/i.test(detail)) return 'rate-limit';
  if (
    /auth|login|HTTP 401|HTTP 403|permission|forbidden|not accessible/i.test(
      detail
    )
  )
    return 'authentication';
  if (/network|connect|timeout|timed out|resolve host|TLS/i.test(detail))
    return 'network';
  return 'request';
}
