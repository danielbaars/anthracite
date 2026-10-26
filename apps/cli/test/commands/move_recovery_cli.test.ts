import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { expectParent } from '../lib/utils/expect_parent';

function prepareLaterConflict(fixture: CreateCliFixture): void {
  fixture.stage('main.txt', 'source edit');
  fixture.git(['commit', '-m', 'source edit']);
  fixture.ok(['restack', '--upstack']);
  fixture.branch('conflicting', 'tip');
  fixture.stage('main.txt', 'conflicting edit');
  fixture.git(['commit', '-m', 'conflicting edit']);
  fixture.branch('tail', 'conflicting');
  fixture.git(['switch', 'other']);
}
function expectRebase(
  fixture: CreateCliFixture,
  active: boolean,
  unmerged = active
): void {
  const states = ['rebase-merge', 'rebase-apply'].map((name) =>
    fs.existsSync(
      path.resolve(fixture.repo, fixture.git(['rev-parse', '--git-path', name]))
    )
  );
  expect(states.some(Boolean)).to.equal(active);
  expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
    unmerged ? 'main.txt' : ''
  );
}
function quote(argument: string): string {
  return `'${argument.replace(/'/g, `'\\''`)}'`;
}
function retryCommands(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^an (restack --branch|checkout) /.test(line));
}
function rawAbort(fixture: CreateCliFixture): void {
  const [executable, ...args] = getTestCliCommand(['rebase', '--abort']);
  const result = spawnSync(executable, args, {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) throw result.error;
  expect(result.status, result.stdout + result.stderr).to.equal(0);
}
function executeRetry(
  fixture: CreateCliFixture,
  commands: readonly string[]
): void {
  const command = getTestCliCommand([]).map(quote).join(' ');
  fs.writeFileSync(
    path.join(fixture.root, 'bin', 'an'),
    `#!/bin/sh\nexec ${command} "$@" --no-interactive\n`,
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
      fixture.stage('main.txt', 'retry resolution');
      fixture.ok(['continue']);
    }
  }
}

