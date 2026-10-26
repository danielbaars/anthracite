import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('relation inspection across worktrees and raw abort', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let linked: string;
  let observed: string[];
  beforeEach(() => {
    fixture = new RelationCliFixture();
    linked = path.join(fixture.root, 'linked');
    observed = [fixture.repo, linked];
  });
  afterEach(() => fixture?.cleanup());

  function expectPreserved(
    before: ReadonlyArray<Record<string, unknown>>,
    label: string
  ): void {
    const after = observed.map((cwd) => fixture.inspectionSnapshot(cwd));
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, `${path.basename(fixture.root)}-inspection.jsonl`),
        JSON.stringify({ label, worktrees: observed, before, after }) + '\n'
      );
    }
    expect(after, label).to.deep.equal(before);
  }

  function inspect(cwd: string, parent: string, children: string): void {
    const before = observed.map((directory) =>
      fixture.inspectionSnapshot(directory)
    );
    for (const [command, output] of [
      ['parent', parent],
      ['children', children],
    ]) {
      for (const flags of [
        [],
        ['-q'],
        ['--quiet=false'],
        ['--no-interactive'],
        ['--interactive'],
      ]) {
        const result = fixture.run([command, ...flags], cwd);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.equal(flags.includes('-q') ? '' : output);
        expect(result.stderr).to.equal('');
        expectPreserved(before, `${cwd}: ${command} ${flags.join(' ')}`);
      }
      for (const flags of [['--wrong'], ['-q', '--', 'other']]) {
        const result = fixture.run([command, ...flags], cwd);
        expect(result.status).to.equal(1);
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
        expectPreserved(before, `${cwd}: ${command} ${flags.join(' ')}`);
      }
    }
  }

  function dirty(cwd: string): void {
    fs.writeFileSync(path.join(cwd, 'main.txt'), 'staged partial');
    fs.writeFileSync(path.join(cwd, 'staged-only.txt'), 'staged only');
    fixture.git(['add', 'main.txt', 'staged-only.txt'], cwd);
    fs.writeFileSync(path.join(cwd, 'main.txt'), 'unfinished partial');
    fs.writeFileSync(path.join(cwd, 'unstaged.txt'), 'unfinished unstaged');
    fs.appendFileSync(
      path.resolve(
        cwd,
        fixture.git(['rev-parse', '--git-path', 'info/exclude'], cwd)
      ),
      '\nignored.bin\n'
    );
    fs.writeFileSync(path.join(cwd, 'ignored.bin'), Buffer.from([0, 255, 128]));
    fs.writeFileSync(
      path.join(cwd, 'untracked.bin'),
      Buffer.from([255, 0, 13, 10])
    );
    fs.symlinkSync('untracked.bin', path.join(cwd, 'untracked-link'));
    const stable = path.join(cwd, 'stable.txt');
    const previous = fs.statSync(stable);
    fs.utimesSync(stable, previous.atime, new Date(previous.mtimeMs + 10000));
  }

  function commitStable(cwd: string): void {
    fs.writeFileSync(path.join(cwd, 'stable.txt'), 'stable');
    fs.writeFileSync(path.join(cwd, 'unstaged.txt'), 'original');
    fixture.git(['add', 'stable.txt', 'unstaged.txt'], cwd);
    fixture.git(['commit', '-m', 'worktree stable files'], cwd);
  }

  function prepareConflict(): void {
    fixture.git(['switch', 'main']);
    commitStable(fixture.repo);
    fixture.branch('conflict-base', 'main', true);
    resolve('base version');
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    resolve('child version');
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
  }

  function resolve(contents: string): void {
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
    fixture.git(['add', 'main.txt']);
  }

  function expectReplay(branch: string): void {
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const headName = path.resolve(
      fixture.repo,
      fixture.git(['rev-parse', '--git-path', 'rebase-merge/head-name'])
    );
    expect(fs.readFileSync(headName, 'utf8')).to.equal(
      `refs/heads/${branch}\n`
    );
  }

  function expectFinal(): void {
    expect(fixture.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(fixture.ok(['parent'])).to.equal('conflict-child\n');
    expect(fixture.ok(['children'])).to.equal('');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child own\nbase own');
    expect(fixture.git(['show', 'conflict-child:main.txt'])).to.equal(
      'child version'
    );
    expect(fixture.git(['show', 'conflict-base:main.txt'])).to.equal(
      'base version'
    );
    expect(
      fixture.git(['rev-list', '--merges', 'main..conflict-base'])
    ).to.equal('');
    expect(fixture.git(['diff', '--exit-code'])).to.equal('');
    expect(fixture.git(['diff', '--cached', '--exit-code'])).to.equal('');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(false);
  }

  function quote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  function executeNamed(command: string): {
    readonly status: number | null;
    readonly output: string;
  } {
    const bin = path.join(fixture.root, 'named-recovery-bin');
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
    if (result.signal) throw new Error(`Recovery killed by ${result.signal}`);
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
    return { status: result.status, output: result.stdout + result.stderr };
  }

  it('queries its attached linked branch with busy parent and child while preserving all dirty worktrees', () => {
    const busyChild = path.join(fixture.root, 'busy-child');
    fixture.git(['worktree', 'add', linked, 'child']);
    fixture.git(['worktree', 'add', busyChild, 'tip']);
    observed.push(busyChild);
    for (const cwd of observed) {
      commitStable(cwd);
      dirty(cwd);
    }
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal('child');
    expect(fixture.git(['branch', '--show-current'], busyChild)).to.equal(
      'tip'
    );
    inspect(linked, 'base\n', 'tip\n');
  });
  it('uses the other attached subject during a real conflict and preserves both worktrees through fresh continuation', () => {
    fixture.git(['switch', 'other']);
    commitStable(fixture.repo);
    fixture.branch('linked-child', 'other');
    prepareConflict();
    fixture.git(['worktree', 'add', linked, 'other']);
    dirty(linked);
    const first = fixture.run(['reorder', '--stack', '--interactive']);
    expect(first.status, first.stdout + first.stderr).to.equal(1);
    expect(first.stdout + first.stderr)
      .to.include('Departure branch: conflict-base')
      .and.include('Remaining branches: conflict-child, conflict-base');
    expectReplay('conflict-child');
    const stable = path.join(fixture.repo, 'stable.txt');
    const previous = fs.statSync(stable);
    fs.utimesSync(stable, previous.atime, new Date(previous.mtimeMs + 10000));
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_lock'),
      'foreign coordination'
    );
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nignored.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored.bin'),
      Buffer.from([0, 255, 128])
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.bin'),
      Buffer.from([255, 0, 13, 10])
    );
    fs.symlinkSync('untracked.bin', path.join(fixture.repo, 'untracked-link'));
    inspect(linked, 'main\n', 'linked-child\n');
    inspect(fixture.repo, 'conflict-child\n', '');
    resolve('child version');
    inspect(linked, 'main\n', 'linked-child\n');
    const linkedBeforeRecovery = fixture.inspectionSnapshot(linked);
    fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_cache_lock'));
    // Refresh the deliberately stale clean stat after proving both query snapshots.
    fixture.git(['update-index', '--refresh']);
    const second = fixture.run(['continue', '--no-interactive']);
    expect(second.status, second.stdout + second.stderr).to.equal(1);
    expect(second.stdout + second.stderr)
      .to.include('Completed branches: conflict-child')
      .and.include('Remaining branches: conflict-base');
    expectReplay('conflict-base');
    inspect(linked, 'main\n', 'linked-child\n');
    resolve('base version');
    inspect(linked, 'main\n', 'linked-child\n');
    fixture.ok(['continue']);
    expectFinal();
    const linkedAfterRecovery = fixture.inspectionSnapshot(linked);
    expect({
      ...linkedAfterRecovery,
      refs: linkedBeforeRecovery.refs,
      persistent: linkedBeforeRecovery.persistent,
    }).to.deep.equal(linkedBeforeRecovery);
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal('other');
    inspect(linked, 'main\n', 'linked-child\n');
  });
  it('ignores preserved stale context after real raw abort then executes every printed named recovery command', () => {
    observed = [fixture.repo];
    prepareConflict();
    const first = fixture.run(['reorder', '--stack', '--interactive']);
    expect(first.status).to.equal(1);
    expectReplay('conflict-child');
    const recoveryCommands = (first.stdout + first.stderr)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^an (restack --branch|checkout) /.test(line));
    expect(recoveryCommands).to.deep.equal([
      "an restack --branch 'conflict-child' --only",
      "an restack --branch 'conflict-base' --only",
      "an checkout 'conflict-base'",
    ]);
    fixture.git(['rebase', '--abort']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'conflict-child'
    );
    const continuationPath = path.resolve(
      fixture.repo,
      fixture.git(['rev-parse', '--git-common-dir']),
      '.gtcontinue'
    );
    const stale = fs.readFileSync(continuationPath);
    const stable = path.join(fixture.repo, 'stable.txt');
    const previous = fs.statSync(stable);
    fs.utimesSync(stable, previous.atime, new Date(previous.mtimeMs + 10000));
    inspect(fixture.repo, 'main\n', 'conflict-base\n');
    expect(fs.readFileSync(continuationPath)).to.deep.equal(stale);
    // Query preservation ends here: explicit recovery retains its normal cleanup.
    const noRebase = fixture.run(['continue', '--no-interactive']);
    expect(noRebase.status).to.equal(1);
    expect(noRebase.stdout + noRebase.stderr).to.include(
      'No Anthracite operation to continue.'
    );
    fixture.git(['update-index', '--refresh']);
    for (const [index, command] of recoveryCommands.entries()) {
      const result = executeNamed(command);
      if (index < 2) {
        expect(result.status, result.output).to.equal(1);
        expectReplay(index === 0 ? 'conflict-child' : 'conflict-base');
        resolve(index === 0 ? 'child version' : 'base version');
        fixture.ok(['continue']);
      } else expect(result.status, result.output).to.equal(0);
    }
    expectFinal();
  });
});
