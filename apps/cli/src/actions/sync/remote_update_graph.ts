import { randomUUID } from 'crypto';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { z } from 'zod';
import { githubRepoSlug } from '../../lib/api/github_repo';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import {
  fetchBranch,
  readFetchHead,
  writeFetchBase,
} from '../../lib/git/fetch_branch';
import { getSha, getShaOrThrow } from '../../lib/git/get_sha';
import { getMergeBase } from '../../lib/git/merge_base';
import { runGitCommand } from '../../lib/git/runner';
import { readMetadataRef } from '../../lib/engine/metadata_ref';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { RemoteTrunkUpdate } from './remote_update_trunk';

const pullRequestSchema = z.object({
  headRefName: z.string().min(1),
  baseRefName: z.string().min(1),
  number: z.number().int().positive(),
  url: z.string().url(),
  headRefOid: z.string().regex(/^[a-f0-9]{40,64}$/),
});

type PullRequest = z.infer<typeof pullRequestSchema>;
export type RemoteUpdateSelection = {
  readonly branchName: string;
  readonly parentBranchName: string;
  readonly expectedSourceHead: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly previousHead: string;
  readonly previousMetadata: string;
  readonly previousParentBranchName: string | undefined;
  readonly previousBase: string | undefined;
};
export type RemoteUpdateNode = RemoteUpdateSelection & {
  resolution?: 'REBASE' | 'OVERWRITE' | 'UPDATE';
  readonly head: string;
  readonly base: string;
  readonly sourceRef: string;
};

