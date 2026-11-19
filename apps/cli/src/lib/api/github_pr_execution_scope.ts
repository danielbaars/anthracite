import { AsyncLocalStorage } from 'async_hooks';

type GithubPrReadExecutor = (args: readonly string[]) => Promise<string>;
const ownedReads = new AsyncLocalStorage<GithubPrReadExecutor>();

/** Fresh replay input reads share their inspection's deadline and cancellation. */
export function withGithubPrReadExecutor<T>(
  execute: GithubPrReadExecutor,
  read: () => Promise<T>
): Promise<T> {
  return ownedReads.run(execute, read);
}

export function scopedGithubPrRead(
  args: readonly string[]
): Promise<string> | undefined {
  return ownedReads.getStore()?.(args);
}
