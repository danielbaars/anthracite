import fs from 'fs';
import { spawnSync } from 'child_process';
import stripAnsi from 'strip-ansi';
import path from 'path';
import { expect } from 'chai';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

class RestackCliFixture extends FreezeCliFixture {
  observe(): unknown {
    const recovery: Record<string, string> = {};
    const gitDir = path.join(this.repo, '.git');
    const visit = (name: string): void => {
      const file = path.join(gitDir, name);
      if (!fs.existsSync(file)) return;
      if (fs.statSync(file).isDirectory()) {
        for (const child of fs.readdirSync(file)) visit(path.join(name, child));
      } else recovery[name] = fs.readFileSync(file).toString('base64');
    };
    for (const name of [
      'config',
      '.gtcontinue',
      '.graphite_pr_info',
      'rebase-merge',
      'rebase-apply',
    ])
      visit(name);
    return { work: super.observe(), recovery };
  }
}

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

function startConflict(fixture: FreezeCliFixture): void {
  fixture.git(['switch', 'child']);
  fixture.stage('base.txt', 'child edit');
  fixture.git(['commit', '-m', 'child edit']);
  fixture.git(['switch', 'base']);
  fixture.stage('base.txt', 'parent edit');
  fixture.git(['commit', '-m', 'parent edit']);
  expect(fixture.run(['restack', '--upstack']).status).to.equal(1);
  expect(
    ['rebase-merge', 'rebase-apply'].some((name) =>
      fs.existsSync(path.join(fixture.repo, '.git', name))
    )
  ).to.equal(true);
}

