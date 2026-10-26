import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runCliInPty } from '../utils/run_cli_in_pty';
import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';

type CliResult = {
  status: number | null;
  output: string;
  stdout?: string;
  stderr?: string;
};

export class FrozenGetFixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'charcoal-get-'));
  readonly producer = path.join(this.root, 'producer');
  readonly consumer = path.join(this.root, 'consumer');
  readonly remote = path.join(this.root, 'remote.git');
  readonly bin = path.join(this.root, 'bin');
  readonly env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: this.root,
    GRAPHITE_USER_CONFIG_PATH: path.join(this.root, 'user.json'),
    GRAPHITE_INTERACTIVE: '',
    GH_CONFIG_DIR: path.join(this.root, 'gh-home'),
    GIT_EDITOR: 'true',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Get Test',
    GIT_AUTHOR_EMAIL: 'get@example.test',
    GIT_COMMITTER_NAME: 'Get Test',
    GIT_COMMITTER_EMAIL: 'get@example.test',
    GIT_AUTHOR_DATE: '2026-10-21T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-21T12:00:00Z',
    PATH: `${this.bin}${path.delimiter}${process.env.PATH}`,
  };
  readonly prs = path.join(this.root, 'prs.json');
  readonly ghCalls = path.join(this.root, 'gh-calls.jsonl');
  cwd = this.consumer;
  readonly details = path.join(this.root, 'pr-details.json');
  readonly oldParent: string;
  readonly oldChild: string;

  constructor() {
    delete this.env.GH_TOKEN;
    delete this.env.GITHUB_TOKEN;
    fs.ensureDirSync(this.bin);
    fs.writeJsonSync(this.prs, { parent: 'main', child: 'parent' });
    fs.writeJsonSync(this.details, {});
    fs.writeFileSync(this.ghCalls, '');
    fs.writeFileSync(
      path.join(this.bin, 'gh'),
      `#!${process.execPath}\nconst args = process.argv.slice(2);
require('fs').appendFileSync(${JSON.stringify(
        this.ghCalls
      )}, JSON.stringify(args) + '\\n');
if (args[0] !== 'pr' || args[1] !== 'view' || args[4] !== 'get-fixture/repo' || args[5] !== '--json') process.exit(2);
const head = args[2] === '2' ? 'child' : args[2] === '1' ? 'parent' : args[2];
const base = require('fs').readFileSync(${JSON.stringify(this.prs)}, 'utf8');
const parents = JSON.parse(base);
const parent = parents[head];
if (!parent) { console.error('no pull requests found'); process.exit(3); }
const details = JSON.parse(require('fs').readFileSync(${JSON.stringify(
        this.details
      )}, 'utf8'));
const response = { headRefName: head, baseRefName: parent, number: head === 'parent' ? 1 : 2, state: 'OPEN', url: 'https://github.com/get-fixture/repo/pull/' + (head === 'parent' ? 1 : 2), title: details[head] || head + ' original PR', body: 'Existing PR body', isDraft: false, reviewDecision: 'REVIEW_REQUIRED' };
const selected = {};
for (const field of args[6].split(',')) { if (!(field in response)) process.exit(2); selected[field] = response[field]; }
console.log(JSON.stringify(selected));\n`,
      { mode: 0o755 }
    );
    fs.writeJsonSync(path.join(this.root, 'user.json'), {});
    fs.ensureDirSync(this.producer);
    this.git(this.producer, 'init', '-b', 'main');
    this.commit(this.producer, 'main.txt', 'main');
    this.git(this.root, 'init', '--bare', this.remote);
    this.git(this.producer, 'remote', 'add', 'origin', this.remote);
    this.git(this.producer, 'switch', '-c', 'parent');
    this.oldParent = this.commit(this.producer, 'parent.txt', 'parent-old');
    this.git(this.producer, 'switch', '-c', 'child');
    this.oldChild = this.commit(this.producer, 'child.txt', 'child-old');
    this.git(this.producer, 'push', 'origin', 'main', 'parent', 'child');
    this.freshConsumer();
    this.ok('get', 'child');
  }

  freshConsumer(): void {
    fs.removeSync(this.consumer);
    this.git(
      this.root,
      'clone',
      '--branch',
      'main',
      this.remote,
      this.consumer
    );
    this.ok('init', '--trunk', 'main');
    this.ok('repo', 'owner', '--set', 'get-fixture');
    this.ok('repo', 'name', '--set', 'repo');
  }

  git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  commit(cwd: string, file: string, contents: string): string {
    fs.writeFileSync(path.join(cwd, file), contents);
    this.git(cwd, 'add', file);
    this.git(cwd, 'commit', '-m', contents);
    return this.git(cwd, 'rev-parse', 'HEAD');
  }

  observe(cwd = this.consumer): unknown {
    const git = (...args: string[]): string =>
      execFileSync('git', args, {
        cwd,
        env: { ...this.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    const files: Record<string, string> = {};
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile())
          files[path.relative(cwd, file)] = fs
            .readFileSync(file)
            .toString('base64');
      }
    };
    visit(cwd);
    const index = path.resolve(cwd, git('rev-parse', '--git-path', 'index'));
    const rebase = path.resolve(
      cwd,
      git('rev-parse', '--git-path', 'rebase-merge')
    );
    const recovery = path.resolve(
      cwd,
      git('rev-parse', '--git-path', '.gtcontinue')
    );
    return {
      head: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      refs: git(
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
        'refs/branch-metadata'
      ),
      commits: git('log', '--branches', '--format=%H %P %T'),
      status: git('status', '--porcelain=v1'),
      stages: git('ls-files', '--stage'),
      index: fs.existsSync(index)
        ? fs.readFileSync(index).toString('base64')
        : null,
      recovery: fs.existsSync(recovery)
        ? fs.readFileSync(recovery).toString('base64')
        : null,
      rebase: fs.existsSync(rebase),
      files,
    };
  }

  run(
    args: string[],
    interactive = false,
    responses: Parameters<typeof runCliInPty>[1]['responses'] = []
  ): CliResult {
    const cwd = this.cwd;
    const command = getTestCliCommand([
      ...args,
      ...(interactive || args.includes('--get-yargs-completions')
        ? []
        : ['--no-interactive']),
    ]);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    const before = evidence ? this.observe() : undefined;
    if (interactive) {
      const result = runCliInPty(command, { cwd, env: this.env, responses });
      if (evidence)
        fs.appendFileSync(
          path.join(evidence, 'frozen-get-pty-observations.jsonl'),
          JSON.stringify({
            command,
            before,
            after: this.observe(),
            ...result,
          }) + '\n'
        );
      return result;
    }
    const result = spawnSync(command[0], command.slice(1), {
      cwd,
      env: this.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    const transcript = {
      status: result.status,
      output: result.stdout + result.stderr,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    if (evidence) {
      fs.ensureDirSync(evidence);
      fs.appendFileSync(
        path.join(evidence, 'frozen-get-cli.jsonl'),
        JSON.stringify({
          command,
          cwd,
          explicitEnvironment: Object.fromEntries(
            [
              'HOME',
              'GH_CONFIG_DIR',
              'PATH',
              'GRAPHITE_USER_CONFIG_PATH',
              'GRAPHITE_INTERACTIVE',
              'GIT_CONFIG_GLOBAL',
              'GIT_CONFIG_NOSYSTEM',
              'GIT_EDITOR',
              'TERM',
              'NO_COLOR',
            ].map((key) => [key, this.env[key]])
          ),
          before,
          after: this.observe(),
          ...transcript,
          fetchedRefs: this.git(
            this.consumer,
            'for-each-ref',
            '--format=%(refname) %(objectname)',
            'refs/gt-metadata',
            'refs/remotes'
          ),
          ghCalls: fs.readFileSync(this.ghCalls, 'utf8'),
          bareRefs: this.git(
            this.remote,
            'for-each-ref',
            '--format=%(refname) %(objectname)',
            'refs/heads'
          ),
          stdoutBase64:
            'stdout' in result
              ? Buffer.from(result.stdout ?? '').toString('base64')
              : null,
          stderrBase64:
            'stderr' in result
              ? Buffer.from(result.stderr ?? '').toString('base64')
              : null,
          signal: 'signal' in result ? result.signal : null,
          error: 'error' in result ? result.error?.message : undefined,
        }) + '\n'
      );
    }
    if ('error' in result && result.error) throw result.error;
    return transcript;
  }

  ok(...args: string[]): CliResult {
    const result = this.run(args);
    expect(result.status, result.output).to.equal(0);
    return result;
  }

  advanceBoth(): { parent: string; child: string } {
    this.git(this.producer, 'switch', 'parent');
    const parent = this.commit(this.producer, 'parent.txt', 'parent-new');
    this.git(this.producer, 'switch', 'child');
    this.git(this.producer, 'merge', '--no-edit', 'parent');
    const child = this.commit(this.producer, 'child.txt', 'child-new');
    this.git(this.producer, 'push', 'origin', 'parent', 'child');
    expect(
      this.git(this.producer, 'merge-base', this.oldParent, parent)
    ).to.equal(this.oldParent);
    expect(
      this.git(this.producer, 'merge-base', this.oldChild, child)
    ).to.equal(this.oldChild);
    expect(this.git(this.producer, 'merge-base', parent, child)).to.equal(
      parent
    );
    return { parent, child };
  }

  advanceChild(): string {
    const head = this.commit(this.producer, 'child.txt', 'child-new');
    this.git(this.producer, 'push', 'origin', 'child');
    expect(this.git(this.producer, 'merge-base', this.oldChild, head)).to.equal(
      this.oldChild
    );
    return head;
  }

  assertTip(branch: string, revision: string): void {
    expect(this.git(this.consumer, 'rev-parse', branch)).to.equal(revision);
  }

  status(branch = 'child', frozen = true): void {
    const output = this.ok('info', branch).output;
    if (frozen) expect(output).to.include(`${branch} (frozen)`);
    else expect(output).not.to.include('(frozen)');
  }

  cleanup(): void {
    fs.removeSync(this.root);
  }
}
