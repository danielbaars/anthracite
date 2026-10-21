import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const cliPath = path.resolve(__dirname, '../../src/index.js');

class WorktreeFixture {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-worktrees-'));
  readonly repo = path.join(this.root, 'repo');
  readonly linked = path.join(this.root, 'child worktree');
  readonly env = {
    ...process.env,
    HOME: this.root,
    XDG_CONFIG_HOME: this.root,
    GRAPHITE_USER_CONFIG_PATH: path.join(this.root, 'user-config'),
    GRAPHITE_PROFILE: '',
    GRAPHITE_DISABLE_TELEMETRY: '1',
    GRAPHITE_DISABLE_UPGRADE_PROMPT: '1',
    GRAPHITE_DISABLE_SURVEY: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_EDITOR: 'true',
    NO_COLOR: '1',
  };

  constructor() {
    fs.mkdirSync(this.repo);
    fs.writeJsonSync(this.env.GRAPHITE_USER_CONFIG_PATH, { tips: false });
    this.git(['init', '--initial-branch=main']);
    this.git(['config', 'user.name', 'Worktree Test']);
    this.git(['config', 'user.email', 'worktrees@example.invalid']);
    this.git(['init', '--bare', path.join(this.root, 'remote.git')]);
    this.git(['remote', 'add', 'origin', path.join(this.root, 'remote.git')]);
    this.commitFile('base', 'base');
    const commonDir = this.git(['rev-parse', '--git-common-dir']);
    fs.writeJsonSync(
      path.resolve(this.repo, commonDir, '.graphite_repo_config'),
      {
        trunk: 'main',
        isGithubIntegrationEnabled: false,
      }
    );
    this.git(['switch', '-c', 'parent']);
    this.commitFile('parent', 'parent');
    this.ok(['track', '--parent', 'main']);
    this.git(['switch', '-c', 'child']);
    this.commitFile('child', 'child');
    this.ok(['track', '--parent', 'parent']);
    this.git(['switch', 'parent']);
  }

