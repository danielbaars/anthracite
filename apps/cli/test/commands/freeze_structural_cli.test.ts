import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';

function recovery(fixture: FreezeCliFixture): unknown {
  const files: Record<string, string> = {};
  const visit = (name: string): void => {
    const file = path.join(fixture.repo, '.git', name);
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const child of fs.readdirSync(file)) visit(path.join(name, child));
    } else files[name] = fs.readFileSync(file).toString('base64');
  };
  for (const name of [
    '.gtcontinue',
    '.graphite_pr_info',
    'rebase-merge',
    'rebase-apply',
  ])
    visit(name);
  return files;
}

function moveConflict(fixture: FreezeCliFixture): void {
  fixture.branch('z-sibling', 'base');
  fixture.git(['switch', 'child']);
  fixture.stage('main.txt', 'child change');
  fixture.git(['commit', '-m', 'child change']);
  fixture.ok(['restack', '--upstack']);
  fixture.git(['switch', 'other']);
  fixture.stage('main.txt', 'destination change');
  fixture.git(['commit', '-m', 'destination change']);
  fixture.git(['switch', 'base']);
  expect(fixture.run(['move', '--onto', 'other']).status).to.equal(1);
  expect(
    fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
  ).to.equal(true);
}

// eslint-disable-next-line max-lines-per-function
describe('frozen structural participants through the public CLI', function () {
  this.timeout(60000);
  let fixture: FreezeCliFixture;
  beforeEach(() => {
    fixture = new FreezeCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('refuses an explicit frozen move source even when its parent is already the destination', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.observe();
    const result = fixture.run(['move', '--source', 'base', '--onto', 'main']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses insertion before staging or branch creation when an existing child is frozen', () => {
    fixture.ok(['freeze', 'child']);
    fixture.write('new-work.txt', 'unstaged insertion work');
    const before = fixture.observe();
    const result = fixture.run([
      'create',
      'inserted',
      '--insert',
      '--all',
      '-m',
      'insert',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('rechecks insertion children after the commit hook and retains the created commit without changing their parents', () => {
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'post-commit'),
      `#!/bin/sh\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n`,
      { mode: 0o755 }
    );
    const child = fixture.git(['rev-parse', 'child']);
    fixture.stage('insert-work.txt', 'created work');
    const result = fixture.run([
      'c',
      'inserted',
      '--insert',
      '-m',
      'inserted commit',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['show', 'inserted:insert-work.txt'])).to.equal(
      'created work'
    );
    expect(fixture.ok(['info', 'child'])).to.include('Parent: base');
  });

  it('refuses ordinary fold when its surviving parent is frozen', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'child']);
    const before = fixture.observe();
    const result = fixture.run(['fold']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses stack fold when a downstack contributor is frozen', () => {
    fixture.ok(['freeze', 'child']);
    const before = fixture.observe();
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses ordinary reorder on an explicit frozen source before opening its editor', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.observe();
    const result = fixture.run(['ro', '--interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses an ordinary reorder plan before a frozen ancestor changes parent', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'tip']);
    const input = path.join(fixture.root, 'order');
    fs.writeFileSync(input, 'tip\nbase\nchild\n');
    const before = fixture.observe();
    const result = fixture.run(['reorder', '--input', input]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses a stack reorder plan before a frozen mandatory ancestor changes parent', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'tip']);
    const input = path.join(fixture.root, 'order');
    fs.writeFileSync(input, 'tip\nbase\nchild\n');
    const before = fixture.observe();
    const result = fixture.run(['ro', '--stack', '--input', input]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses a newly frozen later move participant before continue all stages a resolution and resumes after unfreeze', () => {
    fixture.branch('z-sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.stage('main.txt', 'child change');
    fixture.git(['commit', '-m', 'child change']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'destination change');
    fixture.git(['commit', '-m', 'destination change']);
    fixture.git(['switch', 'base']);
    const oldBase = fixture.git(['rev-parse', 'base']);
    const start = fixture.run(['move', '--onto', 'other']);
    expect(start.status).to.equal(1);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(true);
    const base = fixture.git(['rev-parse', 'base']);
    expect(base).not.to.equal(oldBase);
    fixture.ok(['freeze', 'z-sibling']);
    fixture.write('main.txt', 'resolved child');
    fixture.write('untracked.txt', 'preserve untracked');
    const before = fixture.observe();
    const saved = recovery(fixture);
    const result = fixture.run(['continue', '--all']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze z-sibling');
    expect(result.stdout + result.stderr).to.include(
      'Completed branches: base'
    );
    expect(fixture.observe()).to.deep.equal(before);
    expect(recovery(fixture)).to.deep.equal(saved);
    fixture.ok(['unfreeze', 'z-sibling']);
    fixture.ok(['cont', '--all']);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(false);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['show', 'child:main.txt'])).to.equal('resolved child');
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.git(['rev-parse', 'z-sibling^'])).to.equal(base);
    expect(fixture.git(['show', 'child:untracked.txt'])).to.equal(
      'preserve untracked'
    );
  });

  it('preserves every editable child when ordinary fold reparents multiple children', () => {
    fixture.branch('z-child', 'child');
    fixture.git(['switch', 'child']);
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    const sibling = fixture.git(['rev-parse', 'z-child']);
    fixture.ok(['fold']);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.git(['rev-parse', 'z-child'])).to.equal(sibling);
    expect(fixture.ok(['info', 'tip'])).to.include('Parent: base');
    expect(fixture.ok(['info', 'z-child'])).to.include('Parent: base');
    expect(fixture.git(['show', 'z-child:child.txt'])).to.equal('child');
  });

  it('checks a later mandatory participant frozen by the continuation commit hook before publishing the active commit', () => {
    moveConflict(fixture);
    fixture.stage('main.txt', 'hook resolution');
    const head = fixture.git(['rev-parse', 'HEAD']);
    const child = fixture.git(['rev-parse', 'child']);
    const sibling = fixture.git(['rev-parse', 'z-sibling']);
    const cli = getTestCliCommand(['freeze', 'z-sibling', '--no-interactive']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'prepare-commit-msg');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nprintf 'hook work' > hook-work.txt\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['cont']);
    expect(result.status).to.equal(1);
    expect(result.stdout + result.stderr).to.include('ch unfreeze z-sibling');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'z-sibling'])).to.equal(sibling);
    expect(fixture.git(['show', ':main.txt'])).to.equal('hook resolution');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(true);
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'z-sibling']);
    fixture.ok(['continue']);
    expect(fixture.git(['show', 'child:main.txt'])).to.equal('hook resolution');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
  });

  it('rechecks the entire remaining move plan after a pre-rebase hook freezes a later sibling', () => {
    fixture.branch('z-sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.env.GIT_COMMITTER_DATE = '2030-01-01T00:00:00Z';
    fixture.git(['commit', '--amend', '--no-edit']);
    delete fixture.env.GIT_COMMITTER_DATE;
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const base = fixture.git(['rev-parse', 'base']);
    const cli = getTestCliCommand(['freeze', 'z-sibling', '--no-interactive']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-rebase'),
      `#!/bin/sh\nif [ "$2" = child ]; then\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['move', '-o', 'other']);
    expect(result.status).to.equal(1);
    expect(result.stdout + result.stderr).to.include('ch unfreeze z-sibling');
    expect(result.stdout + result.stderr).to.include(
      'Completed branches: base'
    );
    expect(fixture.git(['rev-parse', 'base'])).not.to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(false);
    expect(fixture.ok(['info', 'z-sibling'])).to.include('(frozen)');
  });

  it('rechecks stack fold contributors after checkout hooks before publishing or removing selected refs', () => {
    const refs = fixture.refs();
    const cli = getTestCliCommand(['freeze', 'base', '--no-interactive']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\nprintf 'checkout hook work' > hook-work.txt\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(result.stdout + result.stderr).to.include(
      'Selected refs were not published'
    );
    expect(fixture.refs()).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('checkout hook work');
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
  });

  it('rechecks move participants after a metadata transaction hook before installing the first parent change', () => {
    const refs = fixture.refs();
    const cli = getTestCliCommand(['freeze', 'base', '--no-interactive']);
    const marker = path.join(fixture.root, 'once');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\ninput=$(cat)\nif [ "$1" = prepared ] && [ ! -f '${marker}' ]; then\ncase "$input" in\n*refs/branch-metadata/child*)\n: > '${marker}'\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n;;\nesac\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['move', '-o', 'other', '--only']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.ok(['info', 'child'])).to.include('Parent: base');
    expect(fixture.ok(['info', 'base'])).to.include('Parent: main');
  });

  it('rechecks insertion after checkout hooks before all stages or commits newly protected child work', () => {
    const base = fixture.git(['rev-parse', 'base']);
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    const savedIndex = path.join(fixture.root, 'index-after-hook');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\ncp .git/index '${savedIndex}'\n`,
      { mode: 0o755 }
    );
    fixture.write('new-work.txt', 'unstaged insertion work');
    const result = fixture.run([
      'c',
      'inserted',
      '-i',
      '-a',
      '-m',
      'blocked insert commit',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(base);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
    ).to.deep.equal(fs.readFileSync(savedIndex));
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'new-work.txt'), 'utf8')
    ).to.equal('unstaged insertion work');
    expect(fixture.ok(['info', 'child'])).to.include('Parent: base');
  });

  for (const onto of [false, true])
    it(`refreshes initially empty insertion replay participants after checkout hooks stage work with onto=${onto}`, () => {
      fixture.ok(['freeze', 'tip']);
      if (onto) fixture.git(['switch', 'other']);
      const base = fixture.git(['rev-parse', 'base']);
      const heads = ['child', 'tip', 'other'].map((branch) =>
        fixture.git(['rev-parse', branch])
      );
      const savedIndex = path.join(fixture.root, 'hook-index');
      const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
      fs.writeFileSync(
        hook,
        `#!/bin/sh
printf 'staged checkout work' > hook-selected.txt
git add hook-selected.txt
cp .git/index '${savedIndex}'
`,
        { mode: 0o755 }
      );
      const result = fixture.run([
        'create', 'inserted', '--insert', '-m', 'hook selected commit',
        ...(onto ? ['--onto', 'base'] : []),
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('ch unfreeze tip');
      expect(fixture.git(['rev-parse', 'inserted'])).to.equal(base);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(['child', 'tip', 'other'].map((branch) =>
        fixture.git(['rev-parse', branch])
      )).to.deep.equal(heads);
      expect(fs.readFileSync(path.join(fixture.repo, '.git', 'index')))
        .to.deep.equal(fs.readFileSync(savedIndex));
      expect(fixture.git(['show', ':hook-selected.txt'])).to.equal('staged checkout work');
      expect(fs.readFileSync(path.join(fixture.repo, 'hook-selected.txt'), 'utf8'))
        .to.equal('staged checkout work');
      expect(fixture.ok(['info', 'child'])).to.include('Parent: base');
      expect(fixture.ok(['info', 'tip'])).to.include('Parent: child').and.include('(frozen)');
      expect(fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))).to.equal(false);
      expect(fs.existsSync(path.join(fixture.repo, '.git', '.gtcontinue'))).to.equal(false);
    });

  it('checks existing insertion participants after the commit editor before publishing the new commit', () => {
    const base = fixture.git(['rev-parse', 'base']);
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    const editor = path.join(fixture.root, 'editor');
    fs.writeFileSync(
      editor,
      `#!/bin/sh\nprintf 'insert editor commit' > "$1"\nprintf 'editor work' > editor-work.txt\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n`,
      { mode: 0o755 }
    );
    fixture.env.GIT_EDITOR = editor;
    fixture.stage('new-work.txt', 'selected insertion work');
    const result = fixture.run([
      'c',
      'inserted',
      '-i',
      '--interactive',
      '--no-verify',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(base);
    expect(fixture.git(['show', ':new-work.txt'])).to.equal(
      'selected insertion work'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'editor-work.txt'), 'utf8')
    ).to.equal('editor work');
    expect(fixture.ok(['info', 'child'])).to.include('Parent: base');
  });

  it('reports and retains an ordinary fold ref already changed before a checkout hook freezes its survivor', () => {
    fixture.git(['switch', 'child']);
    const child = fixture.git(['rev-parse', 'child']);
    const cli = getTestCliCommand(['freeze', 'base', '--no-interactive']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nprintf 'late fold work' > hook-work.txt\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['fold']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze base');
    expect(result.stdout + result.stderr).to.include(
      'completed ref and parent writes remain'
    );
    expect(fixture.git(['rev-parse', 'base'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('late fold work');
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'base']);
    fixture.ok(['checkout', 'child']);
    fixture.ok(['fold']);
    expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(child);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('late fold work');
  });
  it('rechecks a stack reorder source frozen by its external editor before any parent write', () => {
    fixture.git(['switch', 'tip']);
    const refs = fixture.refs();
    const cli = getTestCliCommand(['freeze', 'tip', '--no-interactive']);
    const editor = path.join(fixture.root, 'editor');
    fs.writeFileSync(
      editor,
      `#!/bin/sh\nprintf 'tip\\nbase\\nchild\\n' > "$1"\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n`,
      { mode: 0o755 }
    );
    fixture.env.GIT_EDITOR = editor;
    const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
    const result = fixture.run(['ro', '--stack', '--interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze tip');
    expect(fixture.refs()).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
    ).to.deep.equal(index);
    expect(fixture.ok(['info', 'base'])).to.include('Parent: main');
  });
  it('guards a mandatory parent-name change even when every selected tip is identical', () => {
    fixture.ok(['c', 'empty-a', '-o', 'main']);
    fixture.ok(['c', 'empty-b']);
    fixture.ok(['c', 'empty-c']);
    const input = path.join(fixture.root, 'empty-order');
    fs.writeFileSync(input, 'empty-c\nempty-a\nempty-b\n');
    const parent = fixture.git(['rev-parse', 'refs/branch-metadata/empty-b']);
    const refs = fixture.refs();
    const cli = getTestCliCommand(['freeze', 'empty-a', '--no-interactive']);
    const marker = path.join(fixture.root, 'once');
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      `#!/bin/sh\ninput=$(cat)\nif [ "$1" = prepared ] && [ ! -f '${marker}' ]; then\ncase "$input" in\n*refs/branch-metadata/empty-b*)\n: > '${marker}'\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n;;\nesac\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['reorder', '--input', input]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze empty-a');
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/empty-b'])).to.equal(
      parent
    );
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.ok(['info', 'empty-b'])).to.include('Parent: empty-a');
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'empty-a']);
    fixture.ok(['ro', '--input', input]);
    expect(fixture.ok(['info', 'empty-b'])).to.include('Parent: main');
    expect(fixture.ok(['info', 'empty-a'])).to.include('Parent: empty-b');
    expect(fixture.ok(['info', 'empty-c'])).to.include('Parent: empty-a');
    expect(fixture.refs()).to.equal(refs);
  });

  it('protects a remaining DELETE survivor through the same real pre-rebase hook boundary', () => {
    fixture.branch('z-sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.env.GIT_COMMITTER_DATE = '2030-01-01T00:00:00Z';
    fixture.git(['commit', '--amend', '--no-edit']);
    delete fixture.env.GIT_COMMITTER_DATE;
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const sibling = fixture.git(['rev-parse', 'z-sibling']);
    const cli = getTestCliCommand(['freeze', 'z-sibling', '--no-interactive']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-rebase');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nif [ "$2" = child ]; then\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['delete', 'base', '--force']);
    expect(result.status).to.equal(1);
    expect(result.stdout + result.stderr).to.include('ch unfreeze z-sibling');
    expect(result.stdout + result.stderr).to.include('already been deleted');
    expect(fixture.git(['branch', '--list', 'base'])).to.equal('');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'z-sibling'])).to.equal(sibling);
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'z-sibling']);
    fixture.ok(['restack', '--branch', 'child']);
    fixture.ok(['restack', '--branch', 'z-sibling']);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['rev-parse', 'z-sibling^'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'z-sibling:z-sibling.txt'])).to.equal(
      'z-sibling'
    );
  });

  it('retains an actual completed move rewrite and blocks metadata publication after a post-rewrite hook freezes remaining work', () => {
    fixture.branch('z-sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.env.GIT_COMMITTER_DATE = '2030-01-01T00:00:00Z';
    fixture.git(['commit', '--amend', '--no-edit']);
    delete fixture.env.GIT_COMMITTER_DATE;
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/child']);
    const cli = getTestCliCommand(['freeze', 'z-sibling', '--no-interactive']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-rewrite');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\ninput=$(cat)\ncase "$input" in\n*${child}*)\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n;;\nesac\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['move', '-o', 'other']);
    expect(result.status).to.equal(1);
    expect(result.stdout + result.stderr).to.include('ch unfreeze z-sibling');
    const completed = fixture.git(['rev-parse', 'child']);
    expect(completed).not.to.equal(child);
    expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'child:other.txt'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
      metadata
    );
    expect(result.stdout + result.stderr).to.include(
      'Rewrite of child completed, but metadata publication failed'
    );
    expect(result.stdout + result.stderr).to.include(
      'Completed branches: base, child'
    );
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'z-sibling']);
    fixture.ok(['track', 'child', '--parent', 'base']);
    fixture.ok(['restack', '--branch', 'tip']);
    fixture.ok(['restack', '--branch', 'z-sibling']);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completed);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(completed);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
  });

  it('guards local DELETE parent metadata after a prepared hook freezes another survivor while still allowing a frozen target', () => {
    fixture.branch('z-sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.env.GIT_COMMITTER_DATE = '2030-01-01T00:00:00Z';
    fixture.git(['commit', '--amend', '--no-edit']);
    delete fixture.env.GIT_COMMITTER_DATE;
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    fixture.ok(['freeze', 'base']);
    const refs = fixture.refs();
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/child']);
    const cli = getTestCliCommand(['freeze', 'z-sibling', '--no-interactive']);
    const marker = path.join(fixture.root, 'once');
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      `#!/bin/sh\ninput=$(cat)\nif [ "$1" = prepared ] && [ ! -f '${marker}' ]; then\ncase "$input" in\n*refs/branch-metadata/child*)\n: > '${marker}'\n${cli
        .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(' ')}\n;;\nesac\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['delete', 'base', '--force']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze z-sibling');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
      metadata
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.ok(['info', 'child'])).to.include('Parent: base');
    expect(fixture.ok(['info', 'base'])).to.include('(frozen)');
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'z-sibling']);
    fixture.ok(['delete', 'base', '--force']);
    expect(fixture.git(['branch', '--list', 'base'])).to.equal('');
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['rev-parse', 'z-sibling^'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
  });
  for (const command of ['fold', 'reorder'])
    it(`${command} refuses a new ordinary structural plan before changing an existing replay or recovery ownership`, () => {
      moveConflict(fixture);
      const input = path.join(fixture.root, 'unrelated-order');
      fs.writeFileSync(input, 'base\n');
      const before = fixture.observe();
      const saved = recovery(fixture);
      const result = fixture.run(
        command === 'fold' ? ['fold', '--keep'] : ['ro', '--input', input]
      );
      expect(result.status).to.equal(1);
      expect(fixture.observe()).to.deep.equal(before);
      expect(recovery(fixture)).to.deep.equal(saved);
      expect(result.stderr).to.include(
        'while Git operation rebase-merge is active'
      );
    });
});
