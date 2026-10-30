import { TContext } from './context';
import { ExitFailedError } from './errors';
import { inspectionGithubRepo } from './api/github_pr';
import {
  LandingProgress,
  assertLandingRemoteIdentity,
} from './landing_progress';

export function validateLandingIdentity(
  record: LandingProgress,
  context: TContext
): void {
  assertLandingRemoteIdentity(record);
  if (
    inspectionGithubRepo(context) !== record.repo ||
    context.engine.trunk !== record.trunk ||
    context.repoConfig.getRemote() !== record.remote
  )
    throw new ExitFailedError(
      'Landing repository/trunk/remote identity changed or split fetch/push remotes; recovery preserved.'
    );
}
