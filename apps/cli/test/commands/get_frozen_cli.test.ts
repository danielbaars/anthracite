import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('get CLI existing frozen branches', function () {
  this.timeout(45000);
  let fixture: FrozenGetFixture;
  beforeEach(function () {
    fixture = new FrozenGetFixture();
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'frozen-get-cases.jsonl'),
        JSON.stringify({
          root: fixture.root,
          fullTitle: this.currentTest?.fullTitle(),
        }) + '\n'
      );
  });
  afterEach(() => fixture?.cleanup());

  it('keeps frozen status and local descendants after explicit force overwrite', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'descendant');
    const descendant = fixture.commit(
      fixture.consumer,
      'descendant.txt',
      'local descendant'
    );
    fixture.ok('track', '--parent', 'child');
    fixture.ok('freeze', 'child');
    const head = fixture.advanceChild();
    fixture.ok('get', 'child', '--force');
    fixture.assertTip('child', head);
    fixture.assertTip('descendant', descendant);
    fixture.status();
    fixture.ok('track', 'child', '--parent', 'parent');
    fixture.status();
    fixture.ok('up');
    fixture.assertTip('HEAD', descendant);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'descendant.txt'), 'utf8')
    ).to.equal('local descendant');
  });
  it('offers only explicit remote overwrite or abort for frozen divergence in a real PTY', () => {
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local-only commit'
    );
    fixture.ok('freeze', 'child');
    const head = fixture.advanceChild();
    const result = fixture.run(['g', 'child'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Rebase your changes');
    expect(result.output).to.include('unfreeze');
    fixture.assertTip('child', head);
    fixture.assertTip('HEAD', head);
    expect(fixture.git(fixture.consumer, 'merge-base', local, head)).to.equal(
      fixture.oldChild
    );
    expect(fs.existsSync(path.join(fixture.consumer, 'local.txt'))).to.equal(
      false
    );
    fixture.status();
  });

  for (const hook of ['post-merge', 'post-checkout'])
    it(`retains a fresh freeze from a real ${hook} hook through fast-forward publication and a later metadata write`, () => {
      fixture.ok('unfreeze', 'child');
      const head = fixture.advanceChild();
      const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
      if (hook === 'post-checkout') fixture.ok('down');
      fs.writeFileSync(
        path.join(fixture.consumer, '.git', 'hooks', hook),
        `#!/bin/sh\n${cli.map(quote).join(' ')}\n`,
        { mode: 0o755 }
      );
      fixture.ok('get', 'child');
      fixture.assertTip('HEAD', head);
      fixture.assertTip('child', head);
      fixture.status();
      fixture.ok('track', 'child', '--parent', 'parent');
      fixture.status();
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
      ).to.equal('child-new');
    });

  it('refuses force with unrelated staged and unstaged tracked work before replacing local refs', () => {
    fixture.ok('freeze', 'child');
    fixture.advanceChild();
    fs.writeFileSync(path.join(fixture.consumer, 'main.txt'), 'staged work');
    fixture.git(fixture.consumer, 'add', 'main.txt');
    fs.appendFileSync(
      path.join(fixture.consumer, 'main.txt'),
      ' and unstaged work'
    );
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    const result = fixture.run(['get', 'child', '--force']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('tracked changes');
    expect(fixture.observe()).to.deep.equal(before);
  });

  for (const force of [true, false])
    it(`preserves an ignored collision during ${
      force ? 'force overwrite' : 'fast-forward'
    }`, () => {
      fixture.ok('freeze', 'child');
      const head = fixture.commit(
        fixture.producer,
        'incoming.bin',
        'remote bytes'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'child');
      fs.appendFileSync(
        path.join(fixture.consumer, '.git', 'info', 'exclude'),
        '\nincoming.bin\n'
      );
      fs.writeFileSync(
        path.join(fixture.consumer, 'incoming.bin'),
        'ignored local bytes\0tail'
      );
      const result = fixture.run(['g', 'child', ...(force ? ['--force'] : [])]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.match(/overwritten|untracked/);
      fixture.assertTip('child', fixture.oldChild);
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'incoming.bin'), 'utf8')
      ).to.equal('ignored local bytes\0tail');
      expect(fixture.git(fixture.remote, 'rev-parse', 'child')).to.equal(head);
      fixture.status();
    });

  it('reports a reached remote head and unfinished metadata when publication fails after fast-forward', () => {
    fixture.ok('freeze', 'child');
    const metadata = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/child'
    );
    const head = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-merge'),
      '#!/bin/sh\nprintf locked > .git/refs/branch-metadata/child.lock\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Updated child before get stopped');
    expect(result.output).to.match(/metadata.*incomplete/i);
    expect(result.output).not.to.include('Synced child');
    fixture.assertTip('child', head);
    fixture.assertTip('HEAD', head);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).to.equal(metadata);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
    ).to.equal('child-new');
    fs.removeSync(
      path.join(
        fixture.consumer,
        '.git',
        'refs',
        'branch-metadata',
        'child.lock'
      )
    );
    fixture.status();
  });

  for (const continuation of ['continue', 'cont'])
    it(`preserves a queued import through a repeated get conflict and fresh frozen ${continuation} --all refusal`, () => {
      fixture.ok('unfreeze', 'child');
      fixture.commit(fixture.consumer, 'local.txt', 'local replay');
      const remoteChild = fixture.advanceChild();
      fixture.git(fixture.producer, 'switch', '-c', 'tip');
      const tip = fixture.commit(fixture.producer, 'tip.txt', 'queued import');
      fixture.git(fixture.producer, 'push', 'origin', 'tip');
      fs.writeJsonSync(fixture.prs, {
        parent: 'main',
        child: 'parent',
        tip: 'child',
      });
      const result = fixture.run(['get', 'tip'], true, [
        { prompt: 'How would you like to handle', input: '\r' },
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Hit conflict');
      expect(
        fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
      ).to.equal(true);
      expect(fixture.run([continuation]).status).to.equal(1);
      fs.writeFileSync(
        path.join(fixture.consumer, 'child.txt'),
        'resolved remote and local'
      );
      fixture.git(fixture.consumer, 'add', 'child.txt');
      fs.writeFileSync(
        path.join(fixture.consumer, 'loose.txt'),
        'must not be staged while frozen'
      );
      fixture.ok('freeze', 'child');
      const before = fixture.observe();
      const stopped = fixture.run([continuation, '--all']);
      expect(stopped.status, stopped.output).to.equal(1);
      expect(stopped.output).to.include('ch unfreeze child');
      expect(fixture.observe()).to.deep.equal(before);
      fixture.ok('unfreeze', 'child');
      fs.removeSync(path.join(fixture.consumer, 'loose.txt'));
      fixture.ok(continuation);
      fixture.assertTip('tip', tip);
      fixture.assertTip('HEAD', tip);
      const replayed = fixture.git(fixture.consumer, 'rev-parse', 'child');
      expect(
        fixture.git(fixture.consumer, 'merge-base', replayed, remoteChild)
      ).to.equal(remoteChild);
      expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
        'local replay'
      );
      expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
        'resolved remote and local'
      );
      expect(
        fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
      ).to.equal(false);
    });

  it('preserves the current checkout and raw index when a later force layer hits an untracked collision', () => {
    fixture.ok('freeze', 'child');
    fixture.commit(fixture.producer, 'incoming.txt', 'remote incoming');
    fixture.git(fixture.producer, 'push', 'origin', 'child');
    fs.writeFileSync(
      path.join(fixture.consumer, 'incoming.txt'),
      'untracked local'
    );
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    const result = fixture.run(['get', 'child', '--force']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.match(/overwritten|untracked/);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('reports completed layers when final target checkout meets a new ignored collision', () => {
    fixture.ok('freeze', 'child');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent.txt',
      'parent advanced alone'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    fs.appendFileSync(
      path.join(fixture.consumer, '.git', 'info', 'exclude'),
      '\nchild.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-merge'),
      '#!/bin/sh\nprintf "ignored child collision" > child.txt\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Updated parent before get stopped');
    expect(result.output).to.include('checkout');
    fixture.assertTip('parent', parent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('HEAD', parent);
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
    ).to.equal('ignored child collision');
    fixture.status();
  });

  it('does not report a force update as synced when a checkout hook advances its fetched tip', () => {
    fixture.ok('freeze', 'child');
    const head = fixture.advanceChild();
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = child ]; then git -c core.hooksPath=/dev/null commit --allow-empty -m hook-after-force; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child', '--force']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('changed while getting the stack');
    expect(result.output).to.include('Updated child before get stopped');
    expect(result.output).not.to.include('Synced child');
    const reached = fixture.git(fixture.consumer, 'rev-parse', 'child');
    expect(reached).not.to.equal(head);
    expect(fixture.git(fixture.consumer, 'merge-base', reached, head)).to.equal(
      head
    );
    expect(fixture.git(fixture.consumer, 'log', '-1', '--format=%s')).to.equal(
      'hook-after-force'
    );
    fixture.status();
  });

  for (const frozen of [false, true])
    for (const selector of ['branch', 'number', 'current'])
      it(`keeps ${
        frozen ? 'frozen' : 'editable'
      } status through no-op and two-layer FF via ${selector}`, () => {
        if (frozen) fixture.ok('freeze', 'child');
        else fixture.ok('unfreeze', 'parent');
        const args =
          selector === 'branch'
            ? ['get', 'child']
            : selector === 'number'
            ? ['g', '2']
            : ['get'];
        fixture.git(fixture.consumer, 'status', '--porcelain');
        const before = fixture.observe();
        fixture.ok(...args);
        expect(fixture.observe()).to.deep.equal(before);
        const head = fixture.advanceBoth();
        fixture.ok(...args);
        fixture.assertTip('parent', head.parent);
        fixture.assertTip('child', head.child);
        fixture.assertTip('HEAD', head.child);
        expect(
          fixture.git(
            fixture.consumer,
            'rev-parse',
            'refs/remotes/origin/child'
          )
        ).to.equal(head.child);
        expect(
          fixture.git(fixture.consumer, 'rev-parse', 'child^{tree}')
        ).to.equal(fixture.git(fixture.producer, 'rev-parse', 'child^{tree}'));
        fixture.status('child', frozen);
        fixture.ok('down');
        fixture.assertTip('HEAD', head.parent);
        fixture.ok('up');
        fixture.assertTip('HEAD', head.child);
      });

  for (const frozen of [false, true])
    it(`imports a valid changed remote parent with explicit ${
      frozen ? 'force while frozen' : 'PTY confirmation while editable'
    }`, () => {
      if (frozen) fixture.ok('freeze', 'child');
      else fixture.ok('unfreeze', 'child');
      const parent = fixture.git(fixture.consumer, 'rev-parse', 'parent');
      const head = fixture.advanceChild();
      fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
      const before = fixture.observe();
      const refused = fixture.run(['get', 'child']);
      expect(refused.status, refused.output).to.equal(1);
      expect(refused.output).to.include('different parents');
      expect(refused.output).not.to.include('Rebase your changes');
      expect(fixture.observe()).to.deep.equal(before);
      const accepted = frozen
        ? fixture.run(['get', 'child', '-f'])
        : fixture.run(['get', 'child'], true, [
            { prompt: 'Overwrite child', input: 'y\r' },
          ]);
      expect(accepted.status, accepted.output).to.equal(0);
      fixture.assertTip('child', head);
      fixture.assertTip('parent', parent);
      fixture.status('child', frozen);
      fixture.ok('down');
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('main');
    });

  it('refuses an invalid remote parent chain before force can replace frozen local refs', () => {
    fixture.ok('freeze', 'child');
    fixture.advanceChild();
    fs.writeJsonSync(fixture.prs, { parent: 'child', child: 'parent' });
    const before = fixture.observe();
    const result = fixture.run(['g', 'child', '--force']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('cycle');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('keeps frozen divergent commits and resolution guidance under quiet cwd routing', () => {
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local protected'
    );
    fixture.ok('freeze', 'child');
    fixture.advanceChild();
    const before = fixture.observe();
    fixture.cwd = fixture.root;
    const result = fixture.run([
      '--cwd',
      fixture.consumer,
      '--quiet',
      'g',
      '2',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('ch unfreeze child');
    expect(result.stderr).to.include('--force');
    expect(result.output).not.to.include('How would you like');
    expect(fixture.observe()).to.deep.equal(before);
    fixture.assertTip('child', local);
  });

  it('refuses a REBASE chosen after another process freezes the waiting branch', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local retained'
    );
    fixture.advanceChild();
    const result = fixture.run(['get', 'child'], true, [
      {
        prompt: 'How would you like to handle',
        input: '\r',
        beforeInput: getTestCliCommand(['freeze', 'child', '--no-interactive']),
      },
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('ch unfreeze child');
    fixture.assertTip('HEAD', local);
    fixture.assertTip('child', local);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    fixture.status();
  });

  it('retains frozen status and discovered PR details through refresh, no-op and force overwrite', () => {
    fixture.ok('sync', '--no-pull', '--no-delete');
    fixture.ok('freeze', 'child');
    fs.writeJsonSync(fixture.details, { child: 'Updated child PR title' });
    fixture.ok('sync', '--no-pull', '--no-delete');
    expect(fixture.ok('info', 'child').output).to.include(
      'Updated child PR title'
    );
    fixture.status();
    fixture.ok('get', 'child');
    fixture.status();
    const head = fixture.advanceChild();
    fixture.ok('get', 'child', '--force');
    fixture.assertTip('HEAD', head);
    expect(fixture.ok('info', 'child').output).to.include(
      'Updated child PR title'
    );
    fixture.status();
  });

  for (const force of [false, true])
    it(`preserves a frozen target in another dirty worktree with force=${force}`, () => {
      fixture.ok('freeze', 'child');
      fixture.advanceChild();
      fixture.ok('down');
      const other = path.join(fixture.root, 'other-worktree');
      fixture.git(fixture.consumer, 'worktree', 'add', other, 'child');
      fs.writeFileSync(path.join(other, 'child.txt'), 'other staged');
      fixture.git(other, 'add', 'child.txt');
      fs.appendFileSync(path.join(other, 'child.txt'), ' and unstaged');
      fixture.git(other, 'status', '--porcelain');
      fixture.git(fixture.consumer, 'status', '--porcelain');
      const before = fixture.observe();
      const outside = fixture.observe(other);
      const result = fixture.run([
        'get',
        'child',
        ...(force ? ['--force'] : []),
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include(other);
      expect(fixture.observe()).to.deep.equal(before);
      expect(fixture.observe(other)).to.deep.equal(outside);
    });

  it('retains get/g help, force aliases and root completion without changing frozen refs', () => {
    fixture.ok('freeze', 'child');
    const before = fixture.observe();
    for (const command of ['get', 'g']) {
      const help = fixture.ok(command, '--help').output;
      expect(help).to.include('--force');
      expect(help).to.include('-f');
    }
    const completion = fixture
      .ok('--get-yargs-completions', 'ch', '')
      .output.split('\n')
      .map((line) => line.split(':')[0]);
    expect(completion).to.include('get');
    expect(completion).to.include('g');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('rechecks fresh status after remote-tracking publication before starting local replay', () => {
    fixture.ok('unfreeze', 'child');
    const local = fixture.commit(
      fixture.consumer,
      'local.txt',
      'local must remain'
    );
    fixture.advanceChild();
    const armed = path.join(fixture.root, 'arm-replay-check');
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ] && [ -f ${quote(
        armed
      )} ]; then\n  while read old new ref; do\n    if [ "$ref" = refs/remotes/origin/child ]; then ${cli
        .map(quote)
        .join(' ')} || exit $?; fi\n  done\nfi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child'], true, [
      {
        prompt: 'How would you like to handle',
        input: '\r',
        beforeInput: ['/usr/bin/touch', armed],
      },
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('ch unfreeze child');
    fixture.assertTip('HEAD', local);
    fixture.assertTip('child', local);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    fixture.status();
  });

  it('keeps a frozen force no-op free of metadata publication and checkout writes', () => {
    fixture.ok('freeze', 'child');
    const publications = path.join(fixture.root, 'metadata-publications');
    fs.writeFileSync(publications, '');
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/branch-metadata/*) printf '%s\\n' "$ref" >> ${quote(
        publications
      )};; esac\ndone\n`,
      { mode: 0o755 }
    );
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    fixture.ok('g', '2', '--force');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fs.readFileSync(publications, 'utf8')).to.equal('');
    fixture.status();
  });

  it('retains a freeze published by a force checkout hook after the original editable context loaded', () => {
    fixture.ok('unfreeze', 'child');
    const head = fixture.advanceChild();
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\n${cli.map(quote).join(' ')}\n`,
      { mode: 0o755 }
    );
    fixture.ok('get', 'child', '--force');
    fixture.assertTip('child', head);
    fixture.assertTip('HEAD', head);
    fixture.status();
    fixture.ok('track', 'child', '--parent', 'parent');
    fixture.status();
  });
  it('reports a completed parent-metadata import even when its head was unchanged before a later fetch failure', () => {
    fixture.ok('freeze', 'child');
    const before = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/child'
    );
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'main',
      missing: 'child',
    });
    const result = fixture.run(['get', 'missing', '--force']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Updated child before get stopped');
    fixture.assertTip('child', fixture.oldChild);
    expect(
      fixture.git(fixture.consumer, 'rev-parse', 'refs/branch-metadata/child')
    ).not.to.equal(before);
    fixture.status();
    fixture.ok('down');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
  });
});
