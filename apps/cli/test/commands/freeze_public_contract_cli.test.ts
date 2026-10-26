import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// Public CLI behavior with real repositories and independent opaque state reads.
// eslint-disable-next-line max-lines-per-function
describe('frozen public contract through the CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    fixture.env.HOME = path.join(fixture.root, 'home');
    fs.mkdirSync(fixture.env.HOME);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'freeze-public-contract-cases.jsonl'),
        JSON.stringify({
          root: fixture.root,
          fullTitle: this.currentTest?.fullTitle(),
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture?.cleanup());

  it('explains editable children, skipped publication and the raw Git boundary in public freeze help', () => {
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['freeze', '--help', '--quiet'], fixture.root);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    const help = result.stdout.replace(/\s+/g, ' ');
    for (const fragment of [
      'downstack',
      'editable child',
      'Restack and submit skip',
      'raw Git',
    ])
      expect(help).to.include(fragment);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('keeps frozen inspection and classic long compatibility read-only with dirty ignored work', () => {
    fixture.ok(['freeze', 'tip']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged base');
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged base');
    fs.writeFileSync(path.join(fixture.repo, 'untracked.txt'), 'portable');
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nignored.txt\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'ignored.txt'), 'ignored bytes');
    fixture.git(['status', '--porcelain']);
    fixture.ok(['info', 'child']);
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['info', 'child'],
      ['i', 'child'],
      ['log'],
      ['l'],
      ['log', 'short'],
      ['log', 's'],
      ['ls'],
    ])
      expect(fixture.ok(args)).to.include('child (frozen)');
    for (const args of [
      ['log', '--classic'],
      ['l', '--classic'],
      ['log', 'long'],
      ['log', 'l'],
      ['ll'],
    ])
      expect(fixture.ok(args)).not.to.include('(frozen)');
    expect(fixture.ok(['parent']).trim()).to.equal('main');
    expect(fixture.ok(['children']).trim()).to.equal('child');
    expect(fixture.ok(['info', 'child', '--patch'])).to.include('child.txt');
    expect(stripAnsi(fixture.ok(['i', 'child', '--diff']))).to.include(
      '+child'
    );
    expect(fixture.ok(['info', 'child', '--stat'])).to.include(
      '1 file changed'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('selects a Unicode relative cwd for quiet status and refuses edits without touching either dirty worktree', () => {
    const selected = path.join(fixture.root, 'selected repo ü');
    fs.symlinkSync(fixture.repo, selected, 'dir');
    const linked = path.join(fixture.root, 'departure worktree ü');
    fixture.git(['worktree', 'add', linked, 'other']);
    for (const cwd of [fixture.repo, linked]) {
      fs.writeFileSync(path.join(cwd, 'main.txt'), 'staged');
      fixture.git(['add', 'main.txt'], cwd);
      fs.writeFileSync(path.join(cwd, 'main.txt'), 'unstaged');
      fs.writeFileSync(path.join(cwd, 'untracked.txt'), 'keep');
      fixture.git(['status', '--porcelain'], cwd);
    }
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nignored.txt\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'ignored.txt'), 'keep ignored');
    const base = fixture.git(['rev-parse', 'base']);
    const other = fixture.git(['rev-parse', 'other']);
    const frozen = fixture.run(
      ['--cwd', '../selected repo ü', 'freeze', '--quiet', '--interactive'],
      linked
    );
    expect(frozen.status, frozen.stderr).to.equal(0);
    expect(frozen.stdout + frozen.stderr).to.equal('');
    expect(fixture.ok(['i', 'base'])).to.include('base (frozen)');
    expect(fixture.ok(['i', 'other'])).not.to.include('(frozen)');
    const mainBefore = fixture.inspectionSnapshot();
    const linkedBefore = fixture.inspectionSnapshot(linked);
    const refused = fixture.run(
      [
        'm',
        '--all',
        '--commit',
        '-m',
        'blocked',
        '--cwd',
        '../selected repo ü',
        '--quiet',
        '--no-interactive',
      ],
      linked
    );
    expect(refused.status).to.equal(1);
    expect(refused.stdout).to.equal('');
    expect(refused.stderr).to.include('ch unfreeze base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(mainBefore);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(linkedBefore);
    const unfrozen = fixture.run(
      [
        'unfreeze',
        '--cwd',
        '../selected repo ü',
        '--quiet',
        '--no-interactive',
      ],
      linked
    );
    expect(unfrozen.status, unfrozen.stderr).to.equal(0);
    expect(unfrozen.stdout + unfrozen.stderr).to.equal('');
    expect(fixture.ok(['info', 'base'])).not.to.include('(frozen)');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.index()).to.equal(mainBefore.index);
    expect(fixture.index(linked)).to.equal(linkedBefore.index);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('retains held-worktree protection after administrative freeze and explicit unfreeze', () => {
    const linked = path.join(fixture.root, 'held child ü');
    fixture.git(['worktree', 'add', linked, 'child']);
    fs.writeFileSync(path.join(linked, 'child.txt'), 'held staged');
    fixture.git(['add', 'child.txt'], linked);
    fs.writeFileSync(path.join(linked, 'child.txt'), 'held unstaged');
    fs.writeFileSync(path.join(linked, 'untracked.txt'), 'held untracked');
    fixture.git(['status', '--porcelain'], linked);
    fixture.ok(['freeze', 'child']);
    expect(fixture.ok(['i', 'child'], linked)).to.include('child (frozen)');
    fixture.ok(['unfreeze', 'child']);
    fixture.ok(['info', 'child']);
    const before = fixture.inspectionSnapshot();
    const held = fixture.inspectionSnapshot(linked);
    const result = fixture.run([
      'move',
      '--source',
      'child',
      '--onto',
      'other',
      '--only',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('worktree');
    expect(result.stderr).not.to.include('frozen branch child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(held);
  });

  it('completes frozen local selectors and get U without writes or private command names across shells', () => {
    fixture.ok(['freeze', 'tip']);
    fixture.ok(['info', 'child']);
    const before = fixture.inspectionSnapshot();
    const names = (args: readonly string[]): string[] => {
      const result = fixture.run(['--get-yargs-completions', 'ch', ...args]);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stderr).to.equal('');
      return result.stdout
        .trim()
        .split('\n')
        .map((line) => line.split(':')[0]);
    };
    for (const shell of ['/bin/bash', '/bin/zsh', '/usr/local/bin/fish']) {
      fixture.env.SHELL = shell;
      for (const command of ['freeze', 'unfreeze'])
        expect(
          names(['--quiet', '--no-interactive', command, ''])
        ).to.have.members(['main', 'base', 'child', 'tip', 'other']);
      for (const command of ['get', 'g']) {
        const options = names([command, '--']);
        expect(options).to.include('--unfrozen');
        expect(
          options.some((option) => option === '-U' || option === '--U')
        ).to.equal(true);
      }
      const roots = names(['']);
      expect(roots).to.include('freeze').and.include('unfreeze');
      for (const hidden of [
        'internal-commit-guard',
        'internal-push-guard',
        'branch',
        'commit',
        'upstack',
      ])
        expect(roots).not.to.include(hidden);
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('keeps quiet dominant in a real terminal while retaining frozen errors and permitting navigation', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.inspectionSnapshot();
    const refs = fixture.refs();
    for (const [args, status] of [
      [['restack', '--only', '--quiet', '--interactive'], 0],
      [['m', '--no-edit', '--quiet', '--interactive'], 1],
    ] as const) {
      const result = runCliInPty(getTestCliCommand(args), {
        cwd: fixture.repo,
        env: fixture.env,
      });
      expect(result.status, result.output).to.equal(status);
      if (status === 0) expect(result.output).to.equal('');
      else expect(result.output).to.include('ch unfreeze base');
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.ok(['co', 'child']);
    fixture.ok(['b']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.refs()).to.equal(refs);
  });

  it('leaves direct Git commits and existing raw Git reset outside frozen enforcement', () => {
    fixture.ok(['freeze', 'base']);
    const old = fixture.git(['rev-parse', 'base']);
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/base']);
    fs.writeFileSync(
      path.join(fixture.repo, 'direct.txt'),
      'direct Git content'
    );
    fixture.git(['add', 'direct.txt']);
    fixture.git(['commit', '-m', 'direct Git commit']);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(old);
    expect(fixture.git(['show', 'HEAD:direct.txt'])).to.equal(
      'direct Git content'
    );
    expect(fixture.ok(['info', 'base'])).to.include('base (frozen)');
    const raw = fixture.run(
      ['--cwd', fixture.repo, 'reset', '--soft', old],
      fixture.root
    );
    expect(raw.status, raw.stderr).to.equal(0);
    expect(raw.stderr).to.include('Passing command through to git');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(old);
    expect(fixture.git(['show', ':direct.txt'])).to.equal('direct Git content');
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/base'])).to.equal(
      metadata
    );
    expect(fixture.ok(['i', 'base'])).to.include('base (frozen)');
    expect(
      fixture.run(['m', '--no-edit', '--no-interactive']).stderr
    ).to.include('ch unfreeze base');
  });
});
