import { execFileSync, spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from './create_cli';

export class FreezeCliFixture extends CreateCliFixture {
  observe(): unknown {
    const git = (args: readonly string[]): string =>
      execFileSync('git', args, {
        cwd: this.repo,
        env: { ...this.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
      });
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
    const index = path.join(this.repo, '.git', 'index');
    return {
      head: git(['rev-parse', 'HEAD']),
      branch: git(['branch', '--show-current']),
      refs: git(['for-each-ref', '--format=%(refname) %(objectname)']),
      status: git(['status', '--porcelain=v1']),
      stages: git(['ls-files', '--stage']),
      index: fs.existsSync(index)
        ? fs.readFileSync(index).toString('base64')
        : null,
      files,
    };
  }

  run(args: readonly string[], cwd = this.repo): SpawnSyncReturns<string> {
    const command = getTestCliCommand([
      ...args,
      ...(args.includes('--interactive') ||
      args.includes('--get-yargs-completions')
        ? []
        : ['--no-interactive']),
    ]);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    const before = evidence ? this.observe() : undefined;
    const [executable, ...argv] = command;
    const result = spawnSync(executable, argv, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      const explicitEnvironment = Object.fromEntries(
        [
          'HOME',
          'GH_CONFIG_DIR',
          'GRAPHITE_USER_CONFIG_PATH',
          'GIT_CONFIG_NOSYSTEM',
          'GIT_CONFIG_GLOBAL',
          'GIT_EDITOR',
          'GIT_SEQUENCE_EDITOR',
          'NO_COLOR',
          'TERM',
        ].map((key) => [key, this.env[key]])
      );
      fs.appendFileSync(
        path.join(evidence, 'freeze-cli.jsonl'),
        JSON.stringify({
          root: this.root,
          command,
          cwd,
          explicitEnvironment,
          before,
          after: this.observe(),
          stdoutBase64: Buffer.from(result.stdout ?? '').toString('base64'),
          stderrBase64: Buffer.from(result.stderr ?? '').toString('base64'),
          status: result.status,
          signal: result.signal,
          error: result.error?.message,
        }) + '\n'
      );
    }
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`CLI killed by ${result.signal}`);
    return result;
  }
}
