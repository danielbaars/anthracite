import fs from 'fs';
import path from 'path';

import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { restoreIndex } from '../lib/git/index_state';
import { cacheLockConfigFactory } from '../lib/spiffy/cache_lock_spf';
import {
  getAbsorbRoot,
  readAbsorbGit,
  runAbsorbGit,
  withAbsorbIndex,
} from './absorb_git';
import { assertAbsorbInputSupported } from './absorb_input';
import { assertAbsorbApplicationAvailable } from './absorb_apply';
import { planAbsorb, AbsorbPlan, inspectAbsorbSource } from './absorb_plan';

export function prepareAbsorbStaging(
  context: TContext,
  patch: boolean
): {
  readonly plan: AbsorbPlan;
  readonly publish: () => void;
  readonly cleanup: () => void;
} {
  // Check source policy and conversions before a private add can invoke filters.
  inspectAbsorbSource(context);
  const root = getAbsorbRoot();
  const indexPath = path.resolve(
    root,
    readAbsorbGit(['rev-parse', '--git-path', 'index']).trim()
  );
  assertStagingLocksAvailable(indexPath);
  const checkSource = checkAbsorbSource();
  assertStagingSupported();
  const directory = fs.mkdtempSync(
    path.resolve(
      root,
      readAbsorbGit(['rev-parse', '--git-path', 'an-absorb-stage-']).trim()
    )
  );
  const index = path.join(directory, 'index');
  const cleanup = (): void => fs.rmSync(directory, { recursive: true });
  try {
    fs.copyFileSync(indexPath, index);
    // Keep the caller alive so Git SIGINT unwinds through private-index cleanup.
    const interrupted = (): void => undefined;
    if (patch) process.on('SIGINT', interrupted);
    try {
      runAbsorbGit(
        [
          '-c',
          'core.fsmonitor=false',
          ...(patch
            ? ['-c', 'interactive.diffFilter=', 'add', '--patch']
            : ['add', '--update', '--', '.']),
        ],
        {
          env: { ...process.env, GIT_INDEX_FILE: index },
          ...(patch ? { stdio: 'inherit' as const } : {}),
        }
      );
    } finally {
      if (patch) process.removeListener('SIGINT', interrupted);
    }
    const plan = withAbsorbIndex(index, () => {
      const selected = planAbsorb(context);
      assertAbsorbApplicationAvailable(selected, context);
      return selected;
    });
    return {
      plan,
      cleanup,
      publish: () => {
        checkSource();
        withAbsorbIndex(index, () => {
          planAbsorb(context);
          assertStagingSupported();
        });
        // Application already owns its cache lock; staging-only has no such lock.
        if (!plan.targets.length) assertStagingLocksAvailable(indexPath);
        restoreIndex(fs.readFileSync(index));
      },
    };
  } catch (error: unknown) {
    cleanup();
    throw error;
  }
}

function assertStagingLocksAvailable(indexPath: string): void {
  const lock = cacheLockConfigFactory.load(undefined, {
    preserveInvalid: true,
  });
  if (fs.existsSync(lock.path) || fs.existsSync(`${indexPath}.lock`))
    throw new PreconditionsFailedError(
      'Absorb requires existing cache/index locks to be released by their owners.'
    );
}

function assertStagingSupported(): void {
  assertAbsorbInputSupported([]);
  const paths = readAbsorbGit(['ls-files', '-z']);
  const attributes = readAbsorbGit(
    [
      'check-attr',
      '-z',
      '--stdin',
      'filter',
      'text',
      'eol',
      'working-tree-encoding',
      'ident',
    ],
    paths
  ).split('\0');
  for (let i = 2; i < attributes.length; i += 3)
    if (attributes[i] !== 'unspecified' && attributes[i] !== 'unset')
      throw new PreconditionsFailedError(
        'Absorb does not yet support working-tree conversions.'
      );
}

export function checkAbsorbSource(): () => void {
  const indexPath = path.resolve(
    getAbsorbRoot(),
    readAbsorbGit(['rev-parse', '--git-path', 'index']).trim()
  );
  const index = fs.readFileSync(indexPath);
  const snapshot = snapshotSource();
  return () => {
    if (
      !fs.readFileSync(indexPath).equals(index) ||
      snapshotSource() !== snapshot
    )
      throw new PreconditionsFailedError(
        'Absorb source changed during selection or confirmation. Inspect changes before retrying.'
      );
  };
}

function snapshotSource(): string {
  const root = getAbsorbRoot();
  const paths = [
    ...new Set(
      [
        ...readAbsorbGit(['ls-files', '-z']).split('\0'),
        ...readAbsorbGit(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split(
          '\0'
        ),
      ].filter(Boolean)
    ),
  ];
  return JSON.stringify({
    refs: readAbsorbGit(['for-each-ref', '--format=%(refname) %(objectname)']),
    head: readAbsorbGit(['symbolic-ref', 'HEAD']),
    files: paths.map((file) => {
      assertOrdinaryParents(root, file);
      const location = path.join(root, file);
      const stat = fs.lstatSync(location, { throwIfNoEntry: false });
      return !stat
        ? [file, 'absent']
        : stat.isSymbolicLink()
        ? [file, 'link', fs.readlinkSync(location)]
        : stat.isFile()
        ? [file, stat.mode, fs.readFileSync(location).toString('base64')]
        : [file, 'other', stat.mode];
    }),
  });
}

function assertOrdinaryParents(root: string, file: string): void {
  let parent = root;
  for (const part of file.split('/').slice(0, -1)) {
    parent = path.join(parent, part);
    const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink())
      throw new PreconditionsFailedError(
        `Absorb cannot follow a parent-directory symlink for ${file}.`
      );
    if (!stat.isDirectory())
      throw new PreconditionsFailedError(
        `Absorb requires ordinary parent directories for ${file}.`
      );
  }
}
