import fs from 'fs';
import path from 'path';
import { TContext } from '../../lib/context';
import { PreconditionsFailedError } from '../../lib/errors';
import {
  getMetadataRefList,
  readMetadataRef,
} from '../../lib/engine/metadata_ref';
import { assertNoGitOperation } from '../../lib/git/assert_no_operation';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import { runGitCommand } from '../../lib/git/runner';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import {
  ensureEditorAllowedPrecondition,
  uncommittedTrackedChangesPrecondition,
} from '../../lib/preconditions';
import { performInTmpDir } from '../../lib/utils/perform_in_tmp_dir';
import { restackBranches } from '../restack';
import { clearContinuation } from '../persist_continuation';
import { beginReorder, finishReorder } from '../reorder_recovery';
import { interactiveBranchSelection } from '../log';
import { createStackEditFile } from './stack_edit_file';

/** Reorder a frozen, aligned chain while preserving every original own range. */
export async function reorderStack(
  inputPath: string | undefined,
  context: TContext
): Promise<void> {
  context.engine.assertBranchEditable(context.engine.currentBranchPrecondition);
  if (!inputPath) ensureEditorAllowedPrecondition(context);
  assertNoGitOperation('reorder');
  uncommittedTrackedChangesPrecondition();
  const departure = context.engine.currentBranchPrecondition;
  const before = captureReorderState();
  // Include saved nodes whose local ref is missing; the engine omits those.
  const savedParents = new Map(
    Object.keys(getMetadataRefList()).map((name) => [
      name,
      readMetadataRef(name).parentBranchName,
    ])
  );
  const selection = { savedParents, before };
  const chain = await selectTipChain(departure, selection, context);
  for (const name of chain) {
    assertAlignedBranch(name, context);
    assertNoPrAssociation(name, context);
  }
  const others = getOtherBranches(chain, savedParents, context);
  const original = new Map(
    [...chain, ...others].map((name) => [
      name,
      {
        from: context.engine.getBaseRevision(name),
        parent: context.engine.getParentPrecondition(name),
        revision: context.engine.getRevision(name),
      },
    ])
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
  const parents = new Map<string, string>();
  for (const name of order) {
    parents.set(name, parent);
    parent = name;
  }
  for (const [name, branch] of original)
    if (!parents.has(name)) parents.set(name, branch.parent);
  const unchanged = order.every((name, index) => name === chain[index]);
  for (const name of unchanged ? [] : [...order, ...others]) {
    const parent = parents.get(name);
    if (!parent) throw new PreconditionsFailedError('Invalid reorder plan.');
    const branch = original.get(name);
    if (!branch) throw new PreconditionsFailedError('Invalid reorder plan.');
    const { from, revision } = branch;
    const parentTip = futureTips.get(parent);
    const changesTip = parentTip === undefined || from !== parentTip;
    if (changesTip || branch.parent !== parent) {
      changing.push(name);
      checkoutRevisions.push(
        `refs/heads/${name}`,
        `refs/heads/${parent}`,
        from
      );
    }
    futureTips.set(
      name,
      changesTip ? (revision === from ? parentTip : undefined) : revision
    );
  }
  for (const name of [departure, ...changing])
    context.engine.assertBranchEditable(name);
  for (const name of changing) assertNoPrAssociation(name, context);
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
  if (unchanged) return;
  beginReorder(
    { returnBranch: departure, order, parents, original, pending: changing },
    context
  );
  // Existing restack retains original own bases and returns to C after replay.
  restackBranches([...changing], context);
  finishReorder(context);
  clearContinuation(context);
}

function assertAlignedBranch(name: string, context: TContext): void {
  if (!context.engine.isBranchFixed(name))
    throw new PreconditionsFailedError(
      `Cannot reorder ${name}: needs restack. Run ch restack --branch '${name.replace(
        /'/g,
        "'\\''"
      )}' before retrying reorder --stack.`
    );
}

function assertNoPrAssociation(name: string, context: TContext): void {
  if (context.engine.getPrInfo(name)?.number !== undefined)
    throw new PreconditionsFailedError(
      `Cannot reorder ${name}: it has a locally known PR association. PR-aware stack reorder is not supported.`
    );
}

function getOtherBranches(
  chain: readonly string[],
  savedParents: ReadonlyMap<string, string | undefined>,
  context: TContext
): string[] {
  const others: string[] = [];
  const collectChildren = (parent: string): void => {
    for (const [child, savedParent] of savedParents) {
      if (savedParent !== parent) continue;
      if (!context.engine.branchExists(child))
        throw new PreconditionsFailedError(
          `Cannot reorder ${child}: missing local tracked branch.`
        );
      if (chain.includes(child)) continue;
      if (others.includes(child))
        throw new PreconditionsFailedError('Invalid reorder parent chain.');
      others.push(child);
      collectChildren(child);
    }
  };
  chain.forEach(collectChildren);
  return others;
}

async function selectTipChain(
  departure: string,
  {
    savedParents,
    before,
  }: {
    readonly savedParents: ReadonlyMap<string, string | undefined>;
    readonly before: string;
  },
  context: TContext
): Promise<string[]> {
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
  const tips: string[] = [];
  const visited = new Set<string>();
  const findTips = (name: string): void => {
    if (visited.has(name))
      throw new PreconditionsFailedError('Invalid reorder parent chain.');
    visited.add(name);
    if (!context.engine.branchExists(name))
      throw new PreconditionsFailedError(
        `Cannot reorder ${name}: missing local tracked branch.`
      );
    if (!context.engine.isBranchTracked(name))
      assertAlignedBranch(name, context);
    context.engine.getBaseRevision(name);
    const children = [...savedParents]
      .filter(([, parent]) => parent === name)
      .map(([child]) => child);
    if (!children.length) tips.push(name);
    else children.forEach(findTips);
  };
  findTips(departure);
  if (tips.length > 1 && !context.interactive)
    throw new PreconditionsFailedError(
      'Stack reorder requires a unique tip in non-interactive mode.'
    );
  const tip =
    tips.length === 1
      ? tips[0]
      : await interactiveBranchSelection(
          {
            message: `Choose a tip above ${departure} to reorder (autocomplete or arrow keys)`,
            allowedBranches: tips,
          },
          context
        );
  if (!tips.includes(tip))
    throw new PreconditionsFailedError('Invalid reorder tip selection.');
  // The selector can wait while another process changes refs or local work.
  if (captureReorderState() !== before)
    throw new PreconditionsFailedError(
      'Cannot reorder: repository state changed during tip selection. Retry from the current state.'
    );
  assertNoGitOperation('reorder');
  uncommittedTrackedChangesPrecondition();
  const upstack: string[] = [];
  name = tip;
  while (name !== departure) {
    upstack.unshift(name);
    name = context.engine.getParentPrecondition(name);
  }
  return [...chain, ...upstack];
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
    git([
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=no',
    ]),
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
