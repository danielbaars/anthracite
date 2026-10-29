import fs from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { expect } from 'chai';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('absorb continuation through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  let stoppedOutput = '';
  beforeEach(() => {
    fixture = new CwdCliFixture();
  });
  afterEach(() => fixture.cleanup());
  function stage(file: string, text: string): void {
    fs.writeFileSync(path.join(fixture.repo, file), text);
    fixture.git(['add', '--', file]);
  }
  function artifacts(): Record<string, string> {
    const administration = path.join(fixture.repo, '.git');
    return Object.fromEntries(
      fs
        .readdirSync(administration)
        .filter((name) => name.startsWith('an-absorb-'))
        .flatMap((name) => {
          const directory = path.join(administration, name);
          return fs
            .readdirSync(directory)
            .filter((file) => fs.lstatSync(path.join(directory, file)).isFile())
            .map((file) => [
              name + '/' + file,
              fs.readFileSync(path.join(directory, file)).toString('base64'),
            ]);
        })
    );
  }
  function conflict(): string {
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'child override\n');
    fixture.git(['commit', '-m', 'Override ancestor']);
    fixture.git(['switch', 'child']);
    stage('base.txt', 'corrected ancestor\n');
    stage('main.txt', 'retained baseline\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'child.txt'),
      'unstaged sentinel\n'
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    stoppedOutput = result.stderr;
    expect(fixture.git(['ls-files', '--unmerged'])).to.include('base.txt');
    expect(fixture.git(['show', 'base:base.txt'])).to.equal(
      'corrected ancestor'
    );
    expect(fixture.git(['diff', '--cached', '--name-only'])).not.to.include(
      'main.txt'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('child');
    return fixture.git(['rev-parse', 'base']);
  }
  it('continues a genuine descendant conflict in a fresh process and restores middle-caller leftovers exactly once', () => {
    const amended = conflict();
    stage('base.txt', 'deliberate child resolution\n');
    const result = fixture.run(['continue', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(amended);
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal(
      'deliberate child resolution'
    );
    expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('2');
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal(
      'main.txt'
    );
    expect(fixture.git(['show', ':main.txt'])).to.equal('retained baseline');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('unstaged sentinel\n');
    const before = fixture.inspectionSnapshot();
    expect(fixture.run(['continue', '--no-interactive']).status).to.equal(1);
    const after = fixture.inspectionSnapshot();
    for (const key of [
      'head',
      'branch',
      'refs',
      'index',
      'staging',
      'status',
      'files',
    ])
      expect(after[key]).to.deep.equal(before[key]);
  });
  it('preserves a deliberate intermediate resolution inherited by the original checkout', () => {
    fixture.git(['switch', 'base']);
    stage('shared.txt', 'alpha\nmiddle\nomega\n');
    fixture.git(['commit', '-m', 'Shared original']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('shared.txt', 'alpha\nchild middle\nomega\n');
    fixture.git(['commit', '-m', 'Adjacent child change']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('shared.txt', 'corrected alpha\nchild middle\nomega\n');
    stage('main.txt', 'retained baseline\n');
    fs.writeFileSync(path.join(fixture.repo, 'tip.txt'), 'unstaged sentinel\n');
    const stopped = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).to.include('shared.txt');
    stage(
      'shared.txt',
      'corrected alpha\nchild middle\ndeliberate resolved omega\n'
    );
    const result = fixture.run(['continue', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['show', 'tip:shared.txt'])).to.equal(
      'corrected alpha\nchild middle\ndeliberate resolved omega'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'shared.txt'), 'utf8')
    ).to.equal('corrected alpha\nchild middle\ndeliberate resolved omega\n');
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal(
      'main.txt'
    );
    expect(fixture.git(['show', ':main.txt'])).to.equal('retained baseline');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('unstaged sentinel\n');
  });

  it('refuses a newly frozen participant before continue --all and permits retry after its original protection metadata is restored', () => {
    conflict();
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'unstaged resolution\n'
    );
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/tip']);
    const original: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', metadata])
    );
    if (!original || typeof original !== 'object' || Array.isArray(original))
      throw new Error('Invalid fixture metadata');
    const file = path.join(fixture.root, 'frozen.json');
    fs.writeFileSync(file, JSON.stringify({ ...original, frozen: true }));
    fixture.git([
      'update-ref',
      'refs/branch-metadata/tip',
      fixture.git(['hash-object', '-w', file]),
    ]);
    const before = fixture.inspectionSnapshot();
    const retained = artifacts();
    const stopped = fixture.run(['continue', '--all', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.match(/frozen|expected ref changed/);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(artifacts()).to.deep.equal(retained);
    fixture.git(['update-ref', 'refs/branch-metadata/tip', metadata]);
    stage('base.txt', 'unstaged resolution\n');
    const expectedBase = fixture.git(['rev-parse', 'base']);
    fixture.git([
      'update-ref',
      'refs/heads/base',
      fixture.git(['rev-parse', 'main']),
    ]);
    const changed = fixture.inspectionSnapshot();
    const retainedAfterRefChange = artifacts();
    const refusedRef = fixture.run(['continue', '--all', '--no-interactive']);
    expect(refusedRef.status, refusedRef.stdout + refusedRef.stderr).to.equal(
      1
    );
    expect(refusedRef.stderr).to.include(
      'Absorb expected ref changed: refs/heads/base'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(changed);
    expect(artifacts()).to.deep.equal(retainedAfterRefChange);
    fixture.git(['update-ref', 'refs/heads/base', expectedBase]);
    const result = fixture.run(['continue', '--all', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal(
      'unstaged resolution'
    );
  });
  it('keeps original owned input after raw Git abort and runs the printed guarded manual restoration', () => {
    const amended = conflict();
    const directories = fs
      .readdirSync(path.join(fixture.repo, '.git'))
      .filter((name) => name.startsWith('an-absorb-'));
    expect(directories).to.have.length(1);
    const directory = path.join(fixture.repo, '.git', directories[0]);
    fixture.git(['rebase', '--abort']);
    const stopped = fixture.run(['continue', '--all', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('No owned active absorb rebase')
      .and.include(directory);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(amended);
    fixture.git(['switch', 'child']);
    const command = /running: (?:BUN_BE_BUN=1 )?'([^'\n]+)' '([^'\n]+)'/.exec(
      stoppedOutput
    );
    if (!command) throw new Error('No executable recovery command printed');
    const recovery = spawnSync(command[1], [command[2]], {
      cwd: fixture.repo,
      env: {
        ...fixture.env,
        ...(stoppedOutput.includes('running: BUN_BE_BUN=1 ')
          ? { BUN_BE_BUN: '1' }
          : {}),
      },
      encoding: 'utf8',
    });
    expect(recovery.status, recovery.stdout + recovery.stderr).to.equal(0);
    expect(fixture.git(['show', ':main.txt'])).to.equal('retained baseline');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('unstaged sentinel\n');
    expect(fs.existsSync(directory)).to.equal(true);
  });
  it('preserves an unselected descendant own commit made redundant by the ancestor correction', () => {
    fixture.branch('side', 'base');
    stage('base.txt', 'corrected ancestor\n');
    fixture.git(['commit', '-m', 'Keep redundant own subject\n\nKeep body.']);
    const identity = fixture.git([
      'show',
      '-s',
      '--format=%an%n%ae%n%aI%n%B',
      'side',
    ]);
    fixture.git(['switch', 'child']);
    stage('base.txt', 'corrected ancestor\n');
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-list', '--count', 'base..side'])).to.equal('2');
    expect(
      fixture.git(['show', '-s', '--format=%an%n%ae%n%aI%n%B', 'side'])
    ).to.equal(identity);
    expect(fixture.git(['rev-parse', 'side^{tree}'])).to.equal(
      fixture.git(['rev-parse', 'side^' + '^{tree}'])
    );
  });

  it('resumes a pending selected caller after an earlier side-arm conflict using the saved no-verify choice', () => {
    fixture.branch('side', 'base');
    stage('base.txt', 'side override\n');
    fixture.git(['commit', '-m', 'Side override']);
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'corrected ancestor\n');
    stage('tip.txt', 'pending selected tip\n');
    stage('main.txt', 'retained baseline\n');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 91\n', { mode: 0o755 });
    const stopped = fixture.run([
      'absorb',
      '--force',
      '--no-verify',
      '--no-interactive',
    ]);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).to.include('base.txt');
    const amended = fixture.git(['rev-parse', 'base']);
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    stage('base.txt', 'deliberate side resolution\n');
    const result = fixture.run(['continue', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(amended);
    expect(fixture.git(['show', 'side:base.txt'])).to.equal(
      'deliberate side resolution'
    );
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal(
      'corrected ancestor'
    );
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal(
      'pending selected tip'
    );
    expect(fixture.git(['rev-list', '--count', 'main..tip'])).to.equal('3');
    expect(fixture.git(['show', ':main.txt'])).to.equal('retained baseline');
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
  });
  it('refuses occupied and foreign-worktree continuation before staging a resolution', () => {
    conflict();
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'unstaged resolution\n'
    );
    const linked = path.join(fixture.root, 'occupied-tip');
    fixture.git(['worktree', 'add', '--force', linked, 'tip']);
    let before = fixture.inspectionSnapshot();
    const outside = fixture.inspectionSnapshot(linked);
    let stopped = fixture.run(['continue', '--all', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('checked out in worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(outside);
    stopped = fixture.run(['continue', '--all', '--no-interactive'], linked);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('original source worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['worktree', 'remove', linked]);
    before = fixture.inspectionSnapshot();
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'index.lock'),
      'foreign lock'
    );
    stopped = fixture.run(['continue', '--all', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('existing lock');
    fs.unlinkSync(path.join(fixture.repo, '.git', 'index.lock'));
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const result = fixture.run(['continue', '--all', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
  });

  it('retains both committed conflict work and original staged input when final remainders collide', () => {
    fixture.git(['switch', 'base']);
    stage('shared.txt', 'alpha\nmiddle\nomega\n');
    fixture.git(['commit', '-m', 'Shared original']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('shared.txt', 'alpha\nchild middle\nomega\n');
    fixture.git(['commit', '-m', 'Adjacent child change']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('shared.txt', 'corrected alpha\nchild middle\nomega\n');
    stage('main.txt', 'retained baseline\n');
    const stopped = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).to.include('shared.txt');
    stage('shared.txt', 'corrected alpha\nchild middle\ndeliberate omega\n');
    stage('main.txt', 'deliberate baseline resolution\n');
    const result = fixture.run(['continue', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('restoring retained input')
      .and.include('Retained input and construction:');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
      'deliberate baseline resolution'
    );
    expect(fixture.git(['show', ':main.txt'])).to.equal(
      'deliberate baseline resolution'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('deliberate baseline resolution\n');
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
    const directories = fs
      .readdirSync(path.join(fixture.repo, '.git'))
      .filter((name) => name.startsWith('an-absorb-'));
    expect(directories).to.have.length(1);
    const input: unknown = JSON.parse(
      fs.readFileSync(
        path.join(fixture.repo, '.git', directories[0], 'input.json'),
        'utf8'
      )
    );
    expect(JSON.stringify(input)).to.include(
      Buffer.from('retained baseline\n').toString('base64')
    );
  });
  it('refuses a new ignored checkout collision created by a replay hook and retains its bytes for manual recovery', () => {
    fixture.branch('side', 'base');
    stage('intermediate.txt', 'temporary tracked bytes\n');
    fixture.git(['commit', '-m', 'Introduce temporary side path']);
    fixture.git(['rm', 'intermediate.txt']);
    fixture.git(['commit', '-m', 'Remove temporary side path']);
    fixture.git(['switch', 'child']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'intermediate.txt\n'
    );
    stage('base.txt', 'corrected ancestor\n');
    const file = path.join(fixture.repo, 'intermediate.txt');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-rebase'),
      '#!/bin/sh\nprintf "new hook bytes\\n" > ' + JSON.stringify(file) + '\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('overwrite ignored file intermediate.txt');
    expect(fixture.git(['show', 'base:base.txt'])).to.equal(
      'corrected ancestor'
    );
    expect(fs.readFileSync(file, 'utf8')).to.equal('new hook bytes\n');
    expect(result.stderr).to.include('Retained input and construction:');
  });

  it('distinguishes a retained failed Git exec from an unresolved content conflict and then continues it', () => {
    const amended = conflict();
    stage('base.txt', 'deliberate resolution\n');
    const editor = path.join(fixture.root, 'todo-editor.cjs');
    fs.writeFileSync(
      editor,
      "const fs=require('fs');const file=process.argv[2];fs.writeFileSync(file,'exec false\\n'+fs.readFileSync(file,'utf8'));\n"
    );
    fixture.git([
      '-c',
      'sequence.editor=' + process.execPath + ' ' + editor,
      'rebase',
      '--edit-todo',
    ]);
    const stopped = fixture.run(['continue', '--no-interactive']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('replay remains stopped')
      .and.not.include('Content conflict');
    expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(true);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(amended);
    const result = fixture.run(['continue', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal(
      'deliberate resolution'
    );
    expect(fixture.git(['show', ':main.txt'])).to.equal('retained baseline');
  });
});
