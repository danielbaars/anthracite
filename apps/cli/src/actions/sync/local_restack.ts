import { execFileSync } from 'child_process';
import fs from 'fs';
import { devNull } from 'os';
import { TextDecoder } from 'util';
import { RemoteUpdateNode } from './remote_update_graph';

const MAX_COMMITS = 128;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_MS = 3000;
const OID = '(?:[a-f0-9]{40}|[a-f0-9]{64})';

type OwnCommit = {
  readonly oid: string;
  readonly parent: string;
  readonly author: string;
  readonly message: Buffer;
};
type ReadGit = (args: readonly string[]) => Buffer;

/** Virtual replacement/graft ancestry cannot authorize retaining local work. */
export function hasCanonicalAncestry(ancestor: string, head: string): boolean {
  if (![ancestor, head].every((oid) => new RegExp(`^${OID}$`).test(oid)))
    return false;
  const read = boundedGitReader();
  try {
    if (!hasCanonicalGraph(read)) return false;
    read(['merge-base', '--is-ancestor', ancestor, head]);
    return true;
  } catch {
    return false;
  }
}

/** Unknown or unsupported evidence must retain ordinary reconciliation. */
export function hasEquivalentLocalRestack(
  node: RemoteUpdateNode,
  verifiedParent?: RemoteUpdateNode,
  debug?: (detail: string) => void
): boolean {
  const refuse = (detail: string): false => {
    debug?.(detail);
    return false;
  };
  if (
    node.previousParentBranchName !== node.parentBranchName ||
    !node.previousBase ||
    node.previousBase === node.base ||
    node.previousHead === node.head
  )
    return refuse('parent bases or current heads do not describe a restack');
  if (
    ![node.base, node.previousBase, node.head, node.previousHead].every((oid) =>
      new RegExp(`^${OID}$`).test(oid)
    )
  )
    return refuse('unsupported object identity');
  const read = boundedGitReader();
  try {
    if (!hasCanonicalGraph(read))
      return refuse('replacement or graft ancestry is unsupported');
    if (verifiedParent) {
      if (
        node.parentBranchName !== verifiedParent.branchName ||
        node.base !== verifiedParent.head ||
        node.previousBase !== verifiedParent.previousHead
      )
        return refuse(
          'captured parent-head pairing does not match child bases'
        );
    } else {
      try {
        read(['merge-base', '--is-ancestor', node.base, node.previousBase]);
      } catch {
        return refuse('newer root-base ancestry is unproven or unavailable');
      }
    }
    const remote = ownCommits(node.base, node.head, read);
    const local = ownCommits(node.previousBase, node.previousHead, read);
    if (!remote || !local)
      return refuse('unsupported or over-limit linear own-commit sequence');
    if (remote.length !== local.length)
      return refuse('own-commit counts differ');
    for (const [index, commit] of remote.entries()) {
      const other = local[index];
      if (!other) return refuse('own-commit counts differ');
      if (commit.author !== other.author)
        return refuse('author identity or author time differs');
      if (!commit.message.equals(other.message))
        return refuse('complete commit message bytes differ');
      if (!commitPatch(commit, read).equals(commitPatch(other, read)))
        return refuse('per-commit change bytes differ');
    }
    debug?.(`matched ${remote.length} ordered own commit(s)`);
    return true;
  } catch {
    // Read failure, limits and unsupported encodings establish no equivalence.
    return refuse('bounded Git read failed or commit encoding is unsupported');
  }
}

function boundedGitReader(): ReadGit {
  const deadline = Date.now() + MAX_DURATION_MS;
  let bytes = 0;
  return (args) => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error('Local restack proof time limit.');
    const result = execFileSync('git', ['--no-replace-objects', ...args], {
      timeout,
      maxBuffer: MAX_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_GRAFT_FILE: devNull,
      },
    });
    bytes += result.length;
    if (bytes > MAX_BYTES) throw new Error('Local restack proof byte limit.');
    return result;
  };
}

function hasCanonicalGraph(read: ReadGit): boolean {
  if (read(['for-each-ref', '--format=%(refname)', 'refs/replace']).length)
    return false;
  if (process.env.GIT_GRAFT_FILE || process.env.GIT_REPLACE_REF_BASE)
    return false;
  const grafts = read(['rev-parse', '--git-path', 'info/grafts'])
    .toString('utf8')
    .trim();
  return !fs.existsSync(grafts) || fs.statSync(grafts).size === 0;
}

function ownCommits(
  base: string,
  head: string,
  read: ReadGit
): readonly OwnCommit[] | undefined {
  const output = read([
    'rev-list',
    '--reverse',
    `--max-count=${MAX_COMMITS + 1}`,
    `${base}..${head}`,
  ])
    .toString('ascii')
    .trim();
  const ids = output ? output.split('\n') : [];
  if (!ids.length || ids.length > MAX_COMMITS) return undefined;
  let parent = base;
  const commits: OwnCommit[] = [];
  for (const oid of ids) {
    if (!new RegExp(`^${OID}$`).test(oid)) return undefined;
    const commit = readCommit(oid, read);
    if (!commit || commit.parent !== parent) return undefined;
    commits.push(commit);
    parent = oid;
  }
  return parent === head ? commits : undefined;
}

function readCommit(oid: string, read: ReadGit): OwnCommit | undefined {
  const bytes = read(['cat-file', 'commit', oid]);
  // Validate without replacing invalid UTF-8, then retain the message bytes.
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const separator = bytes.indexOf('\n\n');
  if (separator < 0) return undefined;
  const headers = bytes.subarray(0, separator).toString('utf8').split('\n');
  const [tree, parent, author, committer] = headers;
  if (
    headers.length !== 4 ||
    !new RegExp(`^tree ${OID}$`).test(tree ?? '') ||
    !new RegExp(`^parent ${OID}$`).test(parent ?? '') ||
    !/^author .+ <[^<>]*> -?\d+ [+-]\d{4}$/.test(author ?? '') ||
    !/^committer .+ <[^<>]*> -?\d+ [+-]\d{4}$/.test(committer ?? '') ||
    !parent ||
    !author
  )
    return undefined;
  return {
    oid,
    parent: parent.slice('parent '.length),
    author,
    message: bytes.subarray(separator + 2),
  };
}

function commitPatch(commit: OwnCommit, read: ReadGit): Buffer {
  return read([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--no-color',
    '--no-relative',
    '--ignore-submodules=none',
    '--submodule=short',
    '--binary',
    '--full-index',
    commit.parent,
    commit.oid,
  ]);
}
