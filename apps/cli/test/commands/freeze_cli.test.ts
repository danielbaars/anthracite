import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

import { expect } from 'chai';

import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

const quote = (s: string): string => `'${s.replace(/'/g, `'"'"'`)}'`;
const metadataRefs = (fixture: FreezeCliFixture): string =>
  fixture.git([
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    'refs/branch-metadata',
  ]);
function objectFromJson(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected fixture metadata object');
  return Object.fromEntries(Object.entries(value));
}

// eslint-disable-next-line max-lines-per-function
describe('manual freeze through the public CLI', function () {
  this.timeout(120000);
  let fixture: FreezeCliFixture;
  beforeEach(function () {
    fixture = new FreezeCliFixture();
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'freeze-cases.jsonl'),
        JSON.stringify({
          root: fixture.root,
          fullTitle: this.currentTest?.fullTitle(),
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture.cleanup());

  it('freezes the selected downstack and rejects a real modify before staging', () => {
    const refs = fixture.refs();
    fixture.ok(['freeze', 'child']);
    expect(fixture.ok(['info', 'child'])).to.include('child (frozen)');
    expect(fixture.ok(['info', 'base'])).to.include('base (frozen)');
    expect(fixture.ok(['info', 'tip'])).not.to.include('(frozen)');
    fixture.git(['switch', 'child']);
    fixture.write('change.txt', 'preserve unstaged work');
    const before = fixture.snapshot();
    const result = fixture.run([
      'modify',
      '--commit',
      '--all',
      '-m',
      'blocked',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('ch unfreeze child');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.refs()).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'change.txt'), 'utf8')
    ).to.equal('preserve unstaged work');
  });

  it('rechecks a branch frozen by the original commit hook before publishing HEAD', () => {
    fixture.git(['switch', 'child']);
    const before = fixture.git(['rev-parse', 'HEAD']);
    const hooks = path.join(fixture.root, 'custom hooks');
    fs.mkdirSync(hooks);
    fixture.git(['config', 'core.hooksPath', hooks]);
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    fs.writeFileSync(
      path.join(hooks, 'pre-commit'),
      `#!/bin/sh\n${cli
        .map(quote)
        .join(' ')} || exit $?\nprintf 'hook work' > hook-work.txt\n`,
      { mode: 0o755 }
    );
    fixture.write('new-work.txt', 'staged by modify');
    const result = fixture.run([
      'modify',
      '--commit',
      '--all',
      '-m',
      'must be blocked',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('frozen branch child');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(before);
    expect(fixture.git(['config', 'core.hooksPath'])).to.equal(hooks);
    expect(fixture.git(['show', ':new-work.txt'])).to.equal('staged by modify');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
    expect(fixture.ok(['info', 'child'])).to.include('(frozen)');
    fixture.ok(['track', 'child', '--parent', 'base']);
    expect(fixture.ok(['info', 'child'])).to.include('(frozen)');
  });

  it('rejects undocumented branch flags and extra selectors without changing any status', () => {
    fixture.ok(['freeze', 'tip']);
    const before = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
    ]);
    for (const args of [
      ['unfreeze', '--branch', 'base'],
      ['freeze', 'base', 'child'],
      ['freeze', ''],
      ['freeze', '--force'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, args.join(' ')).to.equal(1);
      expect(
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
      ).to.equal(before);
    }
    expect(fixture.ok(['info', 'tip'])).to.include('(frozen)');
  });

  it('freezes only downstack and unfreezes every branching descendant with idempotent refs', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'child']);
    fixture.ok(['freeze']);
    expect(fixture.ok(['i', 'base'])).to.include('(frozen)');
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
    for (const branch of ['tip', 'sibling', 'other'])
      expect(fixture.ok(['i', branch])).not.to.include('(frozen)');
    const frozen = metadataRefs(fixture);
    fixture.ok(['freeze']);
    expect(metadataRefs(fixture)).to.equal(frozen);
    fixture.ok(['freeze', 'tip']);
    fixture.ok(['freeze', 'sibling']);
    fixture.ok(['unfreeze', 'child']);
    expect(fixture.ok(['i', 'tip'])).not.to.include('(frozen)');
    expect(fixture.ok(['i', 'base'])).to.include('(frozen)');
    expect(fixture.ok(['i', 'sibling'])).to.include('(frozen)');
    fixture.ok(['unfreeze', 'base']);
    for (const branch of ['base', 'child', 'tip', 'sibling', 'other'])
      expect(fixture.ok(['i', branch])).not.to.include('(frozen)');
    const unfrozen = metadataRefs(fixture);
    fixture.ok(['unfreeze', 'base']);
    expect(metadataRefs(fixture)).to.equal(unfrozen);
  });

  for (const command of ['freeze', 'unfreeze'])
    for (const target of ['main', 'missing', 'untracked'])
      it(`${command} rejects ${target} without a partially changed status scope`, () => {
        fixture.git(['branch', 'untracked', 'child']);
        fixture.ok(['freeze', 'tip']);
        const before = metadataRefs(fixture);
        const state = fixture.observe();
        expect(fixture.run([command, target]).status).to.equal(1);
        expect(metadataRefs(fixture)).to.equal(before);
        expect(fixture.observe()).to.deep.equal(state);
        expect(fixture.ok(['info', 'tip'])).to.include('(frozen)');
      });

  it('supports explicit detached selectors and refuses detached defaults without guessing', () => {
    fixture.git(['checkout', '--detach']);
    const head = fixture.git(['rev-parse', 'HEAD']);
    fixture.ok(['freeze', 'child']);
    const refs = metadataRefs(fixture);
    expect(fixture.run(['freeze']).status).to.equal(1);
    expect(fixture.run(['unfreeze']).status).to.equal(1);
    expect(metadataRefs(fixture)).to.equal(refs);
    fixture.ok(['unfreeze', 'child']);
    expect(fixture.ok(['i', 'child'])).not.to.include('(frozen)');
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
  });

  it('keeps every status ref unchanged when one transaction participant is locked', () => {
    const lock = path.join(
      fixture.repo,
      '.git',
      'refs',
      'branch-metadata',
      'child.lock'
    );
    fs.writeFileSync(lock, 'held by another Git writer');
    const before = metadataRefs(fixture);
    const result = fixture.run(['freeze', 'child']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('cannot lock ref');
    expect(metadataRefs(fixture)).to.equal(before);
    expect(fixture.ok(['i', 'base'])).not.to.include('(frozen)');
    fs.unlinkSync(lock);
    fixture.ok(['freeze', 'child']);
    expect(fixture.ok(['i', 'base'])).to.include('(frozen)');
  });

  it('preserves raw index, dirty and ignored files and recovery/config bytes while toggling status', () => {
    fixture.stage('staged.txt', 'staged version');
    fixture.write('staged.txt', 'unstaged version');
    fixture.write('untracked.txt', 'untracked work');
    fixture.write('.gitignore', 'ignored.bin\n');
    fixture.write('ignored.bin', 'ignored bytes\u0000tail');
    const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
    const legacy = path.join(fixture.repo, '.git', '.graphite_pr_info');
    fs.writeFileSync(recovery, '{"invalid":"preserve exactly"}\n');
    fs.writeFileSync(legacy, '{"legacy":"preserve exactly"}\n');
    fixture.git(['status', '--porcelain']);
    const before = fixture.snapshot();
    const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
    fixture.ok(['freeze', 'child']);
    fixture.ok(['unfreeze', 'base']);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
    ).to.deep.equal(index);
    expect(fs.readFileSync(recovery, 'utf8')).to.equal(
      '{"invalid":"preserve exactly"}\n'
    );
    expect(fs.readFileSync(legacy, 'utf8')).to.equal(
      '{"legacy":"preserve exactly"}\n'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, 'ignored.bin'), 'utf8')
    ).to.equal('ignored bytes\u0000tail');
  });

  it('makes frozen status visible and enforceable from a linked worktree without checking out there', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    const linked = fixture.snapshot(fixture.linked);
    fixture.ok(['freeze', 'tip']);
    expect(fixture.ok(['info', 'tip'], fixture.linked)).to.include('(frozen)');
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    const rejected = fixture.run(['m', '--no-edit'], fixture.linked);
    expect(rejected.status).to.equal(1);
    expect(rejected.stderr).to.include('ch unfreeze tip');
    fixture.ok(['unfreeze', 'child'], fixture.linked);
    expect(fixture.ok(['info', 'tip'])).not.to.include('(frozen)');
  });

  it('preserves status and PR information through ordinary parsing repair and metadata upserts', () => {
    fixture.ok(['freeze', 'child']);
    const raw = objectFromJson(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/child'])
    );
    const file = path.join(fixture.root, 'old-metadata.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...raw,
        parentBranchRevision: fixture.git(['rev-parse', 'main']),
        prInfo: { number: 17, title: 'Fixture PR', base: 'base' },
      })
    );
    const blob = fixture.git(['hash-object', '-w', file]);
    fixture.git(['update-ref', 'refs/branch-metadata/child', blob]);
    fixture.ok(['log', 'short']);
    fixture.ok(['track', 'child', '--parent', 'base']);
    const info = fixture.ok(['i', 'child']);
    expect(info).to.include('child (frozen)');
    expect(info).to.include('PR #17');
    expect(info).to.include('Fixture PR');
    fixture.git(['switch', 'child']);
    expect(fixture.run(['m', '--no-edit']).stderr).to.include(
      'frozen branch child'
    );
  });

  it('shows status only in the native Charcoal renderers and offers public completion without exposing its hook bridge', () => {
    fixture.ok(['freeze', 'child']);
    for (const args of [['log'], ['l'], ['log', 'short'], ['ls']])
      expect(fixture.ok(args)).to.include('(frozen)');
    for (const args of [
      ['log', '--classic'],
      ['l', '--classic'],
      ['log', 'long'],
      ['ll'],
    ])
      expect(fixture.ok(args)).not.to.include('(frozen)');
    for (const command of ['freeze', 'unfreeze']) {
      const help = fixture.ok([command, '--help']);
      expect(help).to.include(command);
      expect(help).to.include(command === 'freeze' ? 'downstack' : 'upstack');
      const completed = fixture.ok([
        '--get-yargs-completions',
        'ch',
        command,
        '',
      ]);
      expect(completed).to.include('child');
      expect(completed).to.include('other');
    }
    const root = fixture.ok(['--get-yargs-completions', 'ch', '']);
    expect(root).to.include('freeze');
    expect(root).to.include('unfreeze');
    expect(root).not.to.include('internal-commit-guard');
  });

  for (const damage of ['broken descendant', 'parent cycle'])
    it(`rejects a ${damage} before changing a valid subset or repairing metadata`, () => {
      fixture.ok(['freeze', 'tip']);
      const branch = damage === 'parent cycle' ? 'base' : 'child';
      const meta = objectFromJson(
        fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
      );
      const file = path.join(fixture.root, 'damaged-metadata.json');
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...meta,
          ...(damage === 'parent cycle'
            ? { parentBranchName: 'tip' }
            : { parentBranchRevision: fixture.git(['rev-parse', 'other']) }),
        })
      );
      fixture.git([
        'update-ref',
        `refs/branch-metadata/${branch}`,
        fixture.git(['hash-object', '-w', file]),
      ]);
      const before = metadataRefs(fixture);
      expect(fixture.run(['unfreeze', 'base']).status).to.equal(1);
      expect(fixture.run(['freeze', 'tip']).status).to.equal(1);
      expect(metadataRefs(fixture)).to.equal(before);
    });

  it('rechecks a branch frozen by the message editor even with no-verify', () => {
    fixture.git(['switch', 'child']);
    const before = fixture.git(['rev-parse', 'HEAD']);
    fixture.stage('editor.txt', 'staged work');
    const editor = path.join(fixture.root, 'freezing editor');
    const cli = getTestCliCommand(['freeze', 'child', '--no-interactive']);
    fs.writeFileSync(
      editor,
      `#!/bin/sh\n${cli
        .map(quote)
        .join(
          ' '
        )} || exit $?\nprintf 'edited message\\n' > "$1"\nprintf 'editor work' > retained-editor.txt\n`,
      { mode: 0o755 }
    );
    fixture.env.GIT_EDITOR = quote(editor);
    const result = fixture.run(['m', '-e', '--interactive', '--no-verify']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('frozen branch child');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(before);
    expect(fixture.git(['show', ':editor.txt'])).to.equal('staged work');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'retained-editor.txt'), 'utf8')
    ).to.equal('editor work');
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
  });

  it('forwards original configured hooks and their input while committing a real editable branch', () => {
    fixture.git(['switch', 'tip']);
    const hooks = path.join(fixture.root, 'original hooks');
    fs.mkdirSync(hooks);
    fixture.git(['config', 'core.hooksPath', hooks]);
    const reference = path.join(fixture.root, 'reference-input');
    const observedHooks = path.join(fixture.root, 'observed-hooks');
    fs.writeFileSync(
      path.join(hooks, 'pre-commit'),
      `#!/bin/sh\nprintf "from precommit" > added-by-hook.txt\ngit add added-by-hook.txt\ngit config --get core.hooksPath > ${quote(
        observedHooks
      )}\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(hooks, 'commit-msg'),
      '#!/bin/sh\nprintf "hook title\\n" > "$1"\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(hooks, 'reference-transaction'),
      `#!/bin/sh\nprintf '%s\\n' "$1" >> ${quote(reference)}\ncat >> ${quote(
        reference
      )}\n`,
      { mode: 0o755 }
    );
    fixture.write('editable.txt', 'editable content');
    const old = fixture.git(['rev-parse', 'tip']);
    fixture.ok(['m', '--commit', '--all', '-m', 'original message']);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(old);
    expect(fixture.git(['log', '-1', '--format=%s'])).to.equal('hook title');
    expect(fixture.git(['show', 'HEAD:editable.txt'])).to.equal(
      'editable content'
    );
    expect(fixture.git(['show', 'HEAD:added-by-hook.txt'])).to.equal(
      'from precommit'
    );
    expect(fixture.git(['config', 'core.hooksPath'])).to.equal(hooks);
    expect(fs.readFileSync(observedHooks, 'utf8').trim()).to.equal(hooks);
    expect(fs.readFileSync(reference, 'utf8')).to.include('prepared\n');
    expect(fs.readFileSync(reference, 'utf8')).to.include('committed\n');
    expect(fs.readFileSync(reference, 'utf8')).to.include(' refs/heads/tip\n');
  });

  it('refuses frozen amend and patch modes before invoking sentinels or changing staged work', () => {
    fixture.ok(['freeze', 'child']);
    fixture.git(['switch', 'child']);
    fixture.stage('staged.txt', 'staged');
    fixture.write('untracked.txt', 'preserve');
    const marker = path.join(fixture.root, 'unexpected-editor-hook');
    const sentinel = path.join(fixture.root, 'sentinel');
    fs.writeFileSync(
      sentinel,
      `#!/bin/sh\nprintf bad > ${quote(marker)}\nexit 0\n`,
      { mode: 0o755 }
    );
    fixture.env.GIT_EDITOR = sentinel;
    fixture.git(['config', 'core.hooksPath', path.dirname(sentinel)]);
    fs.copyFileSync(sentinel, path.join(path.dirname(sentinel), 'pre-commit'));
    fixture.git(['status', '--porcelain']);
    const before = fixture.snapshot();
    const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
    for (const args of [
      ['m', '--patch', '--commit', '-m', 'blocked'],
      ['modify', '--all', '--no-edit'],
      ['m', '-e', '--interactive', '--no-verify'],
    ]) {
      const result = fixture.run(args);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('frozen branch child');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
      ).to.deep.equal(index);
      expect(fs.existsSync(marker)).to.equal(false);
    }
  });

  it('honors prefix and suffix cwd with quiet dominance and no implicit setup', () => {
    const before = fixture.snapshot();
    const frozen = fixture.run(
      ['--cwd', fixture.repo, 'freeze', 'child', '--quiet', '--interactive'],
      fixture.root
    );
    expect(frozen.status).to.equal(0);
    expect(frozen.stdout + frozen.stderr).to.equal('');
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
    const unfrozen = fixture.run(
      ['unfreeze', 'base', '--cwd', fixture.repo, '--quiet'],
      fixture.root
    );
    expect(unfrozen.status).to.equal(0);
    expect(unfrozen.stdout + unfrozen.stderr).to.equal('');
    expect(fixture.snapshot()).to.deep.equal(before);
    const config = path.join(fixture.repo, '.git', '.graphite_repo_config');
    fs.unlinkSync(config);
    expect(fixture.run(['freeze', 'child']).status).to.equal(1);
    expect(fs.existsSync(config)).to.equal(false);
    expect(fixture.run(['unfreeze', '--help'], fixture.root).status).to.equal(
      0
    );
  });

  it('keeps a real active rebase and continuation bytes intact while setting status explicitly', () => {
    fixture.git(['switch', 'child']);
    fixture.write('base.txt', 'child edits');
    fixture.git(['add', 'base.txt']);
    fixture.git(['commit', '-m', 'child conflict']);
    fixture.git(['switch', 'base']);
    fixture.write('base.txt', 'parent edits');
    fixture.git(['add', 'base.txt']);
    fixture.git(['commit', '-m', 'parent conflict']);
    fixture.git(['switch', 'child']);
    const rebase = spawnSync('git', ['rebase', 'base'], {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
    });
    expect(rebase.status).not.to.equal(0);
    const directory = path.join(fixture.repo, '.git', 'rebase-merge');
    expect(fs.existsSync(directory)).to.equal(true);
    const files = (): Record<string, string> =>
      Object.fromEntries(
        fs
          .readdirSync(directory)
          .filter((file) => fs.statSync(path.join(directory, file)).isFile())
          .map((file) => [
            file,
            fs.readFileSync(path.join(directory, file)).toString('base64'),
          ])
      );
    const continuation = path.join(fixture.repo, '.git', '.gtcontinue');
    fs.writeFileSync(
      continuation,
      '{"branchesToSync":[],"branchesToRestack":[]}\n'
    );
    const before = fixture.snapshot();
    const rebaseBefore = files();
    fixture.ok(['freeze', 'child']);
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
    fixture.ok(['unfreeze', 'child']);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(files()).to.deep.equal(rebaseBefore);
    expect(fs.readFileSync(continuation, 'utf8')).to.equal(
      '{"branchesToSync":[],"branchesToRestack":[]}\n'
    );
    fixture.git(['rebase', '--abort']);
  });

  it('invalidates a same-version legacy cache that lacks frozen metadata instead of unfreezing on retrack', () => {
    fixture.ok(['freeze', 'child']);
    const parseRefs = (output: string): Record<string, string> =>
      Object.fromEntries(
        output
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split(':'))
      );
    const heads = parseRefs(
      fixture.git([
        'for-each-ref',
        '--format=%(refname:lstrip=2):%(objectname)',
        '--sort=-committerdate',
        'refs/heads/',
      ])
    );
    const metadata = parseRefs(
      fixture.git([
        'for-each-ref',
        '--format=%(refname:lstrip=2):%(objectname)',
        'refs/branch-metadata/',
      ])
    );
    // Reproduce the documented pre-freeze cache format, not the new cache hash.
    const seed = {
      version: fixture.ok(['--version']).trim(),
      trunkName: 'main',
      gitBranchNamesAndRevisions: heads,
      metadataRefList: metadata,
    };
    const parents: Record<string, string> = {
      base: 'main',
      child: 'base',
      tip: 'child',
      other: 'main',
    };
    const branches = Object.entries(heads).map(([name, branchRevision]) => [
      name,
      {
        validationResult: name === 'main' ? 'TRUNK' : 'VALID',
        branchRevision,
        children: Object.keys(parents).filter(
          (child) => parents[child] === name
        ),
        ...(name === 'main'
          ? {}
          : {
              parentBranchName: parents[name],
              parentBranchRevision: heads[parents[name]],
            }),
      },
    ]);
    const cache = path.join(fixture.repo, '.git', '.graphite_cache_persist');
    fs.writeFileSync(
      cache,
      JSON.stringify({
        sha: createHash('sha1').update(JSON.stringify(seed)).digest('hex'),
        branches,
      })
    );
    fixture.ok(['track', 'child', '--parent', 'base']);
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
    fixture.git(['switch', 'child']);
    expect(fixture.run(['m', '--no-edit']).stderr).to.include(
      'frozen branch child'
    );
    fs.rmSync(cache, { force: true });
    fixture.ok(['track', 'child', '--parent', 'base']);
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
  });

  it('treats a numeric selector as a literal existing branch without resolving a PR', () => {
    fixture.git(['branch', '123', 'child']);
    fixture.git([
      'update-ref',
      'refs/branch-metadata/123',
      fixture.git(['rev-parse', 'refs/branch-metadata/child']),
    ]);
    fixture.ok(['freeze', '123']);
    expect(fixture.ok(['i', '123'])).to.include('123 (frozen)');
    expect(fixture.ok(['i', 'child'])).not.to.include('(frozen)');
    fixture.ok(['unfreeze', '123']);
    expect(fixture.ok(['i', '123'])).not.to.include('(frozen)');
    expect(fixture.run(['freeze', '123~0']).status).to.equal(1);
  });

  it('makes an explicitly unfrozen leaf editable for a real new commit and amend in separate processes', () => {
    fixture.ok(['freeze', 'tip']);
    fixture.git(['switch', 'tip']);
    fixture.ok(['unfreeze']);
    const old = fixture.git(['rev-parse', 'tip']);
    fixture.write('new.txt', 'own new content');
    fixture.ok(['m', '--commit', '--all', '-m', 'own commit']);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(old);
    expect(fixture.git(['show', 'HEAD:new.txt'])).to.equal('own new content');
    const created = fixture.git(['rev-parse', 'HEAD']);
    fixture.write('amended.txt', 'own amend content');
    fixture.ok(['modify', '--all', '--no-edit']);
    expect(fixture.git(['rev-parse', 'HEAD'])).not.to.equal(created);
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(old);
    expect(fixture.git(['show', 'HEAD:amended.txt'])).to.equal(
      'own amend content'
    );
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
  });

  it('sets status without invoking repository reference-transaction hooks', () => {
    const hooks = path.join(fixture.root, 'status hooks');
    const marker = path.join(fixture.root, 'unexpected-status-hook');
    fs.mkdirSync(hooks);
    fs.writeFileSync(
      path.join(hooks, 'reference-transaction'),
      `#!/bin/sh\nprintf bad > ${quote(marker)}\nexit 42\n`,
      { mode: 0o755 }
    );
    fixture.git(['config', 'core.hooksPath', hooks]);
    fixture.ok(['freeze', 'child']);
    expect(fixture.ok(['i', 'child'])).to.include('(frozen)');
    fixture.ok(['unfreeze', 'base']);
    expect(fixture.ok(['i', 'child'])).not.to.include('(frozen)');
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.git(['config', 'core.hooksPath'])).to.equal(hooks);
  });

  it('refuses a known frozen modify before ordinary context can repair metadata', () => {
    fixture.ok(['freeze', 'child']);
    const original = objectFromJson(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/child'])
    );
    const old = path.join(fixture.root, 'repairable-metadata.json');
    fs.writeFileSync(
      old,
      JSON.stringify({
        ...original,
        parentBranchRevision: fixture.git(['rev-parse', 'main']),
      })
    );
    fixture.git([
      'update-ref',
      'refs/branch-metadata/child',
      fixture.git(['hash-object', '-w', old]),
    ]);
    fixture.git(['switch', 'child']);
    const refs = metadataRefs(fixture);
    const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
    const legacy = path.join(fixture.repo, '.git', '.graphite_pr_info');
    fs.writeFileSync(recovery, '{"preserve":"recovery"}\n');
    fs.writeFileSync(legacy, '{"preserve":"legacy info"}\n');
    const result = fixture.run(['m', '--no-edit']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('frozen branch child');
    expect(metadataRefs(fixture)).to.equal(refs);
    expect(fs.readFileSync(recovery, 'utf8')).to.equal(
      '{"preserve":"recovery"}\n'
    );
    expect(fs.readFileSync(legacy, 'utf8')).to.equal(
      '{"preserve":"legacy info"}\n'
    );
  });
});
