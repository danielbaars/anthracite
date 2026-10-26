import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// Real Git recovery, separate pipe bytes, and independent read-only observers.
// eslint-disable-next-line max-lines-per-function
describe('interaction policy combined recovery through the public CLI', function () {
  this.timeout(180000);
  let departure: CwdCliFixture;
  let target: CwdCliFixture;
  let control: CwdCliFixture;
  beforeEach(() => {
    departure = new CwdCliFixture();
    target = new CwdCliFixture();
    control = new CwdCliFixture();
    for (const fixture of [departure, target, control]) {
      delete fixture.env.GRAPHITE_INTERACTIVE;
      fixture.env.GIT_EDITOR = 'true';
    }
  });
  afterEach(() => {
    departure?.cleanup();
    target?.cleanup();
    control?.cleanup();
  });

  function resolve(fixture: CwdCliFixture, contents: string): void {
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
    fixture.git(['add', 'main.txt']);
  }

  function prepare(fixture: CwdCliFixture, marker = 'target'): string {
    fixture.branch('conflict-base', 'main', true);
    resolve(fixture, `${marker} base version`);
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    resolve(fixture, `${marker} child version`);
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
    return fixture.input('conflict-base\nconflict-child\n');
  }

  function expectReplay(fixture: CwdCliFixture, branch: string): void {
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

  function finalState(fixture: CwdCliFixture) {
    return {
      branch: fixture.git(['branch', '--show-current']),
      trees: ['conflict-child', 'conflict-base'].map((branch) =>
        fixture.git(['rev-parse', `${branch}^{tree}`])
      ),
      subjects: fixture.git([
        'log',
        '--reverse',
        '--format=%s',
        'main..conflict-base',
      ]),
      contents: ['conflict-child', 'conflict-base'].map((branch) =>
        fixture.git(['show', `${branch}:main.txt`])
      ),
      parent: fixture.run(['parent']).stdout,
      childInfo: fixture.run(['info', 'conflict-child']).stdout,
      merges: fixture.git(['rev-list', '--merges', 'main..conflict-base']),
      work: fixture.git(['diff', '--exit-code']),
      staged: fixture.git(['diff', '--cached', '--exit-code']),
      operation: fixture.inspectionSnapshot().operation,
    };
  }

  function dirtyLinked(linked: string): void {
    fs.writeFileSync(path.join(linked, 'main.txt'), 'linked staged');
    target.git(['add', 'main.txt'], linked);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'linked partial');
    fs.writeFileSync(path.join(linked, 'untracked.bin'), Buffer.from([0, 255]));
    fs.symlinkSync('untracked.bin', path.join(linked, 'untracked-link'));
    target.git(['status', '--porcelain'], linked);
  }

  function runRemote(fixture: SubmitCliFixture, args: readonly string[]) {
    const [executable, ...argv] = getTestCliCommand(args);
    const result = spawnSync(executable, argv, {
      cwd: departure.repo,
      env: fixture.env,
      input: Buffer.alloc(0),
      timeout: 20000,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`CLI killed by ${result.signal}`);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'combined-remote-cli.jsonl'),
        JSON.stringify({
          executable,
          argv,
          cwd: departure.repo,
          status: result.status,
          stdoutBase64: result.stdout.toString('base64'),
          stderrBase64: result.stderr.toString('base64'),
          environment: Object.fromEntries(
            [
              'GRAPHITE_USER_CONFIG_PATH',
              'GRAPHITE_INTERACTIVE',
              'HOME',
              'CODEX_HOME',
              'GIT_OPTIONAL_LOCKS',
              'CHARCOAL_TEST_BINARY',
              'BUN_BE_BUN',
              'CH_PAGER',
              'PATH',
            ].map((key) => [key, fixture.env[key] ?? null])
          ),
        }) + '\n'
      );
    return {
      status: result.status,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
    };
  }

  function recoverControl(): void {
    const controlInput = prepare(control);
    expect(
      control.run(['reorder', '--stack', '--input', controlInput]).status
    ).to.equal(1);
    expectReplay(control, 'conflict-child');
    resolve(control, 'target child version');
    expect(control.run(['continue']).status).to.equal(1);
    expectReplay(control, 'conflict-base');
    resolve(control, 'target base version');
    expect(control.run(['continue']).status).to.equal(0);
  }

  it('finishes two fresh quiet cwd continuations while an independent conflict and dirty attached worktree remain intact, matching ordinary direct recovery', () => {
    const departureInput = prepare(departure, 'departure');
    expect(
      departure.run(['reorder', '--stack', '--input', departureInput]).status
    ).to.equal(1);
    expectReplay(departure, 'conflict-child');
    const departureBefore = departure.inspectionSnapshot();
    const input = prepare(target);
    const expectedTrees = ['conflict-child', 'conflict-base'].map((branch) =>
      target.git(['rev-parse', `${branch}^{tree}`])
    );
    const linked = path.join(target.root, 'linked');
    target.git(['worktree', 'add', linked, 'other']);
    dirtyLinked(linked);
    const linkedBefore = target.inspectionSnapshot(linked);
    const first = target.run(
      [
        '--cwd',
        target.repo,
        'reorder',
        '--stack',
        '--input',
        input,
        '--quiet',
        '--interactive',
      ],
      departure.repo
    );
    expect(first.status, first.stderr).to.equal(1);
    expect(first.stdout).to.equal('');
    expect(first.stderr).to.include('conflict').and.include('an continue');
    expectReplay(target, 'conflict-child');
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
    const replayBefore = target.inspectionSnapshot();
    const unresolved = target.run(
      ['--cwd', target.repo, 'continue', '--quiet'],
      departure.repo
    );
    expect(unresolved.status).to.equal(1);
    expect(unresolved.stdout).to.equal('');
    expect(unresolved.stderr)
      .to.include('Stage the conflict resolution')
      .and.include('retrying');
    expect(target.inspectionSnapshot()).to.deep.equal(replayBefore);
    for (const command of ['info', 'parent', 'children']) {
      const before = target.inspectionSnapshot();
      const inspected = target.run(
        ['--cwd', target.repo, command, '--quiet'],
        departure.repo
      );
      expect(inspected.status, inspected.stderr).to.equal(0);
      expect(inspected.stdout).to.equal('');
      expect(inspected.stderr).to.equal('');
      expect(target.inspectionSnapshot()).to.deep.equal(before);
    }
    resolve(target, 'target child version');
    const second = target.run(
      ['--cwd', target.repo, 'continue', '--quiet'],
      departure.repo
    );
    expect(second.status, second.stderr).to.equal(1);
    expect(second.stdout).to.equal('');
    expect(second.stderr).to.include('conflict').and.include('an continue');
    expectReplay(target, 'conflict-base');
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
    resolve(target, 'target base version');
    const outside = path.join(target.root, 'outside');
    fs.mkdirSync(outside);
    const finished = target.run(
      ['--cwd', target.repo, 'continue', '--quiet'],
      outside
    );
    expect(finished.status, finished.stderr).to.equal(0);
    expect(finished.stdout).to.equal('');
    expect(finished.stderr).to.equal('');
    expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
    expectReplay(departure, 'conflict-child');
    const linkedAfter = target.inspectionSnapshot(linked);
    // Shared refs and tracking persistence legitimately advance during recovery.
    expect({ ...linkedAfter, refs: '', persistent: null }).to.deep.equal({
      ...linkedBefore,
      refs: '',
      persistent: null,
    });
    recoverControl();
    const actual = finalState(target);
    expect({ ...actual, childInfo: '' }).to.deep.equal({
      ...finalState(control),
      childInfo: '',
    });
    expect(actual).to.include({
      branch: 'conflict-base',
      parent: 'conflict-child\n',
      subjects: 'child own\nbase own',
      merges: '',
      work: '',
      staged: '',
    });
    expect(actual.childInfo).to.include('Parent: main');
    expect(actual.trees).to.deep.equal(expectedTrees);
    expect(actual.contents).to.deep.equal([
      'target child version',
      'target base version',
    ]);
    expect(actual.operation).to.deep.equal({
      'rebase-merge': null,
      'rebase-apply': null,
    });
    expect(fs.existsSync(path.join(target.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('refuses quiet cwd reorder before changing a branch occupied by a dirty linked worktree', () => {
    const linked = path.join(target.root, 'linked');
    target.git(['worktree', 'add', linked, 'tip']);
    fs.writeFileSync(path.join(linked, 'tip.txt'), 'staged work');
    target.git(['add', 'tip.txt'], linked);
    fs.appendFileSync(path.join(linked, 'tip.txt'), '\npartial work');
    target.git(['status', '--porcelain'], linked);
    const input = target.input('base\ntip\nchild\n');
    const before = {
      departure: departure.inspectionSnapshot(),
      target: target.inspectionSnapshot(),
      linked: target.inspectionSnapshot(linked),
    };
    const refused = target.run(
      ['--cwd', target.repo, 'reorder', '--stack', '--input', input, '--quiet'],
      departure.repo
    );
    expect(refused.status).to.equal(1);
    expect(refused.stdout).to.equal('');
    expect(refused.stderr).to.include('tip').and.include('worktree');
    expect({
      departure: departure.inspectionSnapshot(),
      target: target.inspectionSnapshot(),
      linked: target.inspectionSnapshot(linked),
    }).to.deep.equal(before);
    expect(fs.existsSync(path.join(target.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('retains an already fast-forwarded parent and fetched refs when quiet cwd get later refuses a divergent child', () => {
    const remote = new SubmitCliFixture();
    try {
      delete remote.env.GRAPHITE_INTERACTIVE;
      delete remote.env.GIT_OPTIONAL_LOCKS;
      remote.env.CH_PAGER = '';
      remote.branch('parent', 'main');
      remote.branch('child', 'parent');
      remote.succeed('submit');
      const producer = path.join(remote.root, 'producer');
      remote.git('clone', '--branch', 'child', remote.remote, producer);
      remote.git('-C', producer, 'config', 'user.name', 'Combined fixture');
      remote.git(
        '-C',
        producer,
        'config',
        'user.email',
        'combined@example.test'
      );
      remote.git('-C', producer, 'config', 'commit.gpgsign', 'false');
      remote.git('-C', producer, 'switch', 'parent');
      fs.writeFileSync(
        path.join(producer, 'parent-new.txt'),
        'parent advanced'
      );
      remote.git('-C', producer, 'add', 'parent-new.txt');
      remote.git('-C', producer, 'commit', '-m', 'remote parent');
      const parent = remote.git('-C', producer, 'rev-parse', 'parent');
      remote.git('-C', producer, 'switch', 'child');
      remote.git('-C', producer, 'merge', '--no-edit', 'parent');
      fs.writeFileSync(path.join(producer, 'child-new.txt'), 'child advanced');
      remote.git('-C', producer, 'add', 'child-new.txt');
      remote.git('-C', producer, 'commit', '-m', 'remote child');
      remote.git('-C', producer, 'push', 'origin', 'parent', 'child');
      const child = remote.commit('local-child');
      const childTree = remote.git('rev-parse', 'child^{tree}');
      const remoteBefore = remote.git('ls-remote', '--heads', 'origin');
      const departureBefore = departure.inspectionSnapshot();
      const refused = runRemote(remote, [
        '--cwd',
        remote.repo,
        'get',
        'child',
        '--quiet',
      ]);
      expect(refused.status).to.equal(1);
      expect(refused.stdout).to.equal('');
      expect(refused.stderr).to.include('Updated parent before get stopped');
      expect(remote.git('rev-parse', 'parent')).to.equal(parent);
      expect(remote.git('rev-parse', 'child')).to.equal(child);
      expect(remote.git('rev-parse', 'child^{tree}')).to.equal(childTree);
      expect(remote.git('rev-parse', 'HEAD')).to.equal(parent);
      expect(remote.git('rev-parse', 'origin/parent')).to.equal(parent);
      expect(remote.git('ls-remote', '--heads', 'origin')).to.equal(
        remoteBefore
      );
      expect(remote.git('status', '--porcelain')).to.equal('');
      expect(remote.git('show', 'child:local-child.txt')).to.equal(
        'local-child'
      );
      expect(departure.inspectionSnapshot()).to.deep.equal(departureBefore);
      const navigated = runRemote(remote, [
        '--cwd',
        remote.repo,
        'up',
        '--quiet',
      ]);
      expect(navigated.status, navigated.stderr).to.equal(0);
      expect(remote.git('rev-parse', 'HEAD')).to.equal(child);
      expect(
        fs.readFileSync(path.join(remote.repo, 'local-child.txt'), 'utf8')
      ).to.equal('local-child');
      const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
      if (evidence)
        fs.writeFileSync(
          path.join(evidence, 'combined-get-state.json'),
          JSON.stringify(
            {
              parent,
              child,
              childTree,
              remoteBefore,
              remoteAfter: remote.git('ls-remote', '--heads', 'origin'),
              localRefs: remote.git('show-ref'),
              current: remote.git('branch', '--show-current'),
              prs: remote.prs(),
            },
            null,
            2
          )
        );
    } finally {
      remote.cleanup();
    }
  });

  it('matches ordinary stale-foreign continuation lifecycle under quiet instead of applying inspection ownership guards', () => {
    const prepareStale = (fixture: CwdCliFixture): void => {
      fixture.git(['switch', '-c', 'raw-X', 'main']);
      resolve(fixture, 'raw X');
      fixture.git(['commit', '-m', 'raw X']);
      fixture.git(['switch', '-c', 'raw-Y']);
      resolve(fixture, 'raw Y');
      fixture.git(['commit', '-m', 'raw Y']);
      fixture.git(['switch', '-c', 'raw-target', 'main']);
      resolve(fixture, 'raw target');
      fixture.git(['commit', '-m', 'raw target']);
      const input = prepare(fixture);
      expect(
        fixture.run(['reorder', '--stack', '--input', input]).status
      ).to.equal(1);
      fixture.git(['rebase', '--abort']);
      expect(() =>
        fixture.git(['rebase', '--onto', 'raw-target', 'raw-X', 'raw-Y'])
      ).to.throw();
      expectReplay(fixture, 'raw-Y');
      resolve(fixture, 'raw Y');
    };
    prepareStale(target);
    prepareStale(control);
    const before = departure.inspectionSnapshot();
    const direct = control.run(['continue']);
    const selected = target.run(
      ['--cwd', target.repo, 'continue', '--quiet'],
      departure.repo
    );
    expect(selected.status).to.equal(direct.status).and.equal(1);
    expect(selected.stdout).to.equal('');
    expect(selected.stderr).to.include('untracked branch raw-Y');
    expect(direct.stdout + direct.stderr).to.include('untracked branch raw-Y');
    for (const fixture of [target, control]) {
      expect(fixture.git(['branch', '--show-current'])).to.equal('raw-Y');
      expect(fixture.git(['show', 'HEAD:main.txt'])).to.equal('raw Y');
      expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
      expect(fixture.git(['diff', '--cached', '--exit-code'])).to.equal('');
      expect(fixture.inspectionSnapshot().operation).to.deep.equal({
        'rebase-merge': null,
        'rebase-apply': null,
      });
    }
    expect(target.git(['rev-parse', 'HEAD^{tree}'])).to.equal(
      control.git(['rev-parse', 'HEAD^{tree}'])
    );
    expect(departure.inspectionSnapshot()).to.deep.equal(before);
  });
});
