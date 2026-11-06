import { isDeepStrictEqual } from 'util';
import { TPRInfoToUpsert } from '../lib/api/pr_info';
import { getGithubPr } from '../lib/api/github_pr';
import { ExitFailedError } from '../lib/errors';
import { TContext } from '../lib/context';
import { TEngine } from '../lib/engine/engine';
import { readMetadataRef, TBranchPRInfo } from '../lib/engine/metadata_ref';
import { getSha } from '../lib/git/get_sha';

export async function syncPrInfo(
  branchNames: string[],
  context: TContext,
  allowCreate: readonly string[] = []
): Promise<TPRInfoToUpsert> {
  const isGithubIntegrationEnabled =
    context.repoConfig.getIsGithubIntegrationEnabled();
  if (!isGithubIntegrationEnabled) {
    return [];
  }

  const snapshots = branchNames.map((branchName) => {
    context.engine.assertBranchEditable(branchName);
    const metadata = readMetadataRef(branchName);
    const head = getSha(`refs/heads/${branchName}`);
    if (
      head !== context.engine.getRevision(branchName) ||
      metadata.parentBranchName !== context.engine.getParent(branchName) ||
      metadata.parentBranchRevision !==
        context.engine.getBaseRevision(branchName) ||
      !isDeepStrictEqual(
        prFields(metadata.prInfo),
        prFields(context.engine.getPrInfo(branchName))
      )
    )
      throw new ExitFailedError(
        `${branchName} changed before PR discovery; inspect current metadata and replan submit.`
      );
    return {
      branchName,
      head,
      metadata: getSha(`refs/branch-metadata/${branchName}`),
    };
  });
  const assertSnapshot = (branchName: string): void => {
    context.engine.assertBranchEditable(branchName);
    const snapshot = snapshots.find((entry) => entry.branchName === branchName);
    if (
      !snapshot ||
      getSha(`refs/heads/${branchName}`) !== snapshot.head ||
      getSha(`refs/branch-metadata/${branchName}`) !== snapshot.metadata
    )
      throw new ExitFailedError(
        `${branchName} changed during PR discovery; concurrent work and metadata were preserved. Replan before submitting.`
      );
  };
  const resolved = await Promise.all(
    branchNames.map(async (branchName) => ({
      branchName,
      pr: await getGithubPr(branchName, context, 'open'),
    }))
  );
  // Complete discovery before changing any selected association.
  branchNames.forEach(assertSnapshot);
  for (const { branchName, pr } of resolved) {
    context.engine.assertBranchEditable(branchName);
    if (!pr && context.engine.getPrInfo(branchName)?.number !== undefined) {
      if (!allowCreate.includes(branchName))
        throw new ExitFailedError(
          `No current open PR for ${branchName}; refusing to edit historical dependency metadata or expand submission scope.`
        );
    }
  }
  for (const { branchName, pr } of resolved) {
    if (!pr && context.engine.getPrInfo(branchName)?.number !== undefined) {
      assertSnapshot(branchName);
      context.engine.clearPrInfo(branchName);
    }
  }
  const upsertInfo: TPRInfoToUpsert = resolved.flatMap(({ pr }) =>
    pr
      ? [
          {
            prNumber: pr.number,
            headRefName: pr.headRefName,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            reviewDecision: pr.reviewDecision || undefined,
            baseRefName: pr.baseRefName,
            url: pr.url,
            isDraft: pr.isDraft,
          },
        ]
      : []
  );
  for (const pr of upsertInfo) {
    assertSnapshot(pr.headRefName);
    upsertPrInfoForBranches([pr], context.engine);
  }

  return upsertInfo;
}

export function upsertPrInfoForBranches(
  prInfoToUpsert: TPRInfoToUpsert,
  engine: TEngine
): void {
  prInfoToUpsert.forEach((pr) =>
    engine.upsertPrInfo(pr.headRefName, {
      number: pr.prNumber,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      reviewDecision: pr.reviewDecision ?? undefined,
      base: pr.baseRefName,
      url: pr.url,
      isDraft: pr.isDraft,
    })
  );
}

function prFields(prInfo: TBranchPRInfo | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(prInfo ?? {}).filter(([, value]) => value !== undefined)
  );
}
