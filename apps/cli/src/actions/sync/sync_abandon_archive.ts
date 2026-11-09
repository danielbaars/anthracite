import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { refuseSync } from './sync_recovery';

/** Publish only complete durable bytes; interrupted private staging never owns the final name. */
export function retainSyncFile(file: string, bytes: string): void {
  if (fs.lstatSync(file, { throwIfNoEntry: false })) {
    assertRetainedSyncFile(file, bytes);
    return;
  }
  const temporary = path.join(path.dirname(file), `.pending-${randomUUID()}`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.linkSync(temporary, file);
  } catch (error) {
    if (!fs.lstatSync(file, { throwIfNoEntry: false })) throw error;
    assertRetainedSyncFile(file, bytes);
  }
  syncDirectory(path.dirname(file));
  fs.unlinkSync(temporary);
}

export function assertRetainedSyncFile(file: string, bytes: string): void {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    !fs.readFileSync(file).equals(Buffer.from(bytes))
  )
    refuseSync(`Conflicting archive preserved at ${file}.`);
}

export function syncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
