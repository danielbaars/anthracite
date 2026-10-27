/* eslint-disable max-lines-per-function */
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import { z } from 'zod';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { McpCliClient } from '../lib/mcp_client';

const resultSchema = z.object({
  status: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  truncated: z.boolean(),
});

// These workflows use the public SDK/process seam and real Git state observers.
describe('MCP protected stack workflows through stdio', function () {
  this.timeout(180000);
  let fixtures: CwdCliFixture[];
  let remote: SubmitCliFixture | undefined;
  let connections: Set<McpCliClient>;
  beforeEach(() => {
    fixtures = [];
    connections = new Set();
    remote = undefined;
  });
  afterEach(async () => {
    await Promise.all([...connections].map((connection) => connection.close()));
    for (const fixture of fixtures) fixture.cleanup();
    remote?.cleanup();
  });

  function fixture(): CwdCliFixture {
    const created = new CwdCliFixture({
      ...process.env,
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    });
    fixtures.push(created);
    return created;
  }
  async function connect(cwd: string, env: NodeJS.ProcessEnv) {
    const connection = new McpCliClient(cwd, env);
    connections.add(connection);
    await connection.connect();
    return connection;
  }
  async function run(
    connection: McpCliClient,
    args: readonly string[],
    options: { readonly cwd: string; readonly exitCode?: number }
  ) {
    const { cwd, exitCode = 0 } = options;
    const response = await connection.client.callTool({
      name: 'run_an_cmd',
      arguments: { args, cwd, why: 'Verify the selected fixture workflow' },
    });
    const content = response.content;
    if (
      !Array.isArray(content) ||
      content.length !== 1 ||
      content[0]?.type !== 'text' ||
      typeof content[0].text !== 'string'
    )
      throw new Error('Expected one JSON text result');
    const parsed: unknown = JSON.parse(content[0].text);
    const result = resultSchema.parse(parsed);
    expect(result, result.stderr).to.include({
      status: exitCode === 0 ? 'success' : 'cli_error',
      exitCode,
      signal: null,
      truncated: false,
    });
    expect(response.isError).to.equal(exitCode !== 0);
    return result;
  }
  function record(scenario: number, state: unknown): void {
    const directory = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (!directory) return;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `workflow-${scenario}.json`),
      JSON.stringify(state, null, 2)
    );
  }
  function commitState(target: CwdCliFixture, branch: string) {
    return {
      commit: target.git(['rev-parse', branch]),
      parents: target.git(['show', '-s', '--format=%P', branch]),
      tree: target.git(['rev-parse', `${branch}^{tree}`]),
      message: target.git(['show', '-s', '--format=%B', branch]),
      files: target.git(['ls-tree', '-r', branch]),
    };
  }

  it('scenario 5: modifies and restacks a real chain like the direct CLI while preserving another stack', async () => {
    const target = fixture();
    const control = fixture();
    const other = commitState(target, 'other');
    const child = target.git(['rev-parse', 'child']);
    const message = target.git(['show', '-s', '--format=%B', 'base']);
    for (const current of [target, control]) {
      fs.writeFileSync(
        path.join(current.repo, 'change.txt'),
        'selected work\n'
      );
      current.git(['add', 'change.txt']);
    }
    const connection = await connect(target.root, target.env);
    const modified = await run(connection, ['modify', '--no-edit'], {
      cwd: target.repo,
    });
    control.ok(['modify', '--no-edit']);
    expect(target.git(['show', 'base:change.txt'])).to.equal('selected work');
    expect(target.git(['show', '-s', '--format=%B', 'base'])).to.equal(message);
    expect(target.git(['rev-parse', 'child'])).not.to.equal(child);
    for (const current of [target, control]) {
      current.git(['switch', 'main']);
      current.commit('trunk-new');
      current.git(['switch', 'base']);
    }
    const beforeRestack = target.git(['rev-parse', 'base']);
    const restacked = await run(
      connection,
      ['restack', '--branch', 'base', '--upstack'],
      { cwd: target.repo }
    );
    control.ok(['restack', '--branch', 'base', '--upstack']);
    expect(target.git(['rev-parse', 'base'])).not.to.equal(beforeRestack);
    const actual = ['base', 'child', 'tip'].map((name) =>
      commitState(target, name)
    );
    expect(actual).to.deep.equal(
      ['base', 'child', 'tip'].map((name) => commitState(control, name))
    );
    for (const [branch, parent] of [
      ['base', 'main'],
      ['child', 'base'],
      ['tip', 'child'],
    ]) {
      expect(target.git(['rev-parse', `${branch}^`])).to.equal(
        target.git(['rev-parse', parent])
      );
      expect(target.ok(['info', branch])).to.include(`Parent: ${parent}`);
    }
    expect(commitState(target, 'other')).to.deep.equal(other);
    expect(target.ok(['info', 'other'])).to.include('Parent: main');
    expect(target.git(['show', 'tip:trunk-new.txt'])).to.equal('trunk-new');
    expect(target.git(['show', 'tip:change.txt'])).to.equal('selected work');
    expect(target.git(['status', '--porcelain'])).to.equal('');
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
    record(5, { modified, restacked, actual, other });
  });

  function dirtyLinked(target: CwdCliFixture, branch: string): string {
    const linked = path.join(target.root, 'linked');
    target.git(['worktree', 'add', linked, branch]);
    fs.writeFileSync(path.join(linked, `${branch}.txt`), 'linked staged');
    target.git(['add', `${branch}.txt`], linked);
    fs.appendFileSync(path.join(linked, `${branch}.txt`), '\nlinked unstaged');
    fs.writeFileSync(path.join(linked, 'untracked.bin'), Buffer.from([0, 255]));
    fs.symlinkSync('untracked.bin', path.join(linked, 'untracked-link'));
    target.git(['status', '--porcelain'], linked);
    return linked;
  }

  it('scenario 9: refuses frozen writes and occupied branches without changing tracking or either dirty index', async () => {
    const frozen = fixture();
    frozen.ok(['freeze', 'child']);
    frozen.git(['switch', 'child']);
    fs.writeFileSync(path.join(frozen.repo, 'child.txt'), 'staged frozen work');
    frozen.git(['add', 'child.txt']);
    fs.appendFileSync(
      path.join(frozen.repo, 'child.txt'),
      '\nunstaged frozen work'
    );
    frozen.git(['status', '--porcelain']);
    const linked = dirtyLinked(frozen, 'other');
    expect(frozen.ok(['info', 'child'])).to.include('child (frozen)');
    expect(frozen.ok(['info', 'base'])).to.include('base (frozen)');
    const before = {
      main: frozen.inspectionSnapshot(),
      linked: frozen.inspectionSnapshot(linked),
    };
    const connection = await connect(frozen.root, frozen.env);
    const refused = await run(
      connection,
      ['modify', '--commit', '--all', '-m', 'blocked'],
      { cwd: frozen.repo, exitCode: 1 }
    );
    expect(refused.stderr).to.include('an unfreeze child');
    expect({
      main: frozen.inspectionSnapshot(),
      linked: frozen.inspectionSnapshot(linked),
    }).to.deep.equal(before);
    expect(
      (await run(connection, ['parent'], { cwd: frozen.repo })).stdout
    ).to.equal('base\n');

    const occupied = fixture();
    const busy = dirtyLinked(occupied, 'tip');
    const input = occupied.input('base\ntip\nchild\n');
    const occupiedBefore = {
      main: occupied.inspectionSnapshot(),
      linked: occupied.inspectionSnapshot(busy),
    };
    const otherConnection = await connect(occupied.root, occupied.env);
    const busyRefused = await run(
      otherConnection,
      ['reorder', '--stack', '--input', input, '--quiet'],
      { cwd: occupied.repo, exitCode: 1 }
    );
    expect(busyRefused.stdout).to.equal('');
    expect(busyRefused.stderr).to.include('tip').and.include('worktree');
    expect({
      main: occupied.inspectionSnapshot(),
      linked: occupied.inspectionSnapshot(busy),
    }).to.deep.equal(occupiedBefore);
    expect(
      (await run(otherConnection, ['parent'], { cwd: occupied.repo })).stdout
    ).to.equal('main\n');
    for (const current of [connection, otherConnection]) {
      expect(current.errors).to.deep.equal([]);
      expect(current.stderr).to.equal('');
    }
    record(9, { refused, before, busyRefused, occupiedBefore });
  });

  function resolve(target: CwdCliFixture, contents: string): void {
    fs.writeFileSync(path.join(target.repo, 'main.txt'), contents);
    target.git(['add', 'main.txt']);
  }
  function prepareConflict(target: CwdCliFixture): string {
    target.env.GIT_EDITOR = 'true';
    target.branch('conflict-base', 'main', true);
    resolve(target, 'target base version');
    target.git(['commit', '-m', 'base own']);
    target.branch('conflict-child', 'conflict-base', true);
    resolve(target, 'target child version');
    target.git(['commit', '-m', 'child own']);
    target.git(['switch', 'conflict-base']);
    return target.input('conflict-base\nconflict-child\n');
  }
  function expectConflict(target: CwdCliFixture, branch: string): void {
    expect(target.git(['branch', '--show-current'])).to.equal('');
    expect(target.git(['ls-files', '--unmerged'])).not.to.equal('');
    const headName = path.resolve(
      target.repo,
      target.git(['rev-parse', '--git-path', 'rebase-merge/head-name'])
    );
    expect(fs.readFileSync(headName, 'utf8')).to.equal(
      `refs/heads/${branch}\n`
    );
  }
  function recoveredState(target: CwdCliFixture) {
    return {
      branch: target.git(['branch', '--show-current']),
      commits: ['conflict-child', 'conflict-base'].map((name) =>
        commitState(target, name)
      ),
      subjects: target.git([
        'log',
        '--reverse',
        '--format=%s',
        'main..conflict-base',
      ]),
      contents: ['conflict-child', 'conflict-base'].map((name) =>
        target.git(['show', `${name}:main.txt`])
      ),
      parent: target.ok(['parent']),
      merges: target.git(['rev-list', '--merges', 'main..conflict-base']),
      status: target.git(['status', '--porcelain']),
      operation: target.inspectionSnapshot().operation,
      continuation: fs.readFileSync(
        path.join(target.repo, '.git', '.gtcontinue'),
        'utf8'
      ),
    };
  }

  it('scenario 10: retains a completed conflict across idle shutdown and recovers through a fresh MCP session like direct CLI recovery', async () => {
    const target = fixture();
    const control = fixture();
    const input = prepareConflict(target);
    const controlInput = prepareConflict(control);
    const originalTrees = ['conflict-child', 'conflict-base'].map((name) =>
      target.git(['rev-parse', `${name}^{tree}`])
    );
    const linked = dirtyLinked(target, 'other');
    const linkedBefore = target.inspectionSnapshot(linked);
    const connection = await connect(target.root, target.env);
    const first = await run(
      connection,
      ['reorder', '--stack', '--input', input],
      { cwd: target.repo, exitCode: 1 }
    );
    expect(first.stdout + first.stderr)
      .to.include('conflict')
      .and.include('an continue');
    expectConflict(target, 'conflict-child');
    const partial = target.inspectionSnapshot();
    const unresolved = await run(connection, ['continue'], {
      cwd: target.repo,
      exitCode: 1,
    });
    expect(unresolved.stderr).to.include('Stage the conflict resolution');
    expect(target.inspectionSnapshot()).to.deep.equal(partial);
    await connection.close();
    connections.delete(connection);
    expect(target.inspectionSnapshot()).to.deep.equal(partial);

    resolve(target, 'target child version');
    const fresh = await connect(target.root, target.env);
    const second = await run(fresh, ['continue'], {
      cwd: target.repo,
      exitCode: 1,
    });
    expect(second.stdout + second.stderr)
      .to.include('conflict')
      .and.include('an continue');
    expectConflict(target, 'conflict-base');
    resolve(target, 'target base version');
    const finished = await run(fresh, ['continue'], { cwd: target.repo });

    const directFirst = control.run([
      'reorder',
      '--stack',
      '--input',
      controlInput,
      '--no-interactive',
    ]);
    expect(directFirst.status, directFirst.stderr).to.equal(first.exitCode);
    expectConflict(control, 'conflict-child');
    expect(control.run(['continue', '--no-interactive']).status).to.equal(
      unresolved.exitCode
    );
    resolve(control, 'target child version');
    expect(control.run(['continue', '--no-interactive']).status).to.equal(
      second.exitCode
    );
    expectConflict(control, 'conflict-base');
    resolve(control, 'target base version');
    control.ok(['continue']);
    const actual = recoveredState(target);
    expect(actual).to.deep.equal(recoveredState(control));
    expect(actual).to.include({
      branch: 'conflict-base',
      parent: 'conflict-child\n',
      subjects: 'child own\nbase own',
      merges: '',
      status: '',
    });
    expect(actual.commits.map((commit) => commit.tree)).to.deep.equal(
      originalTrees
    );
    expect(actual.contents).to.deep.equal([
      'target child version',
      'target base version',
    ]);
    expect(actual.operation).to.deep.equal({
      'rebase-merge': null,
      'rebase-apply': null,
    });
    expect(target.ok(['info', 'conflict-child'])).to.include('Parent: main');
    const linkedAfter = target.inspectionSnapshot(linked);
    // Successful recovery advances shared refs/tracking but not the linked checkout.
    expect({ ...linkedAfter, refs: '', persistent: null }).to.deep.equal({
      ...linkedBefore,
      refs: '',
      persistent: null,
    });
    for (const current of [connection, fresh]) {
      expect(current.errors).to.deep.equal([]);
      expect(current.stderr).to.equal('');
    }
    record(10, {
      first,
      unresolved,
      partial,
      second,
      finished,
      actual,
      linkedBefore,
      linkedAfter,
    });
  });

  it('scenario 11: explicitly submits the selected stack to a local bare remote while preserving approved metadata and unrelated work', async () => {
    const target = new SubmitCliFixture();
    remote = target;
    target.branch('parent', 'main');
    target.branch('target', 'parent');
    target.succeed('submit');
    target.setPrs(
      target.prs().map((pr) =>
        pr.headRefName === 'target'
          ? {
              ...pr,
              title: 'Approved target title',
              body: `Approved target core\n${pr.body}`,
              reviewRequests: [{ login: 'existing-reviewer' }],
            }
          : pr
      )
    );
    const updatedTarget = target.commit('target-update');
    target.branch('target-child', 'target');
    target.branch('unrelated', 'main');
    target.succeed('submit');
    const unrelatedRemote = target.remoteSha('unrelated');
    const unrelatedPr = target
      .prs()
      .find((pr) => pr.headRefName === 'unrelated');
    expect(unrelatedPr).not.to.equal(undefined);
    fs.appendFileSync(
      path.join(target.repo, 'unrelated.txt'),
      '\nunstaged work'
    );
    fs.writeFileSync(path.join(target.repo, 'staged.txt'), 'staged work');
    target.git('add', 'staged.txt');
    fs.writeFileSync(
      path.join(target.repo, 'untracked.bin'),
      Buffer.from([0, 255])
    );
    const work = () => ({
      branch: target.git('branch', '--show-current'),
      head: target.git('rev-parse', 'HEAD'),
      status: target.git('status', '--porcelain'),
      index: target.git('write-tree'),
      diff: target.git('diff', '--binary'),
      untracked: fs
        .readFileSync(path.join(target.repo, 'untracked.bin'))
        .toString('base64'),
    });
    const before = work();
    const remoteBefore = target.git('ls-remote', '--heads', 'origin');
    const prsBefore = target.prs();
    const hook = path.join(target.root, 'hook-output');
    target.env.ANTHRACITE_TEST_WORKFLOW_HOOK = hook;
    target.env.ANTHRACITE_TEST_WORKFLOW_VALUE = 'inherited fixture environment';
    fs.writeFileSync(
      path.join(target.repo, '.git', 'hooks', 'pre-push'),
      `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.ANTHRACITE_TEST_WORKFLOW_HOOK, process.env.ANTHRACITE_TEST_WORKFLOW_VALUE + '\\n');`,
      { mode: 0o755 }
    );
    target.clearCalls();
    const connection = await connect(target.root, target.env);
    await connection.client.listTools();
    await connection.client.callTool({ name: 'learn_an' });
    expect(target.git('ls-remote', '--heads', 'origin')).to.equal(remoteBefore);
    expect(target.prs()).to.deep.equal(prsBefore);
    expect(target.calls()).to.deep.equal([]);
    expect(fs.existsSync(hook)).to.equal(false);
    const submitted = await run(
      connection,
      ['submit', '--branch', 'target', '--stack'],
      { cwd: target.repo }
    );
    expect(submitted.stdout)
      .to.include('target (Update)')
      .and.include('target-child (Create)');
    expect(target.remoteSha('target')).to.equal(updatedTarget);
    for (const name of ['parent', 'target', 'target-child'])
      expect(target.remoteSha(name)).to.equal(target.git('rev-parse', name));
    expect(target.remoteSha('unrelated')).to.equal(unrelatedRemote);
    expect(work()).to.deep.equal(before);
    const prs = target.prs();
    expect(prs.find((pr) => pr.headRefName === 'unrelated')).to.deep.equal(
      unrelatedPr
    );
    expect(
      prs
        .filter((pr) => pr.headRefName !== 'unrelated')
        .map((pr) => [pr.headRefName, pr.baseRefName, pr.isDraft])
    ).to.deep.equal([
      ['parent', 'main', true],
      ['target', 'parent', true],
      ['target-child', 'target', true],
    ]);
    const approved = prs.find((pr) => pr.headRefName === 'target');
    expect(approved?.title).to.equal('Approved target title');
    expect(approved?.body).to.include('Approved target core');
    expect(approved?.reviewRequests).to.deep.equal([
      { login: 'existing-reviewer' },
    ]);
    for (const pr of prs.filter((pr) => pr.headRefName !== 'unrelated'))
      expect(pr.body.match(/#### PR Dependency Tree/g)).to.have.length(1);
    expect(
      target
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
        .every(
          (args) =>
            args[2] !== 'unrelated' && args[2] !== String(unrelatedPr?.number)
        )
    ).to.equal(true);
    const hookOutput = fs.readFileSync(hook, 'utf8').trim().split('\n');
    expect(hookOutput).not.to.have.length(0);
    expect(
      hookOutput.every((line) => line === 'inherited fixture environment')
    ).to.equal(true);
    expect(target.env.GH_TOKEN).to.equal(undefined);
    expect(target.env.GITHUB_TOKEN).to.equal(undefined);
    expect(connection.errors).to.deep.equal([]);
    expect(connection.stderr).to.equal('');
    record(11, {
      submitted,
      remoteBefore,
      remoteAfter: target.git('ls-remote', '--heads', 'origin'),
      prs,
      before,
      hookOutput,
      ghCalls: target.calls(),
    });
  });
});
