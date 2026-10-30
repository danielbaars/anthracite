import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { ExitFailedError } from './errors';
import { runGitCommand } from './git/runner';

const oid = z.string().regex(/^[a-f0-9]{40}$/);
const branch = z.string().min(1);
const member = z
  .object({
    branch,
    parent: branch,
    base: oid,
    head: oid,
    remoteHead: oid.optional(),
    metadata: oid,
    number: z.number().int().positive().optional(),
    url: z.string().url().optional(),
    reached: z
      .object({
        head: oid,
        metadata: oid,
        parent: branch,
        base: oid,
        remoteHead: oid.optional(),
      })
      .strict()
      .optional(),
    result: oid.optional(),
    cleanupResult: oid.optional(),
  })
  .strict();
const schema = z
  .object({
    owner: z.literal('anthracite-landing'),
    version: z.literal(1),
    directory: z.string().min(1),
    gitDirectory: z.string().min(1),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    remote: z.string().min(1),
    remoteUrlHash: z.string().regex(/^[a-f0-9]{64}$/),
    pushUrlHash: z.string().regex(/^[a-f0-9]{64}$/),
    trunk: branch,
    trunkHead: oid,
    target: branch,
    checkout: branch,
    cacheLock: z
      .object({
        pid: z.number().int().positive(),
        timestamp: z.number().int().positive(),
      })
      .strict()
      .optional(),
    merges: z.array(member).min(1),
    maintenance: z.array(member),
    index: z.number().int().nonnegative().optional(),
    continuationCleanup: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    replay: z
      .object({
        pending: z.array(branch).min(1),
        onto: oid,
        continuation: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        ready: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .optional(),
    phase: z.enum([
      'prepared',
      'merge-requested',
      'merged',
      'trunk-advanced',
      'remote-deleted',
      'local-deleted',
      'checkout-restored',
    ]),
    result: oid.optional(),
  })
  .strict();
export type LandingProgress = z.infer<typeof schema>;

export function landingGit(args: string[]): string {
  return runGitCommand({ args, onError: 'throw', resource: 'landing' });
}
/** Keep credentials out of durable recovery while detecting endpoint changes. */
export function landingRemoteIdentity(
  remote: string,
  repo: string
): {
  readonly remoteUrlHash: string;
  readonly pushUrlHash: string;
} {
  const declared = (key: string): string[] =>
    runGitCommand({
      args: ['config', '--get-all', key],
      onError: 'ignore',
      resource: 'landingRemoteIdentity',
    })
      .split('\n')
      .filter(Boolean);
  const fetchUrls = declared(`remote.${remote}.url`);
  const pushUrls = declared(`remote.${remote}.pushurl`);
  // Validate declarations before transport resolution; Git/SSH routing remains
  // the user's trusted configuration, not proof of the actual server endpoint.
  const githubRepo = (url: string): string | undefined => {
    const match =
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(
        url
      );
    return match &&
      !['.', '..'].includes(match[1]) &&
      !['.', '..'].includes(match[2])
      ? `${match[1]}/${match[2]}`.toLowerCase()
      : undefined;
  };
  if (fetchUrls.length !== 1 || pushUrls.length > 1)
    throw new ExitFailedError(
      'Landing requires one matching fetch/push remote endpoint. No credentials are recorded.'
    );
  if (
    [...fetchUrls, ...pushUrls].some(
      (url) => githubRepo(url) !== repo.toLowerCase()
    )
  )
    throw new ExitFailedError(
      'Landing requires a supported declared GitHub remote matching the configured repository (HTTPS, git@github.com or ssh://git@github.com). No credentials are recorded.'
    );
  const fetch = landingGit(['remote', 'get-url', '--all', remote]);
  const push = landingGit(['remote', 'get-url', '--push', '--all', remote]);
  if (!fetch || fetch.includes('\n') || fetch !== push)
    throw new ExitFailedError(
      'Landing requires one matching fetch/push remote endpoint. No credentials are recorded.'
    );
  const digest = (url: string): string =>
    createHash('sha256').update(url).digest('hex');
  return { remoteUrlHash: digest(fetch), pushUrlHash: digest(push) };
}
export function assertLandingRemoteIdentity(record: LandingProgress): void {
  const identity = landingRemoteIdentity(record.remote, record.repo);
  if (
    identity.remoteUrlHash !== record.remoteUrlHash ||
    identity.pushUrlHash !== record.pushUrlHash
  )
    throw new ExitFailedError(
      'Landing remote endpoint changed; recovery preserved.'
    );
}
export function landingProgressPath(): string {
  return path.join(
    path.resolve(landingGit(['rev-parse', '--git-common-dir'])),
    '.anthracite_landing'
  );
}
export function assertNoPendingLanding(): void {
  if (exists(landingProgressPath()))
    throw new ExitFailedError(
      'Pending landing is preserved. Run an land for its original target to reconcile before another mutation.'
    );
}
export function loadLandingProgress(): LandingProgress | undefined {
  const file = landingProgressPath();
  if (!exists(file)) return undefined;
  try {
    if (!fs.lstatSync(file).isFile())
      throw new Error('not an owned regular record');
    const record = schema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    const first = record.merges[0];
    const participants = [...record.merges, ...record.maintenance];
    const survivors = landingSurvivors(record)
      .filter((item) => !item.cleanupResult)
      .map((item) => item.branch);
    const pending = record.replay?.pending;
    if (
      (record.replay?.ready &&
        record.replay.ready !== record.replay.continuation) ||
      (pending &&
        JSON.stringify(pending) !==
          JSON.stringify(survivors.slice(survivors.indexOf(pending[0])))) ||
      record.merges[record.merges.length - 1].branch !== record.target ||
      first.parent !== record.trunk ||
      new Set(participants.map((item) => item.branch)).size !==
        participants.length ||
      (record.index ?? 0) >= record.merges.length ||
      record.merges.some(
        (item, index) =>
          !item.number ||
          !item.url ||
          item.remoteHead !== item.head ||
          (index > 0 && item.parent !== record.merges[index - 1].branch)
      ) ||
      participants.some(
        (item) =>
          item.url !== undefined &&
          item.url.toLowerCase() !==
            `https://github.com/${record.repo}/pull/${item.number}`.toLowerCase()
      ) ||
      record.target === record.trunk ||
      record.directory !==
        fs.realpathSync(landingGit(['rev-parse', '--show-toplevel'])) ||
      record.gitDirectory !==
        fs.realpathSync(landingGit(['rev-parse', '--absolute-git-dir'])) ||
      (record.phase !== 'prepared' &&
        record.phase !== 'merge-requested' &&
        !record.result)
    )
      throw new Error('ownership or scope mismatch');
    return record;
  } catch {
    throw new ExitFailedError(
      `Invalid or foreign landing recovery preserved at ${file}. Inspect its original project and identities before retrying.`
    );
  }
}

/** Atomic durable intent; never overwrite recovery changed by another process. */
export function saveLandingProgress(
  record: LandingProgress,
  previous?: LandingProgress
): void {
  const file = landingProgressPath();
  assertUnchanged(file, previous);
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(schema.parse(record)) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    assertUnchanged(file, previous);
    fs.renameSync(temporary, file);
    syncDirectory(file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function clearLandingProgress(record: LandingProgress): void {
  const file = landingProgressPath();
  assertUnchanged(file, record);
  fs.unlinkSync(file);
  syncDirectory(file);
}
function assertUnchanged(file: string, previous?: LandingProgress): void {
  if (
    previous
      ? !exists(file) ||
        fs.readFileSync(file, 'utf8') !==
          JSON.stringify(schema.parse(previous)) + '\n'
      : exists(file)
  )
    throw new ExitFailedError(
      'Landing recovery changed concurrently; preserved for inspection.'
    );
}
function syncDirectory(file: string): void {
  const fd = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function exists(file: string): boolean {
  return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
}

export function current(
  record: LandingProgress
): LandingProgress['merges'][number] & { number: number; url: string } {
  const member = record.merges[record.index ?? 0];
  if (!member?.number || !member.url)
    throw new ExitFailedError('Landing merge identity is unavailable.');
  return { ...member, number: member.number, url: member.url };
}
export function owned(
  member: LandingProgress['merges'][number]
): NonNullable<LandingProgress['merges'][number]['reached']> {
  return (
    member.reached ?? {
      head: member.head,
      metadata: member.metadata,
      parent: member.parent,
      base: member.base,
      remoteHead: member.remoteHead,
    }
  );
}

/** Original captured ancestry retains this merge's scope across partial reparents. */
export function landingSurvivors(
  record: LandingProgress
): LandingProgress['merges'] {
  const candidates = [
    ...record.merges.slice((record.index ?? 0) + 1),
    ...record.maintenance,
  ];
  const affected = new Set([current(record).branch]);
  const survivors: LandingProgress['merges'] = [];
  for (const member of candidates) {
    if (!affected.has(member.parent)) continue;
    affected.add(member.branch);
    survivors.push(member);
  }
  return survivors;
}
