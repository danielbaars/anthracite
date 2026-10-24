import { execFileSync, spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestCliCommand } from '../../../src/lib/utils/test_cli_command';

/** Public setup and real external editor; configuration stays in the fixture. */
export class ReorderCliFixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-reorder-'));
  readonly repo = path.join(this.root, 'repo');
  readonly offered = path.join(this.root, 'offered');
  readonly env: NodeJS.ProcessEnv;
  constructor() {
    fs.mkdirSync(this.repo);
    const config = path.join(this.root, 'user-config');
    fs.writeFileSync(
      config,
      JSON.stringify({ tips: false, branchDate: false })
    );
    this.env = {
      ...process.env,
      GRAPHITE_USER_CONFIG_PATH: config,
      GRAPHITE_PROFILE: '',
      GH_CONFIG_DIR: path.join(this.root, 'gh-config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_EDITOR: 'false',
      NO_COLOR: '1',
    };
    delete this.env.DEBUG;
    delete this.env.GH_TOKEN;
    delete this.env.GITHUB_TOKEN;
    this.git(['init', '--initial-branch=main']);
    this.git(['config', 'user.name', 'Reorder fixture']);
    this.git(['config', 'user.email', 'reorder@example.test']);
    this.git(['config', 'commit.gpgsign', 'false']);
    this.commit('main');
    this.ok(['init', '--trunk', 'main']);
    this.branch('base', 'main');
    this.branch('child', 'base');
    this.branch('tip', 'child');
    this.branch('other', 'main');
    this.git(['switch', 'base']);
    this.editor();
  }
  git(args: readonly string[], cwd = this.repo): string {
    const output = execFileSync('git', args, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
      fs.appendFileSync(
        path.join(this.root, 'git.jsonl'),
        JSON.stringify({ args, cwd, output }) + '\n'
      );
    return output;
  }
  run(args: readonly string[], cwd = this.repo): SpawnSyncReturns<string> {
    const [executable, ...cliArgs] = getTestCliCommand(args);
    const result = spawnSync(executable, cliArgs, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      timeout: 20000,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`CLI killed by ${result.signal}`);
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
      fs.appendFileSync(
        path.join(this.root, 'cli.jsonl'),
        JSON.stringify({
          args,
          cwd,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        }) + '\n'
      );
    return result;
  }
  ok(args: readonly string[], cwd = this.repo): string {
    const result = this.run([...args, '--no-interactive'], cwd);
    if (result.status !== 0)
      throw new Error(`${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  }
  edit(
    args: readonly string[] = ['reorder', '--stack'],
    cwd = this.repo
  ): string {
    const result = this.run([...args, '--interactive'], cwd);
    if (result.status !== 0)
      throw new Error(`${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  }
  editor(contents?: string, extra = '', status = 0): void {
    const script = path.join(this.root, 'editor.js');
    fs.writeFileSync(
      script,
      [
        "const fs = require('fs');",
        `fs.copyFileSync(process.argv[2], ${JSON.stringify(this.offered)});`,
        ...(contents === undefined
          ? []
          : [
              `fs.writeFileSync(process.argv[2], ${JSON.stringify(contents)});`,
            ]),
        extra,
        `process.exitCode = ${status};`,
      ].join('\n')
    );
    this.env.CH_EDITOR = `'${process.execPath.replace(
      /'/g,
      "'\\''"
    )}' '${script}'`;
  }
  input(contents: string): string {
    const file = path.join(this.root, 'input');
    fs.writeFileSync(file, contents);
    return file;
  }
  commit(name: string): void {
    fs.writeFileSync(path.join(this.repo, `${name}.txt`), name);
    this.git(['add', `${name}.txt`]);
    this.git(['commit', '-m', name]);
  }
  branch(name: string, parent: string, empty = false): void {
    this.git(['switch', '-c', name, parent]);
    if (!empty) this.commit(name.replace(/[^a-z0-9-]/gi, '_'));
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
  index(cwd = this.repo): string {
    return fs
      .readFileSync(
        path.resolve(cwd, this.git(['rev-parse', '--git-path', 'index'], cwd))
      )
      .toString('base64');
  }
  snapshot(cwd = this.repo): {
    head: string;
    branch: string;
    refs: string;
    index: string;
    status: string;
    files: Record<string, string | null>;
  } {
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '-z'],
      { cwd, env: this.env }
    )
      .toString()
      .split('\0')
      .filter(Boolean);
    return {
      head: this.git(['rev-parse', 'HEAD'], cwd),
      branch: this.git(['branch', '--show-current'], cwd),
      refs: this.refs(),
      index: this.index(cwd),
      status: this.git(['status', '--porcelain=v1', '-z'], cwd),
      files: Object.fromEntries(
        files.map((file) => {
          const absolute = path.join(cwd, file);
          const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
          return [
            file,
            stat?.isSymbolicLink()
              ? `link:${fs.readlinkSync(absolute)}`
              : stat?.isFile()
              ? fs.readFileSync(absolute).toString('base64')
              : null,
          ];
        })
      ),
    };
  }
  parent(name: string): string {
    const departure = this.git(['branch', '--show-current']);
    this.ok(['checkout', name]);
    const parent =
      this.ok(['info'])
        .split('\n')
        .find((line) => line.startsWith('Parent: '))
        ?.slice(8) ?? '';
    this.ok(['checkout', departure]);
    return parent;
  }
  cleanup(): void {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      const destination = path.join(evidence, path.basename(this.root));
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(
        path.join(destination, 'snapshot.json'),
        JSON.stringify(this.snapshot(), null, 2)
      );
      for (const name of ['offered', 'cli.jsonl', 'git.jsonl']) {
        const source = path.join(this.root, name);
        if (fs.existsSync(source))
          fs.copyFileSync(source, path.join(destination, name));
      }
    }
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
