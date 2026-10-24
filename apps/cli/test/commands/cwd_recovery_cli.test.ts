import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('cwd combined recovery through the public CLI', function () {
  this.timeout(180000);
  let departure: CwdCliFixture;
  let target: CwdCliFixture;
  let control: CwdCliFixture | undefined;
  beforeEach(() => {
    departure = new CwdCliFixture();
    target = new CwdCliFixture();
    departure.env.GIT_EDITOR = target.env.GIT_EDITOR = 'true';
  });
  afterEach(() => {
    departure?.cleanup();
    target?.cleanup();
    control?.cleanup();
    control = undefined;
  });

  function resolve(fixture: CwdCliFixture, text: string): void {
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), text);
    fixture.git(['add', 'main.txt']);
  }

  function prepareConflict(fixture: CwdCliFixture, marker = 'target'): void {
    fixture.branch('conflict-base', 'main', true);
    resolve(fixture, `${marker} base version`);
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    resolve(fixture, `${marker} child version`);
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
  }

  function expectReplay(fixture: CwdCliFixture, name: string): void {
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(
      fs.readFileSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge/head-name'])
        ),
        'utf8'
      )
    ).to.equal(`refs/heads/${name}\n`);
  }

  function startConflict(fixture: CwdCliFixture): void {
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr)
      .to.include('Departure branch: conflict-base')
      .and.include('Remaining branches: conflict-child, conflict-base');
    expectReplay(fixture, 'conflict-child');
  }

  function observe(linked?: string) {
    return {
      departure: departure.inspectionSnapshot(),
      target: target.inspectionSnapshot(),
      linked: linked ? target.inspectionSnapshot(linked) : null,
    };
  }

  function query(args: readonly string[], cwd = target.repo, linked?: string) {
    const before = observe(linked);
    const result = target.run(['--cwd', cwd, ...args], departure.repo);
    expect(observe(linked), args.join(' ')).to.deep.equal(before);
    return result;
  }

  function dirtyLinked(linked: string): void {
    fs.writeFileSync(path.join(linked, 'main.txt'), 'linked staged');
    target.git(['add', 'main.txt'], linked);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'linked partial');
    fs.appendFileSync(
      path.resolve(
        linked,
        target.git(['rev-parse', '--git-path', 'info/exclude'], linked)
      ),
      '\nignored.bin\n'
    );
    fs.writeFileSync(path.join(linked, 'ignored.bin'), Buffer.from([255, 0]));
    fs.writeFileSync(path.join(linked, 'untracked.bin'), Buffer.from([0, 255]));
    fs.symlinkSync('untracked.bin', path.join(linked, 'untracked-link'));
  }

  it('preserves simultaneous departure and target conflicts while inspecting an attached worktree and finishing two fresh target continuations', () => {
    prepareConflict(departure, 'departure');
    startConflict(departure);
    const independent = query(['info', '--stat']);
    expect(independent.status, independent.stderr).to.equal(0);
    expect(stripAnsi(independent.stdout)).to.match(/^base\s/);
    expect(query(['parent']).stdout).to.equal('main\n');
    expect(query(['children']).stdout).to.equal('child\n');

    target.branch('linked-child', 'other');
    prepareConflict(target);
    const expectedTrees = ['conflict-child', 'conflict-base'].map((name) =>
      target.git(['rev-parse', `${name}^{tree}`])
    );
    const linked = path.join(target.root, 'linked');
    target.git(['worktree', 'add', linked, 'other']);
    dirtyLinked(linked);
    const departureBefore = departure.inspectionSnapshot();
    startConflict(target);
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);

    const primary = query(['info', '--stat'], target.repo, linked);
    expect(primary.status, primary.stderr).to.equal(0);
    expect(stripAnsi(primary.stdout)).to.match(/^conflict-base\s/);
    expect(query(['parent'], target.repo, linked).stdout).to.equal(
      'conflict-child\n'
    );
    const attached = query(['info', '--stat'], linked, linked);
    expect(attached.status, attached.stderr).to.equal(0);
    expect(stripAnsi(attached.stdout)).to.match(/^other\s/);
    expect(query(['parent'], linked, linked).stdout).to.equal('main\n');
    expect(query(['children'], linked, linked).stdout).to.equal(
      'linked-child\n'
    );
    const linkedBefore = target.inspectionSnapshot(linked);
    resolve(target, 'target child version');
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
    const second = target.run(
      ['--cwd', target.repo, 'continue', '--no-interactive'],
      departure.repo
    );
    expect(second.status, second.stdout + second.stderr).to.equal(1);
    expect(second.stdout + second.stderr)
      .to.include('Completed branches: conflict-child')
      .and.include('Remaining branches: conflict-base');
    expectReplay(target, 'conflict-base');
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
    expect(query(['parent'], linked, linked).stdout).to.equal('main\n');
    resolve(target, 'target base version');
    const outside = path.join(target.root, 'outside');
    fs.mkdirSync(outside);
    const finished = target.run(
      ['--cwd', target.repo, 'continue', '--no-interactive'],
      outside
    );
    expect(finished.status, finished.stdout + finished.stderr).to.equal(0);
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
    expect(target.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(query(['parent'], target.repo, linked).stdout).to.equal(
      'conflict-child\n'
    );
    expect(
      query(['info', 'conflict-child'], target.repo, linked).stdout
    ).to.include('Parent: main');
    expect(
      target.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child own\nbase own');
    expect(target.git(['show', 'conflict-child:main.txt'])).to.equal(
      'target child version'
    );
    expect(target.git(['show', 'conflict-base:main.txt'])).to.equal(
      'target base version'
    );
    expect(
      ['conflict-child', 'conflict-base'].map((name) =>
        target.git(['rev-parse', `${name}^{tree}`])
      )
    ).to.deep.equal(expectedTrees);
    expect(
      target.git(['rev-list', '--merges', 'main..conflict-base'])
    ).to.equal('');
    expect(target.git(['diff', '--exit-code'])).to.equal('');
    expect(target.git(['diff', '--cached', '--exit-code'])).to.equal('');
    const linkedAfter = target.inspectionSnapshot(linked);
    // Shared refs and Charcoal persistence legitimately change during recovery.
    expect({ ...linkedAfter, refs: '', persistent: null }).to.deep.equal({
      ...linkedBefore,
      refs: '',
      persistent: null,
    });
    expect(linkedAfter.branch).to.equal('other\n');
    expect(target.inspectionSnapshot().operation).to.deep.equal({
      'rebase-merge': null,
      'rebase-apply': null,
    });
    expectReplay(departure, 'conflict-child');
  });

  it('rejects a selected branch occupied in a dirty target worktree without changing either repository, index or parent graph', () => {
    const linked = path.join(target.root, 'linked');
    target.git(['worktree', 'add', linked, 'tip']);
    fs.writeFileSync(path.join(linked, 'tip.txt'), 'staged work');
    target.git(['add', 'tip.txt'], linked);
    fs.appendFileSync(path.join(linked, 'tip.txt'), '\npartial work');
    target.editor('base\ntip\nchild\n');
    const graph = query(['log', 'short'], target.repo, linked).stdout;
    const before = observe(linked);
    const refused = target.run(
      ['--cwd', target.repo, 'reorder', '--stack', '--interactive'],
      departure.repo
    );
    expect(refused.status).to.equal(1);
    expect(refused.stdout + refused.stderr).to.include('tip');
    expect(observe(linked)).to.deep.equal(before);
    expect(query(['log', 'short'], target.repo, linked).stdout).to.equal(graph);
  });

  function prepareRaw(fixture: CwdCliFixture): void {
    fixture.git(['switch', '-c', 'raw-X', 'main']);
    resolve(fixture, 'raw X');
    fixture.git(['commit', '-m', 'raw X']);
    fixture.git(['switch', '-c', 'raw-Y']);
    resolve(fixture, 'raw Y');
    fixture.git(['commit', '-m', 'raw Y']);
    fixture.git(['switch', '-c', 'raw-target', 'main']);
    resolve(fixture, 'raw target');
    fixture.git(['commit', '-m', 'raw target']);
  }

  function startRaw(fixture: CwdCliFixture, isRestart: boolean): void {
    expect(() =>
      fixture.git([
        'rebase',
        '--onto',
        isRestart ? 'main' : 'raw-target',
        isRestart ? 'conflict-base' : 'raw-X',
        isRestart ? 'conflict-child' : 'raw-Y',
      ])
    ).to.throw();
    expectReplay(fixture, isRestart ? 'conflict-child' : 'raw-Y');
  }

  for (const isRestart of [false, true]) {
    it(`preserves stale context and refuses implicit inspection during a ${
      isRestart ? 'matching restarted' : 'foreign'
    } raw replay while explicit target selection remains usable`, () => {
      prepareRaw(target);
      prepareConflict(target);
      startConflict(target);
      const aborted = target.run(
        ['--cwd', target.repo, 'rebase', '--abort'],
        departure.repo
      );
      expect(aborted.status, aborted.stderr).to.equal(0);
      const attached = query(['info']);
      expect(attached.status, attached.stderr).to.equal(0);
      expect(stripAnsi(attached.stdout)).to.match(/^conflict-child\s/);
      startRaw(target, isRestart);
      for (const isResolved of [false, true]) {
        if (isResolved)
          resolve(target, isRestart ? 'target child version' : 'raw Y');
        for (const args of [['info', '--stat'], ['parent'], ['children']]) {
          const refused = query(args);
          expect(refused.status, args.join(' ')).to.equal(1);
          expect(refused.stdout).to.equal('');
          expect(refused.stderr).to.include('ERROR:');
        }
        const explicit = query(['info', 'other', '--stat']);
        expect(explicit.status, explicit.stderr).to.equal(0);
        expect(stripAnsi(explicit.stdout)).to.match(/^other\s/);
        expect(explicit.stdout).to.include('Parent: main');
      }
      target.git(['rebase', '--continue']);
      expect(target.git(['branch', '--show-current'])).to.equal(
        isRestart ? 'conflict-child' : 'raw-Y'
      );
      expect(target.git(['show', 'HEAD:main.txt'])).to.equal(
        isRestart ? 'target child version' : 'raw Y'
      );
    });
  }

  function publicRecoveryState(fixture: CwdCliFixture) {
    const operation = path.resolve(
      fixture.repo,
      fixture.git(['rev-parse', '--git-path', 'rebase-merge/head-name'])
    );
    return {
      branch: fixture.git(['branch', '--show-current']),
      commits: fixture.git(['log', '--reverse', '--format=%s', 'main..HEAD']),
      content: fixture.git(['show', 'HEAD:main.txt']),
      unresolved: fixture.git(['ls-files', '--unmerged']),
      replay: fs.existsSync(operation)
        ? fs.readFileSync(operation, 'utf8')
        : null,
      continuation: fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-common-dir']),
          '.gtcontinue'
        )
      ),
      parents: ['conflict-base', 'conflict-child'].map((branch) =>
        fixture
          .ok(['info', branch])
          .split('\n')
          .find((line) => line.startsWith('Parent: '))
      ),
    };
  }

  for (const mode of [
    'raw-abort',
    'foreign',
    'stale-foreign',
    'stale-restarted',
  ]) {
    it(`matches ordinary direct continue lifecycle for ${mode} without applying inspection ownership rules`, () => {
      control = new CwdCliFixture();
      control.env.GIT_EDITOR = 'true';
      const prepare = (fixture: CwdCliFixture): void => {
        prepareRaw(fixture);
        prepareConflict(fixture);
        if (mode !== 'foreign') {
          startConflict(fixture);
          fixture.git(['rebase', '--abort']);
        }
        if (mode !== 'raw-abort') {
          startRaw(fixture, mode === 'stale-restarted');
          resolve(
            fixture,
            mode === 'stale-restarted' ? 'target child version' : 'raw Y'
          );
        }
      };
      prepare(target);
      prepare(control);
      const departureBefore = departure.inspectionSnapshot();
      const direct = control.run(['continue', '--no-interactive']);
      const selected = target.run(
        ['--cwd', target.repo, 'continue', '--no-interactive'],
        departure.repo
      );
      const normalize = (text: string, fixture: CwdCliFixture): string =>
        stripAnsi(text)
          .split(fixture.root)
          .join('<fixture>')
          .replace(/\b[0-9a-f]{7,40}\b/g, '<object>');
      expect(selected.status).to.equal(direct.status);
      expect(normalize(selected.stdout, target)).to.equal(
        normalize(direct.stdout, control)
      );
      expect(normalize(selected.stderr, target)).to.equal(
        normalize(direct.stderr, control)
      );
      expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
      expect(publicRecoveryState(target)).to.deep.equal(
        publicRecoveryState(control)
      );
      if (mode === 'raw-abort' || mode === 'foreign') {
        expect(selected.status).to.equal(1);
        expect(selected.stdout + selected.stderr).to.include(
          'No Charcoal operation to continue.'
        );
      } else if (mode === 'stale-foreign') {
        // Ordinary continue completes Git replay before its existing untracked-branch guard.
        expect(selected.stdout + selected.stderr).to.include(
          'Cannot perform this operation on untracked branch raw-Y'
        );
        expect(publicRecoveryState(target).replay).to.equal(null);
        expect(target.git(['branch', '--show-current'])).to.equal('raw-Y');
        expect(target.git(['show', 'HEAD:main.txt'])).to.equal('raw Y');
      } else {
        // Matching stale replay reaches the next stop under the existing continuation policy.
        expect(selected.stdout + selected.stderr).to.include(
          'Resolved rebase conflict for conflict-child'
        );
        expectReplay(target, 'conflict-base');
      }
    });
  }
});
