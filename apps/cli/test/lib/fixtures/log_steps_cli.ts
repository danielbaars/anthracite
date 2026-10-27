import fs from 'fs';
import os from 'os';
import path from 'path';

import { CwdCliFixture } from './cwd_cli';

/** Deterministic public-CLI reproductions of the log depth investigation. */
export class LogStepsCliFixture extends CwdCliFixture {
  private readonly home: string;

  constructor(graph: 'minimal' | 'branched' = 'minimal') {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'an-log-home-'));
    super({
      ...process.env,
      HOME: home,
      GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z',
      TZ: 'UTC',
      TERM: 'dumb',
    });
    this.home = home;
    delete this.env.FORCE_COLOR;
    delete this.env.GRAPHITE_INTERACTIVE;
    for (const key of ['CH_PAGER', 'PAGER', 'GIT_PAGER']) this.env[key] = '';
    this.git(['switch', 'main']);
    for (const name of ['tip', 'child', 'base', 'other']) {
      this.ok(['untrack', name, '--force']);
      this.git(['branch', '-D', name]);
    }
    this.git(['commit', '--amend', '--no-edit', '--date=2026-10-01T12:00:00Z']);
    if (graph === 'minimal') {
      this.branch('child', 'main');
      this.git([
        'commit',
        '--amend',
        '-m',
        'Own change mentions main and maintenance',
      ]);
      return;
    }
    this.branch('base', 'main');
    this.branch('search', 'base');
    this.git([
      'commit',
      '--amend',
      '-m',
      'Search change mentions base, main and api',
    ]);
    this.branch('ui', 'search');
    this.branch('empty-tip', 'ui', true);
    this.branch('api', 'base');
    this.branch('api-followup', 'api');
    this.git(['switch', 'api']);
    this.commit('api-update');
    this.branch('maintenance', 'main');
    this.branch('feature/café-long-branch-name-for-terminal-width', 'search');
    this.git(['switch', '-c', 'scratch', 'main']);
    this.commit('scratch');
    this.git(['switch', 'search']);
  }

  override cleanup(): void {
    try {
      super.cleanup();
    } finally {
      fs.rmSync(this.home, { recursive: true, force: true });
    }
  }

  /** Compare durable work state without treating transient caches as user data. */
  logSnapshot(): Record<string, unknown> {
    const snapshot = this.inspectionSnapshot();
    delete snapshot.persistent;
    return snapshot;
  }
}

export function getFullLogNodes(output: string): readonly string[] {
  return [...output.matchAll(/^[│ ]*[◉◯] ([^\s]+)/gm)].map((match) => match[1]);
}
