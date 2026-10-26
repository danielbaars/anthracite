import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';
import { readSubmitPrs, SubmitPr } from './submit_gh';

// Every instance owns its repo, bare remote, HOME, and external gh state.
export class SubmitCliFixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'anthracite-submit-'));
  readonly repo = path.join(this.root, 'repo');
  readonly remote = path.join(this.root, 'remote.git');
  readonly state = path.join(this.root, 'prs.json');
  readonly log = path.join(this.root, 'gh.jsonl');
  readonly env: NodeJS.ProcessEnv;

  constructor() {
    fs.mkdirSync(this.repo);
    const bin = path.join(this.root, 'bin');
    const home = path.join(this.root, 'home');
    fs.mkdirSync(bin);
    fs.mkdirSync(home);
    fs.writeFileSync(this.state, '[]');
    fs.writeFileSync(this.log, '');
    const shim = path.join(bin, 'gh');
    fs.writeFileSync(
      shim,
      `#!${process.execPath}\n${fs.readFileSync(
        path.join(__dirname, 'submit_gh.js'),
        'utf8'
      )}`
    );
    fs.chmodSync(shim, 0o755);
    const userConfig = path.join(this.root, 'user-config');
    fs.writeFileSync(userConfig, JSON.stringify({ tips: false }));
    this.env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: home,
      GH_CONFIG_DIR: home,
      GRAPHITE_USER_CONFIG_PATH: userConfig,
      GRAPHITE_PROFILE: '',
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      ANTHRACITE_TEST_GH_STATE: this.state,
      ANTHRACITE_TEST_GH_LOG: this.log,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    };
    delete this.env.DEBUG;
    delete this.env.GH_TOKEN;
    delete this.env.GITHUB_TOKEN;
    this.git('init', '--initial-branch=main');
    this.git('config', 'user.name', 'Submit fixture');
    this.git('config', 'user.email', 'submit@example.test');
    this.git('config', 'commit.gpgsign', 'false');
    this.git('init', '--bare', this.remote);
    this.git('remote', 'add', 'origin', this.remote);
    this.commit('main');
    this.git('push', '-u', 'origin', 'main');
    fs.writeFileSync(
      path.join(this.repo, '.git', '.graphite_repo_config'),
      JSON.stringify({
        trunk: 'main',
        owner: 'fixture',
        name: 'submit',
        host: 'github.com',
        isGithubIntegrationEnabled: true,
      })
    );
  }

  git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.repo,
      env: this.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  cli(...args: string[]): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const [executable, ...cliArgs] = getTestCliCommand([
      ...args,
      '--no-interactive',
    ]);
    const result = spawnSync(executable, cliArgs, {
      cwd: this.repo,
      env: this.env,
      encoding: 'utf8',
      timeout: 20000,
    });
    if (result.error) throw result.error;
    if (result.signal)
      throw new Error(
        `CLI killed by ${result.signal}: ${result.stdout}\n${result.stderr}`
      );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  succeed(...args: string[]): string {
    const result = this.cli(...args);
    if (result.status !== 0)
      throw new Error(
        `CLI ${args.join(' ')} exited ${result.status}: ${result.stdout}\n${
          result.stderr
        }`
      );
    return result.stdout;
  }

  commit(name: string): string {
    fs.writeFileSync(path.join(this.repo, `${name}.txt`), name);
    this.git('add', `${name}.txt`);
    this.git('commit', '-m', name);
    return this.git('rev-parse', 'HEAD');
  }

  branch(name: string, parent: string): void {
    this.git('checkout', '-b', name, parent);
    this.commit(name);
    this.succeed('track', name, '--parent', parent);
  }

  prs(): SubmitPr[] {
    return readSubmitPrs(this.state);
  }
  setPrs(prs: SubmitPr[]): void {
    fs.writeFileSync(this.state, JSON.stringify(prs));
  }
  calls(): string[][] {
    return fs
      .readFileSync(this.log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const call: unknown = JSON.parse(line);
        if (
          !Array.isArray(call) ||
          !call.every((arg: unknown) => typeof arg === 'string')
        )
          throw new Error('Invalid gh fixture call');
        return call;
      });
  }
  clearCalls(): void {
    fs.writeFileSync(this.log, '');
  }
  remoteSha(branch: string): string {
    return this.git('ls-remote', 'origin', `refs/heads/${branch}`).split(
      /\s/
    )[0];
  }
  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
