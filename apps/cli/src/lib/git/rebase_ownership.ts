import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { getRebaseDirectory } from './rebase_in_progress';

// Keep the 0.1.0 marker so interrupted operations survive an upgrade.
const OWNERSHIP_FILE = 'charcoal-continuation';

/** Git removes this marker on abort or completion, even for an identical retry. */
export function recordRebaseOwnership(): string | undefined {
  const directory = getRebaseDirectory();
  if (!directory) return undefined;
  const ownership = randomUUID();
  fs.writeFileSync(path.join(directory, OWNERSHIP_FILE), ownership, {
    mode: 0o600,
  });
  return ownership;
}

export function ownsRebase(ownership: string | undefined): boolean {
  if (!ownership) return false;
  const directory = getRebaseDirectory();
  if (!directory) return false;
  const marker = path.join(directory, OWNERSHIP_FILE);
  return fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === ownership;
}