function abortReplay(fixture: FreezeCliFixture): void {
  const command = getTestCliCommand(['rebase', '--abort']);
  const [executable, ...argv] = command;
  const before = fixture.observe();
  const rebase = recoveryFiles(fixture);
  const result = spawnSync(executable, argv, {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
  if (evidence)
    fs.appendFileSync(
      path.join(evidence, 'restack-abort.jsonl'),
      JSON.stringify({
        command,
        cwd: fixture.repo,
        explicitEnvironment: Object.fromEntries(
          [
            'HOME',
            'GH_CONFIG_DIR',
            'GRAPHITE_USER_CONFIG_PATH',
            'GIT_CONFIG_NOSYSTEM',
            'GIT_CONFIG_GLOBAL',
            'TERM',
            'NO_COLOR',
          ].map((key) => [key, fixture.env[key]])
        ),
        before,
        rebase,
        after: fixture.observe(),
        stdoutBase64: Buffer.from(result.stdout ?? '').toString('base64'),
        stderrBase64: Buffer.from(result.stderr ?? '').toString('base64'),
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
      }) + '\n'
    );
  expect(result.error).to.equal(undefined);
  expect(result.signal).to.equal(null);
  expect(result.status, result.stderr).to.equal(0);
}

function recoveryFiles(fixture: FreezeCliFixture): Record<string, string> {
  const directory = ['rebase-merge', 'rebase-apply']
    .map((name) => path.join(fixture.repo, '.git', name))
    .find((name) => fs.existsSync(name));
  if (!directory) throw new Error('Expected active fixture rebase');
  return Object.fromEntries(
    fs
      .readdirSync(directory)
      .map((name) => [
        name,
        fs.readFileSync(path.join(directory, name)).toString('base64'),
      ])
  );
}

// eslint-disable-next-line max-lines-per-function
describe('frozen anchors and recovery through the public CLI', function () {
  this.timeout(120000);
  let fixture: RestackCliFixture;
  beforeEach(function () {
    fixture = new RestackCliFixture();
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'restack-cases.jsonl'),
        JSON.stringify({
          root: fixture.root,
          fullTitle: this.currentTest?.fullTitle(),
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture.cleanup());

  it('skips a stale frozen only target without changing its tip or recorded base', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'main']);
    fixture.commit('advanced-main');
    const refs = fixture.refs();
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/base']);
    const output = fixture.ok(['r', '--branch', 'base', '-o']);
    expect(output).to.include('Skipping frozen branch base');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/base'])).to.equal(
      metadata
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('preserves a frozen recorded base before ordinary context repair can publish metadata', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'main']);
    fixture.commit('advanced-main');
    fixture.git(['switch', 'base']);
    fixture.git(['merge', '--no-edit', 'main']);
    const refs = fixture.refs();
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/base']);
    expect(fixture.ok(['restack', '--only'])).to.include(
      'Skipping frozen branch base'
    );
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/base'])).to.equal(
      metadata
    );
  });

  it('checks a newly frozen active replay before continue all stages its resolution', () => {
    startConflict(fixture);
    fixture.write('base.txt', 'resolved edit');
    fixture.ok(['freeze', 'child']);
    const legacy = path.join(fixture.repo, '.git', '.graphite_pr_info');
    fs.writeFileSync(legacy, '{"preserve":"legacy"}');
    const rebase = recoveryFiles(fixture);
    const before = fixture.observe();
    const continuation = fs.readFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue')
    );
    const result = fixture.run(['continue', '--all']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('an unfreeze child');
    expect(fixture.observe()).to.deep.equal(before);
    expect(recoveryFiles(fixture)).to.deep.equal(rebase);
    expect(fs.readFileSync(legacy, 'utf8')).to.equal('{"preserve":"legacy"}');
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'))
    ).to.deep.equal(continuation);
  });

  it('replays editable descendants onto the actual externally advanced frozen anchor', () => {
    fixture.ok(['freeze', 'base']);
    const baseMeta = fixture.git(['rev-parse', 'refs/branch-metadata/base']);
    const other = fixture.git(['rev-parse', 'other']);
    const oldChild = fixture.git(['rev-parse', 'child']);
    const oldTip = fixture.git(['rev-parse', 'tip']);
    fixture.commit('anchor-update');
    const anchor = fixture.git(['rev-parse', 'base']);
    fixture.git(['switch', 'main']);
    fixture.commit('trunk-update');
    fixture.ok(['restack', '--branch', 'base']);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(anchor);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/base'])).to.equal(
      baseMeta
    );
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(oldChild);
    expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(oldTip);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(anchor);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.git(['show', 'tip:anchor-update.txt'])).to.equal(
      'anchor-update'
    );
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.ok(['info', 'base'])).to.include('(frozen)');
    expect(fixture.ok(['info', 'child'])).not.to.include('(frozen)');
  });

  it('does not propagate a hypothetical rewrite through frozen anchors or block unchanged linked descendants', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'main']);
    fixture.commit('trunk-update');
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    const childWorktree = path.join(fixture.root, 'child worktree');
    fixture.git(['worktree', 'add', childWorktree, 'child']);
    fixture.write('untouched.txt', 'linked work', fixture.linked);
    fixture.write('untouched-child.txt', 'child work', childWorktree);
    const refs = fixture.refs();
    const linked = fixture.snapshot(fixture.linked);
    const child = fixture.snapshot(childWorktree);
    expect(fixture.ok(['r', '--branch', 'base', '-u'])).to.include(
      'Skipping frozen branch base'
    );
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    expect(fixture.snapshot(childWorktree)).to.deep.equal(child);
  });

  for (const args of [
    ['restack', '--branch', 'child', '--downstack'],
    ['r', '--branch', 'child', '-d'],
    ['restack', '--branch', 'base', '--upstack'],
    ['r', '--branch', 'base', '-u'],
  ]) {
    it(`${args.join(
      ' '
    )} preserves stale frozen scope and editable descendants`, () => {
      fixture.ok(['freeze', 'child']);
      fixture.git(['switch', 'main']);
      fixture.commit('trunk-update');
      const before = fixture.refs();
      expect(fixture.ok(args)).to.include('Skipping frozen branch base');
      expect(fixture.refs()).to.equal(before);
    });
  }

  for (const args of [
    ['create', 'new-child'],
    ['c', 'new-child'],
    ['create', 'new-child', '--onto', 'base'],
    ['c', 'new-child', '-o', 'base'],
  ]) {
    it(`${args.join(
      ' '
    )} creates a real editable commit above a frozen parent`, () => {
      fixture.ok(['freeze', 'base']);
      const parent = fixture.git(['rev-parse', 'base']);
      const meta = fixture.git(['rev-parse', 'refs/branch-metadata/base']);
      if (args.includes('--onto') || args.includes('-o'))
        fixture.git(['switch', 'other']);
      fixture.stage('new-work.txt', 'new child work');
      fixture.ok([...args, '-m', 'new child commit']);
      expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
      expect(fixture.git(['show', 'HEAD:new-work.txt'])).to.equal(
        'new child work'
      );
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
        'new child commit'
      );
      expect(fixture.git(['rev-parse', 'base'])).to.equal(parent);
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/base'])).to.equal(
        meta
      );
      expect(fixture.ok(['parent']).trim()).to.equal('base');
      expect(fixture.ok(['info'])).not.to.include('(frozen)');
      fixture.write('editable.txt', 'editable descendant');
      fixture.ok(['m', '-c', '-a', '-m', 'editable descendant commit']);
      expect(fixture.git(['show', 'HEAD:editable.txt'])).to.equal(
        'editable descendant'
      );
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
        'editable descendant commit'
      );
      expect(fixture.git(['rev-parse', 'base'])).to.equal(parent);
    });
  }

  it('uses fresh post-commit freeze status for implicit restack and leaves the skipped descendant stale', () => {
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    const hooks = path.join(fixture.repo, '.git', 'hooks');
    fs.writeFileSync(
      path.join(hooks, 'post-commit'),
      `#!/bin/sh
${cli.map(quote).join(' ')}
`,
      { mode: 0o755 }
    );
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    fixture.write('new-base-work.txt', 'new base work');
    const output = fixture.ok([
      'modify',
      '--commit',
      '--all',
      '-m',
      'base commit before freeze',
    ]);
    expect(output).to.include('Skipping frozen branch child');
    expect(fixture.git(['show', 'base:new-base-work.txt'])).to.equal(
      'new base work'
    );
    expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
      'base commit before freeze'
    );
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.ok(['info', 'child'])).to.include('(frozen)');
  });

  for (const command of ['continue', 'cont']) {
    it(`${command} preserves staged and unstaged resolution until explicit unfreeze then completes the actual replay`, () => {
      startConflict(fixture);
      fixture.write('base.txt', 'staged resolution');
      fixture.git(['add', 'base.txt']);
      fixture.write('untracked.txt', 'untracked work');
      fixture.write('child.txt', 'unstaged child work');
      fixture.ok(['freeze', 'child']);
      const before = fixture.observe();
      const rebase = recoveryFiles(fixture);
      const result = fixture.run([command, '-a']);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('an unfreeze child');
      expect(fixture.observe()).to.deep.equal(before);
      expect(recoveryFiles(fixture)).to.deep.equal(rebase);
      fixture.git(['checkout', '--', 'child.txt']);
      fixture.ok(['unfreeze', 'child']);
      fixture.ok([command]);
      expect(
        fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
      ).to.equal(false);
      expect(fixture.git(['show', 'child:base.txt'])).to.equal(
        'staged resolution'
      );
      expect(fixture.git(['log', '-1', '--format=%s', 'child'])).to.equal(
        'child edit'
      );
      expect(fixture.git(['rev-parse', 'child~2'])).to.equal(
        fixture.git(['rev-parse', 'base'])
      );
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(
        fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
      ).to.equal('untracked work');
    });
  }

  it('skips a newly frozen later generic queue item while completing earlier editable replays', () => {
    fixture.branch('z-sibling', 'base');
    const sibling = fixture.git(['rev-parse', 'z-sibling']);
    fixture.branch('z-child', 'z-sibling');
    const child = fixture.git(['rev-parse', 'z-child']);
    startConflict(fixture);
    fixture.ok(['freeze', 'z-sibling']);
    fixture.git(['worktree', 'add', fixture.linked, 'z-child']);
    fixture.write('linked-work.txt', 'preserved linked work', fixture.linked);
    const linked = fixture.snapshot(fixture.linked);
    const meta = fixture.git(['rev-parse', 'refs/branch-metadata/z-sibling']);
    fixture.write('base.txt', 'resolved edit');
    const output = fixture.ok(['cont', '--all']);
    expect(output).to.include('Skipping frozen branch z-sibling');
    expect(fixture.git(['rev-parse', 'z-child'])).to.equal(child);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal({
      ...linked,
      refs: fixture.refs(),
    });
    expect(fixture.git(['rev-parse', 'z-sibling'])).to.equal(sibling);
    expect(
      fixture.git(['rev-parse', 'refs/branch-metadata/z-sibling'])
    ).to.equal(meta);
    expect(fixture.git(['show', 'child:base.txt'])).to.equal('resolved edit');
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.ok(['info', 'child'])).not.to.include('(frozen)');
  });

  it('keeps the existing rebase abort available after an active replay becomes frozen', () => {
    const child = fixture.git(['rev-parse', 'child']);
    startConflict(fixture);
    const beforeAbort = fixture.git(['rev-parse', 'child']);
    expect(beforeAbort).not.to.equal(child);
    fixture.ok(['freeze', 'child']);
    const parent = fixture.git(['rev-parse', 'base']);
    abortReplay(fixture);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(false);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(beforeAbort);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(parent);
    expect(fixture.ok(['info', 'child'])).to.include('(frozen)');
  });

  it('keeps known editable replay worktree blockers ahead of all branch effects', () => {
    fixture.ok(['freeze', 'base']);
    fixture.commit('anchor-update');
    fixture.git(['switch', 'main']);
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.write('linked-work.txt', 'preserve linked bytes', fixture.linked);
    const before = fixture.observe();
    const linked = fixture.snapshot(fixture.linked);
    const result = fixture.run(['restack', '--branch', 'base']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('checked out in worktree');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
  });

  it('preserves completed editable restacks and untracked work when a later actual replay fails', () => {
    fixture.ok(['freeze', 'base']);
    fixture.commit('anchor-update');
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    fixture.write('tip.txt', 'untracked collision');
    const result = fixture.run(['r', '--upstack']);
    expect(result.status).to.equal(1);
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(child);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('untracked collision');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(true);
    expect(
      fs
        .readFileSync(
          path.join(fixture.repo, '.git', 'rebase-merge', 'head-name'),
          'utf8'
        )
        .trim()
    ).to.equal('refs/heads/tip');
    const savedWork = path.join(fixture.root, 'preserved-tip.txt');
    fs.renameSync(path.join(fixture.repo, 'tip.txt'), savedWork);
    abortReplay(fixture);
    expect(fs.readFileSync(savedWork, 'utf8')).to.equal('untracked collision');
  });

  it('uses cwd prefix and suffix selection and quiet suppresses successful frozen skips', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'main']);
    fixture.commit('trunk-update');
    const before = fixture.refs();
    for (const args of [
      [
        '--cwd',
        fixture.repo,
        'restack',
        '--branch',
        'base',
        '--only',
        '--quiet',
      ],
      ['r', '-o', '--branch', 'base', '--cwd', fixture.repo, '-q'],
    ]) {
      const result = fixture.run(args, fixture.root);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
      expect(fixture.refs()).to.equal(before);
    }
  });

  it('retains navigation aliases and parent children patch diff and stat inspection for frozen branches', () => {
    fixture.ok(['freeze', 'tip']);
    const refs = fixture.refs();
    fixture.write('untracked.txt', 'portable work');
    const steps: ReadonlyArray<readonly [string, string]> = [
      ['checkout', 'child'],
      ['co', 'base'],
      ['up', 'child'],
      ['u', 'tip'],
      ['down', 'child'],
      ['d', 'base'],
      ['top', 'tip'],
      ['b', 'base'],
      ['t', 'tip'],
      ['bottom', 'base'],
    ];
    for (const [command, target] of steps) {
      fixture.ok(
        command === 'checkout' || command === 'co'
          ? [command, target]
          : [command]
      );
      expect(fixture.git(['branch', '--show-current'])).to.equal(target);
      expect(fixture.refs()).to.equal(refs);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
      ).to.equal('portable work');
    }
    expect(fixture.ok(['parent']).trim()).to.equal('main');
    expect(fixture.ok(['children']).trim()).to.equal('child');
    expect(fixture.ok(['info', 'child', '--patch'])).to.include('child.txt');
    expect(stripAnsi(fixture.ok(['i', 'child', '--diff']))).to.include(
      '+child'
    );
    expect(fixture.ok(['info', 'child', '--stat'])).to.include(
      '1 file changed'
    );
    expect(fixture.refs()).to.equal(refs);
  });

  it('advertises frozen skips and current-status continuation checks in public help', () => {
    expect(fixture.ok(['restack', '--help'])).to.include('frozen');
    expect(fixture.ok(['r', '--help'])).to.include('--only');
    expect(fixture.ok(['continue', '--help'])).to.include('frozen');
    expect(fixture.ok(['cont', '--help'])).to.include('--all');
  });

  it('modifies an editable ancestor without preflighting a frozen linked descendant or its unchanged child', () => {
    fixture.ok(['freeze', 'child']);
    fixture.git(['branch', 'editable-anchor', 'base']);
    fixture.ok(['track', 'editable-anchor', '--parent', 'main']);
    fixture.ok(['track', 'child', '--parent', 'editable-anchor']);
    fixture.git(['switch', 'editable-anchor']);
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.write('linked-work.txt', 'preserved linked work', fixture.linked);
    const linked = fixture.snapshot(fixture.linked);
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    fixture.write('new-editable-work.txt', 'editable work');
    expect(
      fixture.ok(['m', '-c', '-a', '-m', 'editable ancestor commit'])
    ).to.include('Skipping frozen branch child');
    expect(
      fixture.git(['show', 'editable-anchor:new-editable-work.txt'])
    ).to.equal('editable work');
    expect(
      fixture.git(['log', '-1', '--format=%s', 'editable-anchor'])
    ).to.equal('editable ancestor commit');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    // The shared refs include the completed editable commit; local linked work must remain byte-identical.
    expect(fixture.snapshot(fixture.linked)).to.deep.equal({
      ...linked,
      refs: fixture.refs(),
    });
  });

  it('guards the actual active apply-backend branch before cont all changes its index', () => {
    fixture.git(['config', 'rebase.backend', 'apply']);
    startConflict(fixture);
    fixture.write('base.txt', 'apply resolution');
    fixture.ok(['freeze', 'child']);
    const before = fixture.observe();
    const rebase = recoveryFiles(fixture);
    const result = fixture.run(['cont', '--all']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('an unfreeze child');
    expect(fixture.observe()).to.deep.equal(before);
    expect(recoveryFiles(fixture)).to.deep.equal(rebase);
  });
});
