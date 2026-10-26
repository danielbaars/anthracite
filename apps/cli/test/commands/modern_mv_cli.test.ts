import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('modern mv ownership through the public CLI', function () {
  this.timeout(120000);
  let start: CwdCliFixture;
  let target: CwdCliFixture;
  beforeEach(function () {
    start = new CwdCliFixture();
    target = new CwdCliFixture();
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-mv-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          start: start.root,
          target: target.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => {
    start.cleanup();
    target.cleanup();
  });

  it('refuses a prefixed mv rather than moving branches or changing either repository', () => {
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const result = start.run(['--no-interactive', 'mv', 'other']);
    expect(result.status, result.stdout + result.stderr).not.to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).not.to.equal('');
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('moves a tracked file through direct Git while preserving history and public parents', () => {
    const before = start.inspectionSnapshot();
    const beforeTarget = target.inspectionSnapshot();
    expect(start.run(['parent']).stdout).to.equal('main\n');
    const moved = start.run(['mv', 'base.txt', 'renamed.txt']);
    expect(moved.status, moved.stdout + moved.stderr).to.equal(0);
    expect(moved.stdout).to.equal('');
    expect(moved.stderr).to.equal(
      'Passing command through to git...\nRunning: "git mv base.txt renamed.txt"\n\n'
    );
    expect(start.git(['show', ':renamed.txt'])).to.equal('base');
    expect(start.git(['ls-files', 'base.txt'])).to.equal('');
    expect(fs.existsSync(path.join(start.repo, 'base.txt'))).to.equal(false);
    expect(
      fs.readFileSync(path.join(start.repo, 'renamed.txt'), 'utf8')
    ).to.equal('base');
    expect(start.run(['parent']).stdout).to.equal('main\n');
    const after = start.inspectionSnapshot();
    for (const key of ['head', 'branch', 'refs', 'persistent', 'userConfig'])
      expect(after[key], key).to.deep.equal(before[key]);
    expect(target.inspectionSnapshot()).to.deep.equal(beforeTarget);
  });

  it('moves only files in the selected linked worktree with a cwd prefix', () => {
    const linked = path.join(target.root, 'linked δ files');
    target.git(['worktree', 'add', linked, 'other']);
    const beforeStart = start.inspectionSnapshot();
    const beforePrimary = target.inspectionSnapshot();
    const beforeLinked = target.inspectionSnapshot(linked);
    const moved = start.run([
      '--cwd',
      linked,
      'mv',
      'other.txt',
      'renamed other.txt',
    ]);
    expect(moved.status, moved.stdout + moved.stderr).to.equal(0);
    expect(target.git(['show', ':renamed other.txt'], linked)).to.equal(
      'other'
    );
    expect(target.git(['ls-files', 'other.txt'], linked)).to.equal('');
    const afterLinked = target.inspectionSnapshot(linked);
    for (const key of ['head', 'branch', 'refs', 'persistent', 'userConfig'])
      expect(afterLinked[key], key).to.deep.equal(beforeLinked[key]);
    expect(target.inspectionSnapshot()).to.deep.equal(beforePrimary);
    expect(start.inspectionSnapshot()).to.deep.equal(beforeStart);
  });

  it('preserves both dirty repositories and a linked worktree across unsupported prefixes', () => {
    const linked = path.join(target.root, 'linked-preserved');
    target.git(['worktree', 'add', linked, 'other']);
    for (const fixture of [start, target]) {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged base');
      fixture.git(['add', 'base.txt']);
      fs.appendFileSync(path.join(fixture.repo, 'base.txt'), '\nworking base');
      fs.writeFileSync(
        path.join(fixture.repo, 'untracked.txt'),
        'keep untracked'
      );
      fixture.git(['status', '--porcelain']);
    }
    fs.writeFileSync(path.join(linked, 'untracked.txt'), 'keep linked');
    const before = [
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
      target.inspectionSnapshot(linked),
    ];
    for (const prefix of [
      ['--quiet'],
      ['--no-interactive'],
      ['--debug'],
      ['--cwd', target.repo, '--no-interactive'],
      ['--no-interactive', '--cwd', target.repo],
      ['--cwd=' + linked, '--quiet'],
    ]) {
      const result = start.run([...prefix, 'mv', 'other']);
      expect(result.status, JSON.stringify(prefix)).not.to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect([
        start.inspectionSnapshot(),
        target.inspectionSnapshot(),
        target.inspectionSnapshot(linked),
      ]).to.deep.equal(before);
    }
  });

  it('keeps Git errors and payload flags without guessing a branch fallback', () => {
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    for (const args of [
      ['mv', 'missing', 'other'],
      ['mv', 'other'],
      ['mv', 'base.txt', 'copy.txt', 'other'],
      ['mv', 'base.txt', 'renamed.txt', '--quiet'],
      ['mv', 'base.txt', 'renamed.txt', '--stack'],
    ]) {
      const direct = spawnSync('git', args, {
        cwd: start.repo,
        env: start.env,
      });
      if (direct.error) throw direct.error;
      expect(direct.signal).to.equal(null);
      const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
      if (evidence)
        fs.appendFileSync(
          path.join(evidence, 'modern-mv-direct-git.jsonl'),
          JSON.stringify({
            args,
            cwd: start.repo,
            status: direct.status,
            stdoutBase64: direct.stdout.toString('base64'),
            stderrBase64: direct.stderr.toString('base64'),
          }) + '\n'
        );
      const result = start.run(args);
      expect(result.status).to.equal(direct.status).and.not.to.equal(0);
      expect(result.stdout).to.equal(direct.stdout.toString());
      expect(result.stderr).to.equal(
        `Passing command through to git...\nRunning: "git ${args.join(
          ' '
        )}"\n\n` + direct.stderr.toString()
      );
      expect([
        start.inspectionSnapshot(),
        target.inspectionSnapshot(),
      ]).to.deep.equal(before);
    }
  });

  it('treats option-looking filenames after the Git terminator literally', () => {
    fs.writeFileSync(path.join(start.repo, '--quiet'), 'literal payload');
    start.git(['add', '--', '--quiet']);
    const beforeTarget = target.inspectionSnapshot();
    const refs = start.refs();
    const result = start.run(['mv', '--', '--quiet', '--stack']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(start.git(['show', ':--stack'])).to.equal('literal payload');
    expect(start.git(['ls-files', '--', '--quiet'])).to.equal('');
    expect(start.refs()).to.equal(refs);
    expect(start.git(['branch', '--show-current'])).to.equal('base');
    expect(target.inspectionSnapshot()).to.deep.equal(beforeTarget);
  });

  it('retains canonical branch move with source, onto and only', () => {
    const beforeTarget = target.inspectionSnapshot();
    const result = start.run([
      'move',
      '-s',
      'base',
      '-o',
      'other',
      '--only',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(start.run(['parent']).stdout).to.equal('other\n');
    start.ok(['checkout', 'child']);
    expect(start.run(['parent']).stdout).to.equal('main\n');
    expect(start.git(['log', '--format=%s', 'main..child'])).to.equal('child');
    expect(target.inspectionSnapshot()).to.deep.equal(beforeTarget);
  });

  it('keeps merge and revert as real Git operations rather than PR actions', () => {
    const originalTree = start.git(['rev-parse', 'HEAD^{tree}']);
    const child = start.git(['rev-parse', 'child']);
    const beforeTarget = target.inspectionSnapshot();
    const beforePersistent = start.inspectionSnapshot().persistent;
    const merged = start.run(['merge', '--ff-only', 'child']);
    expect(merged.status, merged.stdout + merged.stderr).to.equal(0);
    expect(start.git(['rev-parse', 'HEAD'])).to.equal(child);
    expect(merged.stderr).to.include('Running: "git merge --ff-only child"');
    const reverted = start.run(['revert', '--no-edit', child]);
    expect(reverted.status, reverted.stdout + reverted.stderr).to.equal(0);
    expect(start.git(['rev-parse', 'HEAD^{tree}'])).to.equal(originalTree);
    expect(start.git(['log', '-1', '--format=%s'])).to.equal('Revert "child"');
    expect(start.git(['branch', '--show-current'])).to.equal('base');
    expect(start.inspectionSnapshot().persistent).to.deep.equal(
      beforePersistent
    );
    expect(fs.existsSync(path.join(start.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(target.inspectionSnapshot()).to.deep.equal(beforeTarget);
  });

  it('documents move without advertising mv as a branch alias', () => {
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const root = start.run(['--help', '--quiet']);
    expect(root.status, root.stdout + root.stderr).to.equal(0);
    expect(root.stdout).to.include('move [branch]');
    expect(root.stdout).not.to.include('aliases: mv');
    const move = start.run(['move', '--help', '--quiet']);
    expect(move.status, move.stdout + move.stderr).to.equal(0);
    expect(move.stdout).to.include('an move [branch]');
    expect(move.stdout).to.include('--onto');
    expect(move.stdout).not.to.include('aliases: mv');
    expect(fs.existsSync(path.join(start.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('keeps branch completion for move and never offers branches for raw mv', () => {
    start.git(['branch', 'completion-only-branch']);
    start.env.SHELL = '/usr/local/bin/fish';
    delete start.env.ZSH_NAME;
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const move = start.run(['--get-yargs-completions', 'an', 'move', '']);
    expect(move.status, move.stdout + move.stderr).to.equal(0);
    expect(move.stderr).to.equal('');
    expect(move.stdout.split('\n').filter(Boolean)).to.have.members([
      'main',
      'base',
      'child',
      'tip',
      'other',
      'completion-only-branch',
    ]);
    const raw = start.run(['--get-yargs-completions', 'an', 'mv', '']);
    expect(raw.status, raw.stdout + raw.stderr).to.equal(0);
    expect(raw.stderr).to.equal('');
    for (const name of [
      'main',
      'base',
      'child',
      'tip',
      'other',
      'completion-only-branch',
    ])
      expect(raw.stdout.split('\n')).not.to.include(name);
    const fish = start.run(['fish', '--quiet']);
    expect(fish.status, fish.stdout + fish.stderr).to.equal(0);
    expect(fish.stderr).to.equal('');
    expect(fish.stdout).to.include(
      '$tokens[1] --get-yargs-completions $tokens "$current"'
    );
    expect(fish.stdout).not.to.include('__fish_seen_subcommand_from');
    expect(fish.stdout).not.to.include('command git');
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
    expect(fs.existsSync(path.join(start.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(fs.existsSync(path.join(target.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
});