function lookupPullRequest(
  branch: string,
  context: TContext
): PullRequest | undefined {
  let output: string;
  try {
    output = execFileSync(
      'gh',
      [
        'pr',
        'view',
        branch,
        '--repo',
        githubRepoSlug(context),
        '--json',
        'headRefName,baseRefName,number,url,headRefOid',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString();
  } catch (error) {
    if (
      error instanceof Error &&
      'stderr' in error &&
      Buffer.isBuffer(error.stderr) &&
      /^no pull requests found(?: for branch [^\n]+)?$/i.test(
        error.stderr.toString().trim()
      )
    )
      return undefined;
    throw new ExitFailedError(
      `Pull request lookup failed for ${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new ExitFailedError(`Malformed pull request response for ${branch}.`);
  }
  const result = pullRequestSchema.safeParse(value);
  if (
    !result.success ||
    (!/^\d+$/.test(branch) && result.data.headRefName !== branch) ||
    (/^\d+$/.test(branch) && result.data.number !== Number(branch)) ||
    result.data.url !==
      `https://github.com/${githubRepoSlug(context)}/pull/${result.data.number}`
  ) {
    throw new ExitFailedError(`Invalid pull request identity for ${branch}.`);
  }
  for (const name of [result.data.headRefName, result.data.baseRefName]) {
    if (
      runGitCommand({
        args: ['check-ref-format', '--branch', name],
        onError: 'ignore',
        resource: 'validateGetBranch',
      }) !== name
    )
      throw new ExitFailedError(
        `Invalid pull request branch identity: ${name}.`
      );
  }
  return result.data;
}

export function getPullRequest(branch: string, context: TContext): PullRequest {
  const pr = lookupPullRequest(branch, context);
  if (!pr)
    throw new ExitFailedError(
      `Could not trace ${branch} back to trunk: no pull request found.`
    );
  return pr;
}

export function selectRemoteUpdateGraph(
  target: string,
  downstack: boolean,
  context: TContext
): RemoteUpdateSelection[] {
  const selected: RemoteUpdateSelection[] = [];
  const seen = new Set<string>();
  let branch = target;
  while (branch !== context.engine.trunk) {
    if (seen.has(branch))
      throw new ExitFailedError(
        `Encountered a cycle while resolving the stack for ${target}.`
      );
    seen.add(branch);
    const association = readMetadataRef(branch).prInfo?.number;
    const pr = getPullRequest(
      association ? String(association) : branch,
      context
    );
    if (pr.headRefName !== branch)
      throw new ExitFailedError(`Invalid pull request identity for ${branch}.`);
    selected.unshift(snapshotSelection(branch, pr));
    branch = pr.baseRefName;
  }
  if (
    !downstack &&
    context.engine.branchExists(target) &&
    context.engine.isBranchTracked(target)
  ) {
    const queue = [...context.engine.getChildren(target)].sort();
    for (const descendant of queue) {
      if (seen.has(descendant))
        throw new ExitFailedError(`Encountered a cycle at ${descendant}.`);
      seen.add(descendant);
      const association = context.engine.getPrInfo(descendant)?.number;
      const pr = lookupPullRequest(
        association ? String(association) : descendant,
        context
      );
      if (!pr) {
        if (association)
          throw new ExitFailedError(
            `Required associated pull request ${association} for ${descendant} is missing.`
          );
        context.splog.info(
          `${descendant} is local-only; remote refresh skipped (no pull request).`
        );
        queue.push(...context.engine.getChildren(descendant).sort());
        continue;
      }
      if (pr.headRefName !== descendant)
        throw new ExitFailedError(
          `Invalid pull request identity for ${descendant}.`
        );
      selected.push(snapshotSelection(descendant, pr));
      queue.push(...context.engine.getChildren(descendant).sort());
    }
  }
  return orderRemoteUpdateGraph(selected, context);
}

function snapshotSelection(
  branchName: string,
  pr: PullRequest
): RemoteUpdateSelection {
  const metadata = readMetadataRef(branchName);
  return {
    branchName,
    parentBranchName: pr.baseRefName,
    expectedSourceHead: pr.headRefOid,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
    previousHead: getSha(`refs/heads/${branchName}`),
    previousMetadata: getSha(`refs/branch-metadata/${branchName}`),
    previousParentBranchName: metadata.parentBranchName,
    previousBase: metadata.parentBranchRevision,
  };
}

function orderRemoteUpdateGraph(
  selected: readonly RemoteUpdateSelection[],
  context: TContext
): RemoteUpdateSelection[] {
  const ordered: RemoteUpdateSelection[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (branch: string): void => {
    if (branch === context.engine.trunk || done.has(branch)) return;
    if (visiting.has(branch))
      throw new ExitFailedError(`Encountered a cycle at ${branch}.`);
    visiting.add(branch);
    const node = selected.find((item) => item.branchName === branch);
    if (
      !node &&
      (!context.engine.branchExists(branch) ||
        !context.engine.isBranchTracked(branch))
    )
      throw new ExitFailedError(
        `Could not trace required parent ${branch} back to trunk.`
      );
    visit(
      node?.parentBranchName ?? context.engine.getParentPrecondition(branch)
    );
    visiting.delete(branch);
    done.add(branch);
    if (node) ordered.push(node);
  };
  for (const node of selected) visit(node.branchName);
  return ordered;
}

/** Run before context initialization can repair or remove recovery metadata. */
export function assertGetOperationAvailable(): void {
  for (const name of [
    'rebase-merge',
    'rebase-apply',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
    '.gtcontinue',
  ]) {
    const file = runGitCommand({
      args: ['rev-parse', '--git-path', name],
      onError: 'throw',
      resource: 'getOperationPath',
    });
    if (name === '.gtcontinue' && isCompletedLegacyContinuation(file)) continue;
    if (fs.existsSync(file))
      throw new ExitFailedError(
        'Get requires no active Git or Anthracite recovery operation. Finish or inspect the existing operation first.'
      );
  }
}

function isCompletedLegacyContinuation(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return z
      .object({
        branchesToSync: z.array(z.never()).optional(),
        branchesToRestack: z.array(z.never()).optional(),
      })
      .strict()
      .safeParse(value).success;
  } catch {
    return false;
  }
}

export function assertRemoteUpdateNodeUnchanged(node: RemoteUpdateNode): void {
  if (node.previousHead !== node.head || node.resolution)
    assertBranchesAvailableInWorktrees([node.branchName]);
  if (
    getSha(`refs/heads/${node.branchName}`) !== node.previousHead ||
    getSha(`refs/branch-metadata/${node.branchName}`) !== node.previousMetadata
  )
    throw new ExitFailedError(
      `${node.branchName} changed while getting the stack. Please retry.`
    );
}

export function snapshotRemoteUpdateGraph(
  selected: readonly RemoteUpdateSelection[],
  context: TContext,
  trunk?: RemoteTrunkUpdate
): RemoteUpdateNode[] {
  const prefix = `refs/gt-metadata/get/${randomUUID()}`;
  const nodes: RemoteUpdateNode[] = [];
  try {
    for (const [index, selection] of selected.entries()) {
      fetchBranch(context.repoConfig.getRemote(), selection.branchName);
      const head = readFetchHead();
      if (head !== selection.expectedSourceHead)
        throw new ExitFailedError(
          `Remote source for ${selection.branchName} changed while planning get. Please retry.`
        );
      const sourceRef = `${prefix}/${index}`;
      const parent =
        nodes.find((node) => node.branchName === selection.parentBranchName)
          ?.head ??
        (selection.parentBranchName === trunk?.branchName
          ? trunk.head
          : getShaOrThrow(`refs/heads/${selection.parentBranchName}`));
      const base = getRemoteBranchBase({ selection, head, parent });
      runGitCommand({
        args: ['update-ref', sourceRef, head],
        onError: 'throw',
        resource: 'pinGetSource',
      });
      nodes.push({
        ...selection,
        head,
        base,
        sourceRef,
      });
    }
    return nodes;
  } catch (error) {
    releaseRemoteUpdateGraph(nodes);
    throw error;
  }
}

function getRemoteBranchBase(args: {
  selection: RemoteUpdateSelection;
  head: string;
  parent: string;
}): string {
  const { selection, head, parent } = args;
  const metadata = readMetadataRef(selection.branchName);
  const previousBase =
    metadata.parentBranchName === selection.parentBranchName
      ? metadata.parentBranchRevision
      : undefined;
  // A rewritten parent can no longer expose the old boundary through merge-base.
  if (
    previousBase &&
    getMergeBase(head, previousBase) === previousBase &&
    getMergeBase(parent, previousBase) !== previousBase
  )
    return previousBase;
  return getMergeBase(head, parent);
}

/** Adapt explicit snapshots to the legacy engine; no fetch occurs while applying. */
export function activateRemoteUpdateNode(node: RemoteUpdateNode): void {
  runGitCommand({
    args: ['update-ref', 'refs/gt-metadata/FETCH_HEAD', node.head],
    onError: 'throw',
    resource: 'activateGetSource',
  });
  writeFetchBase(node.base);
}

export function releaseRemoteUpdateGraph(
  nodes: readonly RemoteUpdateNode[]
): void {
  for (const node of nodes)
    runGitCommand({
      args: ['update-ref', '-d', node.sourceRef],
      onError: 'throw',
      resource: 'releaseGetSource',
    });
}
