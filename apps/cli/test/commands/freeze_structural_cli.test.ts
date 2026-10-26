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
});
