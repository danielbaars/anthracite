import fs from 'fs';
import { runGitCommand } from './runner';

function getIndexPath(): string {
  return runGitCommand({
    args: ['rev-parse', '--git-path', 'index'],
    onError: 'throw',
    resource: 'indexPath',
  });
}

export function readIndex(): Buffer {
  return fs.readFileSync(getIndexPath());
}

export function restoreIndex(index: Buffer): void {
  const indexPath = getIndexPath();
  const lockPath = `${indexPath}.lock`;
  fs.writeFileSync(lockPath, index, { flag: 'wx' });
  try {
    fs.renameSync(lockPath, indexPath);
  } catch (error) {
    fs.unlinkSync(lockPath);
    throw error;
  }
}
