import { composeEngine, TEngine } from './engine/engine';
import { TGit } from './git/git';
import { rebaseInProgress } from './git/rebase_in_progress';
import { ownsRebase } from './git/rebase_ownership';
import {
  continueConfigFactory,
  TContinueConfig,
} from './spiffy/continuation_spf';
import { prInfoConfigFactory } from './spiffy/pr_info_spf';
import { repoConfigFactory, TRepoConfig } from './spiffy/repo_config_spf';
import {
  surveyConfigFactory,
  TSurveyConfig,
} from './spiffy/survey_responses_spf';
import {
  messageConfigFactory,
  TMessageConfig,
} from './spiffy/upgrade_message_spf';
import { TUserConfig, userConfigFactory } from './spiffy/user_config_spf';
import { composeSplog, TSplog } from './utils/splog';
import { NonInteractiveError, PreconditionsFailedError } from './errors';
import { gtPrompts, TPrompts } from './utils/prompts_helpers';
import {
  resolveInteractionPolicy,
  TInteractionPolicy,
} from './interaction_policy';

export const USER_CONFIG_OVERRIDE_ENV = 'GRAPHITE_USER_CONFIG_PATH' as const;

export type TContextLite = TInteractionPolicy & {
  splog: TSplog;
  surveyConfig: TSurveyConfig;
  userConfig: TUserConfig;
  messageConfig: TMessageConfig;
  userEmail?: string;
  prompts: TPrompts;
};

type TRepoContext = {
  repoConfig: TRepoConfig;
  continueConfig: TContinueConfig;
  engine: TEngine;
};

export function initContextLite(opts?: {
  interactive?: boolean;
  quiet?: boolean;
  debug?: boolean;
  userEmail?: string;
  readonly inspection?: boolean;
}): TContextLite {
  const userConfig = userConfigFactory.load(
    process.env[USER_CONFIG_OVERRIDE_ENV]
  );
  const policy = resolveInteractionPolicy(opts);
  const splog = composeSplog({
    quiet: opts?.quiet,
    outputDebugLogs: opts?.debug,
    tips: userConfig.data.tips,
    pager: userConfig.getPager(),
    canPage: policy.canPage,
  });

  return {
    ...policy,
    splog,
    prompts: async (...args: Parameters<TPrompts>) => {
      if (!policy.canPrompt) {
        throw new NonInteractiveError();
      }
      return gtPrompts(...args);
    },
    surveyConfig: surveyConfigFactory.load(),
    userConfig,
    messageConfig: messageConfigFactory.load(undefined, {
      preserveInvalid: opts?.inspection,
    }),
    userEmail: opts?.userEmail,
  };
}

export type TContext = TRepoContext & TContextLite;

export function initContext(
  contextLite: TContextLite,
  git: TGit,
  opts?: {
    verify?: boolean;
    preserveMetadata?: boolean;
    readonly inspection?: boolean;
  }
): TContext {
  const repoConfig = repoConfigFactory.load();
  if (
    (opts?.preserveMetadata || opts?.inspection) &&
    !repoConfig.graphiteInitialized()
  )
    throw new PreconditionsFailedError(
      opts?.inspection
        ? 'Inspection requires an initialized repository. Run ch init explicitly before retrying.'
        : 'Stack reorder requires an initialized repository. Run ch init explicitly before retrying.'
    );
  if (!opts?.inspection && !rebaseInProgress()) {
    continueConfigFactory.load().delete();
  }
  const continueConfig = continueConfigFactory.load(undefined, {
    preserveInvalid: opts?.inspection,
  });
  // Attached worktrees keep their own subject; only an own local replay may use C.
  const inspectionOverride =
    opts?.inspection &&
    !git.getCurrentBranchName() &&
    ownsRebase(continueConfig.data.rebaseOwnership) &&
    continueConfig.data.rebasedBranchBase
      ? continueConfig.data.currentBranchOverride
      : undefined;
  const engine = composeEngine({
    git,
    trunkName: repoConfig.data.trunk,
    currentBranchOverride: opts?.inspection
      ? inspectionOverride
      : continueConfig.data.currentBranchOverride,
    splog: contextLite.splog,
    noVerify: !(opts?.verify ?? true),
    remote: repoConfig.getRemote(),
    preserveMetadata: opts?.preserveMetadata || opts?.inspection,
    inspection: opts?.inspection,
    restackCommitterDateIsAuthorDate:
      contextLite.userConfig.data.restackCommitterDateIsAuthorDate,
  });
  if (!opts?.inspection) {
    const prInfoConfig = prInfoConfigFactory.loadIfExists();
    if (prInfoConfig) prInfoConfig.delete();
  }
  return {
    ...contextLite,
    repoConfig,
    continueConfig,
    engine,
  };
}
