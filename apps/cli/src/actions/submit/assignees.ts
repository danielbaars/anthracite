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
    const identity: unknown = JSON.parse(
      execFileSync('gh', ['api', 'user']).toString()
    );
    const identitySchema = t.shape({ login: t.string });
    if (!identitySchema(identity) || !isLogin(identity.login)) {
      throw new ExitFailedError('Could not verify the GitHub user for @me.');
    }
    account = identity.login;
  }
  return [
    ...new Set(
      names.map((name) => (name === '@me' ? account ?? '' : name).toLowerCase())
    ),
  ];
}
