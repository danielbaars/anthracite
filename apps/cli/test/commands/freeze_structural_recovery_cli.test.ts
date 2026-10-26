import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

type FoldRoute = 'ordinary' | 'stack';

function recovery(fixture: FreezeCliFixture): unknown {
  const files: Record<string, string> = {};
  const visit = (name: string): void => {
    const file = path.join(fixture.repo, '.git', name);
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const child of fs.readdirSync(file)) visit(path.join(name, child));
    } else files[name] = fs.readFileSync(file).toString('base64');
  };
  for (const name of ['.gtcontinue', 'rebase-merge', 'rebase-apply'])
    visit(name);
  return files;
}

function active(fixture: FreezeCliFixture): string {
  return fs
    .readFileSync(
      path.join(fixture.repo, '.git', 'rebase-merge', 'head-name'),
      'utf8'
    )
    .trim()
    .replace('refs/heads/', '');
}

function finish(fixture: FreezeCliFixture, command: string): void {
  for (let step = 0; step < 6; step++) {
    if (!fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))) return;
    fixture.stage('main.txt', `resolved ${active(fixture)}`);
    const result = fixture.run([command]);
    if (result.status === 0) return;
    expect(result.stdout + result.stderr).to.match(/conflict/i);
  }
  throw new Error(
    'Structural replay did not finish within six real conflict resolutions.'
  );
}

function foldConflict(
  fixture: FreezeCliFixture,
  route: FoldRoute,
  keep: boolean
): string {
  fixture.branch('conflict', 'base');
  fixture.stage('main.txt', 'conflicting sibling');
  fixture.git(['commit', '-m', 'sibling shared edit']);
  fixture.branch('z-sibling', 'base');
  fixture.git(['switch', 'child']);
  fixture.stage('main.txt', 'selected shared edit');
  fixture.git(['commit', '-m', 'selected shared edit']);
  fixture.ok(['restack', '--upstack']);
  fixture.git(['switch', route === 'stack' ? 'tip' : 'child']);
  const result = fixture.run([
    'fold',
    ...(route === 'stack' ? ['--stack'] : []),
    `--keep=${keep}`,
  ]);
  expect(result.status, result.stdout + result.stderr).to.equal(1);
  expect(active(fixture)).to.equal('conflict');
  return keep ? (route === 'stack' ? 'tip' : 'child') : 'base';
}

