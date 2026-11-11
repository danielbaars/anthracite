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
export function hasEquivalentLocalRestack(node: RemoteUpdateNode): boolean {
  if (
    node.previousParentBranchName !== node.parentBranchName ||
    !node.previousBase ||
    node.previousBase === node.base ||
    node.previousHead === node.head
  )
    return false;
  if (
    ![node.base, node.previousBase, node.head, node.previousHead].every((oid) =>
      new RegExp(`^${OID}$`).test(oid)
    )
  )
    return false;
  const read = boundedGitReader();
  try {
    if (!hasCanonicalGraph(read)) return false;
    read(['merge-base', '--is-ancestor', node.base, node.previousBase]);
    const remote = ownCommits(node.base, node.head, read);
    const local = ownCommits(node.previousBase, node.previousHead, read);
    if (!remote || !local || remote.length !== local.length) return false;
    return remote.every((commit, index) => {
      const other = local[index];
      return (
        other !== undefined &&
        commit.author === other.author &&
        commit.message.equals(other.message) &&
        commitPatch(commit, read).equals(commitPatch(other, read))
      );
    });
  } catch {
    // Read failure, limits and unsupported encodings establish no equivalence.
    return false;
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
