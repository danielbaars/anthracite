import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { runGitCommand } from '../../lib/git/runner';
import { getSha } from '../../lib/git/get_sha';
import {
  assertOwnedSyncRebase,
  readOwnedSyncRecovery,
  refuseSync,
} from './sync_recovery';

type OwnedSync = NonNullable<ReturnType<typeof readOwnedSyncRecovery>>;
const git = (...args: string[]): string =>
  runGitCommand({ args, onError: 'throw', resource: 'syncAbortRebase' });

/** Pin Git's existing autostash before quit, including a failed stash-store path. */
export function retainSyncAutostash(
  owned: OwnedSync,
  archive: string,
  directory: string
): string | undefined {
  const file = path.join(directory, 'autostash');
  const state = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!state) return undefined;
  if (!state.isFile())
    refuseSync('Owned autostash marker is not a regular file.');
  const marker = fs.readFileSync(file, 'utf8');
  const oid = marker.trim();
  if (!/^[a-f0-9]{40,64}$/.test(oid) || getSha(`${oid}^{commit}`) !== oid)
    refuseSync(
      'Owned autostash commit is unavailable; retain its marker for inspection.'
    );
  const digest = createHash('sha256').update(owned.bytes).digest('hex');
  const pin = `refs/gt-metadata/sync-abandonment/${digest}/autostash`;
  const bytes =
    JSON.stringify({ version: 1, marker, oid, pin }, null, 2) + '\n';
  const archived = path.join(archive, 'autostash.json');
  if (fs.existsSync(archived)) {
    const stat = fs.lstatSync(archived);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      fs.readFileSync(archived, 'utf8') !== bytes
    )
      refuseSync('Conflicting retained autostash evidence; nothing was quit.');
  } else {
    const fd = fs.openSync(archived, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const parent = fs.openSync(archive, 'r');
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  }
  const current = getSha(pin);
  if (current && current !== oid)
    refuseSync('Retained autostash pin changed; nothing was quit.');
  if (!current) git('update-ref', pin, oid, '0'.repeat(oid.length));
  if (getSha(pin) !== oid)
    refuseSync('Owned autostash pin could not be verified.');
  return marker;
}

export function quitSyncRebase(
  owned: OwnedSync,
  directory: string,
  autostash: string | undefined
): void {
  const fresh = readOwnedSyncRecovery();
  if (
    !fresh ||
    fresh.bytes !== owned.bytes ||
    assertOwnedSyncRebase(fresh.data).directory !== directory
  )
    refuseSync('Saved sync or active rebase changed before quit.');
  const file = path.join(directory, 'autostash');
  const state = fs.lstatSync(file, { throwIfNoEntry: false });
  if (state && !state.isFile())
    refuseSync('Owned autostash changed before quit.');
  const marker = state ? fs.readFileSync(file, 'utf8') : undefined;
  if (marker !== autostash) refuseSync('Owned autostash changed before quit.');
  assertRetainedSyncAutostash(owned, autostash);
  git('rebase', '--quit');
  assertRetainedSyncAutostash(owned, autostash);
}

function assertRetainedSyncAutostash(
  owned: OwnedSync,
  marker: string | undefined
): void {
  if (marker === undefined) return;
  const digest = createHash('sha256').update(owned.bytes).digest('hex');
  if (
    getSha(`refs/gt-metadata/sync-abandonment/${digest}/autostash`) !==
    marker.trim()
  )
    refuseSync(
      'Retained owned autostash pin changed; inspect archived evidence.'
    );
}
