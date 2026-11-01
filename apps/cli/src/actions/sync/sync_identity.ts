import { TRepoConfig } from '../../lib/spiffy/repo_config_spf';
import { ExitFailedError } from '../../lib/errors';
import { runGitCommand } from '../../lib/git/runner';

/** Pure local sync must not acquire remote or GitHub configuration requirements. */
export function getSyncRepository(repo: TRepoConfig): string | undefined {
  try {
    return `${repo.getRepoOwner()}/${repo.getRepoName()}`;
  } catch (error) {
    if (
      !repo.getIsGithubIntegrationEnabled() &&
      error instanceof ExitFailedError
    )
      return undefined;
    throw error;
  }
}

export function getSyncRemoteUrl(remote: string): string | undefined {
  const remotes = runGitCommand({
    args: ['remote'],
    onError: 'throw',
    resource: 'syncIdentity',
  }).split('\n');
  if (!remotes.includes(remote)) return undefined;
  return runGitCommand({
    args: ['remote', 'get-url', remote],
    onError: 'throw',
    resource: 'syncIdentity',
  });
}
