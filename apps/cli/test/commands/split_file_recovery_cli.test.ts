import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

function setupConflict(fixture: RelationCliFixture): void {
  fixture.git(['switch', 'base']);
  fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected\n');
  fixture.git(['add', 'selected.txt']);
  fixture.git(['commit', '-m', 'Select prerequisite']);
  fixture.ok(['restack', '--upstack']);
  fixture.git(['switch', 'child']);
  fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child\n');
  fixture.git(['add', 'main.txt']);
  fixture.git(['commit', '-m', 'Child overlaps future source']);
  fixture.ok(['restack', '--upstack']);
  fixture.git(['switch', 'base']);
  fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'source\n');
  fixture.git(['add', 'main.txt']);
  fixture.git(['commit', '-m', 'Advance source without restacking']);
  fixture.env.GIT_EDITOR = 'true';
}

function setupPlain(fixture: RelationCliFixture): void {
  fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected\n');
  fixture.git(['add', 'selected.txt']);
  fixture.git(['commit', '-m', 'Select prerequisite']);
}

function hook(
  fixture: RelationCliFixture,
  name: string,
  contents: string
): void {
  fs.writeFileSync(
    path.join(fixture.repo, '.git', 'hooks', name),
    `#!/bin/sh\n${contents}\n`,
    { mode: 0o755 }
  );
}