  git(args: string[], cwd = this.repo): string {
    return execFileSync('git', args, {
      cwd,
      env: this.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  commitFile(name: string, content: string): void {
    fs.writeFileSync(path.join(this.repo, name), content);
    this.git(['add', name]);
    this.git(['commit', '-m', name]);
  }

  run(args: string[], cwd = this.repo) {
    const nativeBinary = process.env.CHARCOAL_TEST_BINARY;
    return spawnSync(
      nativeBinary ?? process.execPath,
      [...(nativeBinary ? [] : [cliPath]), ...args, '--no-interactive'],
      { cwd, env: this.env, encoding: 'utf8', timeout: 15000 }
    );
  }

  ok(args: string[], cwd = this.repo): void {
    const result = this.run(args, cwd);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
  }

  snapshot(cwd = this.repo) {
    return {
      head: this.git(['rev-parse', 'HEAD'], cwd),
      refs: this.git(['show-ref', '--heads'], cwd),
      status: this.git(['status', '--porcelain=v1'], cwd),
      staged: this.git(['diff', '--cached', '--binary'], cwd),
      unstaged: this.git(['diff', '--binary'], cwd),
      files: Object.fromEntries(
        ['base', 'parent', 'child'].map((file) => [
          file,
          fs.existsSync(path.join(cwd, file))
            ? fs.readFileSync(path.join(cwd, file), 'utf8')
            : undefined,
        ])
      ),
    };
  }

  assertNoRebase(cwd = this.repo): void {
    for (const state of ['rebase-merge', 'rebase-apply']) {
      const statePath = this.git(['rev-parse', '--git-path', state], cwd);
      expect(fs.existsSync(path.resolve(cwd, statePath))).to.equal(false);
    }
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

describe('modify worktree protection through the CLI', function () {
  this.timeout(60000);
  let fixture: WorktreeFixture;

  beforeEach(() => {
    fixture = new WorktreeFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const options of [
    ['--commit', '-m', 'new parent'],
    ['--all', '-m', 'amended parent'],
    ['--commit', '--all', '-m', 'new parent'],
  ]) {
    it(`preserves both indexes and trees before modify ${options.join(
      ' '
    )}`, () => {
      fixture.git(['worktree', 'add', fixture.linked, 'child']);
      fs.writeFileSync(path.join(fixture.repo, 'parent'), 'staged edit');
      fixture.git(['add', 'parent']);
      fs.writeFileSync(
        path.join(fixture.repo, 'parent'),
        'additional unstaged edit'
      );
      fs.writeFileSync(path.join(fixture.repo, 'base'), 'unstaged base edit');
      fs.writeFileSync(path.join(fixture.linked, 'child'), 'staged child edit');
      fixture.git(['add', 'child'], fixture.linked);
      fs.writeFileSync(
        path.join(fixture.linked, 'child'),
        'unstaged child edit'
      );
      const parentBefore = fixture.snapshot();
      const childBefore = fixture.snapshot(fixture.linked);

      const result = fixture.run(['modify', ...options]);

      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(parentBefore);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(childBefore);
      expect(result.stdout + result.stderr)
        .to.include('child')
        .and.include(fixture.linked);
      fixture.assertNoRebase();
      fixture.assertNoRebase(fixture.linked);
      fixture.ok(['log', 'short', '--stack']);
    });
  }

  it('allows a no-op restack when an already aligned child is active elsewhere', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    const parentBefore = fixture.snapshot();
    const childBefore = fixture.snapshot(fixture.linked);

    fixture.ok(['restack', '--upstack']);

    expect(fixture.snapshot()).to.deep.equal(parentBefore);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(childBefore);
    fixture.ok(['down']);
    fixture.ok(['up']);
  });

  it('detects a checked-out grandchild before restacking its currently aligned parent', () => {
    fixture.git(['switch', 'child']);
    fixture.git(['switch', '-c', 'grandchild']);
    fixture.commitFile('grandchild', 'grandchild');
    fixture.ok(['track', '--parent', 'child']);
    fixture.git(['switch', 'parent']);
    fixture.git(['worktree', 'add', fixture.linked, 'grandchild']);
    fixture.commitFile('extra', 'new parent commit');
    const parentBefore = fixture.snapshot();
    const otherBefore = fixture.snapshot(fixture.linked);

    const result = fixture.run(['restack', '--upstack']);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('grandchild')
      .and.include(fixture.linked);
    expect(fixture.snapshot()).to.deep.equal(parentBefore);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(otherBefore);
    fixture.assertNoRebase();
    fixture.assertNoRebase(fixture.linked);
  });

  for (const commit of [false, true]) {
    it(`restacks after ${
      commit ? 'a new commit' : 'an amend'
    } from the current linked worktree`, () => {
      fixture.git(['switch', 'main']);
      fixture.git(['worktree', 'add', fixture.linked, 'parent']);
      const mainBefore = fixture.snapshot();
      const childBefore = fixture.git(['rev-parse', 'child']);
      fs.writeFileSync(path.join(fixture.linked, 'parent'), 'modified parent');

      fixture.ok(
        [
          'modify',
          '--all',
          ...(commit ? ['--commit'] : []),
          '-m',
          'updated parent',
        ],
        fixture.linked
      );

      const parentAfter = fixture.git(['rev-parse', 'parent']);
      expect(fixture.git(['rev-parse', 'child'])).not.to.equal(childBefore);
      expect(fixture.git(['merge-base', 'parent', 'child'])).to.equal(
        parentAfter
      );
      expect(fixture.git(['show', 'child:parent'])).to.equal('modified parent');
      expect(fixture.git(['status', '--porcelain'], fixture.linked)).to.equal(
        ''
      );
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal('parent');
      expect(fixture.snapshot().head).to.equal(mainBefore.head);
      expect(fixture.snapshot().files).to.deep.equal(mainBefore.files);
      expect(fixture.snapshot().status).to.equal(mainBefore.status);
      fixture.ok(['up'], fixture.linked);
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal('child');
      fixture.ok(['down'], fixture.linked);
      fixture.ok(['restack', '--upstack'], fixture.linked);
      fixture.assertNoRebase(fixture.linked);
    });
  }

  it('refuses manual restack before trying a branch checked out elsewhere', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.commitFile('extra', 'new parent commit');
    const parentBefore = fixture.snapshot();
    const childBefore = fixture.snapshot(fixture.linked);

    const result = fixture.run(['restack', '--upstack']);

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('child')
      .and.include(fixture.linked);
    expect(result.stdout + result.stderr).to.match(/switch|detach|remove/i);
    expect(result.stdout + result.stderr).not.to.include('git rebase --onto');
    expect(fixture.snapshot()).to.deep.equal(parentBefore);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(childBefore);
    fixture.assertNoRebase();
    fixture.assertNoRebase(fixture.linked);
    fixture.ok(['down']);
    fixture.ok(['up']);
  });

  it('refuses an amend before changing the parent when a child is active elsewhere', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'parent'), 'staged parent edit');
    fixture.git(['add', 'parent']);
    fs.writeFileSync(path.join(fixture.linked, 'child'), 'child local edit');
    const parentBefore = fixture.snapshot();
    const childBefore = fixture.snapshot(fixture.linked);

    const result = fixture.run(['modify', '-m', 'amended parent']);

    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(parentBefore);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(childBefore);
    expect(result.stdout + result.stderr)
      .to.include('child')
      .and.include(fixture.linked);
    expect(result.stdout + result.stderr).to.match(/switch|detach|remove/i);
    fixture.assertNoRebase();
    fixture.assertNoRebase(fixture.linked);
    fixture.git(['stash', 'push']);
    fixture.ok(['down']);
    fixture.ok(['up']);
    fixture.git(['stash', 'pop', '--index']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('parent');
    expect(fixture.snapshot()).to.deep.equal(parentBefore);
  });
});
