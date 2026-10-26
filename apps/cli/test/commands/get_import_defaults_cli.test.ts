import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecord(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw new Error('Expected a fixture JSON object');
  return value;
}

function prepareMixedQueuedImports(fixture: FrozenGetFixture): {
  otherTip: string;
  ownTip: string;
} {
  fixture.git(fixture.producer, 'switch', '-c', 'otherTip');
  const otherTip = fixture.commit(
    fixture.producer,
    'other-tip.txt',
    'other queued bytes'
  );
  fixture.git(fixture.producer, 'switch', '-c', 'ownTip');
  const ownTip = fixture.commit(
    fixture.producer,
    'own-tip.txt',
    'own queued bytes'
  );
  fixture.git(fixture.producer, 'push', 'origin', 'otherTip', 'ownTip');
  fs.writeJsonSync(fixture.prs, {
    parent: 'main',
    child: 'parent',
    otherTip: 'child',
    ownTip: 'otherTip',
  });
  fs.writeJsonSync(fixture.identities, {
    account: { login: 'current-user' },
    authors: {
      otherTip: { login: 'other-user' },
      ownTip: { login: 'current-user' },
    },
  });
  return { otherTip, ownTip };
}

// Independent public CLI workflows, not one production function.
// eslint-disable-next-line max-lines-per-function
describe('get CLI new import defaults', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(function () {
    fixture = new FrozenGetFixture(false);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'import-default-cases.jsonl'),
        JSON.stringify({
          root: fixture.root,
          fullTitle: this.currentTest?.fullTitle(),
        }) + '\n'
      );
  });
  afterEach(() => fixture?.cleanup());

  it('imports another author frozen with real remote commits and refuses local modify before staging', () => {
    fs.writeJsonSync(fixture.identities, {
      account: { login: 'current-user' },
      authors: {
        parent: { login: 'other-user' },
        child: { login: 'other-user' },
      },
    });
    fixture.ok('get', 'child');
    fixture.assertTip('parent', fixture.oldParent);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('HEAD', fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'rev-parse', 'child^{tree}')).to.equal(
      fixture.git(fixture.producer, 'rev-parse', 'child^{tree}')
    );
    fixture.status();
    fs.writeFileSync(path.join(fixture.consumer, 'work.txt'), 'retained work');
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    const refused = fixture.run(['modify', '--all', '-m', 'must not commit']);
    expect(refused.status, refused.output).to.equal(1);
    expect(refused.output).to.include('ch unfreeze child');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('imports verified own PRs editable and permits an actual new local commit', () => {
    fs.writeJsonSync(fixture.identities, {
      account: { login: 'Current-User' },
      authors: {
        parent: { login: 'current-user' },
        child: { login: 'current-user' },
      },
    });
    fixture.ok('g', 'child');
    fixture.status('parent', false);
    fixture.status('child', false);
    fs.writeFileSync(path.join(fixture.consumer, 'own.txt'), 'own new work');
    fixture.ok('modify', '--commit', '--all', '-m', 'own local commit');
    const head = fixture.git(fixture.consumer, 'rev-parse', 'child');
    expect(head).not.to.equal(fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'rev-parse', 'child^')).to.equal(
      fixture.oldChild
    );
    expect(fixture.git(fixture.consumer, 'show', 'child:own.txt')).to.equal(
      'own new work'
    );
    const calls: unknown[] = fs
      .readFileSync(fixture.ghCalls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      calls.filter((args) => Array.isArray(args) && args[0] === 'api')
    ).to.have.length(1);
  });

  it('decides mixed chain authors independently without cascading the frozen child to its own parent', () => {
    fs.writeJsonSync(fixture.identities, {
      account: { login: 'current-user' },
      authors: {
        parent: { login: 'current-user' },
        child: { login: 'other-user' },
      },
    });
    fixture.ok('get', 'child');
    fixture.status('parent', false);
    fixture.status();
    fixture.ok('down');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent-own.txt'),
      'parent local work'
    );
    fixture.ok('modify', '--commit', '--all', '-m', 'own parent commit');
    expect(fixture.git(fixture.consumer, 'rev-parse', 'parent^')).to.equal(
      fixture.oldParent
    );
    fixture.assertTip('child', fixture.oldChild);
  });

  for (const identity of [
    { label: 'missing identity', value: {} },
    { label: 'empty account', value: { account: { login: '' } } },
    {
      label: 'invalid account',
      value: { account: { login: ' current-user ' } },
    },
    { label: 'non-string account', value: { account: { login: 42 } } },
    { label: 'malformed account JSON', value: { accountRaw: '{' } },
    { label: 'account process error', value: { accountError: true } },
    { label: 'missing author', value: { account: { login: 'current-user' } } },
    {
      label: 'empty author',
      value: {
        account: { login: 'current-user' },
        authors: { parent: { login: '' }, child: { login: '' } },
      },
    },
    {
      label: 'invalid author',
      value: {
        account: { login: 'current-user' },
        authors: {
          parent: { login: 'bad user' },
          child: { login: 'bad user' },
        },
      },
    },
    {
      label: 'malformed author JSON',
      value: { account: { login: 'current-user' }, authorRaw: '[' },
    },
    {
      label: 'author process error',
      value: { account: { login: 'current-user' }, authorError: true },
    },
  ])
    it(`conservatively imports frozen despite optional ${identity.label}`, () => {
      fs.writeJsonSync(fixture.identities, identity.value);
      fixture.ok('get', 'child');
      fixture.assertTip('child', fixture.oldChild);
      fixture.assertTip('parent', fixture.oldParent);
      fixture.status();
      fs.writeFileSync(
        path.join(fixture.consumer, 'unknown.txt'),
        'no guessed permission'
      );
      const result = fixture.run(['modify', '--all', '-m', 'blocked']);
      expect(result.status, result.output).to.equal(1);
      fixture.assertTip('child', fixture.oldChild);
      expect(
        fixture.git(fixture.consumer, 'ls-files', '--stage', 'unknown.txt')
      ).to.equal('');
    });

  for (const override of [
    '--unfrozen',
    '-U',
    '--unfrozen=true',
    '--unfrozen=false',
    '-U=false',
  ])
    it(`honors ${override} only as the new import override`, () => {
      fixture.ok('g', '2', override);
      fixture.assertTip('HEAD', fixture.oldChild);
      const frozen = override.endsWith('false');
      fixture.status('parent', frozen);
      fixture.status('child', frozen);
      fs.writeFileSync(
        path.join(fixture.consumer, 'override.txt'),
        'override work'
      );
      const result = fixture.run([
        'modify',
        '--commit',
        '--all',
        '-m',
        'override commit',
      ]);
      expect(result.status, result.output).to.equal(frozen ? 1 : 0);
      if (!frozen)
        expect(fixture.git(fixture.consumer, 'rev-parse', 'child^')).to.equal(
          fixture.oldChild
        );
      else fixture.assertTip('child', fixture.oldChild);
    });

  for (const frozen of [false, true])
    it(`preserves existing ${
      frozen ? 'frozen' : 'editable'
    } status across force, U, PR metadata and cache rebuild`, () => {
      fixture.ok('get', 'child', '-U');
      if (frozen) fixture.ok('freeze', 'child');
      const head = fixture.advanceChild();
      fixture.ok('get', 'child', '--force', '--unfrozen');
      fixture.assertTip('HEAD', head);
      fixture.ok('sync', '--no-pull', '--no-delete');
      fixture.ok('init', '--trunk', 'main');
      fixture.ok('get', 'child', '-f', '-U');
      fixture.status('child', frozen);
      fs.writeFileSync(
        path.join(fixture.consumer, 'existing.txt'),
        'existing work'
      );
      const result = fixture.run([
        'modify',
        '--commit',
        '--all',
        '-m',
        'existing commit',
      ]);
      expect(result.status, result.output).to.equal(frozen ? 1 : 0);
      if (!frozen)
        expect(fixture.git(fixture.consumer, 'rev-parse', 'child^')).to.equal(
          head
        );
      else fixture.assertTip('child', head);
    });

  for (const selector of ['number', 'current'])
    it(`applies default freezing to a new ${selector} target while retaining local overwrite confirmation`, () => {
      fixture.git(fixture.consumer, 'switch', '-c', 'child');
      const local = fixture.commit(
        fixture.consumer,
        'namesake.txt',
        'local namesake'
      );
      const args = selector === 'number' ? ['g', '2'] : ['get'];
      fixture.git(fixture.consumer, 'status', '--porcelain');
      const before = fixture.observe();
      const refused = fixture.run(args);
      expect(refused.status, refused.output).to.equal(1);
      expect(refused.output).to.include('without confirmation');
      fixture.assertTip('child', local);
      // The already imported parent is allowed progress; the namesake's bytes remain.
      expect(
        fixture.git(fixture.consumer, 'show', 'child:namesake.txt')
      ).to.equal('local namesake');
      fixture.git(fixture.consumer, 'switch', 'child');
      const accepted = fixture.run(args, true, [
        { prompt: 'Overwrite child', input: 'y\r' },
      ]);
      expect(accepted.status, accepted.output).to.equal(0);
      fixture.assertTip('child', fixture.oldChild);
      fixture.status();
      expect(fixture.observe()).not.to.deep.equal(before);
    });

  it('keeps required PR base and numeric head errors fatal before local writes', () => {
    fs.writeJsonSync(fixture.identities, { accountError: true });
    fs.writeJsonSync(fixture.prs, { child: 'missing' });
    fixture.git(fixture.consumer, 'status', '--porcelain');
    const before = fixture.observe();
    for (const target of ['child', '2', '999']) {
      const result = fixture.run(['get', target, '-U', '-f']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.match(/trace|open pull request/);
      expect(fixture.observe()).to.deep.equal(before);
    }
  });

  it('routes quiet cwd imports to the selected repository and discovers U through help and completion', () => {
    fixture.cwd = fixture.root;
    const result = fixture.run([
      '--cwd',
      fixture.consumer,
      '--quiet',
      'g',
      '2',
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    fixture.assertTip('child', fixture.oldChild);
    fixture.cwd = fixture.consumer;
    fixture.status();
    const before = fixture.observe();
    for (const command of ['get', 'g']) {
      const help = fixture.ok(command, '--help').output;
      expect(help).to.include('--unfrozen');
      expect(help).to.include('-U');
      const options = fixture.ok(
        '--get-yargs-completions',
        'ch',
        command,
        '--'
      ).output;
      expect(options).to.include('--unfrozen');
      const branches = fixture.ok(
        '--get-yargs-completions',
        'ch',
        command,
        ''
      ).output;
      expect(branches).to.include('child');
      expect(branches).to.include('parent');
    }
    expect(fixture.observe()).to.deep.equal(before);
  });

  for (const continuation of ['continue', 'cont'])
    it(`retains mixed queued decisions through real conflict, repeated unresolved ${continuation}, frozen all refusal and changed authors`, () => {
      fixture.ok('get', 'child', '-U');
      fixture.commit(fixture.consumer, 'local.txt', 'local replay');
      const remoteChild = fixture.advanceChild();
      const { otherTip, ownTip } = prepareMixedQueuedImports(fixture);
      const initial = fixture.run(['get', 'ownTip'], true, [
        { prompt: 'How would you like to handle', input: '\r' },
      ]);
      expect(initial.status, initial.output).to.equal(1);
      expect(initial.output).to.include('Hit conflict');
      const recovery = path.join(fixture.consumer, '.git', '.gtcontinue');
      expect(
        parseRecord(fs.readFileSync(recovery, 'utf8')).getImportDecisions
      ).to.deep.include({
        branchName: 'otherTip',
        wasTracked: false,
        frozen: true,
      });
      expect(
        parseRecord(fs.readFileSync(recovery, 'utf8')).getImportDecisions
      ).to.deep.include({
        branchName: 'ownTip',
        wasTracked: false,
        frozen: false,
      });
      const saved = parseRecord(fs.readFileSync(recovery, 'utf8'));
      fs.writeJsonSync(fixture.identities, {
        accountError: true,
        authorError: true,
      });
      fs.writeFileSync(fixture.ghCalls, '');
      const unresolved = fixture.run([continuation]);
      expect(unresolved.status, unresolved.output).to.equal(1);
      const repeated = parseRecord(fs.readFileSync(recovery, 'utf8'));
      expect(repeated.getImportDecisions).to.deep.equal(
        saved.getImportDecisions
      );
      expect(repeated.branchesToSync).to.deep.equal(saved.branchesToSync);
      expect(repeated.rebasedBranchBase).to.equal(saved.rebasedBranchBase);
      fs.writeFileSync(
        path.join(fixture.consumer, 'child.txt'),
        'resolved local and remote'
      );
      fixture.git(fixture.consumer, 'add', 'child.txt');
      fs.writeFileSync(
        path.join(fixture.consumer, 'unstaged.txt'),
        'not staged while frozen'
      );
      fixture.ok('freeze', 'child');
      fixture.git(fixture.consumer, 'status', '--porcelain');
      const before = fixture.observe();
      const refused = fixture.run([continuation, '--all']);
      expect(refused.status, refused.output).to.equal(1);
      expect(refused.output).to.include('ch unfreeze child');
      expect(fixture.observe()).to.deep.equal(before);
      fixture.ok('unfreeze', 'child');
      fs.removeSync(path.join(fixture.consumer, 'unstaged.txt'));
      fixture.ok(continuation);
      fixture.assertTip('otherTip', otherTip);
      fixture.assertTip('ownTip', ownTip);
      expect(
        fixture.git(fixture.consumer, 'merge-base', 'child', remoteChild)
      ).to.equal(remoteChild);
      expect(fixture.git(fixture.consumer, 'show', 'child:local.txt')).to.equal(
        'local replay'
      );
      expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
        'resolved local and remote'
      );
      expect(
        fixture.git(fixture.consumer, 'show', 'ownTip:own-tip.txt')
      ).to.equal('own queued bytes');
      fixture.status('otherTip');
      fixture.status('ownTip', false);
      fixture.ok('checkout', 'ownTip');
      fs.writeFileSync(
        path.join(fixture.consumer, 'after.txt'),
        'own after continuation'
      );
      fixture.ok('modify', '--commit', '--all', '-m', 'after continuation');
      expect(fixture.git(fixture.consumer, 'rev-parse', 'ownTip^')).to.equal(
        ownTip
      );
      fixture.ok('checkout', 'otherTip');
      const stopped = fixture.run([
        'modify',
        '--commit',
        '--all',
        '-m',
        'blocked queued edit',
      ]);
      expect(stopped.status, stopped.output).to.equal(1);
      expect(stopped.output).to.include('ch unfreeze otherTip');
      expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
      expect(
        fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
      ).to.equal(false);
    });

  it('preserves the current editable status of a queued import newly tracked by another process', () => {
    fixture.ok('get', 'child', '-U');
    fixture.commit(fixture.consumer, 'local.txt', 'local replay');
    fixture.advanceChild();
    fixture.git(fixture.producer, 'switch', '-c', 'tip');
    const tip = fixture.commit(fixture.producer, 'tip.txt', 'queued tip');
    fixture.git(fixture.producer, 'push', 'origin', 'tip');
    fs.writeJsonSync(fixture.prs, {
      parent: 'main',
      child: 'parent',
      tip: 'child',
    });
    const initial = fixture.run(['get', 'tip'], true, [
      { prompt: 'How would you like to handle', input: '\r' },
    ]);
    expect(initial.status, initial.output).to.equal(1);
    expect(initial.output).to.include('Hit conflict');
    fixture.git(fixture.consumer, 'branch', 'tip', 'child');
    fixture.ok('track', 'tip', '--parent', 'child');
    fixture.status('tip', false);
    fs.writeFileSync(
      path.join(fixture.consumer, 'child.txt'),
      'resolved new actor'
    );
    fixture.git(fixture.consumer, 'add', 'child.txt');
    fs.writeFileSync(fixture.ghCalls, '');
    const resumed = fixture.run(['cont'], true, [
      { prompt: 'How would you like to handle', input: '\u001b[B\r' },
    ]);
    expect(resumed.status, resumed.output).to.equal(0);
    fixture.assertTip('tip', tip);
    fixture.status('tip', false);
    fixture.ok('checkout', 'tip');
    fs.writeFileSync(
      path.join(fixture.consumer, 'actor.txt'),
      'actor editable'
    );
    fixture.ok('modify', '--commit', '--all', '-m', 'actor local commit');
    expect(fixture.git(fixture.consumer, 'rev-parse', 'tip^')).to.equal(tip);
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
  });
  it('reports reached new head and incomplete status when normal import metadata publication fails', () => {
    const metadataDirectory = path.join(
      fixture.consumer,
      '.git',
      'refs',
      'branch-metadata'
    );
    fs.ensureDirSync(metadataDirectory);
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout'),
      '#!/bin/sh\nif [ "$(git branch --show-current)" = child ]; then printf locked > .git/refs/branch-metadata/child.lock; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(
      'Updated parent, child before get stopped'
    );
    expect(result.output).to.match(
      /Metadata\/status publication for child may be incomplete/
    );
    expect(result.output).not.to.include('Synced child');
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('HEAD', fixture.oldChild);
    expect(fixture.git(fixture.consumer, 'show', 'child:child.txt')).to.equal(
      'child-old'
    );
    fixture.status('parent');
    fs.removeSync(path.join(metadataDirectory, 'child.lock'));
    fs.removeSync(
      path.join(fixture.consumer, '.git', 'hooks', 'post-checkout')
    );
    fixture.ok('get', 'child', '--force');
    fixture.status();
    const blocked = fixture.run([
      'modify',
      '--commit',
      '-m',
      'must stay frozen',
    ]);
    expect(blocked.status, blocked.output).to.equal(1);
  });

  it('retains stored frozen protection while repairing an invalid parent through force import and U', () => {
    fixture.ok('get', 'child');
    const metadata = parseRecord(
      fixture.git(fixture.consumer, 'show', 'refs/branch-metadata/child')
    );
    metadata.parentBranchName = 'missing-parent';
    const damaged = path.join(fixture.root, 'damaged.json');
    fs.writeJsonSync(damaged, metadata);
    const oid = fixture.git(fixture.consumer, 'hash-object', '-w', damaged);
    fixture.git(
      fixture.consumer,
      'update-ref',
      'refs/branch-metadata/child',
      oid
    );
    const remote = fixture.advanceChild();
    fixture.ok('get', 'child', '--force', '-U');
    fixture.assertTip('child', remote);
    fixture.status();
    fixture.ok('down');
    fixture.assertTip('HEAD', fixture.oldParent);
    fixture.ok('up');
    fs.writeFileSync(
      path.join(fixture.consumer, 'repair.txt'),
      'must not stage'
    );
    const before = fixture.observe();
    const blocked = fixture.run(['modify', '--all', '-m', 'blocked repair']);
    expect(blocked.status, blocked.output).to.equal(1);
    expect(blocked.output).to.include('ch unfreeze child');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('preserves a new local namesake in another dirty worktree even with force and U', () => {
    fixture.git(fixture.consumer, 'branch', 'child');
    const other = path.join(fixture.root, 'other-worktree');
    fixture.git(fixture.consumer, 'worktree', 'add', other, 'child');
    fs.writeFileSync(path.join(other, 'main.txt'), 'other staged');
    fixture.git(other, 'add', 'main.txt');
    fs.appendFileSync(path.join(other, 'main.txt'), ' and unstaged');
    fixture.git(other, 'status', '--porcelain');
    const linkedBefore = fixture.observe(other);
    const index = fixture.git(other, 'rev-parse', '--git-path', 'index');
    const indexBytes = fs.readFileSync(index);
    const stages = fixture.git(other, 'ls-files', '--stage');
    const result = fixture.run(['g', '2', '-f', '-U']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(other);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'import-worktree-observations.jsonl'),
        JSON.stringify({
          root: fixture.root,
          other,
          before: linkedBefore,
          after: fixture.observe(other),
        }) + '\n'
      );
    expect(fs.readFileSync(index)).to.deep.equal(indexBytes);
    expect(fixture.git(other, 'ls-files', '--stage')).to.equal(stages);
    expect(fs.readFileSync(path.join(other, 'main.txt'), 'utf8')).to.equal(
      'other staged and unstaged'
    );
    expect(fixture.git(other, 'branch', '--show-current')).to.equal('child');
    expect(fixture.git(fixture.consumer, 'rev-parse', 'child')).to.equal(
      fixture.git(fixture.consumer, 'rev-parse', 'main')
    );
    fixture.status('parent', false);
  });

  it('does not trust identical invalid account and author logins containing consecutive hyphens', () => {
    fs.writeJsonSync(fixture.identities, {
      account: { login: 'current--user' },
      authors: {
        parent: { login: 'current--user' },
        child: { login: 'current--user' },
      },
    });
    fixture.ok('get', 'child');
    fixture.assertTip('child', fixture.oldChild);
    fixture.status();
    fs.writeFileSync(
      path.join(fixture.consumer, 'untrusted.txt'),
      'untrusted work'
    );
    const blocked = fixture.run(['modify', '--all', '-m', 'untrusted edit']);
    expect(blocked.status, blocked.output).to.equal(1);
    fixture.assertTip('child', fixture.oldChild);
  });
});
