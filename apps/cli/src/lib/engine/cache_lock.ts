import fs from 'fs';
import { cuteString } from '../utils/cute_string';
import { ConcurrentExecutionError } from '../errors';
import { cacheLockConfigFactory } from '../spiffy/cache_lock_spf';

export type TCacheLock = {
  lock: (timestamp?: number) => void;
  release: () => void;
};
export function getCacheLock(): TCacheLock {
  return {
    lock: (timestamp) => {
      const cacheLockConfig = cacheLockConfigFactory.load(undefined, {
        preserveInvalid: timestamp !== undefined,
      });
      if (timestamp !== undefined) {
        fs.writeFileSync(
          cacheLockConfig.path,
          cuteString({ timestamp, pid: process.pid }),
          { mode: 0o600, flag: 'wx' }
        );
        return;
      }
      if (cacheLockConfig.data.pid || cacheLockConfig.data.timestamp) {
        throw new ConcurrentExecutionError();
      }
      cacheLockConfig.update((data) => {
        data.pid = process.pid;
        data.timestamp = Date.now();
      });
    },
    release: () => {
      const current = cacheLockConfigFactory.load(undefined, {
        preserveInvalid: true,
      });
      if (current.data.pid === process.pid) current.delete();
    },
  };
}
