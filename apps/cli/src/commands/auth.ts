import yargs from 'yargs';
import { graphiteWithoutRepo } from '../lib/runner';
import { execFileSync } from 'child_process';

const args = {
  token: {
    type: 'string',
    alias: 't',
    describe: 'Authenticate with the GitHub API using OAuth.',
    demandOption: false,
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'auth';
export const description =
  'Authenticate with the GitHub CLI to create and manage PRs in GitHub from Charcoal.';
export const builder = args;
export const canonical = 'auth';

const MIN_GH_VERSION = '2.0.0';

export const handler = async (argv: argsT): Promise<void> => {
  return graphiteWithoutRepo(argv, canonical, async (context) => {
    const ghVersion = getGhVersion();

    if (
      !ghVersion ||
      ghVersion.localeCompare(MIN_GH_VERSION, undefined, { numeric: true }) < 0
    ) {
      throw new Error(
        `Please install GitHub CLI version ${MIN_GH_VERSION} or higher.`
      );
    }

    const isGhAuthorized = getGithubAuthorizationStatus();

    if (isGhAuthorized) {
      context.splog.info('✅ Already authenticated with GitHub.');
      return;
    }

    if (!context.canPrompt) {
      throw new Error(
        'Charcoal is not authenticated with GitHub. Please authenticate with ch auth from an interactive terminal.'
      );
    }

    context.splog.message(
      '❌ Charcoal is not authenticated with GitHub. Please authenticate.'
    );

    try {
      execFileSync('gh', ['auth', 'login'], {
        stdio: 'inherit',
      });

      context.splog.info('✅ Successfully authenticated Charcoal with GitHub.');
    } catch {
      throw new Error(
        'Failed to authenticate Charcoal with GitHub. Please try again.'
      );
    }
  });
};

export const getGhVersion = (): string | null => {
  try {
    const output = execFileSync('gh', ['--version']).toString();
    const match = output.match(/gh version (\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
};

export const isGhInstalled = (): boolean => getGhVersion() !== null;

export const getGithubAuthorizationStatus = (): boolean => {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
