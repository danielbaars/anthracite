import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { expectParent } from '../lib/utils/expect_parent';

const root = "b'root";
const deep = "c'deep";
const last = "z'root";
function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function retries(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^an (restack --branch|checkout) /.test(line));
}
function expectRebase(
  fixture: CreateCliFixture,
  active: boolean,
  unmerged = active
): void {
  expect(
    ['rebase-merge', 'rebase-apply'].some((name) =>
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', name])
        )
      )
    )
  ).to.equal(active);
  expect(fixture.git(['ls-files', '--unmerged']) !== '').to.equal(unmerged);
}
function runShell(
  fixture: CreateCliFixture,
  command: string
): ReturnType<typeof fixture.run> {
  const cli = getTestCliCommand([]).map(quote).join(' ');
  fs.writeFileSync(
    path.join(fixture.root, 'bin/an'),
    `#!/bin/sh\nexec ${cli} "$@" --no-interactive\n`,
    { mode: 0o755 }
  );
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) throw result.error;
  expect(result.signal).to.equal(null);
  return result;
}
function inspectAndResolve(fixture: CreateCliFixture, content: string): void {
  fixture.ok(['info']);
  fixture.ok(['log', 'short']);
  fixture.stage('child.txt', content);
  fixture.ok(['info']);
  fixture.ok(['log', 'short']);
}
function setup(fixture: CreateCliFixture): void {
  fixture.branch('a-completed', 'base');
  fixture.commit('completed-second');
  fixture.branch(root, 'base');
  fixture.stage('child.txt', 'original root work');
  fixture.git(['commit', '-m', 'root own edit']);
  fixture.branch(deep, root);
  fixture.stage('child.txt', 'original deep work');
  fixture.git(['commit', '-m', 'deep own edit']);
  fixture.branch(last, 'base');
  fixture.stage('child.txt', 'original last work');
  fixture.git(['commit', '-m', 'last own edit']);
  fixture.git(['switch', 'child']);
}
function expectCollapse(
  fixture: CreateCliFixture,
  survivor: string,
  tip: string
): void {
  expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
  expect(
    fixture.git([
      'branch',
      '--list',
      'child',
      survivor === 'tip' ? 'base' : 'tip',
    ])
  ).to.equal('');
}
function expectResult(
  fixture: CreateCliFixture,
  survivor: string,
  tip: string
): void {
  expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
  expectCollapse(fixture, survivor, tip);
  expectRebase(fixture, false);
  expect(fixture.git(['status', '--porcelain'])).to.equal('');
  for (const [parent, branch, subjects] of [
    [survivor, 'a-completed', 'a-completed\ncompleted-second'],
    [survivor, root, `${root}\nroot own edit`],
    [root, deep, `${deep}\ndeep own edit`],
    [survivor, last, `${last}\nlast own edit`],
  ]) {
    expect(
      fixture.git(['log', '--reverse', '--format=%s', `${parent}..${branch}`])
    ).to.equal(subjects);
    expect(fixture.git(['show', `${branch}:${branch}.txt`])).to.equal(branch);
    expectParent(fixture, branch, parent);
  }
  expectParent(fixture, survivor, 'main');
}

