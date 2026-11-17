import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ExitFailedError } from './errors';
import {
  assertLandingProgressUnchanged,
  current,
  LandingProgress,
  landingProgressPath,
  landingProgressSchema,
  owned,
} from './landing_progress';

type Retry = NonNullable<LandingProgress['retry']>;

function digest(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function scope(record: LandingProgress): string {
  return digest(
    JSON.stringify({
      directory: record.directory,
      gitDirectory: record.gitDirectory,
      repo: record.repo,
      remote: record.remote,
      remoteUrlHash: record.remoteUrlHash,
      pushUrlHash: record.pushUrlHash,
      trunk: record.trunk,
      trunkHead: record.trunkHead,
      target: record.target,
      checkout: record.checkout,
      version: record.version,
      merges: record.merges.map(
        ({ branch, parent, base, head, metadata, number, url }) => ({
          branch,
          parent,
          base,
          head,
          metadata,
          number,
          url,
        })
      ),
      maintenance: record.maintenance.map(
        ({ branch, parent, base, head, metadata, number, url }) => ({
          branch,
          parent,
          base,
          head,
          metadata,
          number,
          url,
        })
      ),
    })
  );
}
function directory(): string {
  return path.join(
    path.dirname(landingProgressPath()),
    '.anthracite_landing_retry'
  );
}
function assertPrivate(file: string, isDirectory: boolean): void {
  const stat = fs.lstatSync(file);
  if (
    (isDirectory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error(
      'Retry evidence must be private, owned and free of symlinks.'
    );
}
function sync(file: string): void {
  const fd = fs.openSync(file, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function write(file: string, bytes: string): void {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Retain source before publishing reader-gated intent; never persist permission. */
export function retainLandingRetry(
  record: LandingProgress,
  original: string
): LandingProgress {
  assertLandingProgressUnchanged(record);
  assertLandingRetryEvidence(record);
  const member = current(record);
  const retry: Retry = {
    attempt: randomUUID(),
    source: digest(original),
    scope: scope(record),
    index: record.index ?? 0,
    number: member.number,
    url: member.url,
    branch: member.branch,
    head: owned(member).head,
    base: owned(member).base,
  };
  const root = directory();
  try {
    if (!fs.lstatSync(root, { throwIfNoEntry: false })) {
      fs.mkdirSync(root, { mode: 0o700 });
      sync(path.dirname(root));
    }
    assertPrivate(root, true);
    const attempt = path.join(root, retry.attempt);
    fs.mkdirSync(attempt, { mode: 0o700 });
    write(path.join(attempt, 'original.json'), original);
    write(path.join(attempt, 'intent.json'), JSON.stringify(retry) + '\n');
    sync(attempt);
    sync(root);
    const next = { ...record, retry };
    assertLandingRetryEvidence(next);
    return next;
  } catch (error: unknown) {
    throw new ExitFailedError(
      `Retry evidence could not be retained; no request sent. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function assertLandingRetryEvidence(record: LandingProgress): void {
  validateEvidence(record, new Set<string>());
}

function validateEvidence(record: LandingProgress, visited: Set<string>): void {
  const retry = record.retry;
  if (!retry) return;
  try {
    if (visited.has(retry.attempt) || visited.size >= 128)
      throw new Error(
        'Retry evidence chain is cyclic or exceeds 128 attempts.'
      );
    visited.add(retry.attempt);
    const root = directory();
    const attempt = path.join(root, retry.attempt);
    assertPrivate(root, true);
    assertPrivate(attempt, true);
    for (const name of ['original.json', 'intent.json'])
      assertPrivate(path.join(attempt, name), false);
    const original = fs.readFileSync(
      path.join(attempt, 'original.json'),
      'utf8'
    );
    const source = landingProgressSchema.parse(JSON.parse(original));
    const member = current(source);
    if (
      source.phase !== 'merge-requested' ||
      (source.index ?? 0) !== retry.index ||
      member.number !== retry.number ||
      member.url !== retry.url ||
      member.branch !== retry.branch ||
      owned(member).head !== retry.head ||
      owned(member).base !== retry.base ||
      scope(source) !== retry.scope ||
      scope(record) !== retry.scope ||
      digest(original) !== retry.source ||
      fs.readFileSync(path.join(attempt, 'intent.json'), 'utf8') !==
        JSON.stringify(retry) + '\n'
    )
      throw new Error('Retry evidence identity changed.');
    validateEvidence(source, visited);
  } catch (error: unknown) {
    throw new ExitFailedError(
      `Retry evidence unavailable or changed; no new request authorized. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** A rejection of a newer request cannot settle the older outstanding uncertainty. */
export function hasCurrentLandingRetry(record: LandingProgress): boolean {
  const retry = record.retry;
  const member = current(record);
  return (
    !!retry &&
    retry.index === (record.index ?? 0) &&
    retry.number === member.number &&
    retry.url === member.url &&
    retry.head === owned(member).head &&
    retry.base === owned(member).base &&
    retry.branch === member.branch
  );
}

/** Immutable receipt supplements intent; it never grants another request. */
export function retainLandingRetryOutcome(
  record: LandingProgress,
  outcome: 'confirmed' | 'rejected' | 'uncertain',
  detail: string
): void {
  if (!hasCurrentLandingRetry(record) || !record.retry) return;
  assertLandingRetryEvidence(record);
  const attempt = path.join(directory(), record.retry.attempt);
  const file = path.join(attempt, `${outcome}.json`);
  if (fs.lstatSync(file, { throwIfNoEntry: false })) {
    assertPrivate(file, false);
    return;
  }
  write(
    file,
    JSON.stringify({
      attempt: record.retry.attempt,
      source: record.retry.source,
      outcome,
      detail: detail.slice(0, 8192),
    }) + '\n'
  );
  sync(attempt);
}
