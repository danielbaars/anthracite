import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

function change(
  fixture: ReorderCliFixture,
  text: string,
  message: string
): void {
  fs.writeFileSync(path.join(fixture.repo, 'main.txt'), text);
  fixture.git(['add', 'main.txt']);
  fixture.git(['commit', '-m', message]);
}
function setup(fixture: ReorderCliFixture): void {
  fixture.branch('r-base', 'main', true);
  change(fixture, 'base own', 'base own');
  fixture.commit('base second');
  fixture.branch('r-child', 'r-base', true);
  change(fixture, 'child own', 'child own');
  fixture.commit('child second');
  fixture.branch('r-tip', 'r-child');
  fixture.commit('tip second');
  fixture.branch("side'$(false)", 'r-base', true);
  change(fixture, 'side own', 'side own');
  fixture.commit('side second');
  fixture.branch('r-deep', "side'$(false)");
  fixture.git(['switch', 'r-child']);
  fixture.editor('r-base\nr-tip\nr-child\n');
}
function resolve(fixture: ReorderCliFixture, text: string): void {
  fs.writeFileSync(path.join(fixture.repo, 'main.txt'), text);
  fixture.git(['add', 'main.txt']);
}
function active(fixture: ReorderCliFixture): boolean {
  return ['rebase-merge', 'rebase-apply'].some((name) =>
    fs.existsSync(
      path.resolve(fixture.repo, fixture.git(['rev-parse', '--git-path', name]))
    )
  );
}
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function commands(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^an (restack --branch|checkout) /.test(line));
}
function execute(fixture: ReorderCliFixture, command: string): string {
  const bin = path.join(fixture.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'an'),
    `#!/bin/sh\nexec ${getTestCliCommand([]).map(quote).join(' ')} "$@"\n`,
    { mode: 0o755 }
  );
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd: fixture.repo,
    env: { ...fixture.env, PATH: `${bin}:${fixture.env.PATH ?? ''}` },
    encoding: 'utf8',
    timeout: 20000,
  });
  if (result.error) throw result.error;
  if (process.env.ANTHRACITE_TEST_EVIDENCE_DIR)
    fs.appendFileSync(
      path.join(fixture.root, 'cli.jsonl'),
      JSON.stringify({
        command,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      }) + '\n'
    );
  const output = result.stdout + result.stderr;
  if (active(fixture)) {
    expect(result.status, output).not.to.equal(0);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    resolve(
      fixture,
      command.includes('side') ? 'side recovered' : 'reordered base'
    );
    fixture.ok(['info']);
    fixture.ok(['log']);
    fixture.ok(['continue']);
  } else expect(result.status, output).to.equal(0);
  return output;
}
function expectFinal(fixture: ReorderCliFixture): void {
  // Assert the final checkout before parent inspection performs navigation.
  expect(fixture.git(['branch', '--show-current'])).to.equal('r-child');
  expect(active(fixture)).to.equal(false);
  expect(
    fixture.git(['status', '--porcelain', '--untracked-files=no'])
  ).to.equal('');
  for (const [name, parent, subjects] of [
    ['r-child', 'main', 'child own\nchild second'],
    ['r-tip', 'r-child', 'r-tip\ntip second'],
    ['r-base', 'r-tip', 'base own\nbase second'],
    ["side'$(false)", 'r-base', 'side own\nside second'],
    ['r-deep', "side'$(false)", 'r-deep'],
  ]) {
    expect(fixture.parent(name)).to.equal(parent);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
    ).to.equal(subjects);
  }
  expect(fixture.git(['show', 'r-base:main.txt'])).to.equal('reordered base');
  expect(fixture.git(['show', 'r-deep:main.txt'])).to.equal('side recovered');
  expect(fixture.git(['rev-list', '--merges', 'main..r-deep'])).to.equal('');
}
// eslint-disable-next-line max-lines-per-function
describe('stack reorder persistent progress and executable recovery', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
    setup(fixture);
  });
  afterEach(() => fixture?.cleanup());
  it('reports original departure, applied graph, actual conflict and remaining parent-first plan', () => {
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(active(fixture)).to.equal(true);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(output)
      .to.include('Departure branch: r-child')
      .and.include('Parent graph: applied')
      .and.include(
        "Applied parents: r-child -> main, r-tip -> r-child, r-base -> r-tip, side'$(false) -> r-base, r-deep -> side'$(false)"
      )
      .and.include('Conflict branch: r-child')
      .and.include('Current checkout: detached HEAD')
      .and.include('Completed branches: none')
      .and.include(
        "Remaining branches: r-child, r-tip, r-base, side'$(false), r-deep"
      );
    expect(fixture.ok(['info'])).to.include('r-child');
    expect(fixture.ok(['log'])).to.include('r-base');
    resolve(fixture, 'child own');
    const next = fixture.run(['continue']);
    expect(next.status).not.to.equal(0);
    expect(next.stdout + next.stderr)
      .to.include('Departure branch: r-child')
      .and.include('Conflict branch: r-base')
      .and.include('Completed branches: r-child, r-tip')
      .and.include("Remaining branches: r-base, side'$(false), r-deep");
  });
  it('continues repeated selected and off-chain conflicts from fresh inspection without losing own commits', () => {
    const unchanged = ['main', 'base', 'child', 'tip', 'other'].map((name) =>
      fixture.git(['rev-parse', name])
    );
    const first = fixture.run(['reorder', '--stack', '--interactive']);
    expect(first.status).not.to.equal(0);
    const bytes = Buffer.from([0, 255, 128, 10]);
    const privateFile = '[private] line\nbytes.bin';
    fs.writeFileSync(path.join(fixture.repo, privateFile), bytes);
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\nignored.bin\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'ignored.bin'), bytes);
    for (const [text, nextConflict, completed] of [
      ['child own', 'r-base', 'r-child, r-tip'],
      ['reordered base', "side'$(false)", 'r-child, r-tip, r-base'],
    ]) {
      expect(active(fixture)).to.equal(true);
      const saved = fixture.snapshot();
      expect(fixture.ok(['info'])).to.include('r-child');
      expect(fixture.ok(['log'])).to.include('r-deep');
      expect(fixture.snapshot()).to.deep.equal(saved);
      resolve(fixture, text);
      const next = fixture.run(['continue']);
      expect(next.status).not.to.equal(0);
      expect(next.stdout + next.stderr)
        .to.include(`Conflict branch: ${nextConflict}`)
        .and.include(`Completed branches: ${completed}`)
        .and.include('Departure branch: r-child');
    }
    fixture.ok(['info']);
    fixture.ok(['log']);
    resolve(fixture, 'side recovered');
    fixture.ok(['continue']);
    expectFinal(fixture);
    expect(
      ['main', 'base', 'child', 'tip', 'other'].map((name) =>
        fixture.git(['rev-parse', name])
      )
    ).to.deep.equal(unchanged);
    expect(fs.readFileSync(path.join(fixture.repo, privateFile))).to.deep.equal(
      bytes
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'ignored.bin'))
    ).to.deep.equal(bytes);
  });
  it('runs the literal raw abort then every quoted named retry including renewed conflicts without hidden continuation', () => {
    expect(
      fixture.run(['reorder', '--stack', '--interactive']).status
    ).not.to.equal(0);
    resolve(fixture, 'child own');
    const stopped = fixture.run(['continue']);
    const output = stopped.stdout + stopped.stderr;
    expect(stopped.status).not.to.equal(0);
    expect(output).to.include('an rebase --abort');
    const completed = ['r-child', 'r-tip'].map((name) =>
      fixture.git(['rev-parse', name])
    );
    execute(fixture, 'an rebase --abort');
    expect(active(fixture)).to.equal(false);
    const saved = fixture.snapshot();
    expect(fixture.run(['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(saved);
    const retries = commands(output);
    expect(retries).to.deep.equal([
      "an restack --branch 'r-base' --only",
      `an restack --branch ${quote("side'$(false)")} --only`,
      "an restack --branch 'r-deep' --only",
      "an checkout 'r-child'",
    ]);
    for (const command of retries) execute(fixture, command);
    expectFinal(fixture);
    expect(
      ['r-child', 'r-tip'].map((name) => fixture.git(['rev-parse', name]))
    ).to.deep.equal(completed);
  });
  for (const ignored of [false, true]) {
    it(`rechecks ${
      ignored ? 'ignored' : 'untracked'
    } pending replay paths before fresh continue without touching staged resolution`, () => {
      expect(
        fixture.run(['reorder', '--stack', '--interactive']).status
      ).not.to.equal(0);
      resolve(fixture, 'child own');
      const file = 'side second.txt';
      if (ignored)
        fs.appendFileSync(
          path.join(fixture.repo, '.git/info/exclude'),
          `\n${file}\n`
        );
      const bytes = Buffer.from([0, 255, 128, 10]);
      fs.writeFileSync(path.join(fixture.repo, file), bytes);
      fixture.ok(['info']);
      fixture.ok(['log']);
      const saved = fixture.snapshot();
      const result = fixture.run(['continue']);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr)
        .to.include(ignored ? 'ignored file' : 'untracked file')
        .and.include('Departure branch: r-child')
        .and.include('Current checkout: detached HEAD');
      expect(fixture.snapshot()).to.deep.equal(saved);
      expect(active(fixture)).to.equal(true);
      expect(fs.readFileSync(path.join(fixture.repo, file))).to.deep.equal(
        bytes
      );
      fs.renameSync(
        path.join(fixture.repo, file),
        path.join(fixture.root, 'saved-local-bytes')
      );
      expect(fixture.run(['continue']).status).not.to.equal(0);
      resolve(fixture, 'reordered base');
      expect(fixture.run(['continue']).status).not.to.equal(0);
      resolve(fixture, 'side recovered');
      fixture.ok(['continue']);
      expectFinal(fixture);
      expect(
        fs.readFileSync(path.join(fixture.root, 'saved-local-bytes'))
      ).to.deep.equal(bytes);
    });
  }
  it('rechecks pending linked worktrees in fresh continue and preserves both indexes and linked work', () => {
    expect(
      fixture.run(['reorder', '--stack', '--interactive']).status
    ).not.to.equal(0);
    resolve(fixture, 'child own');
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, "side'$(false)"]);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'linked staged');
    fixture.git(['add', 'main.txt'], linked);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'linked unfinished');
    const saved = fixture.snapshot();
    const linkedSaved = fixture.snapshot(linked);
    const result = fixture.run(['continue']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('worktree')
      .and.include('Departure branch: r-child');
    expect(fixture.snapshot()).to.deep.equal(saved);
    expect(fixture.snapshot(linked)).to.deep.equal(linkedSaved);
    fixture.git(['switch', '--detach'], linked);
    expect(fixture.run(['continue']).status).not.to.equal(0);
    resolve(fixture, 'reordered base');
    expect(fixture.run(['continue']).status).not.to.equal(0);
    resolve(fixture, 'side recovered');
    fixture.ok(['continue']);
    expectFinal(fixture);
    expect({
      ...fixture.snapshot(linked),
      refs: linkedSaved.refs,
      branch: linkedSaved.branch,
    }).to.deep.equal(linkedSaved);
  });
  it('retains staged resolution and unstaged tracked work when fresh continue cannot replay', () => {
    expect(
      fixture.run(['reorder', '--stack', '--interactive']).status
    ).not.to.equal(0);
    resolve(fixture, 'child own');
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'unfinished tracked bytes'
    );
    const saved = fixture.snapshot();
    const result = fixture.run(['continue']);
    expect(result.status).not.to.equal(0);
    expect(active(fixture)).to.equal(true);
    expect(fixture.snapshot()).to.deep.equal(saved);
    fixture.git(['checkout', '--', 'main.txt']);
    expect(fixture.run(['continue']).status).not.to.equal(0);
    resolve(fixture, 'reordered base');
    expect(fixture.run(['continue']).status).not.to.equal(0);
    resolve(fixture, 'side recovered');
    fixture.ok(['continue']);
    expectFinal(fixture);
  });
  it('truthfully counts parent-only equal-tip replays as completed before a later conflict', () => {
    fixture.branch('empty-one', 'main', true);
    fixture.branch('empty-two', 'empty-one', true);
    fixture.ok(['move', '--source', 'r-base', '--onto', 'empty-two']);
    fixture.git(['switch', 'r-child']);
    fixture.editor('r-base\nr-tip\nr-child\nempty-one\nempty-two\n');
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(output)
      .to.include('empty-two does not need to be restacked')
      .and.include('empty-one does not need to be restacked')
      .and.include('Completed branches: empty-two, empty-one')
      .and.include(
        "Remaining branches: r-child, r-tip, r-base, side'$(false), r-deep"
      );
  });
  for (const finalReplay of [false, true]) {
    it(`records a completed rewrite before its failed ${
      finalReplay ? 'final' : 'intermediate'
    } return checkout and offers only actual pending recovery`, () => {
      if (finalReplay) fixture.ok(['delete', 'r-deep', '--force']);
      fixture.git(['switch', 'r-base']);
      fs.writeFileSync(
        path.join(fixture.repo, 'café.txt'),
        'base Unicode content'
      );
      fixture.git(['add', 'café.txt']);
      fixture.git(['commit', '-m', 'base Unicode']);
      fixture.ok(['restack', '--branch', 'r-child', '--upstack']);
      fixture.ok(['restack', '--branch', "side'$(false)", '--upstack']);
      fixture.git(['switch', "side'$(false)"]);
      fixture.git(['rm', 'café.txt']);
      fixture.git(['commit', '-m', 'side Unicode removal']);
      fixture.git(['switch', 'r-child']);
      // C owns this edit, so its final tree retains the path after moving to trunk.
      fs.writeFileSync(
        path.join(fixture.repo, 'café.txt'),
        'departure Unicode content'
      );
      fixture.git(['add', 'café.txt']);
      fixture.git(['commit', '-m', 'child Unicode']);
      fixture.ok(['restack', '--branch', 'r-tip']);
      fixture.git(['switch', 'r-child']);
      expect(
        fixture.run(['reorder', '--stack', '--interactive']).status
      ).not.to.equal(0);
      resolve(fixture, 'child own');
      // The selected Unicode edit also conflicts when replayed without its base.
      fs.writeFileSync(
        path.join(fixture.repo, 'café.txt'),
        'departure Unicode content'
      );
      fixture.git(['add', 'café.txt']);
      let result = fixture.run(['continue']);
      for (
        let step = 0;
        step < 4 &&
        active(fixture) &&
        !(result.stdout + result.stderr).includes(
          "Conflict branch: side'$(false)"
        );
        step++
      ) {
        resolve(fixture, 'reordered base');
        fs.writeFileSync(
          path.join(fixture.repo, 'café.txt'),
          'departure Unicode content'
        );
        fixture.git(['add', 'café.txt']);
        result = fixture.run(['continue']);
      }
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        "Conflict branch: side'$(false)"
      );
      fixture.ok(['info']);
      fixture.ok(['log']);
      resolve(fixture, 'side recovered');
      const removal = fixture.run(['continue']);
      expect(removal.status).not.to.equal(0);
      expect(fixture.git(['ls-files', '--unmerged'])).to.include('caf');
      fixture.git(['rm', '--', 'café.txt']);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\ncafé.txt\ncafe\u0301.txt\n'
      );
      const hook = path.join(fixture.repo, '.git/hooks/post-rewrite');
      fs.writeFileSync(
        hook,
        `#!/bin/sh\nprintf '\\000\\377\\200\\013' > ${quote(
          'cafe\u0301.txt'
        )}\n`,
        { mode: 0o755 }
      );
      const stopped = fixture.run(['continue']);
      const output = stopped.stdout + stopped.stderr;
      expect(stopped.status).not.to.equal(0);
      expect(output)
        .to.match(/rewrite[^\n]*completed/i)
        .and.include(
          "Completed branches: r-child, r-tip, r-base, side'$(false)"
        )
        .and.include(`Remaining branches: ${finalReplay ? 'none' : 'r-deep'}`)
        .and.include("Current checkout: side'$(false)");
      expect(active(fixture)).to.equal(false);
      const completed = fixture.git(['rev-parse', "side'$(false)"]);
      const bytes = Buffer.from([0, 255, 128, 11]);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'cafe\u0301.txt'))
      ).to.deep.equal(bytes);
      const saved = fixture.snapshot();
      expect(fixture.run(['continue']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(saved);
      fs.renameSync(
        path.join(fixture.repo, 'cafe\u0301.txt'),
        path.join(fixture.root, 'saved-local-bytes')
      );
      fs.unlinkSync(hook);
      const retries = commands(output);
      expect(retries).to.deep.equal([
        ...(finalReplay ? [] : ["an restack --branch 'r-deep' --only"]),
        "an checkout 'r-child'",
      ]);
      for (const command of retries) execute(fixture, command);
      expect(fixture.git(['branch', '--show-current'])).to.equal('r-child');
      expect(fixture.git(['rev-parse', "side'$(false)"])).to.equal(completed);
      if (!finalReplay) {
        expect(fixture.parent('r-deep')).to.equal("side'$(false)");
        const range = "side'$(false)..r-deep";
        expect(
          fixture.git(['log', '--reverse', '--format=%s', range])
        ).to.equal('r-deep');
      }
      expect(
        fs.readFileSync(path.join(fixture.root, 'saved-local-bytes'))
      ).to.deep.equal(bytes);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
    });
  }
  it('preserves the raw index on initial dirty refusal in the normal Git environment', () => {
    const file = path.join(fixture.repo, 'main.txt');
    const previous = fs.statSync(file);
    fs.utimesSync(file, previous.atime, new Date(previous.mtimeMs + 10000));
    fs.writeFileSync(
      path.join(fixture.repo, 'base second.txt'),
      'unfinished tracked work'
    );
    const saved = fixture.snapshot();
    const optionalLocks = fixture.env.GIT_OPTIONAL_LOCKS;
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    fixture.env.GIT_OPTIONAL_LOCKS = optionalLocks;
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(saved);
  });
  it('keeps a clean mtime-only index untouched through normal-environment no-op editor inspection', () => {
    fixture.editor();
    const file = path.join(fixture.repo, 'main.txt');
    const previous = fs.statSync(file);
    fs.utimesSync(file, previous.atime, new Date(previous.mtimeMs + 10000));
    const saved = fixture.snapshot();
    const optionalLocks = fixture.env.GIT_OPTIONAL_LOCKS;
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    fixture.env.GIT_OPTIONAL_LOCKS = optionalLocks;
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(saved);
  });
  it('keeps the normal-environment raw index when dirty fresh continue is refused', () => {
    fixture.git(['switch', 'main']);
    fixture.commit('clean');
    fixture.ok(['restack', '--branch', 'r-base', '--upstack']);
    fixture.git(['switch', 'r-child']);
    expect(
      fixture.run(['reorder', '--stack', '--interactive']).status
    ).not.to.equal(0);
    resolve(fixture, 'child own');
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'unfinished tracked bytes'
    );
    const file = path.join(fixture.repo, 'clean.txt');
    const previous = fs.statSync(file);
    fs.utimesSync(file, previous.atime, new Date(previous.mtimeMs + 10000));
    const saved = fixture.snapshot();
    const optionalLocks = fixture.env.GIT_OPTIONAL_LOCKS;
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    const result = fixture.run(['continue']);
    fixture.env.GIT_OPTIONAL_LOCKS = optionalLocks;
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(saved);
    expect(active(fixture)).to.equal(true);
  });
});
