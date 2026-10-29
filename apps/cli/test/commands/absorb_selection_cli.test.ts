import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('absorb hunk selection through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    fixture.git(['switch', 'tip']);
  });
  afterEach(() => {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.cleanup();
  });

  function stage(file: string, contents: string | Buffer): void {
    fs.writeFileSync(path.join(fixture.repo, file), contents);
    fixture.git(['add', '--', file]);
  }

  function preview(): string {
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    return result.stdout;
  }

  it('selects exact original commits for two files in different branches', () => {
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    const output = preview();
    expect(output).to.include(`base.txt: absorb into base, commit ${base}`);
    expect(output).to.include(`child.txt: absorb into child, commit ${child}`);
  });

  it('assigns separated hunks in one file to distinct original commits', () => {
    const original =
      'first=base\n' +
      Array.from({ length: 20 }, (_, i) => `context-${i}\n`).join('') +
      'tail=base\n';
    fixture.git(['switch', 'base']);
    stage('shared.txt', original);
    fixture.git(['commit', '-m', 'Introduce shared text']);
    const base = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('shared.txt', original.replace('tail=base', 'tail=child'));
    fixture.git(['commit', '-m', 'Change shared tail']);
    const child = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage(
      'shared.txt',
      original
        .replace('first=base', 'first=reviewed')
        .replace('tail=base', 'tail=reviewed')
    );
    fixture.git(['config', 'diff.interHunkContext', '100']);
    const output = preview();
    expect(output).to.include(`shared.txt: absorb into base, commit ${base}`);
    expect(output).to.include(`shared.txt: absorb into child, commit ${child}`);
    expect(output).to.include('source line 1').and.include('source line 22');
  });

  it('reports every retained unsupported entry alongside an eligible hunk', () => {
    stage('binary.bin', Buffer.from([0, 1, 2]));
    fixture.git(['commit', '-m', 'Add binary fixture']);
    stage('base.txt', 'corrected base\n');
    stage('new.txt', 'new staged content\n');
    stage('binary.bin', Buffer.from([0, 9, 2]));
    fixture.git(['rm', 'child.txt']);
    fixture.git(['update-index', '--chmod=+x', 'tip.txt']);
    fs.unlinkSync(path.join(fixture.repo, 'main.txt'));
    fs.symlinkSync(
      '/absorb-must-not-follow-this-link',
      path.join(fixture.repo, 'main.txt')
    );
    fixture.git(['add', 'main.txt']);
    const output = preview();
    expect(output).to.include('base.txt: absorb into base');
    for (const file of [
      'new.txt',
      'binary.bin',
      'child.txt',
      'tip.txt',
      'main.txt',
    ])
      expect(output).to.include(`Retained ${file}:`);
    expect(output)
      .to.include('Absorbable hunks: 1')
      .and.include('Retained entries: 5');
  });

  it('keeps distinct interior and current commit destinations within one branch', () => {
    fixture.git(['switch', 'base']);
    stage('first.txt', 'first original\n');
    fixture.git(['commit', '-m', 'First own change']);
    const first = fixture.git(['rev-parse', 'HEAD']);
    stage('second.txt', 'second original\n');
    fixture.git(['commit', '-m', 'Second own change']);
    const second = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    stage('first.txt', 'first corrected\n');
    stage('second.txt', 'second corrected\n');
    const output = preview();
    expect(output).to.include(`first.txt: absorb into base, commit ${first}`);
    expect(output).to.include(`second.txt: absorb into base, commit ${second}`);
  });

  it('selects the most recent commit that changed an area instead of file introduction', () => {
    fixture.git(['switch', 'child']);
    stage('base.txt', 'child-owned content\n');
    fixture.git(['commit', '-m', 'Override the earlier line']);
    const owner = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'reviewed child content\n');
    const output = preview();
    expect(output).to.include(`base.txt: absorb into child, commit ${owner}`);
    expect(output).not.to.include('base.txt: absorb into base');
  });

  it('translates independent line insertions and deletions through a newer prefix insertion', () => {
    const original = 'start\nremove-me\nkeep-a\nkeep-b\nlast\n';
    fixture.git(['switch', 'base']);
    stage('shared.txt', original);
    fixture.git(['commit', '-m', 'Introduce editable lines']);
    const owner = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('shared.txt', 'child-prefix\n' + original);
    fixture.git(['commit', '-m', 'Insert a separate prefix']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage(
      'shared.txt',
      'child-prefix\nstart\nkeep-a\nkeep-b\ninserted\nlast\n'
    );
    const output = preview();
    expect(
      output.split(`shared.txt: absorb into base, commit ${owner}`).length - 1
    ).to.equal(2);
    expect(output)
      .to.include('Absorbable hunks: 2')
      .and.not.include('Retained shared.txt');
  });

  it('retains a correction whose historical duplicate placement is ambiguous', () => {
    fixture.git(['switch', 'base']);
    stage('repeated.txt', 'repeat\nrepeat\n');
    fixture.git(['commit', '-m', 'Introduce indistinguishable lines']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('repeated.txt', 'repeat\n');
    fixture.git(['commit', '-m', 'Remove one indistinguishable line']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('repeated.txt', 'reviewed\n');
    const output = preview();
    expect(output)
      .to.include('Retained repeated.txt:')
      .and.include('Ambiguous');
    expect(output).not.to.include('repeated.txt: absorb into');
  });

  it('does not assign a canonical inserted copy when either repeated copy could be original', () => {
    fixture.git(['switch', 'base']);
    stage('repeated.txt', 'repeat\n');
    fixture.git(['commit', '-m', 'Introduce one original line']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('repeated.txt', 'repeat\nrepeat\n');
    fixture.git(['commit', '-m', 'Duplicate an indistinguishable line']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('repeated.txt', 'repeat\nreviewed\n');
    const output = preview();
    expect(output)
      .to.include('Retained repeated.txt:')
      .and.include('Ambiguous');
    expect(output).not.to.include('repeated.txt: absorb into');
  });

  it('commutes repeated lines when history still forces their unique order', () => {
    const original = 'left-old\nrepeat\nright-old\nrepeat\n';
    fixture.git(['switch', 'base']);
    stage('repeated.txt', original);
    fixture.git(['commit', '-m', 'Introduce ordered repeated lines']);
    const owner = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage(
      'repeated.txt',
      original.replace('left-old', 'left-new').replace('right-old', 'right-new')
    );
    fixture.git(['commit', '-m', 'Change the separate surrounding lines']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('repeated.txt', 'left-new\nreviewed\nright-new\nrepeat\n');
    const output = preview();
    expect(output).to.include(
      `repeated.txt: absorb into base, commit ${owner}`
    );
    expect(output).not.to.include('Retained repeated.txt');
  });

  it('preserves CRLF and missing final newline for literal Unicode paths from a subdirectory', () => {
    const file = 'nested/space [literal] Ω.txt';
    fixture.git(['switch', 'base']);
    fs.mkdirSync(path.join(fixture.repo, 'nested'));
    stage(file, 'prefix\r\nold\r\nlast');
    fixture.git(['commit', '-m', 'Introduce exact text bytes']);
    const owner = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage(file, 'prefix\r\nreviewed\r\nlast');
    fixture.git(['config', 'diff.relative', 'true']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(
      ['absorb', '--dry-run', '--no-interactive'],
      path.join(fixture.repo, 'nested')
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      `${file}: absorb into base, commit ${owner}`
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(path.join(fixture.repo, file))).to.deep.equal(
      Buffer.from('prefix\r\nreviewed\r\nlast')
    );
  });

  it('stops ownership at an empty frozen anchor while permitting editable work above it', () => {
    fixture.branch('empty-anchor', 'base', true);
    fixture.branch('editable-above', 'empty-anchor');
    const owner = fixture.git(['rev-parse', 'HEAD']);
    const metadata: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/empty-anchor'])
    );
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      throw new Error('Expected valid branch metadata');
    const entry = path.join(fixture.root, 'empty-anchor-metadata.json');
    fs.writeFileSync(entry, JSON.stringify({ ...metadata, frozen: true }));
    fixture.git([
      'update-ref',
      'refs/branch-metadata/empty-anchor',
      fixture.git(['hash-object', '-w', entry]),
    ]);
    stage('base.txt', 'must remain staged\n');
    stage('editable-above.txt', 'eligible correction\n');
    const output = preview();
    expect(output).to.include('Retained base.txt:').and.include('frozen');
    expect(output).to.include(
      `editable-above.txt: absorb into editable-above, commit ${owner}`
    );
    expect(output).not.to.include('base.txt: absorb into base');
  });

  it('plans mandatory replay parent-first regardless of selected path ordering', () => {
    fixture.git(['switch', 'base']);
    stage('z-base.txt', 'base-owned\n');
    fixture.git(['commit', '-m', 'Introduce later-sorted base path']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'child']);
    stage('a-child.txt', 'child-owned\n');
    fixture.git(['commit', '-m', 'Introduce earlier-sorted child path']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('z-base.txt', 'base correction\n');
    stage('a-child.txt', 'child correction\n');
    expect(preview()).to.include('Required replay: base, child, tip.');
  });

  it('includes descendants above a middle caller and refuses an occupied side arm', () => {
    fixture.branch('side', 'base');
    fixture.branch('side-tip', 'side');
    fixture.git(['switch', 'child']);
    stage('base.txt', 'corrected base\n');
    expect(preview()).to.include(
      'Required replay: base, child, side, side-tip, tip.'
    );
    const linked = path.join(fixture.root, 'linked-side');
    fixture.git(['worktree', 'add', linked, 'side']);
    fs.writeFileSync(path.join(linked, 'side.txt'), 'dirty side work\n');
    const before = [
      fixture.inspectionSnapshot(),
      fixture.inspectionSnapshot(linked),
    ];
    const result = fixture.run(['absorb', '--dry-run', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('checked out in worktree');
    expect([
      fixture.inspectionSnapshot(),
      fixture.inspectionSnapshot(linked),
    ]).to.deep.equal(before);
  });
});
