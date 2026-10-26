import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from './submit_cli';
import { SubmitPr } from './submit_gh';

type SubmissionObservation = {
  readonly head: string;
  readonly commits: string;
  readonly refs: string;
  readonly stage: string;
  readonly index: string;
  readonly work: string;
  readonly status: string;
  readonly rebase: boolean;
  readonly remote: string;
  readonly prs: SubmitPr[];
  readonly files: Record<string, string>;
};

export class FrozenSubmitCliFixture extends SubmitCliFixture {
  observe(): SubmissionObservation {
    const git = (...args: string[]): string =>
      execFileSync('git', args, {
        cwd: this.repo,
        env: { ...this.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
      }).trim();
    const files: Record<string, string> = {};
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile())
          files[path.relative(this.repo, file)] = fs
            .readFileSync(file)
            .toString('base64');
      }
    };
    visit(this.repo);
    const gitDir = git('rev-parse', '--absolute-git-dir');
    return {
      head: git('rev-parse', 'HEAD'),
      commits: git('log', '--all', '--format=%H %P %T %s'),
      refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
      stage: git('ls-files', '--stage'),
      index: fs.readFileSync(path.join(gitDir, 'index')).toString('base64'),
      work: git('diff'),
      status: git('status', '--porcelain'),
      rebase: fs.existsSync(path.join(gitDir, 'rebase-merge')),
      remote: git(
        '--git-dir',
        this.remote,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads'
      ),
      prs: this.prs(),
      files,
    };
  }

  run(
    args: readonly string[],
    cwd = this.repo
  ): {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  } {
    const command = getTestCliCommand(args);
    const before = this.observe();
    const result = spawnSync(command[0], command.slice(1), {
      cwd,
      env: this.env,
      timeout: 20000,
    });
    fs.appendFileSync(
      path.join(this.root, 'cli.jsonl'),
      JSON.stringify({
        command,
        cwd,
        before,
        after: this.observe(),
        environment: Object.fromEntries(
          [
            'HOME',
            'GH_CONFIG_DIR',
            'GRAPHITE_USER_CONFIG_PATH',
            'PATH',
            'TERM',
            'NO_COLOR',
            'CH_EDITOR',
            'GIT_CONFIG_NOSYSTEM',
            'GIT_CONFIG_GLOBAL',
            'ANTHRACITE_TEST_BINARY',
          ].map((key) => [key, this.env[key]])
        ),
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        stdoutBase64: result.stdout.toString('base64'),
        stderrBase64: result.stderr.toString('base64'),
      }) + '\n'
    );
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`CLI killed by ${result.signal}`);
    return {
      status: result.status,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  freezeAfterGhView(fields: string, branch: string): void {
    const shim = path.join(this.root, 'bin', 'gh');
    const original = shim + '-original';
    fs.renameSync(shim, original);
    const freeze = getTestCliCommand(['freeze', branch, '--no-interactive']);
    fs.writeFileSync(
      shim,
      `#!${process.execPath}
const cp = require('child_process');
const args = process.argv.slice(2);
const result = cp.spawnSync(${JSON.stringify(
        original
      )}, args, {encoding: 'utf8'});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (args[0] === 'pr' && args[1] === 'view' && args[args.indexOf('--json') + 1] === ${JSON.stringify(
        fields
      )}) {
  const frozen = cp.spawnSync(${JSON.stringify(freeze[0])}, ${JSON.stringify(
        freeze.slice(1)
      )}, {encoding: 'utf8'});
  if (frozen.status !== 0) throw new Error(frozen.stdout + frozen.stderr);
}
process.exitCode = result.status ?? 1;
`
    );
    fs.chmodSync(shim, 0o755);
  }

  saveEvidence(test: string | undefined): void {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (!evidence) return;
    const target = path.join(evidence, path.basename(this.root));
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, 'final.json'),
      JSON.stringify(
        { test, observation: this.observe(), calls: this.calls() },
        null,
        2
      )
    );
    for (const file of ['cli.jsonl', 'editor.jsonl', 'gh.jsonl', 'prs.json']) {
      const source = path.join(this.root, file);
      if (fs.existsSync(source))
        fs.copyFileSync(source, path.join(target, file));
    }
  }
}
