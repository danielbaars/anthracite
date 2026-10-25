import { spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import path from 'path';

import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';
import { RelationCliFixture } from './relation_cli';

/** Select repositories independently of inherited Git overrides; preserve raw pipes. */
export class CwdCliFixture extends RelationCliFixture {
  constructor() {
    const environment = { ...process.env };
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_PREFIX',
      'GIT_CONFIG_COUNT',
    ])
      delete environment[key];
    super(environment);
    this.env.CH_PAGER = '';
  }

  refuseExternalTools(): () => void {
    const originalPath = this.env.PATH;
    const bin = fs.mkdtempSync(path.join(this.root, 'preflight-bin-'));
    for (const tool of ['git', 'gh', 'pager', 'editor'])
      fs.writeFileSync(
        path.join(bin, tool),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          path.join(this.root, 'unexpected-tool')
        )}, ${JSON.stringify(tool)});process.exitCode=99;`,
        { mode: 0o755 }
      );
    this.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
    return () => {
      this.env.PATH = originalPath;
    };
  }

  override run(
    args: readonly string[],
    cwd = this.repo,
    input?: string
  ): SpawnSyncReturns<string> {
    const [executable, ...cliArgs] = getTestCliCommand(args);
    const result = spawnSync(executable, cliArgs, {
      cwd,
      env: this.env,
      timeout: 20000,
      input,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`CLI killed by ${result.signal}`);
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
      fs.appendFileSync(
        path.join(this.root, 'cli.jsonl'),
        JSON.stringify({
          executable,
          args: cliArgs,
          cwd,
          status: result.status,
          stdinBase64:
            input === undefined ? null : Buffer.from(input).toString('base64'),
          stdoutBase64: result.stdout.toString('base64'),
          stderrBase64: result.stderr.toString('base64'),
          environment: Object.fromEntries(
            [
              'GRAPHITE_USER_CONFIG_PATH',
              'GRAPHITE_INTERACTIVE',
              'CHARCOAL_TEST_BINARY',
              'BUN_BE_BUN',
              'CH_PAGER',
              'GRAPHITE_PROFILE',
              'XDG_CONFIG_HOME',
              'GH_CONFIG_DIR',
              'GIT_CONFIG_NOSYSTEM',
              'GIT_CONFIG_GLOBAL',
              'GIT_OPTIONAL_LOCKS',
              'HOME',
              'CODEX_HOME',
              'PATH',
              'SHELL',
              'ZSH_NAME',
            ].map((key) => [key, this.env[key] ?? null])
          ),
        }) + '\n'
      );
    return {
      ...result,
      output: result.output.map((output) => output?.toString('utf8') ?? ''),
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
    };
  }
}
