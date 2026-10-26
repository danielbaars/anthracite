import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';

class LifecycleCliFixture extends FreezeCliFixture {
  observe(): unknown {
    const recovery = Object.fromEntries(
      [
        'config',
        '.graphite_repo_config',
        '.gtcontinue',
        '.graphite_pr_info',
        '.graphite_cache_persist',
        '.graphite_cache_lock',
      ].map((name) => {
        const file = path.join(this.repo, '.git', name);
        return [
          name,
          fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null,
        ];
      })
    );
    const operation: Record<string, string> = {};
    for (const name of ['rebase-merge', 'rebase-apply']) {
      const directory = path.join(this.repo, '.git', name);
      if (fs.existsSync(directory))
        for (const file of fs.readdirSync(directory))
          operation[`${name}/${file}`] = fs
            .readFileSync(path.join(directory, file))
            .toString('base64');
    }
    return { work: super.observe(), recovery, operation };
  }
}

function attachPr(fixture: FreezeCliFixture): void {
  fs.writeFileSync(
    path.join(fixture.root, 'bin', 'gh'),
    `#!${process.execPath}
if (process.argv[2] === 'pr' && process.argv[3] === 'view' && ['base', '17'].includes(process.argv[4])) {
process.stdout.write(JSON.stringify({number:17, headRefName:'base', baseRefName:'main', state:'OPEN', title:'Lifecycle fixture', body:'Preserved body', url:'https://github.com/fixture/lifecycle/pull/17', isDraft:false}));
} else { process.stderr.write('no pull requests found'); process.exitCode=1; }
`,
    { mode: 0o755 }
  );
  fixture.ok(['repo', 'owner', '--set', 'fixture']);
  fixture.ok(['repo', 'name', '--set', 'lifecycle']);
  fixture.ok(['repo', 'github', '--enable']);
  fixture.ok(['sync', '--no-pull', '--no-delete', '--no-restack']);
  expect(fixture.ok(['info'])).to.include('PR #17');
}

