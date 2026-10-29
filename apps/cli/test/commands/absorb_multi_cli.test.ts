import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('multi-target absorb through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    fixture.git(['switch', 'tip']);
  });
  afterEach(() => fixture.cleanup());
  function stage(file: string, text: string): void {
    fs.writeFileSync(path.join(fixture.repo, file), text);
    fixture.git(['add', '--', file]);
  }
  it('applies corrections to distinct original branch commits without losing earlier inherited corrections', () => {
    const trunk = fixture.git(['rev-parse', 'main']);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    stage('tip.txt', 'corrected tip\n');
    const prospective = fixture.git(['write-tree']);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'child:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'child:child.txt'])).to.equal(
      'corrected child'
    );
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('corrected child');
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('corrected tip');
    expect(fixture.git(['rev-list', '--count', 'main..tip'])).to.equal('3');
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(fixture.git(['rev-parse', 'main'])).to.equal(trunk);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
  });
  it('keeps distinct same-file corrections in their original interior commits with exact authors and full messages', () => {
    fixture.git(['switch', 'base']);
    const original = Array.from({ length: 24 }, (_, i) => `line ${i + 1}\n`);
    stage('shared.txt', original.join(''));
    fixture.git([
      '-c',
      'user.name=First Author',
      '-c',
      'user.email=first@example.test',
      'commit',
      '--date=2020-01-02T03:04:05+02:00',
      '--cleanup=verbatim',
      '-m',
      'First subject\n\nFirst body.\n\nReviewed-by: Human <human@example.test>\n\n',
    ]);
    const identity = (revision: string): string =>
      execFileSync(
        'git',
        ['show', '-s', '--format=%an%n%ae%n%aI%n%B', revision],
        {
          cwd: fixture.repo,
          env: fixture.env,
          encoding: 'utf8',
        }
      );
    const firstIdentity = identity('HEAD');
    original[17] = 'second original\n';
    stage('shared.txt', original.join(''));
    fixture.git([
      '-c',
      'user.name=Second Author',
      '-c',
      'user.email=second@example.test',
      'commit',
      '--date=2021-06-07T08:09:10-03:00',
      '-m',
      'Second subject\n\nSecond body.',
    ]);
    const secondIdentity = identity('HEAD');
    stage('last.txt', 'unselected own commit\n');
    fixture.git(['commit', '-m', 'Last own commit']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    original[1] = 'first corrected\n';
    original[17] = 'second corrected\n';
    stage('shared.txt', original.join(''));
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    const firstTree = fixture.git(['show', 'base~2:shared.txt']).split('\n');
    expect(firstTree[1]).to.equal('first corrected');
    expect(firstTree[17]).to.equal('line 18');
    const secondTree = fixture.git(['show', 'base^:shared.txt']).split('\n');
    expect(secondTree[1]).to.equal('first corrected');
    expect(secondTree[17]).to.equal('second corrected');
    expect(fixture.git(['show', 'base:last.txt'])).to.equal(
      'unselected own commit'
    );
    expect(identity('base~2')).to.equal(firstIdentity);
    expect(identity('base^')).to.equal(secondIdentity);
    expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('4');
    expect(fixture.git(['show', 'tip:shared.txt'])).to.equal(
      original.join('').trimEnd()
    );
  });
  it('replays fan-out parent-first above a middle caller and retains local PR identity, unrelated refs and each own commit', () => {
    fixture.branch('side', 'base');
    fixture.branch('side-child', 'side');
    const unrelated = fixture.git(['rev-parse', 'main']);
    fixture.git(['branch', 'untracked-outside', 'main']);
    fixture.git(['tag', 'outside-tag', 'main']);
    for (const branch of ['base', 'child', 'tip', 'side', 'side-child']) {
      const original: unknown = JSON.parse(
        fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
      );
      if (!original || typeof original !== 'object' || Array.isArray(original))
        throw new Error('Invalid fixture metadata');
      const file = path.join(fixture.root, `${branch}-metadata.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...original,
          prInfo: {
            number: 71,
            url: `https://example.test/pr/${branch}`,
            title: branch,
          },
          retainedSentinel: branch,
        })
      );
      fixture.git([
        'update-ref',
        `refs/branch-metadata/${branch}`,
        fixture.git(['hash-object', '-w', file]),
      ]);
    }
    fixture.git(['switch', 'child']);
    stage('base.txt', 'fan-out base correction\n');
    stage('child.txt', 'middle correction\n');
    const prospective = fixture.git(['write-tree']);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    for (const branch of ['base', 'child', 'tip', 'side', 'side-child']) {
      expect(fixture.git(['show', `${branch}:base.txt`]), branch).to.equal(
        'fan-out base correction'
      );
      const meta: unknown = JSON.parse(
        fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
      );
      if (
        !meta ||
        typeof meta !== 'object' ||
        !('parentBranchName' in meta) ||
        typeof meta.parentBranchName !== 'string'
      )
        throw new Error('Invalid reached metadata');
      expect(meta).to.include({
        retainedSentinel: branch,
        parentBranchRevision: fixture.git(['rev-parse', meta.parentBranchName]),
      });
      expect(meta)
        .to.have.property('prInfo')
        .that.deep.equals({
          number: 71,
          url: `https://example.test/pr/${branch}`,
          title: branch,
        });
    }
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal(
      'middle correction'
    );
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(fixture.git(['show', 'side-child:side.txt'])).to.equal('side');
    expect(fixture.git(['show', 'side-child:side-child.txt'])).to.equal(
      'side-child'
    );
    expect(fixture.git(['rev-list', '--count', 'base..side-child'])).to.equal(
      '2'
    );
    expect(fixture.git(['rev-parse', 'side-child^'])).to.equal(
      fixture.git(['rev-parse', 'side'])
    );
    expect(fixture.git(['rev-parse', 'side^'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    for (const ref of ['main', 'untracked-outside', 'outside-tag'])
      expect(fixture.git(['rev-parse', ref])).to.equal(unrelated);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.git(['write-tree'])).to.equal(prospective);
  });
  it('retains a selected commit made empty by its exact text correction and keeps its branch identity', () => {
    stage('tip.txt', 'later own change\n');
    fixture.git(['commit', '-m', 'Selected subject\n\nSelected body.']);
    const identity = fixture.git([
      'show',
      '-s',
      '--format=%an%n%ae%n%aI%n%B',
      'HEAD',
    ]);
    stage('tip.txt', 'tip');
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(
      fixture.git(['rev-parse', 'tip^' + '^{tree}'])
    );
    expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('2');
    expect(
      fixture.git(['show', '-s', '--format=%an%n%ae%n%aI%n%B', 'tip'])
    ).to.equal(identity);
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
  });
  it('refuses an intermediate side-arm collision before staging or publishing any target', () => {
    fixture.branch('side', 'base');
    stage('intermediate.txt', 'temporary tracked content\n');
    fixture.git(['commit', '-m', 'Introduce intermediate path']);
    fixture.git(['rm', 'intermediate.txt']);
    fixture.git(['commit', '-m', 'Remove intermediate path']);
    fixture.git(['switch', 'child']);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'intermediate.txt'),
      'untracked collision sentinel\n'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include(
      'overwrite untracked file intermediate.txt'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('keeps an external protection change during a later target hook and restores retained input after partial progress', () => {
    fixture.branch('side', 'base');
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    stage('leftover.txt', 'retained staged addition\n');
    fs.writeFileSync(path.join(fixture.repo, 'tip.txt'), 'unstaged sentinel\n');
    const prospective = fixture.git(['write-tree']);
    const child = fixture.git(['rev-parse', 'child']);
    const original: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/side'])
    );
    if (!original || typeof original !== 'object' || Array.isArray(original))
      throw new Error('Invalid fixture metadata');
    const file = path.join(fixture.root, 'externally-frozen.json');
    fs.writeFileSync(file, JSON.stringify({ ...original, frozen: true }));
    const frozen = fixture.git(['hash-object', '-w', file]);
    const marker = path.join(fixture.root, 'hook-count');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\ncount=0\nif test -f ' +
        JSON.stringify(marker) +
        '; then count=$(cat ' +
        JSON.stringify(marker) +
        '); fi\ncount=$((count+1))\nprintf "%s" "$count" > ' +
        JSON.stringify(marker) +
        '\nif test "$count" = 2; then git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/side ' +
        frozen +
        '; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('Completed: base.')
      .and.include('Retained input and construction:');
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/side'])).to.equal(
      frozen
    );
    const match = /running: (?:BUN_BE_BUN=1 )?'([^'\n]+)' '([^'\n]+)'/.exec(
      result.stderr
    );
    if (!match) throw new Error('No executable recovery path printed');
    const recovery = spawnSync(match[1], [match[2]], {
      cwd: fixture.repo,
      env: {
        ...fixture.env,
        ...(result.stderr.includes('running: BUN_BE_BUN=1 ')
          ? { BUN_BE_BUN: '1' }
          : {}),
      },
      encoding: 'utf8',
    });
    expect(recovery.status, recovery.stdout + recovery.stderr).to.equal(0);
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('unstaged sentinel\n');
  });
  it('retains a frozen occupied read-only anchor while applying separate eligible corrections above it', () => {
    fixture.ok(['freeze', 'base']);
    const anchor = fixture.git(['rev-parse', 'base']);
    const linked = path.join(fixture.root, 'occupied-anchor');
    fixture.git(['worktree', 'add', linked, 'base']);
    fs.writeFileSync(path.join(linked, 'base.txt'), 'outside dirty anchor\n');
    const outside = fixture.inspectionSnapshot(linked);
    stage('base.txt', 'retained frozen correction\n');
    stage('child.txt', 'eligible child correction\n');
    stage('tip.txt', 'eligible tip correction\n');
    const prospective = fixture.git(['write-tree']);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Retained base.txt:')
      .and.include('frozen');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(anchor);
    expect(fixture.git(['show', 'child:child.txt'])).to.equal(
      'eligible child correction'
    );
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal(
      'eligible tip correction'
    );
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal('base');
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    const after = fixture.inspectionSnapshot(linked);
    expect(after.index).to.equal(outside.index);
    expect(after.head).to.equal(outside.head);
    expect(after.files).to.deep.equal(outside.files);
  });
  it('retains unchanged binary and symlink history and stages unsupported entries separately from multiple absorbed corrections', () => {
    fixture.git(['switch', 'base']);
    const binary = Buffer.from([0, 255, 254, 1, 128]);
    fs.writeFileSync(path.join(fixture.repo, 'original.bin'), binary);
    fs.symlinkSync('base.txt', path.join(fixture.repo, 'original-link'));
    fixture.git(['add', 'original.bin', 'original-link']);
    fixture.git(['commit', '-m', 'Retain ordinary non-text entries']);
    const originalEntry = fixture.git([
      'ls-tree',
      'HEAD',
      '--',
      'original.bin',
      'original-link',
    ]);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    stage('main.txt', 'retained trunk-owned text\n');
    stage('new.txt', 'retained new file\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'new.bin'),
      Buffer.from([0, 254, 255, 3])
    );
    fixture.git(['add', 'new.bin']);
    fixture.git(['rm', 'original-link']);
    const prospective = fixture.git(['write-tree']);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    for (const name of ['main.txt', 'new.txt', 'new.bin', 'original-link'])
      expect(result.stdout).to.include(`Retained ${name}:`);
    for (const branch of ['base', 'child', 'tip'])
      expect(
        fixture.git(['ls-tree', branch, '--', 'original.bin', 'original-link'])
      ).to.equal(originalEntry);
    expect(fixture.git(['write-tree'])).to.equal(prospective);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'original.bin'))
    ).to.deep.equal(binary);
    expect(fs.existsSync(path.join(fixture.repo, 'original-link'))).to.equal(
      false
    );
    expect(
      fixture.git(['diff', '--cached', '--name-only']).split('\n')
    ).to.deep.equal(['main.txt', 'new.bin', 'new.txt', 'original-link']);
  });
  it('preflights frozen and occupied side-arm participants before any target or input publication', () => {
    fixture.branch('side', 'base');
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    const original: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/side'])
    );
    if (!original || typeof original !== 'object' || Array.isArray(original))
      throw new Error('Invalid fixture metadata');
    const file = path.join(fixture.root, 'frozen-side.json');
    fs.writeFileSync(file, JSON.stringify({ ...original, frozen: true }));
    fixture.git([
      'update-ref',
      'refs/branch-metadata/side',
      fixture.git(['hash-object', '-w', file]),
    ]);
    let before = fixture.inspectionSnapshot();
    let result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch side');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.ok(['unfreeze', 'side']);
    const linked = path.join(fixture.root, 'occupied-side');
    fixture.git(['worktree', 'add', linked, 'side']);
    fs.writeFileSync(path.join(linked, 'side.txt'), 'outside staged side\n');
    fixture.git(['add', 'side.txt'], linked);
    fs.writeFileSync(path.join(linked, 'side.txt'), 'outside unstaged side\n');
    before = fixture.inspectionSnapshot();
    const outside = fixture.inspectionSnapshot(linked);
    result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('checked out in worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(outside);
  });
  it('preserves source work written by a later selected branch publication hook', () => {
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    const source = path.join(fixture.repo, 'tip.txt');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'reference-transaction'),
      '#!/bin/sh\nwhile read old new ref; do\nif test "$1" = committed && test "$ref" = refs/heads/child && test "$new" != 0000000000000000000000000000000000000000; then printf "new hook source work\\n" > ' +
        JSON.stringify(source) +
        '; fi\ndone\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('Completed: base, child.')
      .and.include('source work changed');
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'child:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', 'child:child.txt'])).to.equal(
      'corrected child'
    );
    expect(fs.readFileSync(source, 'utf8')).to.equal('new hook source work\n');
    expect(result.stderr).to.include('Retained input and construction:');
  });
});