// eslint-disable-next-line max-lines-per-function
describe('move recovery through new public CLI processes', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('prints and executes a complete child-phase abort retry after a completed prefix', () => {
    prepareLaterConflict(fixture);
    const source = fixture.git(['rev-parse', 'base']);
    const result = fixture.run(['move', '-o', 'other', '-s', 'base', '--only']);
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, true);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    const output = result.stdout + result.stderr;
    expect(output)
      .to.include('left-behind child phase')
      .and.include('conflicting');
    expect(output).to.match(/completed branches[^\n]*child[^\n]*tip/i);
    const commands = retryCommands(output);
    expect(commands).to.deep.equal([
      "an restack --branch 'conflicting' --only",
      "an restack --branch 'tail' --only",
      "an restack --branch 'base' --only",
      "an checkout 'other'",
    ]);
    rawAbort(fixture);
    expectRebase(fixture, false);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.ok(['log', 'short'])).to.match(
      /conflicting[^\n]*needs restack/
    );
    expectParent(fixture, 'conflicting', 'tip');
    expectParent(fixture, 'child', 'main');
    expectParent(fixture, 'base', 'other');
    const beforeContinue = fixture.snapshot();
    expect(fixture.run(['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(beforeContinue);
    executeRetry(fixture, commands);
    expectRebase(fixture, false);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tail'])
    ).to.equal('child\ntip\nconflicting\nconflicting edit\ntail');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource edit');
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal('retry resolution');
    expect(fixture.git(['show', 'base:main.txt'])).to.equal('source edit');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expectParent(fixture, 'tail', 'conflicting');
    expectParent(fixture, 'tip', 'child');
  });
  it('preserves the plan through repeated child and source conflicts and inspection', () => {
    prepareLaterConflict(fixture);
    fixture.git(['switch', 'tail']);
    fixture.stage('main.txt', 'tail edit');
    fixture.git(['commit', '-m', 'tail edit']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'target edit');
    fixture.git(['commit', '-m', 'target edit']);
    fixture.git(['switch', 'tip']);
    const first = fixture.run(['move', '-o', 'other', '-s', 'base', '--only']);
    expect(first.status).not.to.equal(0);
    expectRebase(fixture, true);
    const unresolvedRefs = fixture.refs();
    const unresolved = fixture.run(['continue']);
    expect(unresolved.status).not.to.equal(0);
    expectRebase(fixture, true);
    expect(fixture.refs()).to.equal(unresolvedRefs);
    expect(unresolved.stdout + unresolved.stderr)
      .to.include('left-behind child phase (conflicting)')
      .and.include('Completed branches: child, tip');
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    fixture.ok(['info']);
    fixture.ok(['log', 'short']);
    fixture.stage('main.txt', 'first resolution');
    fixture.ok(['log', 'short']);
    const second = fixture.run(['continue']);
    expect(second.status).not.to.equal(0);
    expectRebase(fixture, true);
    expect(second.stdout + second.stderr)
      .to.include('left-behind child phase (tail)')
      .and.include('Completed branches: child, tip, conflicting');
    const conflicting = fixture.git(['rev-parse', 'conflicting']);
    expect(fixture.git(['show', 'conflicting:main.txt'])).to.equal(
      'first resolution'
    );
    fixture.ok(['info']);
    fixture.stage('main.txt', 'second resolution');
    fixture.ok(['log', 'short']);
    const third = fixture.run(['continue']);
    expect(third.status).not.to.equal(0);
    expectRebase(fixture, true);
    expect(third.stdout + third.stderr)
      .to.include('source phase (base)')
      .and.include('Completed branches: child, tip, conflicting, tail');
    const tail = fixture.git(['rev-parse', 'tail']);
    fixture.ok(['info']);
    fixture.ok(['log', 'short']);
    fixture.stage('main.txt', 'source resolution');
    fixture.ok(['continue']);
    expectRebase(fixture, false);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    for (const [branch, revision] of [
      ['child', child],
      ['tip', tip],
      ['conflicting', conflicting],
      ['tail', tail],
    ]) {
      expect(fixture.git(['rev-parse', branch])).to.equal(revision);
    }
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tail'])
    ).to.equal('child\ntip\nconflicting\nconflicting edit\ntail\ntail edit');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource edit');
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'second resolution'
    );
    expect(fixture.git(['show', 'base:main.txt'])).to.equal(
      'source resolution'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const [branch, parent] of [
      ['base', 'other'],
      ['child', 'main'],
      ['tip', 'child'],
      ['conflicting', 'tip'],
      ['tail', 'conflicting'],
    ])
      expectParent(fixture, branch, parent);
  });

  it('executes the printed source-phase abort retry and preserves completed child refs', () => {
    fixture.stage('main.txt', 'source edit');
    fixture.git(['commit', '-m', 'source edit']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'target edit');
    fixture.git(['commit', '-m', 'target edit']);
    fixture.git(['switch', 'tip']);
    const source = fixture.git(['rev-parse', 'base']);
    const result = fixture.run(['move', '-o', 'other', '-s', 'base', '--only']);
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, true);
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    const commands = retryCommands(result.stdout + result.stderr);
    expect(commands).to.deep.equal([
      "an restack --branch 'base' --only",
      "an checkout 'tip'",
    ]);
    expect(result.stdout + result.stderr)
      .to.include('source phase (base)')
      .and.include('Completed branches: child, tip');
    rawAbort(fixture);
    expectRebase(fixture, false);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.ok(['log', 'short'])).to.match(/base[^\n]*needs restack/);
    const beforeContinue = fixture.snapshot();
    expect(fixture.run(['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(beforeContinue);
    executeRetry(fixture, commands);
    expectRebase(fixture, false);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource edit');
    expect(fixture.git(['show', 'base:main.txt'])).to.equal('retry resolution');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expectParent(fixture, 'base', 'other');
    expectParent(fixture, 'child', 'main');
    expectParent(fixture, 'tip', 'child');
  });

  it('preserves ignored work and reports a completed rewrite when the final hidden return is blocked', () => {
    fixture.git(['switch', '-c', 'departure', 'main']);
    fixture.commit('departure');
    fixture.git(['worktree', 'add', fixture.linked, 'main']);
    fixture.stage('main.txt', 'unrelated staged work', fixture.linked);
    fixture.write(
      'independent.txt',
      'unrelated untracked work',
      fixture.linked
    );
    const linked = fixture.snapshot(fixture.linked);
    const before = fixture
      .refs()
      .split('\n')
      .filter((line) => !line.startsWith('refs/heads/tip '));
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\ndeparture.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-rewrite'),
      "#!/bin/sh\nprintf 'late ignored work' > departure.txt\n",
      { mode: 0o755 }
    );
    const result = fixture.run(['move', '-o', 'other', '-s', 'tip', '--only']);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'departure.txt'), 'utf8'),
      result.stdout + result.stderr
    ).to.equal('late ignored work');
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, false);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
    ).to.equal('tip');
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/tip '))
    ).to.deep.equal(before);
    const afterLinked = fixture.snapshot(fixture.linked);
    expect({ ...afterLinked, refs: linked.refs }).to.deep.equal(linked);
    const output = result.stdout + result.stderr;
    expect(output)
      .to.match(/rewrite[^\n]*tip[^\n]*completed/i)
      .and.match(/return[^\n]*departure[^\n]*failed/i)
      .and.match(/checkout[^\n]*tip/i);
    expect(retryCommands(output)).to.deep.equal(["an checkout 'departure'"]);
    const saved = path.join(fixture.root, 'retained-ignored-work.txt');
    fs.renameSync(path.join(fixture.repo, 'departure.txt'), saved);
    executeRetry(fixture, retryCommands(output));
    expect(fixture.git(['branch', '--show-current'])).to.equal('departure');
    expect(fs.readFileSync(saved, 'utf8')).to.equal('late ignored work');
    expectParent(fixture, 'tip', 'other');
  });

  it('rechecks late ignored replay obstructions before the next branch starts', () => {
    fixture.git(['switch', 'other']);
    const source = fixture.git(['rev-parse', 'base']);
    const oldTip = fixture.git(['rev-parse', 'tip']);
    const marker = path.join(fixture.root, 'hook-ran');
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\nbase.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-rewrite'),
      `#!/bin/sh\nif [ ! -f ${quote(marker)} ]; then\n  : > ${quote(
        marker
      )}\n  printf 'late ignored replay work' > base.txt\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['move', '-o', 'other', '-s', 'base', '--only']);
    expect(
      fs.existsSync(path.join(fixture.repo, 'base.txt')),
      result.stdout + result.stderr
    ).to.equal(true);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('late ignored replay work');
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, false);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(oldTip);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..child'])
    ).to.equal('child');
    const child = fixture.git(['rev-parse', 'child']);
    const output = result.stdout + result.stderr;
    expect(output)
      .to.include('Completed branches: child')
      .and.include('left-behind child phase (tip)');
    expect(retryCommands(output)).to.deep.equal([
      "an restack --branch 'tip' --only",
      "an restack --branch 'base' --only",
      "an checkout 'other'",
    ]);
    const saved = path.join(fixture.root, 'saved-late-replay-work');
    fs.renameSync(path.join(fixture.repo, 'base.txt'), saved);
    executeRetry(fixture, retryCommands(output));
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base');
    expect(fs.readFileSync(saved, 'utf8')).to.equal('late ignored replay work');
    expectParent(fixture, 'base', 'other');
    expectParent(fixture, 'child', 'main');
  });

  it('rechecks ignored intermediate paths before a fresh continue replays them', () => {
    prepareLaterConflict(fixture);
    fixture.git(['switch', 'conflicting']);
    fixture.stage('transient.txt', 'temporary tracked replay work');
    fixture.git(['commit', '-m', 'transient add']);
    fixture.git(['rm', 'transient.txt']);
    fixture.git(['commit', '-m', 'transient remove']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'other']);
    expect(
      fixture.run(['move', 'other', '-s', 'base', '--only']).status
    ).not.to.equal(0);
    expectRebase(fixture, true);
    const refs = fixture.refs();
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\ntransient.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'transient.txt'),
      'precious late ignored work'
    );
    fixture.stage('main.txt', 'continue resolution');
    fixture.ok(['info']);
    fixture.ok(['log', 'short']);
    const staged = fixture.git(['diff', '--cached', '--binary']);
    const result = fixture.run(['continue']);
    expect(
      fs.existsSync(path.join(fixture.repo, 'transient.txt')),
      result.stdout + result.stderr
    ).to.equal(true);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'transient.txt'), 'utf8')
    ).to.equal('precious late ignored work');
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, true, false);
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(staged);
    expect(result.stdout + result.stderr).to.include(
      'left-behind child phase (conflicting)'
    );
    const saved = path.join(fixture.root, 'saved-continue-work');
    fs.renameSync(path.join(fixture.repo, 'transient.txt'), saved);
    fixture.ok(['continue']);
    expectRebase(fixture, false);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fs.readFileSync(saved, 'utf8')).to.equal(
      'precious late ignored work'
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tail'])
    ).to.equal(
      'child\ntip\nconflicting\nconflicting edit\ntransient add\ntransient remove\ntail'
    );
    expect(fixture.git(['show', 'tail:main.txt'])).to.equal(
      'continue resolution'
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource edit');
    expectParent(fixture, 'tail', 'conflicting');
    expectParent(fixture, 'base', 'other');
  });

  it('reports a non-mutating hook refusal and executes safely quoted retry names', () => {
    fixture.git(['switch', '-c', "tip'quote", 'tip']);
    fixture.ok(['track', "tip'quote", '--parent', 'child']);
    fixture.git(['switch', '-c', "depart'quote", 'main']);
    fixture.commit('departure');
    const refs = fixture.refs();
    const status = fixture.git(['status', '--porcelain']);
    const index = fixture.git(['diff', '--cached', '--binary']);
    const hook = path.join(fixture.repo, '.git/hooks/pre-rebase');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const result = fixture.run([
      'move',
      '-o',
      'other',
      '-s',
      "tip'quote",
      '--only',
    ]);
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, false);
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['status', '--porcelain'])).to.equal(status);
    expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(index);
    const output = result.stdout + result.stderr;
    expect(output)
      .to.include("source phase (tip'quote)")
      .and.include('Completed branches: none')
      .and.include('Parent changes and completed restacks remain');
    expect(retryCommands(output)).to.deep.equal([
      "an restack --branch 'tip'\\''quote' --only",
      "an checkout 'depart'\\''quote'",
    ]);
    fs.unlinkSync(hook);
    expectParent(fixture, "tip'quote", 'other');
    executeRetry(fixture, retryCommands(output));
    expect(fixture.git(['branch', '--show-current'])).to.equal("depart'quote");
    expect(
      fixture.git(['log', '--reverse', '--format=%s', "other..tip'quote"])
    ).to.equal('tip');
    expect(fixture.git(['show', "tip'quote:tip.txt"])).to.equal('tip');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expectParent(fixture, "tip'quote", 'other');
  });

  it('reports completed source progress when fresh continue cannot return to departure', () => {
    fixture.git(['switch', 'tip']);
    fixture.stage('main.txt', 'source edit');
    fixture.git(['commit', '-m', 'source edit']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'target edit');
    fixture.git(['commit', '-m', 'target edit']);
    fixture.git(['switch', '-c', 'departure', 'main']);
    fixture.commit('departure');
    fixture.ok(['track', 'departure', '--parent', 'main']);
    expect(
      fixture.run(['move', 'other', '-s', 'tip', '--only']).status
    ).not.to.equal(0);
    expectRebase(fixture, true);
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\ndeparture.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-rewrite'),
      "#!/bin/sh\nprintf 'late continue return work' > departure.txt\n",
      { mode: 0o755 }
    );
    fixture.stage('main.txt', 'continued resolution');
    fixture.ok(['info']);
    fixture.ok(['log', 'short']);
    const result = fixture.run(['continue']);
    expect(result.status).not.to.equal(0);
    expectRebase(fixture, false);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'departure.txt'), 'utf8')
    ).to.equal('late continue return work');
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
    ).to.equal('tip\nsource edit');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
      'continued resolution'
    );
    const output = result.stdout + result.stderr;
    expect(output)
      .to.match(/rewrite[^\n]*tip[^\n]*completed/i)
      .and.include('Completed branches: tip')
      .and.include('Remaining branches: none');
    expect(retryCommands(output)).to.deep.equal(["an checkout 'departure'"]);
    const before = fixture.snapshot();
    expect(fixture.run(['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'departure.txt'), 'utf8')
    ).to.equal('late continue return work');
    const saved = path.join(fixture.root, 'saved-continue-return-work');
    fs.renameSync(path.join(fixture.repo, 'departure.txt'), saved);
    executeRetry(fixture, retryCommands(output));
    expect(fixture.git(['branch', '--show-current'])).to.equal('departure');
    expect(fs.readFileSync(saved, 'utf8')).to.equal(
      'late continue return work'
    );
    expectParent(fixture, 'tip', 'other');
  });
});