// eslint-disable-next-line max-lines-per-function
describe('frozen branch lifecycle through the public CLI', function () {
  this.timeout(120000);
  let fixture: LifecycleCliFixture;
  beforeEach(function () {
    fixture = new LifecycleCliFixture();
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'lifecycle-cases.jsonl'),
        JSON.stringify({
          root: fixture.root,
          fullTitle: this.currentTest?.fullTitle(),
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture.cleanup());

  for (const command of ['rename', 'rn']) {
    it(`${command} preserves frozen identity, PR information and frozen children without rewriting commits`, () => {
      attachPr(fixture);
      fixture.ok(['freeze', 'base']);
      fixture.ok(['freeze', 'child']);
      const unchanged = fixture.observe();
      fixture.ok([command, 'base']);
      expect(fixture.observe()).to.deep.equal(unchanged);
      fixture.git(['worktree', 'add', fixture.linked, 'child']);
      const linked = fixture.snapshot(fixture.linked);
      const refs = fixture
        .refs()
        .replace('refs/heads/base ', 'refs/heads/renamed ')
        .split('\n')
        .sort()
        .join('\n');
      const child = fixture.git(['rev-parse', 'child']);
      fixture.stage('staged.txt', 'staged');
      fixture.write('base.txt', 'unstaged');
      const index = fixture.git(['write-tree']);
      const diff = fixture.git(['diff', '--binary']);
      fixture.ok([command, 'renamed', '--force']);
      expect(fixture.refs()).to.equal(refs);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
      expect(fixture.git(['write-tree'])).to.equal(index);
      expect(fixture.git(['diff', '--binary'])).to.equal(diff);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal({
        ...linked,
        refs: fixture.refs(),
      });
      expect(fixture.ok(['info'])).to.include('PR #17');
      expect(fixture.run(['modify', '-m', 'blocked']).stderr).to.include(
        'ch unfreeze renamed'
      );
      expect(
        fixture.run(['modify', '-m', 'blocked'], fixture.linked).stderr
      ).to.include('ch unfreeze child');
      expect(fixture.ok(['parent'], fixture.linked).trim()).to.equal('renamed');
    });
  }
  for (const command of ['delete', 'dl']) {
    for (const protectedBranch of ['child', 'tip']) {
      it(`${command} refuses a frozen ${protectedBranch} survivor before metadata repair or deletion even with force`, () => {
        fixture.ok(['freeze', protectedBranch]);
        if (protectedBranch === 'tip') {
          fixture.ok(['untrack', 'base', '--force']);
          fixture.ok(['track', 'base', '--parent', 'main']);
          fixture.ok(['untrack', 'child', '--force']);
          fixture.ok(['track', 'child', '--parent', 'base']);
        }
        fixture.git(['switch', 'main']);
        fixture.commit('advance');
        fixture.git(['switch', 'other']);
        fixture.git(['merge', '--no-edit', 'main']);
        fixture.git(['switch', 'base']);
        fixture.stage('pending.txt', 'pending');
        fixture.write('base.txt', 'unstaged');
        fixture.git(['worktree', 'add', fixture.linked, protectedBranch]);
        const linked = fixture.snapshot(fixture.linked);
        const before = fixture.observe();
        const result = fixture.run([command, 'base', '--force']);
        expect(result.status).to.equal(1);
        expect(result.stderr).to.include(`ch unfreeze ${protectedBranch}`);
        expect(fixture.observe()).to.deep.equal(before);
        expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
      });
    }
  }
  for (const args of [['init'], ['repo', 'init'], ['repo', 'i']]) {
    it(`${args.join(
      ' '
    )} refuses a frozen new trunk before config or repair writes`, () => {
      fixture.ok(['freeze', 'base']);
      fixture.git(['switch', 'main']);
      fixture.commit('advance');
      fixture.git(['switch', 'other']);
      fixture.git(['merge', '--no-edit', 'main']);
      fixture.stage('pending.txt', 'pending');
      const before = fixture.observe();
      const result = fixture.run([...args, '--trunk', 'base']);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('ch unfreeze base');
      expect(fixture.observe()).to.deep.equal(before);
    });
  }
  for (const command of ['untrack', 'ut', 'utr']) {
    it(`${command} removes only own protection and preserves frozen descendants through downstack retracking`, () => {
      fixture.ok(['freeze', 'tip']);
      fixture.stage('pending.txt', 'pending');
      fixture.write('base.txt', 'unstaged');
      const work = fixture.snapshot();
      const childMetadata = fixture.git([
        'rev-parse',
        'refs/branch-metadata/child',
      ]);
      const tipMetadata = fixture.git([
        'rev-parse',
        'refs/branch-metadata/tip',
      ]);
      const declined = fixture.observe();
      fixture.ok([command, 'base']);
      expect(fixture.observe()).to.deep.equal(declined);
      fixture.ok([command, 'base', '--force']);
      expect(fixture.snapshot()).to.deep.equal(work);
      expect(
        fixture.git([
          'for-each-ref',
          '--format=%(refname)',
          'refs/branch-metadata/base',
        ])
      ).to.equal('');
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
        childMetadata
      );
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/tip'])).to.equal(
        tipMetadata
      );
      fixture.ok(['tr', 'tip', '--downstack', '--force']);
      expect(fixture.snapshot()).to.deep.equal(work);
      expect(fixture.ok(['info'])).not.to.include('(frozen)');
      fixture.git(['worktree', 'add', fixture.linked, 'tip']);
      expect(
        fixture.run(['modify', '-m', 'blocked'], fixture.linked).stderr
      ).to.include('ch unfreeze tip');
      fixture.ok(['modify', '-m', 'editable again']);
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
        'editable again'
      );
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
        childMetadata
      );
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/tip'])).to.equal(
        tipMetadata
      );
    });
  }

  for (const command of ['track', 'tr']) {
    it(`${command} preserves existing protection during same-parent, new-parent, force and downstack administration`, () => {
      fixture.ok(['freeze', 'child']);
      const work = fixture.snapshot();
      fixture.ok([command, 'child', '--parent', 'base']);
      expect(
        fixture.ok([command, 'child', '--parent', 'main', '--quiet'])
      ).to.equal('');
      expect(fixture.snapshot()).to.deep.equal(work);
      fixture.git(['worktree', 'add', fixture.linked, 'child']);
      expect(fixture.ok(['parent'], fixture.linked).trim()).to.equal('main');
      expect(
        fixture.run(['modify', '-m', 'blocked'], fixture.linked).stderr
      ).to.include('ch unfreeze child');
      fixture.ok([command, 'child', '--force']);
      fixture.ok([command, 'child', '--downstack', '--force']);
      expect(fixture.ok(['parent'], fixture.linked).trim()).to.equal('base');
      expect(
        fixture.run(['modify', '-m', 'blocked'], fixture.linked).stderr
      ).to.include('ch unfreeze child');
      expect(fixture.snapshot()).to.deep.equal(work);
    });
  }
  for (const command of ['delete', 'dl']) {
    it(`${command} may delete its frozen target and really replay editable survivors`, () => {
      fixture.ok(['freeze', 'base']);
      fixture.git(['worktree', 'add', fixture.linked, 'other']);
      const linked = fixture.snapshot(fixture.linked);
      const main = fixture.git(['rev-parse', 'main']);
      const child = fixture.git(['rev-parse', 'child']);
      const tip = fixture.git(['rev-parse', 'tip']);
      fixture.ok([command, 'base', '--force']);
      expect(
        fixture.git([
          'for-each-ref',
          '--format=%(refname)',
          'refs/heads/base',
          'refs/branch-metadata/base',
        ])
      ).to.equal('');
      expect(fixture.git(['rev-parse', 'child^'])).to.equal(main);
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(fixture.git(['rev-parse', 'child'])).not.to.equal(child);
      expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(tip);
      expect(
        fixture.git(['ls-tree', '-r', '--name-only', 'tip']).split('\n')
      ).to.deep.equal(['child.txt', 'main.txt', 'tip.txt']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
      expect(fixture.snapshot(fixture.linked)).to.deep.equal({
        ...linked,
        refs: fixture.refs(),
      });
    });

    it(`${command} retains existing merge and target-worktree safety for a frozen target`, () => {
      fixture.ok(['freeze', 'base']);
      const before = fixture.observe();
      expect(fixture.run([command, 'base']).stderr).to.include(
        'neither merged nor closed'
      );
      expect(fixture.observe()).to.deep.equal(before);
      fixture.git(['switch', 'other']);
      fixture.git(['worktree', 'add', fixture.linked, 'base']);
      const held = fixture.observe();
      const linked = fixture.snapshot(fixture.linked);
      expect(fixture.run([command, 'base', '--force']).status).to.equal(1);
      expect(fixture.observe()).to.deep.equal(held);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    });
  }

  it('rechecks surviving protection after an actual checkout hook and reports the retained progress', () => {
    const command = getTestCliCommand(['freeze', 'child']);
    const script = command
      .map((part: string) => `'${part.replace(/'/g, `'"'"'`)}'`)
      .join(' ');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\n${script} --no-interactive\n`,
      { mode: 0o755 }
    );
    const child = fixture.git(['rev-parse', 'child']);
    const base = fixture.git(['rev-parse', 'base']);
    const result = fixture.run(['delete', 'base', '--force']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(result.stderr).to.include('Checked out main');
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.ok(['--cwd', fixture.repo, 'info', 'child'])).to.include(
      'base'
    );
    fs.unlinkSync(path.join(fixture.repo, '.git', 'hooks', 'post-checkout'));
    fixture.ok(['unfreeze', 'base']);
    fixture.ok(['delete', 'base', '--force']);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
  });
  it('retains protection published by an external reference hook during an administrative rename', () => {
    const command = getTestCliCommand(['freeze', 'base', '--no-interactive']);
    const script = command
      .map((part) => `'${part.replace(/'/g, `'"'"'`)}'`)
      .join(' ');
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      `#!/bin/sh\n[ "$1" = prepared ] || exit 0\nwhile read old new ref; do\n  if [ "$ref" = refs/heads/base ]; then ${script} || exit $?; git cat-file -p refs/branch-metadata/base > "${fixture.root}/hook-status.json"; fi\ndone\n`,
      { mode: 0o755 }
    );
    const head = fixture.git(['rev-parse', 'base']);
    fixture.ok(['rename', 'renamed']);
    expect(
      fs.readFileSync(path.join(fixture.root, 'hook-status.json'), 'utf8')
    ).to.match(/"frozen": true/);
    expect(fixture.git(['rev-parse', 'renamed'])).to.equal(head);
    expect(fixture.run(['modify', '-m', 'blocked']).stderr).to.include(
      'ch unfreeze renamed'
    );
    expect(fixture.ok(['info'])).to.include('(frozen)');
  });
  for (const args of [['init'], ['repo', 'init'], ['repo', 'i']]) {
    it(`${args.join(
      ' '
    )} preserves status on rebuild and cache reconstruction while reset deliberately clears it`, () => {
      fixture.ok(['freeze', 'child']);
      fixture.stage('pending.txt', 'pending');
      fixture.write('base.txt', 'unstaged');
      const before = fixture.snapshot();
      const refs = fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/branch-metadata',
      ]);
      fixture.ok([...args, '--trunk', 'main']);
      fs.rmSync(path.join(fixture.repo, '.git', '.graphite_cache_persist'), {
        force: true,
      });
      fixture.ok(['tr', 'child', '--parent', 'base']);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fixture.git([
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/branch-metadata',
        ])
      ).to.equal(refs);
      expect(fixture.run(['modify', '-m', 'blocked']).stderr).to.include(
        'ch unfreeze base'
      );
      fixture.ok([...args, '--trunk', 'base', '--reset']);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fixture.git([
          'for-each-ref',
          '--format=%(refname)',
          'refs/branch-metadata',
        ])
      ).to.equal('');
      expect(fixture.ok(['info'])).not.to.include('(frozen)');
      fixture.ok(['track', 'child', '--parent', 'base']);
      expect(fixture.ok(['info', 'child'])).not.to.include('(frozen)');
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  it('retains a successful post-commit freeze through real cache warming and a fresh ordinary track writer', () => {
    const command = getTestCliCommand([
      'freeze',
      'created',
      '--no-interactive',
    ]);
    const script = command
      .map((part) => `'${part.replace(/'/g, `'"'"'`)}'`)
      .join(' ');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-commit');
    fs.writeFileSync(hook, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    const base = fixture.git(['rev-parse', 'base']);
    fixture.stage('created.txt', 'successful committed work');
    fixture.ok(['create', 'created', '-m', 'created by public CLI']);
    expect(fixture.git(['rev-parse', 'created^'])).to.equal(base);
    expect(fixture.git(['show', 'created:created.txt'])).to.equal(
      'successful committed work'
    );
    const work = fixture.snapshot();
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.graphite_cache_persist'))
    ).to.equal(true);
    const output = fixture.run([
      'track',
      'created',
      '--parent',
      'base',
      '--debug',
    ]);
    expect(output.status).to.equal(0);
    expect(output.stderr).not.to.include('Building cache from disk');
    expect(fixture.snapshot()).to.deep.equal(work);
    expect(fixture.ok(['info'])).to.include('(frozen)');
    expect(fixture.run(['modify', '-m', 'blocked']).stderr).to.include(
      'ch unfreeze created'
    );
  });
  it('refuses an inferred frozen new trunk before unrelated metadata repair', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['config', '--unset', 'branch.main.remote']);
    fixture.git(['config', 'branch.base.remote', 'origin']);
    fixture.git(['switch', 'main']);
    fixture.commit('advance');
    fixture.git(['switch', 'other']);
    fixture.git(['merge', '--no-edit', 'main']);
    const before = fixture.observe();
    expect(fixture.run(['init']).stderr).to.include('ch unfreeze base');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('reports a completed rename honestly when a real metadata ref transaction fails', () => {
    fixture.ok(['freeze', 'base']);
    fixture.stage('pending.txt', 'pending');
    const work = fixture.snapshot();
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/base']);
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      '#!/bin/sh\n[ "$1" = prepared ] || exit 0\nwhile read old new ref; do [ "$ref" != refs/branch-metadata/renamed ] || exit 42; done\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['rename', 'renamed']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('Renamed base to renamed');
    expect(result.stderr).to.include('metadata');
    expect(fixture.git(['branch', '--show-current'])).to.equal('renamed');
    expect(fixture.git(['rev-parse', 'renamed'])).to.equal(work.head);
    expect(
      fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads/base'])
    ).to.equal('');
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/base'])).to.equal(
      metadata
    );
    expect(fixture.snapshot().staged).to.equal(work.staged);
    expect(fixture.snapshot().files).to.deep.equal(work.files);
    fs.unlinkSync(hook);
    fixture.ok(['track', 'renamed', '--parent', 'main']);
    fixture.ok(['freeze', 'renamed']);
    fixture.ok(['track', 'child', '--parent', 'renamed']);
    expect(fixture.ok(['info'])).to.include('(frozen)');
    expect(fixture.git(['rev-parse', 'renamed'])).to.equal(work.head);
  });

  it('tracks a new local branch as editable without rewriting its existing commit', () => {
    fixture.git(['switch', '-c', 'local', 'other']);
    fixture.commit('local');
    const head = fixture.git(['rev-parse', 'HEAD']);
    fixture.stage('pending.txt', 'pending');
    const before = fixture.snapshot();
    fixture.ok(
      ['tr', '--parent', 'other', '--quiet', '--cwd', fixture.repo],
      fixture.root
    );
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.ok(['info'])).not.to.include('(frozen)');
    fixture.ok(['modify', '-m', 'editable local']);
    expect(fixture.git(['rev-parse', 'HEAD'])).not.to.equal(head);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(
      fixture.git(['rev-parse', `${head}^`])
    );
    expect(fixture.git(['show', 'HEAD:pending.txt'])).to.equal('pending');
  });

  it('documents administration and the stronger survivor boundary in public help and completion', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.observe();
    for (const command of [
      'rename',
      'rn',
      'track',
      'tr',
      'untrack',
      'ut',
      'utr',
      'delete',
      'dl',
      'init',
    ]) {
      expect(fixture.ok([command, '--help']).toLowerCase()).to.include(
        'frozen'
      );
    }
    expect(fixture.ok(['delete', '--help'])).to.include('Unlike Graphite');
    expect(fixture.ok(['repo', 'i', '--help'])).to.include(
      'stored frozen status'
    );
    const root = fixture.ok(['--get-yargs-completions', 'ch', '']);
    for (const name of [
      'rename',
      'rn',
      'track',
      'tr',
      'untrack',
      'ut',
      'utr',
      'delete',
      'dl',
      'init',
    ])
      expect(root.split('\n').map((line) => line.split(':')[0])).to.include(
        name
      );
    for (const command of [
      'track',
      'tr',
      'untrack',
      'ut',
      'utr',
      'delete',
      'dl',
    ]) {
      const result = fixture.run([
        '--get-yargs-completions',
        'ch',
        command,
        '',
      ]);
      expect(result.status).to.equal(0);
      expect(result.stderr).to.equal('');
      expect(result.stdout.split('\n')).to.include('base');
    }
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('keeps terminal confirmation scope for frozen untrack and accepts a frozen rename prompt', () => {
    fixture.ok(['freeze', 'tip']);
    const before = fixture.observe();
    const declined = runCliInPty(
      getTestCliCommand(['ut', 'base', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Are you sure you want to untrack', input: 'n\r' },
        ],
      }
    );
    expect(declined.status, declined.output).to.equal(0);
    expect(fixture.observe()).to.deep.equal(before);
    const renamed = runCliInPty(getTestCliCommand(['rn', '--interactive']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Branch Name', input: 'renamed\r' }],
    });
    expect(renamed.status, renamed.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('renamed');
    expect(fixture.ok(['info'])).to.include('(frozen)');
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/child']);
    const accepted = runCliInPty(getTestCliCommand(['utr', '--interactive']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Are you sure you want to untrack', input: 'y\r' }],
    });
    expect(accepted.status, accepted.output).to.equal(0);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
      metadata
    );
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname)',
        'refs/branch-metadata/renamed',
      ])
    ).to.equal('');
  });
  it('renames a frozen parent with multiple frozen child identities without losing a sibling', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'base']);
    fixture.ok(['freeze', 'child']);
    fixture.ok(['freeze', 'sibling']);
    const refs = fixture.refs();
    fixture.ok(['rn', 'renamed']);
    fixture.git(['switch', 'child']);
    expect(fixture.ok(['parent']).trim()).to.equal('renamed');
    expect(fixture.run(['modify', '-m', 'blocked']).stderr).to.include(
      'ch unfreeze child'
    );
    fixture.git(['switch', 'sibling']);
    expect(fixture.ok(['parent']).trim()).to.equal('renamed');
    expect(fixture.run(['modify', '-m', 'blocked']).stderr).to.include(
      'ch unfreeze sibling'
    );
    expect(
      fixture
        .refs()
        .replace('refs/heads/renamed ', 'refs/heads/base ')
        .split('\n')
        .sort()
    ).to.deep.equal(refs.split('\n').sort());
  });

  it('deletes a frozen parent and really reparents every editable sibling before replay', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'base']);
    fixture.ok(['freeze', 'base']);
    fixture.ok(['delete', 'base', '--force']);
    const main = fixture.git(['rev-parse', 'main']);
    for (const name of ['child', 'sibling']) {
      fixture.git(['switch', name]);
      expect(fixture.ok(['parent']).trim()).to.equal('main');
      expect(fixture.git(['rev-parse', `${name}^`])).to.equal(main);
    }
  });
  it('rechecks captured mandatory survivors after a committed metadata hook before removing the target', () => {
    const command = getTestCliCommand(['freeze', 'tip', '--no-interactive']);
    const script = command
      .map((part) => `'${part.replace(/'/g, `'"'"'`)}'`)
      .join(' ');
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      `#!/bin/sh\n[ "$1" = committed ] || exit 0\nwhile read old new ref; do\n  if [ "$ref" = refs/branch-metadata/child ]; then ${script} || exit $?; fi\ndone\n`,
      { mode: 0o755 }
    );
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const result = fixture.run(['dl', 'base', '--force']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    fixture.git(['switch', 'child']);
    expect(fixture.ok(['parent']).trim()).to.equal('main');
    expect(fixture.ok(['info'])).to.include('(frozen)');
  });

  it('retains mandatory delete recovery across later protection, two real conflicts and continue aliases', () => {
    fixture.git(['switch', 'child']);
    fixture.stage('base.txt', 'child edit');
    fixture.git(['commit', '-m', 'child edit']);
    fixture.ok(['restack', '--branch', 'tip', '--only']);
    fixture.git(['switch', 'tip']);
    fixture.stage('base.txt', 'tip edit');
    fixture.git(['commit', '-m', 'tip edit']);
    fixture.git(['switch', 'main']);
    expect(fixture.run(['delete', 'base', '--force']).status).to.equal(1);
    expect(
      fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads/base'])
    ).to.equal('');
    fixture.write('base.txt', 'resolved child');
    fixture.ok(['freeze', 'tip']);
    fixture.ok(['untrack', 'child', '--force']);
    fixture.ok(['track', 'child', '--parent', 'main']);
    const before = fixture.observe();
    const recovery = fs.readFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue')
    );
    const refused = fixture.run(['continue', '--all']);
    expect(refused.status).to.equal(1);
    expect(refused.stderr).to.include('ch unfreeze tip');
    expect(fixture.observe()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'))
    ).to.deep.equal(recovery);
    fixture.ok(['unfreeze', 'tip']);
    expect(fixture.run(['cont', '--all']).status).to.equal(1);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'), 'utf8')
    ).to.include('"delete"');
    fixture.write('base.txt', 'resolved tip');
    fixture.ok(['continue', '--all']);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'), 'utf8')
    ).not.to.include('"delete"');
    expect(fixture.git(['rev-parse', 'child~2'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal('resolved tip');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });
  it('stops a later mandatory replay when a successful earlier replay hook freezes it and retains completed deletion', () => {
    const command = getTestCliCommand(['freeze', 'tip', '--no-interactive']);
    const script = command
      .map((part) => `'${part.replace(/'/g, `'"'"'`)}'`)
      .join(' ');
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      `#!/bin/sh\n[ "$1" = committed ] || exit 0\ngit show-ref --verify --quiet refs/heads/base && exit 0\nwhile read old new ref; do\n  if [ "$ref" = refs/branch-metadata/child ]; then ${script} || exit $?; fi\ndone\n`,
      { mode: 0o755 }
    );
    const tip = fixture.git(['rev-parse', 'tip']);
    const result = fixture.run(['delete', 'base', '--force']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze tip');
    expect(result.stderr).to.include('base has already been deleted');
    expect(result.stdout).not.to.include('Skipping frozen branch');
    expect(
      fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads/base'])
    ).to.equal('');
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'child']);
    fixture.ok(['restack', '--branch', 'child', '--upstack']);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
  });

  it('allows the public rebase abort after a delete conflict and does not resurrect the deleted branch', () => {
    fixture.git(['switch', 'child']);
    fixture.stage('base.txt', 'child edit');
    fixture.git(['commit', '-m', 'child edit']);
    const child = fixture.git(['rev-parse', 'child']);
    fixture.git(['switch', 'main']);
    expect(fixture.run(['delete', 'base', '--force']).status).to.equal(1);
    fixture.ok(['freeze', 'child']);
    const result = runCliInPty(getTestCliCommand(['rebase', '--abort']), {
      cwd: fixture.repo,
      env: fixture.env,
    });
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(
      fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads/base'])
    ).to.equal('');
    expect(fixture.ok(['info', 'child'])).to.include('(frozen)');
    expect(fixture.run(['cont']).status).to.equal(1);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'), 'utf8')
    ).not.to.include('"delete"');
  });
  it('keeps fresh public navigation consistent with stored parents after a rejected administrative metadata publication', () => {
    fixture.ok(['freeze', 'child']);
    fixture.git(['switch', 'child']);
    fixture.stage('pending.txt', 'pending');
    const before = fixture.snapshot();
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/child']);
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      '#!/bin/sh\n[ "$1" = prepared ] || exit 0\nwhile read old new ref; do [ "$ref" != refs/branch-metadata/child ] || exit 42; done\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['tr', 'child', '--parent', 'main']);
    expect(result.status).to.equal(1);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
      metadata
    );
    fs.unlinkSync(hook);
    expect(fixture.ok(['parent']).trim()).to.equal('base');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.ok(['info', 'child'])).to.include('(frozen)');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.graphite_cache_persist'))
    ).to.equal(false);
  });
  it('retains actual parent progress and permits fresh administration after a rejected local delete ref', () => {
    fixture.ok(['freeze', 'base']);
    fixture.git(['switch', 'main']);
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    fs.writeFileSync(
      hook,
      '#!/bin/sh\n[ "$1" = prepared ] || exit 0\nwhile read old new ref; do [ "$ref" != refs/heads/base ] || exit 42; done\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['delete', 'base', '--force']);
    expect(result.status).to.equal(1);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    fs.unlinkSync(hook);
    fixture.ok(['track', 'base', '--parent', 'main']);
    fixture.git(['switch', 'child']);
    expect(fixture.ok(['parent']).trim()).to.equal('main');
    fixture.git(['switch', 'base']);
    expect(fixture.ok(['info'])).to.include('(frozen)');
    expect(result.stderr).to.include('completed');
    expect(result.stderr).to.include('retained');
  });
  for (const hasChild of [false, true]) {
    it(
      hasChild
        ? 'refuses a delete needing mandatory replays before disturbing an existing Git operation'
        : 'deletes a frozen leaf without replacing an unrelated active continuation',
      () => {
        if (hasChild) fixture.branch('other-child', 'other');
        fixture.git(['switch', 'child']);
        fixture.stage('base.txt', 'child edit');
        fixture.git(['commit', '-m', 'child edit']);
        fixture.git(['switch', 'base']);
        fixture.stage('base.txt', 'parent edit');
        fixture.git(['commit', '-m', 'parent edit']);
        expect(fixture.run(['restack', '--upstack']).status).to.equal(1);
        fixture.ok(['freeze', 'other']);
        const recovery = fs.readFileSync(
          path.join(fixture.repo, '.git', '.gtcontinue')
        );
        const before = fixture.observe();
        const result = fixture.run(['delete', 'other', '--force']);
        if (hasChild) {
          expect(result.status).to.equal(1);
          expect(result.stderr).to.include('while Git operation');
          expect(fixture.observe()).to.deep.equal(before);
        } else {
          expect(result.status).to.equal(0);
          expect(
            fixture.git([
              'for-each-ref',
              '--format=%(refname)',
              'refs/heads/other',
              'refs/branch-metadata/other',
            ])
          ).to.equal('');
        }
        expect(
          fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'))
        ).to.deep.equal(recovery);
        fixture.write('base.txt', 'resolved child');
        fixture.ok(['continue', '--all']);
        expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
          fixture.git(['rev-parse', 'child'])
        );
        expect(fixture.git(['show', 'child:base.txt'])).to.equal(
          'resolved child'
        );
        expect(fixture.git(['status', '--porcelain'])).to.equal('');
      }
    );
  }
});