// eslint-disable-next-line max-lines-per-function
describe('frozen structural recovery through fresh public CLI processes', function () {
  this.timeout(120000);
  let fixture: FreezeCliFixture;
  beforeEach(() => {
    fixture = new FreezeCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const route of ['ordinary', 'stack'] as const)
    for (const keep of [false, true]) {
      it(`${route} fold keep=${keep} preserves an active frozen resolution and really resumes after unfreeze`, () => {
        const survivor = foldConflict(fixture, route, keep);
        const folded = fixture.git(['rev-parse', survivor]);
        fixture.ok(['freeze', 'conflict']);
        fixture.write('main.txt', 'unstaged resolution');
        fixture.write('portable.txt', 'preserved portable work');
        const before = fixture.observe();
        const saved = recovery(fixture);
        const result = fixture.run(['cont', '--all']);
        expect(result.status).to.equal(1);
        expect(result.stderr).to.include('an unfreeze conflict');
        expect(fixture.observe()).to.deep.equal(before);
        expect(recovery(fixture)).to.deep.equal(saved);
        fixture.ok(['unfreeze', 'conflict']);
        finish(fixture, 'continue');
        expect(
          fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
        ).to.equal(false);
        expect(fixture.git(['rev-parse', survivor])).to.equal(folded);
        expect(fixture.git(['show', 'conflict:main.txt'])).to.equal(
          'resolved conflict'
        );
        expect(fixture.git(['show', 'conflict:child.txt'])).to.equal('child');
        expect(fixture.git(['rev-parse', 'z-sibling^'])).to.equal(folded);
        expect(
          fs.readFileSync(path.join(fixture.repo, 'portable.txt'), 'utf8')
        ).to.equal('preserved portable work');
      });
    }

  it('retains the selected collapse and refuses a later newly frozen stack-fold replay before staging the active resolution', () => {
    const survivor = foldConflict(fixture, 'stack', false);
    const folded = fixture.git(['rev-parse', survivor]);
    fixture.ok(['freeze', 'z-sibling']);
    fixture.write('main.txt', 'unstaged resolution');
    const before = fixture.observe();
    const saved = recovery(fixture);
    const result = fixture.run(['continue', '--all']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('an unfreeze z-sibling');
    expect(result.stdout + result.stderr).to.include(
      'Parent changes and completed restacks remain'
    );
    expect(fixture.observe()).to.deep.equal(before);
    expect(recovery(fixture)).to.deep.equal(saved);
    fixture.ok(['unfreeze', 'z-sibling']);
    finish(fixture, 'cont');
    expect(fixture.git(['rev-parse', survivor])).to.equal(folded);
    expect(fixture.git(['show', 'conflict:main.txt'])).to.equal(
      'resolved conflict'
    );
    expect(fixture.git(['rev-parse', 'z-sibling^'])).to.equal(folded);
  });

  it('retains the inserted commit and mandatory queue across frozen refusal and actual resolution', () => {
    fixture.branch('z-sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.stage('main.txt', 'child shared edit');
    fixture.git(['commit', '-m', 'child shared edit']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    fixture.stage('main.txt', 'insert shared edit');
    const start = fixture.run([
      'c',
      'inserted',
      '-i',
      '-m',
      'insert shared edit',
    ]);
    expect(start.status, start.stdout + start.stderr).to.equal(1);
    expect(active(fixture)).to.equal('child');
    const inserted = fixture.git(['rev-parse', 'inserted']);
    fixture.ok(['freeze', 'z-sibling']);
    fixture.write('main.txt', 'unstaged insertion resolution');
    const before = fixture.observe();
    const saved = recovery(fixture);
    const result = fixture.run(['cont', '--all']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('an unfreeze z-sibling');
    expect(fixture.observe()).to.deep.equal(before);
    expect(recovery(fixture)).to.deep.equal(saved);
    fixture.ok(['unfreeze', 'z-sibling']);
    finish(fixture, 'continue');
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
    expect(fixture.git(['show', 'inserted:main.txt'])).to.equal(
      'insert shared edit'
    );
    expect(fixture.git(['show', 'child:main.txt'])).to.equal('resolved child');
    expect(fixture.git(['rev-parse', 'z-sibling^'])).to.equal(inserted);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
  });

  for (const stack of [false, true])
    it(`reorder stack=${stack} retains its plan through frozen active refusal and repeated real conflicts`, () => {
      fixture.stage('main.txt', 'base shared edit');
      fixture.git(['commit', '-m', 'base shared edit']);
      fixture.ok(['restack', '--upstack']);
      fixture.git(['switch', 'child']);
      fixture.stage('main.txt', 'child shared edit');
      fixture.git(['commit', '-m', 'child shared edit']);
      fixture.ok(['restack', '--upstack']);
      fixture.git(['switch', 'tip']);
      const input = path.join(fixture.root, 'order');
      fs.writeFileSync(input, 'tip\nbase\nchild\n');
      const start = fixture.run(['ro', `--stack=${stack}`, '--input', input]);
      expect(start.status, start.stdout + start.stderr).to.equal(1);
      expect(active(fixture)).to.equal('child');
      fixture.ok(['freeze', 'child']);
      fixture.write('main.txt', 'unstaged reorder resolution');
      const before = fixture.observe();
      const saved = recovery(fixture);
      const blocked = fixture.run(['continue', '--all']);
      expect(blocked.status).to.equal(1);
      expect(blocked.stderr).to.include('an unfreeze child');
      expect(fixture.observe()).to.deep.equal(before);
      expect(recovery(fixture)).to.deep.equal(saved);
      fixture.ok(['unfreeze', 'child']);
      finish(fixture, 'cont');
      expect(
        fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
      ).to.equal(false);
      expect(fixture.git(['show', 'tip:main.txt'])).to.equal('resolved base');
      expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
      ).to.equal('child\nchild shared edit\nbase\nbase shared edit\ntip');
      expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    });

  it('keeps bounded abort available after freezing a structural conflict and retains completed parent changes', () => {
    foldConflict(fixture, 'stack', false);
    const folded = fixture.git(['rev-parse', 'base']);
    const conflict = fixture.git(['rev-parse', 'conflict']);
    fixture.ok(['freeze', 'conflict']);
    const [executable, ...args] = getTestCliCommand(['rebase', '--abort']);
    const result = spawnSync(executable, args, {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(false);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(folded);
    expect(fixture.git(['rev-parse', 'conflict'])).to.equal(conflict);
    expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
    expect(fixture.ok(['info', 'conflict'])).to.include('Parent: base');
    expect(fixture.ok(['info', 'conflict'])).to.include('(frozen)');
  });
});
