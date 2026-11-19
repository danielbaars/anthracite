import { withGithubPrReadExecutor } from '../api/github_pr_execution_scope';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { LandPlan } from '../../actions/land';
import { initContext, TContext } from '../context';
import { getGithubPr, inspectionGithubRepo } from '../api/github_pr';
import { ExitFailedError } from '../errors';
import { composeGit } from './git';
import {
  withLandingInspection,
  landingSourceReadArgs,
} from './landing_inspection_process';

function fileState(filename: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw new ExitFailedError(
        'Replay input file cannot be inspected within its bounds.'
      );
    const bytes = Buffer.alloc(stat.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== stat.size)
      throw new ExitFailedError('Replay input file changed during inspection.');
    return createHash('sha256').update(bytes.subarray(0, count)).digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

/** Digest-only input evidence; never persist raw configuration or generated OIDs. */
export async function captureLandingReplayInputs(
  plan: LandPlan,
  context: TContext
): Promise<string> {
  return withLandingInspection('an-land-inputs-', async (git) =>
    withGithubPrReadExecutor(git.runGithub, async () => {
      const read = async (args: readonly string[]): Promise<string> =>
        (
          await git.run(landingSourceReadArgs(args), {
            cwd: process.cwd(),
            env: {
              ...git.originalEnvironment,
              GIT_OPTIONAL_LOCKS: '0',
              GIT_NO_LAZY_FETCH: '1',
            },
          })
        ).stdout;
      const fresh = initContext(context, composeGit(), { inspection: true });
      const remote = fresh.repoConfig.getRemote();
      const names = [...plan.merges, ...plan.maintenance].map(
        (item) => item.branch
      );
      const common = (
        await read(['rev-parse', '--path-format=absolute', '--git-common-dir'])
      ).trim();
      const participants = [];
      for (const branch of names)
        participants.push({
          branch,
          head: fresh.engine.getRevision(branch),
          parent: fresh.engine.getParentPrecondition(branch),
          base: fresh.engine.getBaseRevision(branch),
          children: [...fresh.engine.getChildrenPrecondition(branch)].sort(),
          metadata: (
            await read(['rev-parse', `refs/branch-metadata/${branch}`])
          ).trim(),
        });
      // Only the first GitHub merge uses a PR snapshot as its replay boundary;
      // later target boundaries come from the captured and maintained local graph.
      const first = plan.merges[0];
      const pr = first ? await getGithubPr(first.branch, fresh) : undefined;
      const firstPr = pr
        ? {
            number: pr.number,
            url: pr.url,
            state: pr.state,
            head: pr.headRefOid,
            parent: pr.baseRefName,
            base: pr.baseRefOid,
          }
        : null;
      const attributes = [
        path.resolve(
          (await read(['rev-parse', '--git-path', 'info/attributes'])).trim()
        ),
        (await read(['var', 'GIT_ATTR_SYSTEM'])).trim(),
        (await read(['var', 'GIT_ATTR_GLOBAL'])).trim(),
      ].filter(Boolean);
      const history = [];
      for (const name of ['shallow', 'info/grafts', 'objects/info/alternates'])
        history.push(
          fileState(
            path.resolve((await read(['rev-parse', '--git-path', name])).trim())
          )
        );
      const inputs = {
        repo: inspectionGithubRepo(fresh),
        trunk: fresh.engine.trunk,
        target: plan.target,
        checkout: composeGit().getCurrentBranchName(),
        head: await read(['rev-parse', 'HEAD']),
        status: await read([
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=normal',
        ]),
        index: await read(['ls-files', '--stage', '-z']),
        trunkHead: fresh.engine.getRevision(plan.trunk),
        participants,
        firstPr,
        remote,
        fetchUrl: await read(['remote', 'get-url', '--all', remote]),
        pushUrl: await read(['remote', 'get-url', '--push', '--all', remote]),
        remoteHeads: await read([
          'ls-remote',
          '--heads',
          remote,
          ...[plan.trunk, ...names].map((name) => `refs/heads/${name}`),
        ]),
        // Omit only our disposable command-line hooks entry, never source configuration.
        config: (
          await read([
            'config',
            '--null',
            '--show-origin',
            '--get-regexp',
            '^(merge\\.|filter\\.|rebase\\.|rerere\\.|core\\.|extensions\\.|branch\\.|remote\\.|url\\.|protocol\\.|credential\\.|include|fetch\\.|submodule\\.|commit\\.|user\\.|gpg\\.|init\\.|maintenance\\.|gc\\.)',
          ])
        ).replace(`command line:\0core.hookspath\n${git.hooks}\0`, ''),
        repoConfig: fileState(path.join(common, '.graphite_repo_config')),
        history,
        replacements: await read([
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/replace',
        ]),
        attributes: attributes.map((filename) => [
          filename,
          fileState(filename),
        ]),
      };
      return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
    })
  );
}

export async function assertLandingReplayInputs(
  plan: LandPlan,
  context: TContext
): Promise<void> {
  try {
    if (
      !plan.replayInputs ||
      (await captureLandingReplayInputs(plan, context)) !== plan.replayInputs
    )
      throw new Error('changed');
  } catch {
    throw new ExitFailedError(
      'Replay inputs changed or became unavailable after inspection; preview again. No landing effects were started.'
    );
  }
}
