import { AsyncLocalStorage } from 'async_hooks';
import { landingSourceReadArgs } from './landing_inspection_process';

const freshSourceReads = new AsyncLocalStorage<boolean>();

/** Saved operations retain their existing status semantics outside this invocation. */
export function withFreshLandingSourceReads<T>(action: () => T): T {
  return freshSourceReads.run(true, action);
}

/** Only source inspection uses this clamp; actual replay and hooks remain unchanged. */
export function freshLandingSourceArgs(args: readonly string[]): string[] {
  return freshSourceReads.getStore() ? landingSourceReadArgs(args) : [...args];
}
