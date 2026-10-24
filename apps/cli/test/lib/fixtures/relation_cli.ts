import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ReorderCliFixture } from './reorder_cli';

/** Real CLI setup with normal optional locks for the command under test. */
export class RelationCliFixture extends ReorderCliFixture {
  constructor() {
    super();
    delete this.env.GIT_OPTIONAL_LOCKS;
    this.env.XDG_CONFIG_HOME = path.join(this.root, 'xdg');
    const marker = path.join(this.root, 'unexpected-tool');
    const bin = path.join(this.root, 'sentinel-bin');
    fs.mkdirSync(bin);
    for (const tool of ['gh', 'pager', 'editor'])
      fs.writeFileSync(
        path.join(bin, tool),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          marker
        )},${JSON.stringify(tool)});process.exitCode=99;`,
        { mode: 0o755 }
      );
    this.env.PATH = `${bin}${path.delimiter}${this.env.PATH ?? ''}`;
    this.env.CH_PAGER = path.join(bin, 'pager');
    this.env.CH_EDITOR = path.join(bin, 'editor');
    this.env.GIT_EDITOR = path.join(bin, 'editor');
  }

  /** Observers alone disable optional writes; inspect opaque persistence bytes. */
  inspectionSnapshot(cwd = this.repo): Record<string, unknown> {
    const git = (args: ReadonlyArray<string>): string =>
      execFileSync('git', args, {
        cwd,
        env: { ...this.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
      });
    const gitPath = (name: string): string =>
      path.resolve(
        cwd,
        git(['rev-parse', '--git-path', name]).replace(/\r?\n$/, '')
      );
    const bytes = (name: string): string | null =>
      fs.existsSync(name) ? fs.readFileSync(name).toString('base64') : null;
    const common = path.resolve(
      cwd,
      git(['rev-parse', '--git-common-dir']).replace(/\r?\n$/, '')
    );
    const operation = Object.fromEntries(
      ['rebase-merge', 'rebase-apply'].map((name) => {
        const directory = gitPath(name);
        return [
          name,
          fs.existsSync(directory)
            ? Object.fromEntries(
                fs
                  .readdirSync(directory)
                  .map((entry) => [entry, bytes(path.join(directory, entry))])
              )
            : null,
        ];
      })
    );
    const files: Record<string, string | null> = {};
    const walk = (directory: string): void => {
      for (const name of fs.readdirSync(directory)) {
        if (directory === cwd && name === '.git') continue;
        const file = path.join(directory, name);
        const stat = fs.lstatSync(file);
        if (stat.isDirectory()) walk(file);
        else
          files[path.relative(cwd, file)] = stat.isSymbolicLink()
            ? `link:${fs.readlinkSync(file)}`
            : bytes(file);
      }
    };
    walk(cwd);
    const snapshot = {
      head: git(['rev-parse', 'HEAD']),
      branch: git(['branch', '--show-current']),
      refs: git(['for-each-ref', '--format=%(refname) %(objectname)']),
      index: bytes(gitPath('index')),
      indexLock: bytes(gitPath('index.lock')),
      staging: git(['diff', '--cached', '--raw', '-z']),
      status: git(['status', '--porcelain=v1', '-z']),
      files,
      persistent: Object.fromEntries(
        [
          'config',
          '.graphite_repo_config',
          '.gtcontinue',
          '.graphite_pr_info',
          '.graphite_cache_lock',
          '.graphite_cache_persist',
        ].map((name) => [name, bytes(path.join(common, name))])
      ),
      operation,
      userConfig: bytes(this.env.GRAPHITE_USER_CONFIG_PATH ?? ''),
    };
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, `${path.basename(this.root)}-snapshots.jsonl`),
        JSON.stringify({ cwd, snapshot }) + '\n'
      );
    }
    return snapshot;
  }
}