// eslint-disable-next-line max-lines-per-function
describe('file split recovery through real public processes', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let retained: string[];
  beforeEach(() => {
    fixture = new RelationCliFixture();
    retained = [];
  });
  afterEach(() => {
    for (const root of retained) {
      const worktree = path.join(root, 'worktree');
      if (fs.existsSync(path.join(worktree, '.git')))
        fixture.git(['worktree', 'remove', '--force', worktree]);
      fs.rmSync(root, { recursive: true, force: true });
    }
    fixture?.cleanup();
  });

  it('continues a genuine stale child conflict without extracting twice', () => {
    setupConflict(fixture);
    const oldChild = fixture.git(['rev-parse', 'child']);
    const unrelated = fixture.git(['rev-parse', 'other']);
    const sourceTree = fixture.git(['rev-parse', 'base^{tree}']);
    const result = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    const output = result.stdout + result.stderr;
    expect(result.status, output).to.equal(1);
    expect(output).to.include('File split is incomplete');
    expect(output).to.include('descendant replay');
    expect(output).to.include('run an continue');
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(oldChild);
    const parent = fixture.git(['rev-parse', 'base_split']);
    const source = fixture.git(['rev-parse', 'base']);
    expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(sourceTree);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'source plus child\n'
    );
    fixture.git(['add', 'main.txt']);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'base_split'])).to.equal(parent);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(fixture.git(['show', 'child:main.txt'])).to.equal(
      'source plus child'
    );
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal('source plus child');
    expect(
      fixture.git(['merge-base', '--is-ancestor', 'base', 'tip'])
    ).to.equal('');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(unrelated);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.gtcontinue'))
    ).to.equal(false);
  });

  it('refuses an occupied pending worktree before continue --all changes a resolution', () => {
    setupConflict(fixture);
    const start = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(start.status, start.stdout + start.stderr).to.equal(1);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'staged resolution\n'
    );
    fixture.git(['add', 'main.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'portable.txt'),
      'untracked work\n'
    );
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'tip']);
    fs.writeFileSync(path.join(linked, 'tip.txt'), 'linked local work\n');
    const before = fixture.inspectionSnapshot();
    const linkedBefore = fixture.inspectionSnapshot(linked);
    const refused = fixture.run(['continue', '--all']);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
    expect(refused.stderr).to.include('checked out in worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(linkedBefore);
    fixture.git(['worktree', 'remove', '--force', linked]);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal('staged resolution');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'portable.txt'), 'utf8')
    ).to.equal('untracked work\n');
  });

  it('refuses changed expected refs before staging or changing recovery', () => {
    setupConflict(fixture);
    const start = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(start.status, start.stdout + start.stderr).to.equal(1);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'staged resolution\n'
    );
    fixture.git(['add', 'main.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'portable.txt'),
      'untracked work\n'
    );
    const original = fixture.git(['rev-parse', 'base']);
    fixture.git(['update-ref', 'refs/heads/base', 'other']);
    const before = fixture.inspectionSnapshot();
    const refused = fixture.run(['continue', '--all']);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
    expect(refused.stderr).to.include('Expected file-split ref base changed');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['update-ref', 'refs/heads/base', original]);
    fixture.ok(['continue']);
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal('staged resolution');
  });

  it('preserves staged resolution and recovery when an active participant is frozen', () => {
    setupConflict(fixture);
    expect(
      fixture.run(['split', '-f', 'selected.txt', '--no-interactive']).status
    ).to.equal(1);
    fixture.ok(['freeze', 'child']);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'frozen staged resolution\n'
    );
    fixture.git(['add', 'main.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'portable.txt'),
      'untracked work\n'
    );
    const before = fixture.inspectionSnapshot();
    const refused = fixture.run(['continue', '--all']);
    expect(refused.status).to.equal(1);
    expect(refused.stderr).to.include('an unfreeze child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.ok(['unfreeze', 'child']);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
      'frozen staged resolution'
    );
  });

  it('retains ignored hook work after a construction failure and honors no-verify', () => {
    setupPlain(fixture);
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nhook-work.tmp\n'
    );
    hook(
      fixture,
      'pre-commit',
      'printf "retained hook work" > hook-work.tmp\nexit 23'
    );
    const refs = fixture.refs();
    const index = fixture.index();
    const failed = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(failed.status).to.equal(1);
    expect(failed.stderr).to.include('construction failed before extraction');
    const location = failed.stderr.match(
      /retained at (.+)\. Inspect current refs/
    )?.[1];
    if (!location) throw new Error(failed.stderr);
    retained.push(location);
    expect(
      fs.readFileSync(path.join(location, 'worktree', 'hook-work.tmp'), 'utf8')
    ).to.equal('retained hook work');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.index()).to.equal(index);
    fixture.ok(['split', '-f', 'selected.txt', '--no-verify']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('refuses a hook-mutated prepared tree and retains its actual content', () => {
    setupPlain(fixture);
    hook(
      fixture,
      'pre-commit',
      'printf "hook mutation" > selected.txt\ngit add selected.txt'
    );
    const before = fixture.refs();
    const failed = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(failed.status).to.equal(1);
    expect(failed.stderr).to.include('hook changed the prepared tree');
    const location = failed.stderr.match(
      /retained at (.+)\. Inspect current refs/
    )?.[1];
    if (!location) throw new Error(failed.stderr);
    retained.push(location);
    expect(
      fs.readFileSync(path.join(location, 'worktree', 'selected.txt'), 'utf8')
    ).to.equal('hook mutation');
    expect(fixture.refs()).to.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'selected.txt'), 'utf8')
    ).to.equal('selected\n');
  });

  it('reports explicit remaining retries when a replay hook fails without a rebase', () => {
    setupPlain(fixture);
    hook(
      fixture,
      'pre-rebase',
      'printf "replay hook work" > replay-hook.txt\nexit 29'
    );
    const failed = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-verify',
      '--no-interactive',
    ]);
    const output = failed.stdout + failed.stderr;
    expect(failed.status, output).to.equal(1);
    expect(output).to.include('File split is incomplete (descendant replay)');
    expect(output).to.include('Active replay: none');
    expect(output).to.include("an restack --branch 'child' --only");
    expect(output).to.include("an restack --branch 'tip' --only");
    expect(output).not.to.include('Resolve the conflict, git add');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'replay-hook.txt'), 'utf8')
    ).to.equal('replay hook work');
    const parent = fixture.git(['rev-parse', 'base_split']);
    const source = fixture.git(['rev-parse', 'base']);
    fs.unlinkSync(path.join(fixture.repo, '.git', 'hooks', 'pre-rebase'));
    fixture.ok(['restack', '--branch', 'child', '--only']);
    fixture.ok(['restack', '--branch', 'tip', '--only']);
    fixture.ok(['checkout', 'base']);
    expect(fixture.git(['rev-parse', 'base_split'])).to.equal(parent);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(
      fixture.git(['merge-base', '--is-ancestor', 'base', 'tip'])
    ).to.equal('');
  });

  it('retains a foreign Git lock left by a successful hook before publication', () => {
    setupPlain(fixture);
    hook(
      fixture,
      'post-commit',
      'printf "owned by hook" > "$(git rev-parse --git-path foreign.lock)"'
    );
    const before = fixture.refs();
    const failed = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    expect(failed.status).to.equal(1);
    expect(failed.stderr).to.include('Git lock remains');
    const location = failed.stderr.match(
      /retained at (.+)\. Inspect current refs/
    )?.[1];
    if (!location) throw new Error(failed.stderr);
    retained.push(location);
    const gitPath = fixture.git(
      ['rev-parse', '--git-path', 'foreign.lock'],
      path.join(location, 'worktree')
    );
    expect(
      fs.readFileSync(path.resolve(location, 'worktree', gitPath), 'utf8')
    ).to.equal('owned by hook');
    expect(fixture.refs()).to.equal(before);
  });

  it('accepts the valid empty continuation left by an ordinary legacy recovery', () => {
    setupConflict(fixture);
    expect(fixture.run(['restack', '--upstack']).status).to.equal(1);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'ordinary resolution\n'
    );
    fixture.git(['add', 'main.txt']);
    fixture.ok(['continue']);
    const legacy = path.join(fixture.repo, '.git', '.gtcontinue');
    expect(JSON.parse(fs.readFileSync(legacy, 'utf8'))).to.deep.equal({
      branchesToSync: [],
      branchesToRestack: [],
    });
    fixture.ok(['split', '-f', 'selected.txt']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
      'ordinary resolution'
    );
  });

  it('reports actual saved refs when extraction publication is rejected', () => {
    setupPlain(fixture);
    const source = fixture.git(['rev-parse', 'base']);
    hook(
      fixture,
      'reference-transaction',
      '[ "$1" = prepared ] || exit 0\ninput=$(cat)\ncase "$input" in *refs/heads/base_split*) echo "reject extraction" >&2; exit 31;; esac'
    );
    const failed = fixture.run([
      'split',
      '-f',
      'selected.txt',
      '--no-interactive',
    ]);
    const output = failed.stdout + failed.stderr;
    expect(failed.status, output).to.equal(1);
    expect(output).to.include('extraction publication failed');
    expect(output).to.include(`Saved branch: base; ref: ${source}`);
    expect(output).to.include('Saved branch: base_split; ref: missing');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(fixture.git(['branch', '--list', 'base_split'])).to.equal('');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });
});
