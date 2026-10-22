import { execFileSync, spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';

export class CreateCliFixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-create-'));
  readonly repo = path.join(this.root, 'repo');
  readonly linked = path.join(this.root, 'linked worktree');
  readonly env: NodeJS.ProcessEnv;

  constructor() {
    fs.mkdirSync(this.repo);
    const home = path.join(this.root, 'home');
    const bin = path.join(this.root, 'bin');
    fs.mkdirSync(home);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });
    const config = path.join(this.root, 'user-config');
    fs.writeFileSync(
      config,
      JSON.stringify({ tips: false, branchDate: false })
    );
    this.env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: home,
      GH_CONFIG_DIR: home,
      GRAPHITE_USER_CONFIG_PATH: config,
      GRAPHITE_PROFILE: '',
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_EDITOR: 'false',
      NO_COLOR: '1',
    };
    delete this.env.DEBUG;
    delete this.env.GH_TOKEN;
    delete this.env.GITHUB_TOKEN;
    this.git(['init', '--initial-branch=main']);
    this.git(['config', 'user.name', 'Create fixture']);
    this.git(['config', 'user.email', 'create@example.test']);
    this.git(['config', 'commit.gpgsign', 'false']);
    this.commit('main');
    this.git(['init', '--bare', path.join(this.root, 'remote.git')]);
    this.git(['remote', 'add', 'origin', path.join(this.root, 'remote.git')]);
    this.git(['push', '-u', 'origin', 'main']);
    fs.writeFileSync(
      path.join(this.repo, '.git', '.graphite_repo_config'),
      JSON.stringify({ trunk: 'main', isGithubIntegrationEnabled: false })
    );
    this.branch('base', 'main');
    this.branch('child', 'base');
    this.branch('tip', 'child');
    this.branch('other', 'main');
    this.git(['switch', 'base']);
  }

  git(args: readonly string[], cwd = this.repo): string {
    return execFileSync('git', args, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  run(args: readonly string[], cwd = this.repo): SpawnSyncReturns<string> {
    const [executable, ...cliArgs] = getTestCliCommand([
      ...args,
      '--no-interactive',
    ]);
    const result = spawnSync(executable, cliArgs, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`CLI killed by ${result.signal}`);
    return result;
  }

  ok(args: readonly string[], cwd = this.repo): string {
    const result = this.run(args, cwd);
    if (result.status !== 0) {
      throw new Error(`${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
    }
    return result.stdout;
  }

  write(name: string, content: string, cwd = this.repo): void {
    fs.writeFileSync(path.join(cwd, name), content);
  }

  stage(name = 'new.txt', content = 'new work', cwd = this.repo): void {
    this.write(name, content, cwd);
    this.git(['add', name], cwd);
  }

  commit(name: string): void {
    this.stage(`${name}.txt`, name);
    this.git(['commit', '-m', name]);
  }

  branch(name: string, parent: string): void {
    this.git(['switch', '-c', name, parent]);
    this.commit(name);
    this.ok(['track', name, '--parent', parent]);
  }

  refs(): string {
    return this.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
  }

  snapshot(cwd = this.repo): {
    readonly head: string;
    readonly branch: string;
    readonly refs: string;
    readonly status: string;
    readonly staged: string;
    readonly unstaged: string;
    readonly files: Record<string, string | null>;
  } {
    const files = this.git(
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      cwd
    )
      .split('\0')
      .filter(Boolean);
    return {
      head: this.git(['rev-parse', 'HEAD'], cwd),
      branch: this.git(['branch', '--show-current'], cwd),
      refs: this.refs(),
      status: this.git(['status', '--porcelain=v1'], cwd),
      staged: this.git(['diff', '--cached', '--binary'], cwd),
      unstaged: this.git(['diff', '--binary'], cwd),
      files: Object.fromEntries(
        files.map((file) => [
          file,
          fs.existsSync(path.join(cwd, file))
            ? fs.readFileSync(path.join(cwd, file)).toString('base64')
            : null,
        ])
      ),
    };
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
