import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

function prepareConflicts(fixture: CreateCliFixture, departure: string): void {
  fixture.stage('main.txt', 'source edit');
  fixture.git(['commit', '-m', 'source edit']);
  fixture.ok(['restack', '--upstack']);
  fixture.branch('sibling', 'base');
  fixture.branch('sibling-tip', 'sibling');
  fixture.git(['switch', 'child']);
  fixture.stage('main.txt', 'target edit');
  fixture.git(['commit', '-m', 'target edit']);
  fixture.ok(['restack', '--upstack']);
  fixture.git(['switch', departure]);
}
function expectRebase(fixture: CreateCliFixture, active: boolean): void {
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
  expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
    active ? 'main.txt' : ''
  );
}
function expectParent(
  fixture: CreateCliFixture,
  branch: string,
  parent: string
): void {
  fixture.ok(['checkout', branch]);
  fixture.ok(['down']);
  expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
}
function expectResult(
  fixture: CreateCliFixture,
  departure: string,
  content: { readonly target: string; readonly source: string }
): void {
  expect(fixture.git(['branch', '--show-current'])).to.equal(departure);
  expectRebase(fixture, false);
  expect(fixture.git(['status', '--porcelain'])).to.equal('');
  expect(
    fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
  ).to.equal('child\ntarget edit\ntip');
  expect(
    fixture.git(['log', '--reverse', '--format=%s', 'tip..base'])
  ).to.equal('base\nsource edit');
  expect(
    fixture.git(['log', '--reverse', '--format=%s', 'main..sibling-tip'])
  ).to.equal('sibling\nsibling-tip');
  expect(fixture.git(['rev-parse', 'base~2'])).to.equal(
    fixture.git(['rev-parse', 'tip'])
  );
  expect(fixture.git(['show', 'tip:main.txt'])).to.equal(content.target);
  expect(fixture.git(['show', 'base:main.txt'])).to.equal(content.source);
  expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
    'child.txt\nmain.txt\ntip.txt'
  );
  expect(fixture.git(['show', 'base:base.txt'])).to.equal('base');
  expect(fixture.git(['show', 'sibling-tip:main.txt'])).to.equal('main');
  for (const [branch, parent] of [
    ['child', 'main'],
    ['tip', 'child'],
    ['base', 'tip'],
    ['sibling', 'main'],
    ['sibling-tip', 'sibling'],
  ])
    expectParent(fixture, branch, parent);
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function retryCommands(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^ch (restack --branch|checkout) /.test(line));
}
function rawAbort(fixture: CreateCliFixture): void {
  const [command, ...args] = getTestCliCommand(['rebase', '--abort']);
  const result = spawnSync(command, args, {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) throw result.error;
  expect(result.status, result.stdout + result.stderr).to.equal(0);
  expectRebase(fixture, false);
}
function executeRetry(
  fixture: CreateCliFixture,
  commands: readonly string[]
): void {
  fs.writeFileSync(
    path.join(fixture.root, 'bin/ch'),
    `#!/bin/sh\nexec ${getTestCliCommand([])
      .map(quote)
      .join(' ')} "$@" --no-interactive\n`,
    { mode: 0o755 }
  );
  for (const line of commands) {
    const result = spawnSync('/bin/sh', ['-c', line], {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      expectRebase(fixture, true);
      fixture.stage(
        'main.txt',
        line.includes("--branch 'base'")
          ? 'source retry resolution'
          : 'target retry resolution'
      );
      fixture.ok(['continue']);
    }
  }
}

// eslint-disable-next-line max-lines-per-function
describe('move only descendant recovery through fresh public CLI processes', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const departure of ['tip', 'other']) {
    it(`continues target-subtree then source conflicts and returns to ${departure}`, () => {
      prepareConflicts(fixture, departure);
      const source = fixture.git(['rev-parse', 'base']);
      const oldTarget = fixture.git(['rev-parse', 'tip']);
      const first = fixture.run(['move', 'tip', '-s', 'base', '--only']);
      expect(first.status).not.to.equal(0);
      expect(first.stdout + first.stderr).to.include(
        'left-behind child phase (child)'
      );
      expectRebase(fixture, true);
      expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
      expect(fixture.git(['rev-parse', 'tip'])).to.equal(oldTarget);
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      fixture.stage('main.txt', 'target resolution');
      const second = fixture.run(['continue']);
      expect(second.status).not.to.equal(0);
      expect(second.stdout + second.stderr).to.include('source phase (base)');
      expectRebase(fixture, true);
      const target = fixture.git(['rev-parse', 'tip']);
      expect(target).not.to.equal(oldTarget);
      expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
        'target resolution'
      );
      const completed = ['child', 'tip', 'sibling', 'sibling-tip'].map(
        (branch) => [branch, fixture.git(['rev-parse', branch])]
      );
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      fixture.stage('main.txt', 'source resolution');
      fixture.ok(['continue']);
      for (const [branch, sha] of completed)
        expect(fixture.git(['rev-parse', branch])).to.equal(sha);
      expectResult(fixture, departure, {
        target: 'target resolution',
        source: 'source resolution',
      });
    });
  }

  it('executes the printed child-phase abort recipe before replaying source on its rewritten target', () => {
    prepareConflicts(fixture, 'other');
    const source = fixture.git(['rev-parse', 'base']);
    const oldSibling = fixture.git(['rev-parse', 'sibling']);
    const oldSiblingTip = fixture.git(['rev-parse', 'sibling-tip']);
    const result = fixture.run(['move', 'tip', '-s', 'base', '--only']);
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, true);
    const commands = retryCommands(result.stdout + result.stderr);
    const sibling = fixture.git(['rev-parse', 'sibling']);
    const siblingTip = fixture.git(['rev-parse', 'sibling-tip']);
    const expected = [
      "ch restack --branch 'child' --only",
      "ch restack --branch 'tip' --only",
      "ch restack --branch 'base' --only",
      "ch checkout 'other'",
    ];
    if (sibling === oldSibling)
      expected.push("ch restack --branch 'sibling' --only");
    if (siblingTip === oldSiblingTip)
      expected.push("ch restack --branch 'sibling-tip' --only");
    expect([...commands].sort()).to.deep.equal(expected.sort());
    expect(
      commands.indexOf("ch restack --branch 'child' --only")
    ).to.be.lessThan(commands.indexOf("ch restack --branch 'tip' --only"));
    expect(commands[commands.length - 2]).to.equal(
      "ch restack --branch 'base' --only"
    );
    expect(commands[commands.length - 1]).to.equal("ch checkout 'other'");
    rawAbort(fixture);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
    expect(fixture.git(['rev-parse', 'sibling-tip'])).to.equal(siblingTip);
    expectParent(fixture, 'base', 'tip');
    expectParent(fixture, 'child', 'main');
    const beforeContinue = fixture.snapshot();
    expect(fixture.run(['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(beforeContinue);
    executeRetry(fixture, commands);
    if (sibling !== oldSibling)
      expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
    if (siblingTip !== oldSiblingTip)
      expect(fixture.git(['rev-parse', 'sibling-tip'])).to.equal(siblingTip);
    expectResult(fixture, 'other', {
      target: 'target retry resolution',
      source: 'source retry resolution',
    });
  });

  it('executes the printed source-phase abort recipe without replaying completed target subtrees', () => {
    prepareConflicts(fixture, 'tip');
    const source = fixture.git(['rev-parse', 'base']);
    expect(
      fixture.run(['move', 'tip', '-s', 'base', '--only']).status
    ).not.to.equal(0);
    expectRebase(fixture, true);
    fixture.stage('main.txt', 'target resolution');
    const second = fixture.run(['continue']);
    expect(second.status).not.to.equal(0);
    expectRebase(fixture, true);
    expect(second.stdout + second.stderr).to.include('source phase (base)');
    const completed = ['child', 'tip', 'sibling', 'sibling-tip'].map(
      (branch) => [branch, fixture.git(['rev-parse', branch])]
    );
    const commands = retryCommands(second.stdout + second.stderr);
    expect(commands).to.deep.equal([
      "ch restack --branch 'base' --only",
      "ch checkout 'tip'",
    ]);
    rawAbort(fixture);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    for (const [branch, sha] of completed)
      expect(fixture.git(['rev-parse', branch])).to.equal(sha);
    expect(fixture.ok(['log', 'short'])).to.match(/base[^\n]*needs restack/);
    const beforeContinue = fixture.snapshot();
    expect(fixture.run(['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(beforeContinue);
    executeRetry(fixture, commands);
    for (const [branch, sha] of completed)
      expect(fixture.git(['rev-parse', branch])).to.equal(sha);
    expectResult(fixture, 'tip', {
      target: 'target resolution',
      source: 'source retry resolution',
    });
  });
});
