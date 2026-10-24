import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

import { preparePublicPrRemote } from '../lib/fixtures/public_pr';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { readSubmitPrs } from '../lib/fixtures/submit_gh';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('info combined recovery through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let observed: string[];
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.env.CH_PAGER = '';
    fixture.env.GIT_EDITOR = 'true';
    observed = [fixture.repo];
  });
  afterEach(() => fixture?.cleanup());

  function preparePrs(names: readonly string[]): void {
    const { state, refuseQueries } = preparePublicPrRemote(fixture);
    for (const name of names) {
      fixture.branch(name, 'main', true);
      fs.mkdirSync(path.join(fixture.repo, '.github'), { recursive: true });
      fs.writeFileSync(
        path.join(fixture.repo, '.github', 'pull_request_template.md'),
        `Body for ${name}`
      );
      fixture.git(['add', '.github/pull_request_template.md']);
      fixture.git(['commit', '-m', `Template for ${name}`]);
      fixture.ok(['submit', '--publish']);
    }
    fixture.ok(['sync', '--no-pull', '--no-delete', '--no-restack']);
    const prs = readSubmitPrs(state);
    expect(prs.map((pr) => pr.headRefName).sort()).to.deep.equal(
      [...names].sort()
    );
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      for (const name of ['prs.json', 'gh.jsonl'])
        fs.copyFileSync(
          path.join(fixture.root, name),
          path.join(evidence, `${path.basename(fixture.root)}-setup-${name}`)
        );
    }
    refuseQueries();
  }

  function prepareConflict(): void {
    fixture.branch('conflict-base', 'main', true);
    resolve('base version');
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    resolve('child version');
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
  }

  function resolve(text: string): void {
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), text);
    fixture.git(['add', 'main.txt']);
  }

  function expectReplay(name: string): void {
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const file = path.resolve(
      fixture.repo,
      fixture.git(['rev-parse', '--git-path', 'rebase-merge/head-name'])
    );
    expect(fs.readFileSync(file, 'utf8')).to.equal(`refs/heads/${name}\n`);
  }

  function getStatLines(text: string): readonly string[] {
    return stripAnsi(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\|/.test(line) || /files? changed/.test(line));
  }

  function takeSnapshot() {
    return {
      worktrees: observed.map((directory) =>
        fixture.inspectionSnapshot(directory)
      ),
      service: fs
        .readFileSync(path.join(fixture.root, 'prs.json'))
        .toString('base64'),
      remoteRefs: fixture.git(
        ['for-each-ref', '--format=%(refname) %(objectname)'],
        path.join(fixture.root, 'remote.git')
      ),
    };
  }

  function runQuery(args: readonly string[], cwd = fixture.repo) {
    const before = takeSnapshot();
    const result = fixture.run(args, cwd);
    expect(takeSnapshot(), args.join(' ')).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(
      fs.readFileSync(path.join(fixture.root, 'gh.jsonl'), 'utf8')
    ).to.equal('');
    return result;
  }

  function expectSelected(output: string, name: string): void {
    const pr = readSubmitPrs(path.join(fixture.root, 'prs.json')).find(
      (record) => record.headRefName === name
    );
    if (!pr) throw new Error('Public submit did not create the selected PR.');
    expect(stripAnsi(output))
      .to.match(new RegExp(`^${name}\\s`))
      .and.include(`PR #${pr.number}`)
      .and.include(pr.title)
      .and.include(pr.url)
      .and.include(`Body for ${name}`);
    expect(output).not.to.include(
      `Body for ${name === 'pr-selected' ? 'pr-checkout' : 'pr-selected'}`
    );
    expect(output).not.to.include('@@');
  }

  function runTerminal(args: readonly string[], cwd = fixture.repo) {
    const before = takeSnapshot();
    const argv = getTestCliCommand(args);
    const result = runCliInPty(argv, { cwd, env: fixture.env });
    fixture.savePty(result);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'recovery-pty.jsonl'),
        JSON.stringify({ argv, cwd, result }) + '\n'
      );
    expect(takeSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(
      fs.readFileSync(path.join(fixture.root, 'gh.jsonl'), 'utf8')
    ).to.equal('');
    return result;
  }

  function setQueryHooks(isEnabled: boolean): void {
    for (const hook of ['post-checkout', 'post-rewrite', 'pre-commit']) {
      const file = path.join(fixture.repo, '.git', 'hooks', hook);
      if (isEnabled)
        fs.writeFileSync(
          file,
          `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
            path.join(fixture.root, 'unexpected-tool')
          )}, 'hook');`,
          { mode: 0o755 }
        );
      else fs.unlinkSync(file);
    }
  }

  function expectPagedSelection(selectedStat: string, linked: string): void {
    const pager = path.join(fixture.root, 'pager.js');
    const input = path.join(fixture.root, 'pager-input');
    const calls = path.join(fixture.root, 'pager-calls');
    const installPager = (status: number): void => {
      fs.writeFileSync(
        pager,
        `const fs=require('fs');fs.appendFileSync(${JSON.stringify(
          calls
        )},'called\\n');fs.writeFileSync(${JSON.stringify(
          input
        )},fs.readFileSync(0));process.stdout.write('PAGER_RESULT\\n');process.exitCode=${status};`
      );
      fixture.env.CH_PAGER = `'${process.execPath}' '${pager}'`;
    };
    const flags = [
      'info',
      'pr-selected',
      '--patch',
      '--diff',
      '--stat',
      '--body',
      '--interactive',
    ];
    installPager(0);
    expect(runTerminal(flags).status).to.equal(0);
    expectSelected(fs.readFileSync(input, 'utf8'), 'pr-selected');
    expect(getStatLines(fs.readFileSync(input, 'utf8'))).to.deep.equal(
      getStatLines(selectedStat)
    );
    installPager(23);
    const failure = runTerminal(flags, linked);
    expect(failure.status).to.equal(1);
    expect(failure.output)
      .to.include('ERROR:')
      .and.not.match(/^pr-selected\s/m);
    const pagerCalls = fs.readFileSync(calls);
    const quiet = runTerminal([...flags, '--quiet'], linked);
    expect(quiet.status).to.equal(0);
    expect(quiet.output).to.equal('');
    expect(fs.readFileSync(calls)).to.deep.equal(pagerCalls);
    const invalid = runQuery([
      'info',
      'missing',
      '--stat',
      '--body',
      '--quiet',
    ]);
    expect(invalid.status).to.equal(1);
    expect(invalid.stdout).to.equal('');
    expect(invalid.stderr).to.include('ERROR:');
    expect(fs.readFileSync(calls)).to.deep.equal(pagerCalls);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      for (const file of [input, calls])
        fs.copyFileSync(
          file,
          path.join(
            evidence,
            `${path.basename(fixture.root)}-${path.basename(file)}`
          )
        );
  }

  function dirtyUntracked(cwd: string): void {
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
  }

  function expectFinished(expectedTrees: readonly string[]): void {
    expect(fixture.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(fixture.ok(['parent'])).to.equal('conflict-child\n');
    expect(fixture.ok(['info', 'conflict-child'])).to.include('Parent: main');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child own\nbase own');
    expect(
      fixture.git(['rev-list', '--merges', 'main..conflict-base'])
    ).to.equal('');
    expect(
      ['conflict-child', 'conflict-base'].map((branch) =>
        fixture.git(['rev-parse', `${branch}^{tree}`])
      )
    ).to.deep.equal(expectedTrees);
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(false);
  }

  it('preserves selected PR stat and pagers across dirty linked worktrees and two fresh conflict continuations', () => {
    preparePrs(['pr-selected', 'pr-checkout']);
    const main = fixture.git(['rev-parse', 'main']);
    const selectedStat = fixture.git(['diff', '--stat', main, 'pr-selected']);
    const selectedPatchStat = fixture.git([
      'log',
      '--format=',
      '--stat',
      `${main}..pr-selected`,
    ]);
    prepareConflict();
    const base = fixture.git(['rev-parse', 'conflict-base']);
    const expectedTrees = ['conflict-child', 'conflict-base'].map((branch) =>
      fixture.git(['rev-parse', `${branch}^{tree}`])
    );
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'pr-selected']);
    observed.push(linked);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'part staged');
    fs.writeFileSync(path.join(linked, 'staged-only'), 'staged only');
    fixture.git(['add', 'main.txt', 'staged-only'], linked);
    fs.writeFileSync(path.join(linked, 'main.txt'), 'part unstaged');
    const first = fixture.run(['reorder', '--stack', '--interactive']);
    expect(first.status, first.stdout + first.stderr).to.equal(1);
    expect(first.stdout + first.stderr)
      .to.include('Departure branch: conflict-base')
      .and.include('Remaining branches: conflict-child, conflict-base');
    expectReplay('conflict-child');
    observed.forEach(dirtyUntracked);
    const editor = fixture.env.CH_EDITOR;
    fixture.env.CH_EDITOR = path.join(fixture.root, 'sentinel-bin', 'editor');
    setQueryHooks(true);
    const implicit = runQuery(['info', '--stat', '--no-interactive']);
    expect(implicit.status, implicit.stderr).to.equal(0);
    expect(stripAnsi(implicit.stdout)).to.match(/^conflict-base\s/);
    expect(getStatLines(implicit.stdout)).to.deep.equal(
      getStatLines(fixture.git(['diff', '--stat', main, base]))
    );
    const explicit = runQuery([
      'info',
      'pr-selected',
      '--patch',
      '--stat',
      '--body',
      '--debug',
      '--interactive',
    ]);
    expect(explicit.status, explicit.stderr).to.equal(0);
    expectSelected(explicit.stdout, 'pr-selected');
    expect(getStatLines(explicit.stdout)).to.deep.equal(
      getStatLines(selectedPatchStat)
    );
    expect(explicit.stderr).not.to.equal('');
    expect(explicit.stdout).not.to.include('DEBUG');
    const attached = runQuery(['info', '--stat', '--body'], linked);
    expect(attached.status, attached.stderr).to.equal(0);
    expectSelected(attached.stdout, 'pr-selected');
    const alternate = runQuery(
      ['info', 'pr-checkout', '--diff', '--stat', '--body'],
      linked
    );
    expect(alternate.status, alternate.stderr).to.equal(0);
    expectSelected(alternate.stdout, 'pr-checkout');
    expectPagedSelection(selectedStat, linked);
    setQueryHooks(false);
    fixture.env.CH_EDITOR = editor;
    const linkedBefore = fixture.inspectionSnapshot(linked);
    resolve('child version');
    const second = fixture.run(['continue', '--no-interactive']);
    expect(second.status, second.stdout + second.stderr).to.equal(1);
    expect(second.stdout + second.stderr)
      .to.include('Completed branches: conflict-child')
      .and.include('Remaining branches: conflict-base');
    expectReplay('conflict-base');
    fixture.env.CH_PAGER = '';
    fixture.env.CH_EDITOR = path.join(fixture.root, 'sentinel-bin', 'editor');
    setQueryHooks(true);
    const next = runQuery(['info', '--stat']);
    expect(next.status, next.stderr).to.equal(0);
    expect(stripAnsi(next.stdout)).to.match(/^conflict-base\s/);
    expectSelected(
      runQuery(['info', '--stat', '--body'], linked).stdout,
      'pr-selected'
    );
    expectSelected(
      runQuery(['info', 'pr-checkout', '--stat', '--body']).stdout,
      'pr-checkout'
    );
    const quietSecond = runQuery(['info', '--stat', '--body', '--quiet']);
    expect(quietSecond.status, quietSecond.stderr).to.equal(0);
    expect(quietSecond.stdout).to.equal('');
    setQueryHooks(false);
    fixture.env.CH_EDITOR = editor;
    resolve('base version');
    fixture.ok(['continue']);
    expectFinished(expectedTrees);
    const linkedAfter = fixture.inspectionSnapshot(linked);
    expect({
      ...linkedAfter,
      refs: linkedBefore.refs,
      persistent: linkedBefore.persistent,
    }).to.deep.equal(linkedBefore);
  });

  for (const isExactRestart of [false, true]) {
    it(`rejects stale ownership during a ${
      isExactRestart ? 'matching restarted' : 'foreign'
    } raw Git replay while explicit PR stat stays usable`, () => {
      preparePrs(['pr-selected']);
      const main = fixture.git(['rev-parse', 'main']);
      const selected = fixture.git(['rev-parse', 'pr-selected']);
      const expectedStat = fixture.git(['diff', '--stat', main, selected]);
      fixture.git(['switch', '-c', 'raw-X', 'main']);
      resolve('raw X');
      fixture.git(['commit', '-m', 'raw X']);
      fixture.git(['switch', '-c', 'raw-Y']);
      resolve('raw Y');
      fixture.git(['commit', '-m', 'raw Y']);
      const rawTree = fixture.git(['rev-parse', 'raw-Y^{tree}']);
      fixture.git(['switch', '-c', 'raw-target', 'main']);
      resolve('raw target');
      fixture.git(['commit', '-m', 'raw target']);
      prepareConflict();
      const childTree = fixture.git(['rev-parse', 'conflict-child^{tree}']);
      expect(
        fixture.run(['reorder', '--stack', '--interactive']).status
      ).to.equal(1);
      expectReplay('conflict-child');
      fixture.git(['rebase', '--abort']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        'conflict-child'
      );
      const attached = runQuery(['info', '--stat']);
      expect(attached.status, attached.stderr).to.equal(0);
      expect(stripAnsi(attached.stdout)).to.match(/^conflict-child\s/);
      expect(() =>
        fixture.git([
          'rebase',
          '--onto',
          isExactRestart ? 'main' : 'raw-target',
          isExactRestart ? 'conflict-base' : 'raw-X',
          isExactRestart ? 'conflict-child' : 'raw-Y',
        ])
      ).to.throw();
      expectReplay(isExactRestart ? 'conflict-child' : 'raw-Y');
      setQueryHooks(true);
      fixture.env.CH_EDITOR = path.join(fixture.root, 'sentinel-bin', 'editor');
      for (const isResolved of [false, true]) {
        if (isResolved) resolve(isExactRestart ? 'child version' : 'raw Y');
        for (const flags of [[], ['--quiet']]) {
          const refused = runQuery(['info', '--stat', '--body', ...flags]);
          expect(refused.status).to.equal(1);
          expect(refused.stdout).to.equal('');
          expect(refused.stderr).to.include('ERROR:');
        }
        const explicit = runQuery(['info', 'pr-selected', '--stat', '--body']);
        expect(explicit.status, explicit.stderr).to.equal(0);
        expectSelected(explicit.stdout, 'pr-selected');
        expect(getStatLines(explicit.stdout)).to.deep.equal(
          getStatLines(expectedStat)
        );
      }
      setQueryHooks(false);
      fixture.git(['rebase', '--continue']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        isExactRestart ? 'conflict-child' : 'raw-Y'
      );
      // These fixtures change only main.txt; the resolved tree is known before replay.
      expect(fixture.git(['rev-parse', 'HEAD^{tree}'])).to.equal(
        isExactRestart ? childTree : rawTree
      );
    });
  }
});