for (const keep of [false, true]) {
  const survivor = keep ? 'tip' : 'base';
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold repeated public recovery (keep=${keep})`, function () {
    this.timeout(90000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());

    it('preserves the parent-first queue through three genuine conflicts and fresh inspection', () => {
      setup(fixture);
      const tip = fixture.git(['rev-parse', 'tip']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const history = fixture.git(['rev-list', 'tip']);
      const other = fixture.git(['rev-parse', 'other']);
      let result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      const completed = new Map<string, string>();
      for (const [branch, content] of [
        [root, 'first resolution'],
        [deep, 'second resolution'],
        [last, 'third resolution'],
      ]) {
        const output = result.stdout + result.stderr;
        expect(result.status, output).not.to.equal(0);
        expect(output).to.include(`incomplete at ${branch}`);
        expect(output).to.include('Selected collapse is complete');
        expect(output).to.include('Current checkout: detached HEAD');
        expectRebase(fixture, true);
        expectCollapse(fixture, survivor, tip);
        for (const [name, revision] of completed)
          expect(fixture.git(['rev-parse', name])).to.equal(revision);
        completed.set('a-completed', fixture.git(['rev-parse', 'a-completed']));
        inspectAndResolve(fixture, content);
        result = fixture.run(['continue']);
        completed.set(branch, fixture.git(['rev-parse', branch]));
      }
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      for (const [name, revision] of completed)
        expect(fixture.git(['rev-parse', name])).to.equal(revision);
      expect(fixture.git(['rev-parse', `${survivor}^{tree}`])).to.equal(tree);
      expect(fixture.git(['rev-list', survivor])).to.equal(history);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      for (const [branch, content] of [
        [root, 'first resolution'],
        [deep, 'second resolution'],
        [last, 'third resolution'],
      ])
        expect(fixture.git(['show', `${branch}:child.txt`])).to.equal(content);
      expectResult(fixture, survivor, tip);
    });

    it('executes raw public abort and every safely quoted named retry including new conflicts', () => {
      setup(fixture);
      const tip = fixture.git(['rev-parse', 'tip']);
      const originalRoot = fixture.git(['rev-parse', root]);
      const originalDeep = fixture.git(['rev-parse', deep]);
      const originalLast = fixture.git(['rev-parse', last]);
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      const output = result.stdout + result.stderr;
      expect(result.status, output).not.to.equal(0);
      expectRebase(fixture, true);
      expect(output).to.include('Completed branches: a-completed');
      expect(output).to.include('only cancels the active rebase');
      expect(output).to.include('parent changes and completed restacks remain');
      const commands = retries(output);
      expect(commands).to.deep.equal([
        `an restack --branch ${quote(root)} --only`,
        `an restack --branch ${quote(deep)} --only`,
        `an restack --branch ${quote(last)} --only`,
        `an checkout ${quote(survivor)}`,
      ]);
      expect(output).not.to.include('git rebase --onto');
      const completed = fixture.git(['rev-parse', 'a-completed']);
      const [executable, ...args] = getTestCliCommand(['rebase', '--abort']);
      const aborted = spawnSync(executable, args, {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
        timeout: 15000,
      });
      if (aborted.error) throw aborted.error;
      expect(aborted.status, aborted.stdout + aborted.stderr).to.equal(0);
      expectRebase(fixture, false);
      expectCollapse(fixture, survivor, tip);
      expect(fixture.git(['rev-parse', root])).to.equal(originalRoot);
      expect(fixture.git(['rev-parse', deep])).to.equal(originalDeep);
      expect(fixture.git(['rev-parse', last])).to.equal(originalLast);
      expect(fixture.git(['rev-parse', 'a-completed'])).to.equal(completed);
      for (const [branch, parent] of [
        [root, survivor],
        [deep, root],
        [last, survivor],
      ])
        expectParent(fixture, branch, parent);
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      const before = fixture.snapshot();
      const index = fs.readFileSync(path.join(fixture.repo, '.git/index'));
      expect(fixture.run(['continue']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, '.git/index'))
      ).to.deep.equal(index);
      let conflicts = 0;
      for (const command of commands) {
        const retry = runShell(fixture, command);
        if (retry.status !== 0) {
          expectRebase(fixture, true);
          conflicts++;
          inspectAndResolve(fixture, `retry resolution ${conflicts}`);
          fixture.ok(['continue']);
        }
        expect(fixture.git(['rev-parse', 'a-completed'])).to.equal(completed);
      }
      expect(conflicts).to.equal(3);
      expect(fixture.git(['show', `${root}:child.txt`])).to.equal(
        'retry resolution 1'
      );
      expect(fixture.git(['show', `${deep}:child.txt`])).to.equal(
        'retry resolution 2'
      );
      expect(fixture.git(['show', `${last}:child.txt`])).to.equal(
        'retry resolution 3'
      );
      expectResult(fixture, survivor, tip);
    });
  });
}
