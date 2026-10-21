import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

const cli = path.resolve(__dirname, '../../src/index.js');

type CliResult = { status: number | null; output: string };

class GetFixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'charcoal-get-'));
  readonly producer = path.join(this.root, 'producer');
  readonly consumer = path.join(this.root, 'consumer');
  readonly remote = path.join(this.root, 'remote.git');
  readonly bin = path.join(this.root, 'bin');
  readonly env = {
    ...process.env,
    HOME: this.root,
    GRAPHITE_USER_CONFIG_PATH: path.join(this.root, 'user.json'),
    GRAPHITE_INTERACTIVE: '',
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
  readonly oldParent: string;
  readonly oldChild: string;

  constructor() {
    fs.ensureDirSync(this.bin);
    fs.writeFileSync(
      path.join(this.bin, 'gh'),
      `#!${process.execPath}\nconst args = process.argv.slice(2);
if (args[0] !== 'pr' || args[1] !== 'view' || args[4] !== 'get-fixture/repo' || args[5] !== '--json') process.exit(2);
const head = args[2] === '2' ? 'child' : args[2];
const base = head === 'parent' ? 'main' : head === 'child' ? 'parent' : undefined;
if (!base) process.exit(3);
console.log(JSON.stringify({headRefName: head, baseRefName: base}));\n`,
      { mode: 0o755 }
    );
    fs.writeJsonSync(this.env.GRAPHITE_USER_CONFIG_PATH, {});
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

  run(args: string[], interactive = false): CliResult {
    const command = process.env.CHARCOAL_TEST_BINARY
      ? [process.env.CHARCOAL_TEST_BINARY, ...args]
      : [process.execPath, cli, ...args];
    if (interactive) {
      return runCliInPty(command, { cwd: this.consumer, env: this.env });
    }
    const result = spawnSync(
      command[0],
      [...command.slice(1), '--no-interactive'],
      {
        cwd: this.consumer,
        env: this.env,
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
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

  cleanup(): void {
    fs.removeSync(this.root);
  }
}

describe('get CLI safe fast-forward', function () {
  this.timeout(30000);
  let fixture: GetFixture;
  beforeEach(() => {
    fixture = new GetFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const target of ['child', '2']) {
    it(`gets a fresh stack via ${
      target === '2' ? 'PR number' : 'branch name'
    }`, () => {
      fixture.freshConsumer();
      fixture.ok('get', target);
      fixture.assertTip('parent', fixture.oldParent);
      fixture.assertTip('child', fixture.oldChild);
      fixture.assertTip('HEAD', fixture.oldChild);
      fixture.ok('down');
      fixture.assertTip('HEAD', fixture.oldParent);
      fixture.ok('up');
      fixture.assertTip('HEAD', fixture.oldChild);
      expect(fixture.ok('get', target).output).to.include(
        'child is up to date'
      );
    });
  }

  it('gets the implicit current target and keeps equal tips stable on repetition', () => {
    const head = fixture.advanceChild();
    fixture.ok('get');
    fixture.assertTip('HEAD', head);
    const tree = fixture.git(fixture.consumer, 'write-tree');
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = fixture.ok('get');
      expect(result.output).to.include('child is up to date');
      expect(result.output).not.to.include('How would you like');
      fixture.assertTip('HEAD', head);
      expect(fixture.git(fixture.consumer, 'write-tree')).to.equal(tree);
    }
  });

  it('updates both layers and preserves parent/child navigation across processes', () => {
    const head = fixture.advanceBoth();
    fixture.ok('get', '2');
    fixture.assertTip('parent', head.parent);
    fixture.assertTip('child', head.child);
    fixture.assertTip('HEAD', head.child);
    fixture.ok('down');
    fixture.assertTip('HEAD', head.parent);
    fixture.ok('down');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    fixture.ok('up');
    fixture.assertTip('HEAD', head.parent);
    fixture.ok('up');
    fixture.assertTip('HEAD', head.child);
    expect(fixture.ok('get').output).to.include('child is up to date');
  });

  it('reports completed layers when a later branch cannot be updated', () => {
    const head = fixture.advanceBoth();
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local child commit'
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.include('Updated parent before get stopped');
    fixture.assertTip('parent', head.parent);
    fixture.assertTip('child', local);
    fixture.assertTip('HEAD', head.parent);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    fixture.ok('up');
    fixture.assertTip('HEAD', local);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'local.txt'), 'utf8')
    ).to.equal('local child commit');
  });

  it('preserves a local descendant and reports that it needs restacking', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'local-descendant');
    fixture.commit(fixture.consumer, 'descendant.txt', 'local descendant');
    fixture.ok('track', '--parent', 'child');
    const descendant = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    const tree = fixture.git(fixture.consumer, 'rev-parse', 'HEAD^{tree}');
    const head = fixture.advanceChild();
    const result = fixture.ok('get', 'child');
    fixture.assertTip('child', head);
    fixture.assertTip('local-descendant', descendant);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'local-descendant^{tree}')
    ).to.equal(tree);
    expect(result.output).to.match(/children.*restack/);
    fixture.ok('up');
    fixture.assertTip('HEAD', descendant);
    fixture.ok('down');
    fixture.assertTip('HEAD', head);
  });

  for (const divergent of [false, true]) {
    it(`preserves ${
      divergent ? 'divergent' : 'locally ahead'
    } commits without force`, () => {
      if (divergent) fixture.advanceChild();
      const local = fixture.commit(
        fixture.consumer,
        'local.txt',
        'local commit'
      );
      const tree = fixture.git(fixture.consumer, 'write-tree');
      const result = fixture.run(['get', 'child']);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.output).not.to.include('Synced child');
      fixture.assertTip('child', local);
      fixture.assertTip('HEAD', local);
      expect(fixture.git(fixture.consumer, 'write-tree')).to.equal(tree);
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'local.txt'), 'utf8')
      ).to.equal('local commit');
      expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal(
        ''
      );
      fixture.ok('down');
      fixture.ok('up');
      fixture.assertTip('HEAD', local);
    });
  }

  for (const tracked of [false, true]) {
    it(`refuses a ${
      tracked ? 'different local parent' : 'local untracked namesake'
    }`, () => {
      fixture.advanceChild();
      if (tracked) fixture.ok('track', 'child', '--parent', 'main');
      else fixture.ok('untrack', 'child');
      const result = fixture.run(['get', 'child']);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.output).to.include(
        tracked ? 'different parents' : 'not tracked'
      );
      fixture.assertTip('child', fixture.oldChild);
      fixture.assertTip('HEAD', fixture.oldChild);
      if (tracked) {
        fixture.ok('down');
        expect(
          fixture.git(fixture.consumer, 'branch', '--show-current')
        ).to.equal('main');
      }
    });
  }

  it('preserves an untracked file that the fetched update would overwrite', () => {
    const head = fixture.commit(
      fixture.producer,
      'incoming.txt',
      'remote contents'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    fs.writeFileSync(
      path.join(fixture.consumer, 'incoming.txt'),
      'local contents'
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.match(/untracked.*files|would be overwritten/);
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'incoming.txt'), 'utf8')
    ).to.equal('local contents');
    expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(head);
  });

  it('preserves a branch, index and files checked out in another worktree', () => {
    const head = fixture.advanceChild();
    fixture.ok('down');
    const other = path.join(fixture.root, 'other-worktree');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'child');
    fs.writeFileSync(path.join(other, 'child.txt'), 'other staged work');
    fixture.git(other, 'add', 'child.txt');
    fs.appendFileSync(path.join(other, 'child.txt'), ' and unstaged work');
    const index = fixture.git(other, 'write-tree');
    const status = fixture.git(other, 'status', '--porcelain');
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.include(other);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(other, 'write-tree')).to.equal(index);
    expect(fixture.git(other, 'status', '--porcelain')).to.equal(status);
    expect(fs.readFileSync(path.join(other, 'child.txt'), 'utf8')).to.equal(
      'other staged work and unstaged work'
    );
    expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(head);
  });

  it('rejects unrelated local history without losing its commit', () => {
    fixture.git(fixture.consumer, 'switch', '--orphan', 'unrelated');
    const local = fixture.commit(
      fixture.consumer,
      'unrelated.txt',
      'unrelated local commit'
    );
    fixture.git(fixture.consumer, 'branch', '-f', 'child', local);
    fixture.git(fixture.consumer, 'switch', 'child');
    fixture.git(fixture.consumer, 'branch', '-D', 'unrelated');
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).not.to.include('Synced child');
    fixture.assertTip('HEAD', local);
    fixture.assertTip('child', local);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'unrelated.txt'), 'utf8')
    ).to.equal('unrelated local commit');
  });

  for (const remoteAdvances of [false, true]) {
    it(`rejects a stale ${
      remoteAdvances ? 'fast-forward' : 'no-op'
    } assessment after a concurrent ref transaction`, () => {
      const head = remoteAdvances ? fixture.advanceChild() : fixture.oldChild;
      const hook = fixture.git(
        fixture.consumer,
        'rev-parse',
        '--git-path',
        'hooks/reference-transaction'
      );
      fs.writeFileSync(
        path.resolve(fixture.consumer, hook),
        `#!/bin/sh
if [ "$1" = committed ] && [ ! -f race-once ]; then
  touch race-once
  git -c core.hooksPath=/dev/null commit --allow-empty -m racing-before-apply
fi
`,
        { mode: 0o755 }
      );
      const result = fixture.run(['get', 'child']);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.output).to.include('changed while getting the stack');
      expect(result.output).not.to.include('Synced child');
      const local = fixture.git(fixture.consumer, 'rev-parse', 'child');
      expect(
        fixture.git(fixture.consumer, 'log', '-1', '--format=%s', 'child')
      ).to.equal('racing-before-apply');
      expect(fixture.git(fixture.consumer, 'merge-base', local, head)).to.equal(
        fixture.oldChild
      );
      fixture.assertTip('HEAD', local);
    });
  }

  it('preserves a concurrent local commit made by a checkout hook before applying the update', () => {
    const head = fixture.advanceChild();
    fixture.ok('down');
    const hook = fixture.git(
      fixture.consumer,
      'rev-parse',
      '--git-path',
      'hooks/post-checkout'
    );
    fs.writeFileSync(
      path.resolve(fixture.consumer, hook),
      `#!/bin/sh
if [ "$(git branch --show-current)" = child ]; then
  git -c core.hooksPath=/dev/null commit --allow-empty -m racing-local
fi
`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).not.to.include('Synced child');
    const local = fixture.git(fixture.consumer, 'rev-parse', 'child');
    expect(local).not.to.equal(fixture.oldChild);
    expect(local).not.to.equal(head);
    expect(
      fixture.git(fixture.consumer, 'log', '-1', '--format=%s', 'child')
    ).to.equal('racing-local');
    expect(fixture.git(fixture.consumer, 'merge-base', local, head)).to.equal(
      fixture.oldChild
    );
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    fixture.assertTip('HEAD', local);
  });

  it('does not claim success when a checkout hook advances the local tip beyond the fetched snapshot', () => {
    const head = fixture.advanceChild();
    fixture.ok('down');
    const hook = fixture.git(
      fixture.consumer,
      'rev-parse',
      '--git-path',
      'hooks/post-checkout'
    );
    fs.writeFileSync(
      path.resolve(fixture.consumer, hook),
      `#!/bin/sh
if [ "$(git branch --show-current)" = child ]; then
  git -c core.hooksPath=/dev/null fetch origin child
  git -c core.hooksPath=/dev/null merge --ff-only FETCH_HEAD
  git -c core.hooksPath=/dev/null commit --allow-empty -m racing-ahead
fi
`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).not.to.include('Synced child');
    const local = fixture.git(fixture.consumer, 'rev-parse', 'child');
    expect(fixture.git(fixture.consumer, 'log', '-1', '--format=%s')).to.equal(
      'racing-ahead'
    );
    expect(fixture.git(fixture.consumer, 'merge-base', local, head)).to.equal(
      head
    );
    fixture.assertTip('HEAD', local);
    fs.removeSync(path.resolve(fixture.consumer, hook));
    fixture.ok('down');
    fixture.ok('up');
    fixture.assertTip('HEAD', local);
  });

  it('reports a fetch failure and can retry without losing local branches', () => {
    fixture.advanceChild();
    fixture.git(
      fixture.consumer,
      'remote',
      'set-url',
      'origin',
      path.join(fixture.root, 'missing.git')
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.include('fetch');
    expect(result.output).not.to.include('Synced');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    fixture.git(
      fixture.consumer,
      'remote',
      'set-url',
      'origin',
      fixture.remote
    );
    fixture.ok('get', 'child');
  });

  it('reports a refused Git update without claiming the branch was synced', () => {
    const head = fixture.advanceChild();
    const lock = fixture.git(
      fixture.consumer,
      'rev-parse',
      '--git-path',
      'refs/heads/child.lock'
    );
    fs.writeFileSync(path.resolve(fixture.consumer, lock), 'test lock');
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.include('child.lock');
    expect(result.output).not.to.include('Synced child');
    fixture.assertTip('child', fixture.oldChild);
    expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(head);
    fs.removeSync(path.resolve(fixture.consumer, lock));
    const retry = fixture.run(['get', 'child']);
    // Git may have updated the index/tree before discovering the ref lock.
    if (fixture.git(fixture.consumer, 'status', '--porcelain')) {
      expect(retry.status, retry.output).not.to.equal(0);
      expect(retry.output).to.include('tracked changes');
    } else {
      expect(retry.status, retry.output).to.equal(0);
      fixture.assertTip('child', head);
    }
  });

  it('keeps the explicit force path working on a separate OLD to NEW consumer', () => {
    const head = fixture.advanceChild();
    fixture.assertTip('child', fixture.oldChild);
    fixture.ok('get', 'child', '--force');
    fixture.assertTip('child', head);
    fixture.assertTip('HEAD', head);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    fixture.ok('down');
    fixture.ok('up');
    fixture.assertTip('HEAD', head);
    expect(fixture.ok('get', 'child').output).to.include('child is up to date');
  });

  for (const staged of [false, true]) {
    it(`refuses an update with ${
      staged ? 'staged' : 'unstaged'
    } tracked work`, () => {
      fixture.advanceChild();
      fs.writeFileSync(path.join(fixture.consumer, 'main.txt'), 'local work');
      if (staged) fixture.git(fixture.consumer, 'add', 'main.txt');
      const status = fixture.git(fixture.consumer, 'status', '--porcelain');
      const index = fixture.git(fixture.consumer, 'write-tree');
      const result = fixture.run(['get', 'child']);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.output).to.include('tracked changes');
      fixture.assertTip('child', fixture.oldChild);
      expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal(
        status
      );
      expect(fixture.git(fixture.consumer, 'write-tree')).to.equal(index);
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'main.txt'), 'utf8')
      ).to.equal('local work');
    });
  }

  for (const interactive of [false, true]) {
    it(`updates an existing clean child without input (${
      interactive ? 'PTY' : 'non-interactive'
    })`, () => {
      const head = fixture.advanceChild();
      const result = fixture.run(['get', 'child'], interactive);
      expect(
        result.status,
        `OLD ${fixture.oldChild}; NEW ${head}\n${result.output}`
      ).to.equal(0);
      expect(result.output).not.to.match(
        /How would you like|Overwrite|Rebase your changes/
      );
      fixture.assertTip('child', head);
      fixture.assertTip('HEAD', head);
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
      ).to.equal('child-new');
      expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal(
        ''
      );
      expect(fixture.git(fixture.consumer, 'status')).not.to.include(
        'rebase in progress'
      );
      fixture.ok('down');
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('parent');
      fixture.ok('up');
      fixture.assertTip('HEAD', head);
      expect(fixture.ok('get', 'child').output).to.include('is up to date');
      expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(head);
    });
  }
});
