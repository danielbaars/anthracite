import fs from 'fs';
import path from 'path';
import { TContext } from '../../lib/context';
import { PreconditionsFailedError } from '../../lib/errors';
import { assertNoGitOperation } from '../../lib/git/assert_no_operation';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import { runGitCommand } from '../../lib/git/runner';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { performInTmpDir } from '../../lib/utils/perform_in_tmp_dir';
import { restackBranches } from '../restack';
import { createStackEditFile } from './stack_edit_file';

/** Reorder a frozen, aligned chain while preserving every original own range. */
export async function reorderStack(
  inputPath: string | undefined,
  context: TContext
): Promise<void> {
  assertNoGitOperation('reorder');
  uncommittedTrackedChangesPrecondition();
  const departure = context.engine.currentBranchPrecondition;
  const chain = getLinearChain(departure, context);
  for (const name of chain) {
    if (!context.engine.isBranchFixed(name))
      throw new PreconditionsFailedError(
        `Cannot reorder ${name}: needs restack. Run ch restack --branch '${name.replace(
          /'/g,
          "'\\''"
        )}' before retrying reorder --stack.`
      );
    if (context.engine.getPrInfo(name)?.number !== undefined)
      throw new PreconditionsFailedError(
        `Cannot reorder ${name}: it has a locally known PR association. PR-aware stack reorder is not supported.`
      );
  }
  const bases = new Map(
    chain.map((name) => [name, context.engine.getBaseRevision(name)])
  );
  const before = captureReorderState();
  if (!inputPath && !context.interactive)
    throw new PreconditionsFailedError(
      'Stack reorder requires an interactive editor or --input.'
    );
  const order = inputPath
    ? parseStackOrder(inputPath, chain)
    : await performInTmpDir((tmpDir) => {
        const file = createStackEditFile(
          { branchNames: [...chain], tmpDir },
          context
        );
        context.userConfig.execEditor(file);
        return parseStackOrder(file, chain);
      });
  // Read Git directly: rebuilding a stale engine can repair metadata itself.
  if (captureReorderState() !== before)
    throw new PreconditionsFailedError(
      'Cannot reorder: repository state changed while the editor was open. Retry from the current state.'
    );
  assertNoGitOperation('reorder');
  uncommittedTrackedChangesPrecondition();
  const changing: string[] = [];
  const checkoutRevisions: string[] = [];
  let parent = context.engine.trunk;
  const futureTips = new Map<string, string | undefined>([
    [parent, context.engine.getRevision(parent)],
  ]);
  for (const name of order) {
    const from = bases.get(name);
    const revision = context.engine.getRevision(name);
    const parentTip = futureTips.get(parent);
    const changesTip = parentTip === undefined || from !== parentTip;
    if (changesTip || context.engine.getParentPrecondition(name) !== parent) {
      changing.push(name);
      checkoutRevisions.push(
        `refs/heads/${name}`,
        `refs/heads/${parent}`,
        context.engine.getBaseRevision(name)
      );
    }
    futureTips.set(
      name,
      changesTip ? (revision === from ? parentTip : undefined) : revision
    );
    parent = name;
  }
  assertBranchesAvailableInWorktrees(changing);
  assertRestackFilesAvailable({
    branches: changing.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: changing.length
      ? [`refs/heads/${departure}`, ...checkoutRevisions]
      : [],
    skipTrackedPaths: true,
    operation: 'reorder',
  });
  if (order.every((name, index) => name === chain[index])) return;
  // Detach each new bottom before attaching its next child: no transient cycle.
  parent = context.engine.trunk;
  for (const name of order) {
    context.engine.setParent(name, parent);
    parent = name;
  }
  // The engine retains original own bases when only parent names change and
  // returns to its original current branch after every completed replay.
  restackBranches([...changing], context);
  if (context.engine.currentBranch !== departure)
    context.engine.checkoutBranch(departure, { preserveIgnored: true });
}

function getLinearChain(departure: string, context: TContext): string[] {
  const chain: string[] = [];
  let name = departure;
  while (!context.engine.isTrunk(name)) {
    if (chain.includes(name))
      throw new PreconditionsFailedError('Invalid reorder parent chain.');
    chain.unshift(name);
    const parent = context.engine.getParent(name);
    if (!parent || !context.engine.branchExists(parent))
      throw new PreconditionsFailedError(
        `Cannot reorder ${name}: invalid or untracked parent chain. Track a valid local chain before retrying.`
      );
    name = parent;
  }
  if (!chain.length)
    throw new PreconditionsFailedError('Cannot reorder trunk.');
  name = departure;
  while (name) {
    const children = context.engine.allBranchNames.filter(
      (child) => context.engine.getParent(child) === name
    );
    if (children.length > 1)
      throw new PreconditionsFailedError(
        'Stack reorder requires a unique tip; fan-out is not supported yet.'
      );
    const child = children[0];
    if (!child) break;
    if (chain.includes(child))
      throw new PreconditionsFailedError('Invalid reorder parent chain.');
    chain.push(child);
    name = child;
  }
  for (const branch of chain) {
    if (
      context.engine.allBranchNames.some(
        (child) =>
          context.engine.getParent(child) === branch && !chain.includes(child)
      )
    )
      throw new PreconditionsFailedError(
        'Stack reorder with other subtrees is not supported yet.'
      );
  }
  return chain;
}

function parseStackOrder(file: string, chain: readonly string[]): string[] {
  const names: string[] = [];
  for (const row of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const name = row.replace(/^[ \t]+|[ \t]+$/g, '');
    if (chain.includes(name)) names.push(name);
    else if (name && !name.startsWith('#'))
      throw new PreconditionsFailedError(
        `Invalid stack row: ${name}. Supply each offered branch exactly once; inline comments are not supported.`
      );
  }
  if (names.length !== chain.length || new Set(names).size !== chain.length)
    throw new PreconditionsFailedError(
      'Stack reorder requires each offered branch exactly once.'
    );
  return names.reverse();
}

function captureReorderState(): string {
  const git = (args: string[]): string =>
    runGitCommand({
      args,
      options: { noTrim: true },
      onError: 'throw',
      resource: 'reorderState',
    });
  const index = git(['rev-parse', '--git-path', 'index']).trim();
  return JSON.stringify([
    git(['rev-parse', 'HEAD']),
    git(['symbolic-ref', '-q', 'HEAD']),
    git(['for-each-ref', '--format=%(refname) %(objectname)']),
    fs.existsSync(index) ? fs.readFileSync(index).toString('base64') : '',
    git(['status', '--porcelain=v1', '-z', '--untracked-files=no']),
    git(['worktree', 'list', '--porcelain', '-z']),
    fs.readFileSync(
      path.join(
        git(['rev-parse', '--git-common-dir']).trim(),
        '.graphite_repo_config'
      ),
      'utf8'
    ),
  ]);
}
