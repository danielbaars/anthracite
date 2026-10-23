import fs from 'fs';
import path from 'path';
import { PreconditionsFailedError } from '../errors';
import { runGitCommand } from './runner';

/** Topology changes cannot start while Git is finishing another operation. */
export function assertNoGitOperation(command = 'move'): void {
  for (const operation of [
    'rebase-merge',
    'rebase-apply',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
  ]) {
    const file = runGitCommand({
      args: ['rev-parse', '--git-path', operation],
      onError: 'throw',
      resource: 'moveGitOperation',
    });
    if (fs.existsSync(path.resolve(file))) {
      throw new PreconditionsFailedError(
        `Cannot ${command} while Git operation ${operation} is active. Finish or abort it first.`
      );
    }
  }
}
