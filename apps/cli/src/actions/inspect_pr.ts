import { TContext } from '../lib/context';
import {
  getGithubPr,
  GithubPr,
  inspectionGithubRepo,
  runGithubPrCommand,
} from '../lib/api/github_pr';
import { ExitFailedError } from '../lib/errors';
import { connectedPrBranches } from './pr_selection';

export async function inspectPr(
  branch: string,
  options: { readonly stack: boolean; readonly web: boolean },
  context: TContext
): Promise<void> {
  const branches = options.stack
    ? connectedPrBranches(branch, context)
    : [branch];
  const prs = await Promise.all(
    branches.map(async (name) => ({
      name,
      pr: await getGithubPr(name, context),
    }))
  );
  const selected = prs.find((entry) => entry.name === branch)?.pr;
  if (options.web && !selected)
    throw new ExitFailedError(
      `Branch "${branch}" has no pull request to open.`
    );
  process.stdout.write(`Repository: ${inspectionGithubRepo(context)}\n`);
  for (const entry of prs) printPr(entry.name, entry.pr);
  if (options.web && selected)
    await runGithubPrCommand(
      ['pr', 'view', selected.url, '--web'],
      inspectionGithubRepo(context)
    );
}

function printPr(branch: string, pr: GithubPr | undefined): void {
  process.stdout.write(`Branch: ${branch}\n`);
  if (!pr) {
    process.stdout.write('No pull request.\n');
    return;
  }
  process.stdout.write(
    [
      `PR #${pr.number}: ${pr.url}`,
      `Title: ${pr.title}`,
      `Author: ${pr.author?.login ?? 'UNKNOWN'}`,
      `State: ${pr.state}`,
      `Draft: ${pr.isDraft}`,
      `Base: ${pr.baseRefName}`,
      `Head: ${pr.headRefOid}`,
      `Review: ${pr.reviewDecision || 'UNKNOWN'}`,
      `Mergeability: ${pr.mergeable ?? 'UNKNOWN'}`,
      `Readiness: ${pr.mergeStateStatus || 'UNKNOWN'}`,
      'Required policy: UNKNOWN (requirements not inspected)',
      `Checks: ${
        pr.statusCheckRollup?.length === 0
          ? 'none reported'
          : pr.statusCheckRollup
              ?.map(
                (check) =>
                  `${check.name ?? check.context ?? 'UNKNOWN'} ${
                    check.conclusion || check.state || check.status || 'UNKNOWN'
                  }`
              )
              .join(', ') || 'UNKNOWN'
      }`,
    ].join('\n') + '\n'
  );
}
