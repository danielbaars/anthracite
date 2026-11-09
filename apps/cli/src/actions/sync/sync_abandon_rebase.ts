import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { z } from 'zod';
import { runGitCommand } from '../../lib/git/runner';
import { getSha } from '../../lib/git/get_sha';
import { retainSyncFile } from './sync_abandon_archive';
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
  retainSyncFile(archived, bytes);
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

/** The live marker is gone after quit; retained evidence must still prove retention. */
export function verifyRetainedSyncAutostash(
  owned: OwnedSync,
  archive: string
): void {
  const digest = createHash('sha256').update(owned.bytes).digest('hex');
  const pin = `refs/gt-metadata/sync-abandonment/${digest}/autostash`;
  const quitFile = path.join(archive, 'quit.json');
  let expected: string | null | undefined;
  if (fs.lstatSync(quitFile, { throwIfNoEntry: false })) {
    const quit = z
      .object({ version: z.literal(1), autostash: z.string().nullable() })
      .strict()
      .safeParse(readAutostashEvidence(quitFile));
    if (!quit.success)
      refuseSync('Conflicting retained autostash quit evidence.');
    expected = quit.data.autostash;
  }
  const file = path.join(archive, 'autostash.json');
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) {
    if ((expected !== undefined && expected !== null) || getSha(pin))
      refuseSync('Retained autostash evidence is missing; recovery preserved.');
    return;
  }
  const value = z
    .object({
      version: z.literal(1),
      marker: z.string(),
      oid: z.string().regex(/^[a-f0-9]{40,64}$/),
      pin: z.string(),
    })
    .strict()
    .safeParse(readAutostashEvidence(file));
  if (
    !value.success ||
    value.data.marker.trim() !== value.data.oid ||
    value.data.pin !== pin ||
    (expected !== undefined && expected !== value.data.marker) ||
    getSha(`${value.data.oid}^{commit}`) !== value.data.oid ||
    getSha(pin) !== value.data.oid
  )
    refuseSync(
      'Retained autostash evidence or private pin changed; recovery preserved.'
    );
}

function readAutostashEvidence(file: string): unknown {
  const state = fs.lstatSync(file);
  if (!state.isFile() || (state.mode & 0o077) !== 0)
    refuseSync('Retained autostash evidence is not private regular storage.');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    refuseSync('Retained autostash evidence is malformed.');
  }
}
