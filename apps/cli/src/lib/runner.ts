// Why does an open source CLI include telemetry?
// We the creators want to understand how people are using the tool
// All metrics logged are listed plain to see, and are non blocking in case the server is unavailable.
import yargs from 'yargs';
import chalk from 'chalk';
import { version } from '../../package.json';
import { init } from '../actions/init';
import {
  initContext,
  initContextLite,
  TContext,
  TContextLite,
} from './context';
import { getCacheLock, TCacheLock } from './engine/cache_lock';
import {
  BadTrunkOperationError,
  ConcurrentExecutionError,
  DetachedError,
  ExitFailedError,
  KilledError,
  PreconditionsFailedError,
  RebaseConflictError,
  UntrackedBranchError,
} from './errors';
import { composeGit } from './git/git';
import { TGlobalArguments } from './global_arguments';
import { tracer } from './utils/tracer';
import { CommandFailedError, CommandKilledError } from './git/runner';

export async function graphite(
  args: yargs.Arguments & TGlobalArguments,
  canonicalName: string,
  handler: (context: TContext) => Promise<void>
): Promise<void> {
  return graphiteInternal(args, canonicalName, {
    repo: true as const,
    run: handler,
  });
}

/** Read-only inspections share the engine without mutation/recovery cleanup. */
export async function graphiteInspection(
  args: yargs.Arguments & TGlobalArguments,
  handler: (context: TContext) => Promise<void>
): Promise<void> {
  try {
    const git = composeGit();
    const lite = initContextLite({ ...args, inspection: true });
    // Engine diagnostics must never become part of the branch-name data stream.
    lite.splog.debug = args.debug
      ? (message: string) => {
          process.stderr.write(`${message}\n`);
        }
      : () => void 0;
    const context = initContext(lite, git, { ...args, inspection: true });
    await handler(context);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR: ${message}\n`);
    if (
      (args.debug || process.env.DEBUG) &&
      error instanceof Error &&
      error.stack
    )
      process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  }
}

export async function graphiteWithoutRepo(
  args: yargs.Arguments & TGlobalArguments,
  canonicalName: string,
  handler: (context: TContextLite) => Promise<void>
): Promise<void> {
  return graphiteInternal(args, canonicalName, {
    repo: false as const,
    run: handler,
  });
}

async function graphiteInternal(
  args: yargs.Arguments & TGlobalArguments,
  canonicalName: string,
  handler: TGraphiteCommandHandler
): Promise<void> {
  const handlerMaybeWithCacheLock = handler.repo
    ? {
        ...handler,
        cacheLock: getCacheLock(),
      }
    : { ...handler, cacheLock: undefined };

  process.on('SIGINT', (): never => {
    handlerMaybeWithCacheLock.cacheLock?.release();
    // End all current traces abruptly.
    tracer.allSpans.forEach((s) => s.end(undefined, new KilledError()));
    // eslint-disable-next-line no-restricted-syntax
    process.exit(1);
  });
  const git = composeGit();
  try {
    const contextLite = initContextLite({
      ...args,
      userEmail: git.getUserEmail(),
    });
    await tracer.span(
      {
        name: 'command',
        resource: canonicalName,
        meta: {
          user: contextLite.userEmail ?? 'NotFound',
          version: version,
          gtInteractive: process.env.GRAPHITE_INTERACTIVE ? 'true' : 'false',
          processArgv: process.argv.join(' '),
        },
      },
      async () => {
        if (!handlerMaybeWithCacheLock.repo) {
          await handlerMaybeWithCacheLock.run(contextLite);
          return;
        }

        const context = initContext(contextLite, git, {
          ...args,
          preserveMetadata: canonicalName === 'reorder' && args.stack === true,
        });
        return await graphiteHelper(
          canonicalName,
          handlerMaybeWithCacheLock,
          context
        );
      }
    );
  } catch (err) {
    handleGraphiteError(err);
    if ((args.debug || process.env.DEBUG) && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exitCode = 1;
  }
}

// eslint-disable-next-line max-params
async function graphiteHelper(
  canonicalName: string,
  handler: TGraphiteCommandHandlerWithCacheLock,
  context: TContext
): Promise<{
  cacheBefore: string;
  cacheAfter: string;
}> {
  const cacheBefore = context.engine.debug;

  try {
    if (
      canonicalName !== 'repo init' &&
      !context.repoConfig.graphiteInitialized()
    ) {
      await init({}, context);
      context.splog.info(
        `Charcoal was not initialized; setup is now complete.`
      );
      context.splog.newline();
    }

    await handler.run(context);
  } catch (err) {
    if (
      err.constructor === DetachedError &&
      context.engine.rebaseInProgress()
    ) {
      throw new DetachedError(
        `Did you mean to run ${chalk.cyan(`ch continue`)}?`
      );
    }
    throw err;
  } finally {
    try {
      context.engine.persist();
    } catch (persistError) {
      context.engine.clear();
      context.splog.debug(`Failed to persist Charcoal cache`);
    }
    handler.cacheLock.release();
  }

  return { cacheBefore, cacheAfter: context.engine.debug };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleGraphiteError(err: any): void {
  switch (err.constructor) {
    case CommandKilledError:
    case KilledError: // the user doesn't need a message if they ended ch
    case RebaseConflictError: // we've already logged a message
      // pass
      return;

    case UntrackedBranchError:
    case BadTrunkOperationError:
    case ExitFailedError:
    case ConcurrentExecutionError:
    case PreconditionsFailedError:
    case CommandFailedError:
    default:
      process.stderr.write(`ERROR: ${err.message}\n`);
      return;
  }
}

// typescript is fun!
type TGraphiteCommandHandler =
  | { repo: true; run: (context: TContext) => Promise<void> }
  | {
      repo: false;
      run: (contextLite: TContextLite) => Promise<void>;
    };
type TGraphiteCommandHandlerWithCacheLock = {
  run: (context: TContext) => Promise<void>;
  cacheLock: TCacheLock;
};
