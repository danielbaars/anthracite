import { execFileSync } from 'child_process';
import * as t from '@withgraphite/retype';
import { ExitFailedError } from '../../lib/errors';

function isLogin(login: string): boolean {
  return (
    /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login) && !login.includes('--')
  );
}

export function getAssignees(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const names = value.split(',').map((name) => name.trim());
  if (names.some((name) => name !== '@me' && !isLogin(name))) {
    throw new ExitFailedError(
      'Provide non-empty GitHub usernames or @me with --assignees.'
    );
  }
  let account: string | undefined;
  if (names.includes('@me')) {
    try {
      const identity: unknown = JSON.parse(
        execFileSync('gh', ['api', 'user'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString()
      );
      const identitySchema = t.shape({ login: t.string });
      if (!identitySchema(identity) || !isLogin(identity.login)) {
        throw new Error('Invalid GitHub identity response.');
      }
      account = identity.login;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new ExitFailedError(
          'The GitHub CLI (`gh`) is required but was not found on your PATH. Install it from https://cli.github.com and run `an auth`.'
        );
      }
      throw new ExitFailedError(
        'Could not verify the GitHub user for @me. Run `an auth` and retry.'
      );
    }
  }
  return [
    ...new Set(
      names.map((name) => (name === '@me' ? account ?? '' : name).toLowerCase())
    ),
  ];
}
