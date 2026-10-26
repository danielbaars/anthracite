import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { FrozenSyncCliFixture } from '../lib/fixtures/frozen_sync_cli';

// eslint-disable-next-line max-lines-per-function
describe('frozen sync through the public CLI', function () {
  this.timeout(120000);
  let fixture: FrozenSyncCliFixture;
  beforeEach(() => {
    fixture = new FrozenSyncCliFixture();
  });
  afterEach(function () {
    fixture.saveEvidence(this.currentTest?.fullTitle());
    fixture.cleanup();
  });

  function closed(branch: string): void {
    fixture.succeed('checkout', branch);
    const previouslyClosed = fixture
      .prs()
      .filter((pr) => pr.state === 'CLOSED')
      .map((pr) => pr.headRefName);
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'OPEN' })));
    fixture.succeed('submit', '--draft');
    fixture.setPrs(
      fixture
        .prs()
        .map((pr) =>
          pr.headRefName === branch || previouslyClosed.includes(pr.headRefName)
            ? { ...pr, state: 'CLOSED' }
            : pr
        )
    );
  }

  it('skips a frozen surviving child before any cleanup parent change while an independent frozen leaf is deleted', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('protected', 'candidate');
    fixture.succeed('freeze');
    const protectedHead = fixture.git('rev-parse', 'protected');
    const protectedMeta = fixture.git(
      'rev-parse',
      'refs/branch-metadata/protected'
    );
    fixture.branch('safe', 'main');
    closed('safe');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    fixture.clearCalls();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Skipping cleanup')
      .and.to.include('protected');
    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
      'candidate\nmain\nprotected'
    );
    expect(fixture.git('rev-parse', 'protected')).to.equal(protectedHead);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/protected')).to.equal(
      protectedMeta
    );
    expect(
      fixture
        .calls()
        .every((call) => !['edit', 'ready', 'close'].includes(call[1]))
    ).to.equal(true);
  });
  for (const command of [['sync'], ['repo', 'sync'], ['repo', 's']]) {
    it(`preserves frozen metadata and feature heads during default trunk FF and PR upserts via ${command.join(
      ' '
    )}`, () => {
      fixture.branch('feature', 'main');
      fixture.succeed('submit', '--draft');
      fixture.succeed('freeze');
      const feature = fixture.git('rev-parse', 'feature');
      const tree = fixture.git('rev-parse', 'feature^{tree}');
      const remoteFeature = fixture.git(
        'commit-tree',
        tree,
        '-p',
        feature,
        '-m',
        'remote feature advance'
      );
      fixture.git('push', 'origin', `${remoteFeature}:refs/heads/feature`);
      const trunk = fixture.git('rev-parse', 'main');
      const remoteTrunk = fixture.git(
        'commit-tree',
        fixture.git('rev-parse', 'main^{tree}'),
        '-p',
        trunk,
        '-m',
        'remote trunk advance'
      );
      fixture.git('push', 'origin', `${remoteTrunk}:refs/heads/main`);
      fixture.setPrs(
        fixture.prs().map((pr) => ({
          ...pr,
          title: 'Updated title',
          body: 'Updated body',
          reviewDecision: 'APPROVED',
        }))
      );
      fixture.clearCalls();
      const result = fixture.run([...command, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('use an get')
        .and.to.include('feature heads');
      expect(fixture.git('rev-parse', 'main')).to.equal(remoteTrunk);
      expect(fixture.git('rev-parse', 'feature')).to.equal(feature);
      expect(fixture.git('rev-parse', 'feature^{tree}')).to.equal(tree);
      expect(fixture.remoteSha('feature')).to.equal(remoteFeature);
      const metadata = fixture.git(
        'cat-file',
        '-p',
        'refs/branch-metadata/feature'
      );
      expect(metadata)
        .to.include('"frozen": true')
        .and.to.include('Updated title')
        .and.to.include('Updated body')
        .and.to.include('APPROVED');
      expect(fixture.succeed('info', 'feature')).to.include('(frozen)');
      expect(
        fixture.calls().every((call) => call[0] === 'pr' && call[1] === 'view')
      ).to.equal(true);
    });

    it(`explains the limited sync scope in help and completion via ${command.join(
      ' '
    )}`, () => {
      const help = fixture.run([...command, '--help']);
      expect(help.status).to.equal(0);
      expect(help.stdout).to.include('feature heads').and.to.include('get');
      fixture.env.SHELL = '/bin/zsh';
      const completion = fixture.run([
        '--get-yargs-completions',
        'an',
        ...command.slice(0, -1),
        '',
      ]);
      expect(completion.status).to.equal(0);
      expect(completion.stdout)
        .to.include('feature heads')
        .and.to.include('get');
    });
  }

  it('blocks indirect frozen survivor replays and dependent ancestor deletions while a safe sibling group progresses', () => {
    fixture.branch('ancestor', 'main');
    closed('ancestor');
    fixture.branch('candidate', 'ancestor');
    closed('candidate');
    fixture.branch('editable', 'candidate');
    fixture.branch('indirect', 'editable');
    fixture.succeed('freeze');
    fixture.succeed('track', 'indirect', '--parent', 'main');
    fixture.succeed('unfreeze', 'editable');
    fixture.succeed('track', 'indirect', '--parent', 'editable');
    expect(fixture.succeed('info', 'editable')).not.to.include('(frozen)');
    expect(fixture.succeed('info', 'indirect')).to.include('(frozen)');
    fixture.branch('safe-sibling', 'ancestor');
    closed('safe-sibling');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    const protectedRefs = ['ancestor', 'candidate', 'editable', 'indirect'].map(
      (branch) => fixture.git('rev-parse', branch)
    );
    const metadata = fixture.git('rev-parse', 'refs/branch-metadata/indirect');
    const result = fixture.run([
      'repo',
      's',
      '--no-pull',
      '--force',
      '--restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Skipping cleanup of ancestor')
      .and.to.include('Skipping cleanup of candidate')
      .and.to.include('indirect');
    expect(
      ['ancestor', 'candidate', 'editable', 'indirect'].map((branch) =>
        fixture.git('rev-parse', branch)
      )
    ).to.deep.equal(protectedRefs);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/indirect')).to.equal(
      metadata
    );
    expect(fixture.git('branch', '--format=%(refname:short)')).not.to.include(
      'safe-sibling'
    );
    expect(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/editable')
    ).to.include('"parentBranchName": "candidate"');
  });

  it('deletes an entirely closed frozen chain without treating removed nodes as surviving participants', () => {
    fixture.branch('base', 'main');
    closed('base');
    fixture.succeed('freeze');
    fixture.branch('tip', 'base');
    closed('tip');
    fixture.succeed('freeze');
    const main = fixture.git('rev-parse', 'main');
    const result = fixture.run([
      'repo',
      'sync',
      '--no-pull',
      '-f',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal('main');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(main);
    expect(
      fixture.git('for-each-ref', '--format=%(refname)', 'refs/branch-metadata')
    ).to.equal('');
  });

  it('keeps noninteractive confirmation defaults and no-delete selection for a closed frozen leaf', () => {
    fixture.branch('leaf', 'main');
    closed('leaf');
    fixture.succeed('freeze');
    const head = fixture.git('rev-parse', 'leaf');
    for (const args of [
      ['sync', '--no-pull'],
      ['repo', 'sync', '--no-pull', '--force', '--no-delete'],
    ]) {
      const result = fixture.run([...args, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git('rev-parse', 'leaf')).to.equal(head);
      expect(fixture.succeed('info', 'leaf')).to.include('(frozen)');
    }
  });

  for (const answer of ['n', 'y']) {
    it(`honors real terminal cleanup confirmation ${answer} for a closed frozen leaf`, () => {
      fixture.branch('leaf', 'main');
      closed('leaf');
      fixture.succeed('freeze');
      const before = fixture.observe();
      const command = getTestCliCommand(['sync', '--no-pull', '--interactive']);
      const result = runCliInPty(command, {
        cwd: fixture.repo,
        env: fixture.env,
        timeoutMs: 20000,
        responses: [{ prompt: 'Delete it?', input: answer + '\r' }],
      });
      fs.writeFileSync(
        path.join(fixture.root, 'editor.jsonl'),
        JSON.stringify({
          command,
          before,
          after: fixture.observe(),
          ...result,
        }) + '\n'
      );
      expect(result.status, result.output).to.equal(0);
      expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
        answer === 'y' ? 'main' : 'leaf\nmain'
      );
      if (answer === 'n')
        expect(fixture.git('rev-parse', 'leaf')).to.equal(before.head);
    });
  }

  it('uses an unchanged frozen anchor and actually replays its editable descendant with optional restack', () => {
    fixture.branch('anchor', 'main');
    fixture.succeed('freeze');
    fixture.branch('child', 'anchor');
    const child = fixture.git('rev-parse', 'child');
    const tree = fixture.git('rev-parse', 'child^{tree}');
    const anchor = fixture.git(
      'commit-tree',
      fixture.git('rev-parse', 'anchor^{tree}'),
      '-p',
      fixture.git('rev-parse', 'anchor'),
      '-m',
      'advanced frozen anchor'
    );
    fixture.git('update-ref', 'refs/heads/anchor', anchor);
    const metadata = fixture.git('rev-parse', 'refs/branch-metadata/anchor');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Skipping frozen branch anchor');
    expect(fixture.git('rev-parse', 'anchor')).to.equal(anchor);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/anchor')).to.equal(
      metadata
    );
    expect(fixture.git('rev-parse', 'child')).not.to.equal(child);
    expect(fixture.git('rev-parse', 'child^')).to.equal(anchor);
    expect(fixture.git('rev-parse', 'child^{tree}')).to.equal(tree);
  });

  function conflictCleanup(): void {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('survivor', 'candidate');
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'survivor resolution'
    );
    fixture.git('add', 'main.txt');
    fixture.git('commit', '-m', 'survivor conflict');
    fixture.env.GIT_AUTHOR_DATE = '2020-01-01T00:00:00Z';
    fixture.env.GIT_COMMITTER_DATE = '2020-01-01T00:00:00Z';
    fixture.branch('z-later', 'survivor');
    delete fixture.env.GIT_AUTHOR_DATE;
    delete fixture.env.GIT_COMMITTER_DATE;
    fixture.git('checkout', 'main');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'trunk conflict');
    fixture.git('add', 'main.txt');
    fixture.git('commit', '-m', 'trunk conflict');
    fixture.git('checkout', 'z-later');
  }

  for (const continuation of ['continue', 'cont']) {
    it(`keeps mandatory cleanup survivors and staged resolution through fresh frozen ${continuation} --all refusal`, () => {
      conflictCleanup();
      const result = fixture.run([
        'sync',
        '--no-pull',
        '--force',
        '--restack',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(fixture.observe().rebase).to.equal(true);
      expect(fixture.git('branch', '--format=%(refname:short)')).not.to.include(
        'candidate'
      );
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'resolved');
      fixture.git('add', 'main.txt');
      fs.writeFileSync(path.join(fixture.repo, 'unstaged.txt'), 'do not stage');
      fixture.succeed('freeze', 'survivor');
      const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
      const before = fixture.observe();
      const recoveryBefore = fs.readFileSync(recovery);
      const refused = fixture.run([continuation, '--all', '--no-interactive']);
      expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
      expect(refused.stderr).to.include('frozen branch survivor');
      expect(fixture.observe()).to.deep.equal(before);
      expect(fs.readFileSync(recovery)).to.deep.equal(recoveryBefore);
      fixture.succeed('unfreeze', 'survivor');
      const resumed = fixture.run([continuation, '--no-interactive']);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
      expect(fixture.observe().rebase).to.equal(false);
      expect(fixture.git('rev-parse', 'survivor~2')).to.equal(
        fixture.git('rev-parse', 'main')
      );
      expect(fixture.git('rev-parse', 'z-later^')).to.equal(
        fixture.git('rev-parse', 'survivor')
      );
      expect(fixture.git('show', 'survivor:main.txt')).to.equal('resolved');
      expect(fixture.git('ls-files', '--', 'unstaged.txt')).to.equal('');
    });
  }

  it('retains reached parent progress and reports a real late cleanup failure after a metadata hook freezes another survivor', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('one', 'candidate');
    fixture.branch('two', 'candidate');
    fixture.succeed('checkout', 'main');
    const hooks = path.join(fixture.repo, '.git', 'hooks');
    const freezeOne = getTestCliCommand(['freeze', 'one', '--no-interactive']);
    const freezeTwo = getTestCliCommand(['freeze', 'two', '--no-interactive']);
    const quote = (value: string): string =>
      "'" + value.replace(/'/g, "'\\''") + "'";
    const marker = path.join(fixture.root, 'hook-once');
    fs.writeFileSync(
      path.join(hooks, 'reference-transaction'),
      `#!/bin/sh
input=$(cat)
if [ "$1" = committed ] && [ ! -e '${marker}' ]; then
 case "$input" in
  *refs/branch-metadata/one*) touch '${marker}'; ${freezeTwo
        .map(quote)
        .join(' ')} ;;
  *refs/branch-metadata/two*) touch '${marker}'; ${freezeOne
        .map(quote)
        .join(' ')} ;;
 esac
fi
`
    );
    fs.chmodSync(path.join(hooks, 'reference-transaction'), 0o755);
    const heads = ['candidate', 'one', 'two'].map((branch) =>
      fixture.git('rev-parse', branch)
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('frozen branch')
      .and.to.include('Completed cleanup changes are retained');
    expect(
      ['candidate', 'one', 'two'].map((branch) =>
        fixture.git('rev-parse', branch)
      )
    ).to.deep.equal(heads);
    const parents = ['one', 'two'].map((branch) =>
      fixture.git('cat-file', '-p', `refs/branch-metadata/${branch}`)
    );
    expect(
      parents.filter((meta) => meta.includes('"parentBranchName": "main"'))
    ).to.have.length(1);
    expect(
      parents.filter((meta) => meta.includes('"parentBranchName": "candidate"'))
    ).to.have.length(1);
    expect(fixture.git('symbolic-ref', '--short', 'HEAD')).to.equal('main');
  });

  it('preserves dirty work and rejects deletion of a candidate checked out in another worktree', () => {
    fixture.branch('leaf', 'main');
    closed('leaf');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    const linked = path.join(fixture.root, 'linked');
    fixture.git('worktree', 'add', linked, 'leaf');
    fs.writeFileSync(path.join(linked, 'leaf.txt'), 'linked dirty work');
    fs.writeFileSync(path.join(linked, 'untracked'), 'linked untracked');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    const refs = fixture.git(
      'for-each-ref',
      '--format=%(refname) %(objectname)'
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('worktree');
    expect(
      fixture.git('for-each-ref', '--format=%(refname) %(objectname)')
    ).to.equal(refs);
    expect(fs.readFileSync(path.join(linked, 'leaf.txt'), 'utf8')).to.equal(
      'linked dirty work'
    );
    expect(fs.readFileSync(path.join(linked, 'untracked'), 'utf8')).to.equal(
      'linked untracked'
    );
  });

  it('honors quiet and explicit cwd for normal protected skips while preserving unrelated files', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('child', 'candidate');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    fs.writeFileSync(path.join(fixture.root, 'unrelated'), 'outside scope');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    const before = fixture.observe();
    const result = fixture.run(
      [
        '--cwd',
        fixture.repo,
        'repo',
        's',
        '--no-pull',
        '-f',
        '--quiet',
        '--show-delete-progress',
        '--no-interactive',
      ],
      fixture.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    expect(fixture.observe()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.root, 'unrelated'), 'utf8')
    ).to.equal('outside scope');
  });
  it('treats a declined closed frozen child as a survivor before deleting its accepted ancestor', () => {
    fixture.branch('ancestor', 'main');
    closed('ancestor');
    fixture.branch('child', 'ancestor');
    closed('child');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    const before = fixture.observe();
    const result = runCliInPty(
      getTestCliCommand(['sync', '--no-pull', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        timeoutMs: 20000,
        responses: [
          { prompt: 'Delete it?', input: 'y\r' },
          { prompt: 'Delete it?', input: 'n\r' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .to.include('Skipping cleanup of ancestor')
      .and.to.include('child');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('checks every mandatory cleanup survivor after the real pre-rebase hook before publishing the first replay', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('one', 'candidate');
    fixture.branch('two', 'candidate');
    fixture.succeed('checkout', 'main');
    const heads = ['one', 'two'].map((branch) =>
      fixture.git('rev-parse', branch)
    );
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-rebase');
    const one = getTestCliCommand(['freeze', 'one', '--no-interactive']);
    const two = getTestCliCommand(['freeze', 'two', '--no-interactive']);
    const quote = (value: string): string =>
      "'" + value.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(
      hook,
      `#!/bin/sh
case "$2" in
 one) ${two.map(quote).join(' ')} ;;
 two) ${one.map(quote).join(' ')} ;;
esac
`
    );
    fs.chmodSync(hook, 0o755);
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch');
    expect(
      ['one', 'two'].map((branch) => fixture.git('rev-parse', branch))
    ).to.deep.equal(heads);
    expect(fixture.git('branch', '--format=%(refname:short)')).not.to.include(
      'candidate'
    );
  });
  it('protects local delete sibling survivors with the same managed replay hook participants', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('one', 'candidate');
    fixture.branch('two', 'candidate');
    fixture.succeed('checkout', 'main');
    const heads = ['one', 'two'].map((branch) =>
      fixture.git('rev-parse', branch)
    );
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-rebase');
    const one = getTestCliCommand(['freeze', 'one', '--no-interactive']);
    const two = getTestCliCommand(['freeze', 'two', '--no-interactive']);
    const quote = (value: string): string =>
      "'" + value.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(
      hook,
      `#!/bin/sh
case "$2" in
 one) ${two.map(quote).join(' ')} ;;
 two) ${one.map(quote).join(' ')} ;;
esac
`
    );
    fs.chmodSync(hook, 0o755);
    const result = fixture.run([
      'delete',
      'candidate',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch');
    expect(
      ['one', 'two'].map((branch) => fixture.git('rev-parse', branch))
    ).to.deep.equal(heads);
    expect(fixture.git('branch', '--format=%(refname:short)')).not.to.include(
      'candidate'
    );
  });
  it('rechecks mandatory survivors inside prepared metadata hooks before the first parent publication', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('one', 'candidate');
    fixture.branch('two', 'candidate');
    fixture.succeed('checkout', 'main');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    const freeze = getTestCliCommand(['freeze', 'two', '--no-interactive']);
    const quote = (value: string): string =>
      "'" + value.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(
      hook,
      `#!/bin/sh
input=$(cat)
if [ "$1" = prepared ]; then
 case "$input" in *refs/branch-metadata/one*) ${freeze
   .map(quote)
   .join(' ')} ;; esac
fi
`
    );
    fs.chmodSync(hook, 0o755);
    const heads = ['candidate', 'one', 'two'].map((branch) =>
      fixture.git('rev-parse', branch)
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch two');
    expect(
      ['candidate', 'one', 'two'].map((branch) =>
        fixture.git('rev-parse', branch)
      )
    ).to.deep.equal(heads);
    for (const branch of ['one', 'two'])
      expect(
        fixture.git('cat-file', '-p', `refs/branch-metadata/${branch}`)
      ).to.include('"parentBranchName": "candidate"');
  });
  it('blocks physical cleanup deletion after its prepared ref hook freezes a mandatory survivor', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('survivor', 'candidate');
    fixture.succeed('freeze', 'candidate');
    fixture.succeed('checkout', 'main');
    const heads = ['candidate', 'survivor'].map((branch) =>
      fixture.git('rev-parse', branch)
    );
    const before = fixture.observe();
    const hook = path.join(
      fixture.repo,
      '.git',
      'hooks',
      'reference-transaction'
    );
    const freeze = getTestCliCommand([
      'freeze',
      'survivor',
      '--no-interactive',
    ]);
    fs.writeFileSync(
      hook,
      `#!/bin/sh
input=$(cat)
if [ "$1" = prepared ]; then
 case "$input" in *" 0000000000000000000000000000000000000000 refs/heads/candidate"*) ${freeze
   .map((value) => "'" + value.replace(/'/g, "'\\''") + "'")
   .join(' ')} ;; esac
fi
`,
      { mode: 0o755 }
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('frozen branch survivor')
      .and.to.include('Completed cleanup changes are retained');
    expect(fixture.git('branch', '--list', 'candidate')).to.include(
      'candidate'
    );
    expect(
      ['candidate', 'survivor'].map((branch) =>
        fixture.git('rev-parse', branch)
      )
    ).to.deep.equal(heads);
    const after = fixture.observe();
    expect(after.index).to.equal(before.index);
    expect(after.files).to.deep.equal(before.files);
    expect(after.remote).to.equal(before.remote);
    expect(after.recovery).to.deep.equal(before.recovery);
    expect(fixture.succeed('info', 'survivor')).to.include('Parent: main');
    expect(fixture.succeed('info', 'survivor')).to.include('(frozen)');
    expect(fixture.succeed('info', 'candidate')).to.include('(frozen)');
    fs.unlinkSync(hook);
    fixture.succeed('unfreeze', 'survivor');
    fixture.succeed('sync', '--no-pull', '--force');
    expect(fixture.git('branch', '--list', 'candidate')).to.equal('');
    expect(fixture.git('show', 'survivor:survivor.txt')).to.equal('survivor');
  });
  it('keeps a real eligible warm cache and raw index unchanged during an explained protected cleanup skip', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('child', 'candidate');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    const cache = path.join(fixture.repo, '.git', '.graphite_cache_persist');
    expect(fs.existsSync(cache)).to.equal(true);
    const cacheBefore = fs.readFileSync(cache);
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--debug',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Skipping cleanup');
    expect(result.stderr).not.to.include('Building cache from disk');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fs.readFileSync(cache)).to.deep.equal(cacheBefore);
  });

  function pauseCleanPublicRebase(): void {
    fixture.branch('active', 'main');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'active work');
    fixture.git('add', 'main.txt');
    fixture.git('commit', '-m', 'active conflict');
    fixture.git('checkout', 'main');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'trunk work');
    fixture.git('add', 'main.txt');
    fixture.git('commit', '-m', 'trunk conflict');
    fixture.git('checkout', 'active');
    const start = fixture.run(['restack', '--only', '--no-interactive']);
    expect(start.status, start.stdout + start.stderr).to.equal(1);
    expect(fixture.observe().rebase).to.equal(true);
    fs.writeFileSync(
      path.join(fixture.repo, 'main.txt'),
      'resolved active work'
    );
    fixture.git('add', 'main.txt');
    fixture.git('commit', '--no-edit');
    expect(fixture.git('status', '--porcelain')).to.equal('');
    expect(fixture.observe().rebase).to.equal(true);
  }

  it('does not overwrite unrelated saved continuation during zero-replay frozen leaf cleanup', () => {
    fixture.branch('leaf', 'main');
    closed('leaf');
    fixture.succeed('freeze');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    fixture.succeed('checkout', 'main');
    pauseCleanPublicRebase();
    const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
    const saved = fs.readFileSync(recovery);
    const activeHead = fixture.git('rev-parse', 'HEAD');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git('branch', '--format=%(refname:short)')).not.to.include(
      'leaf'
    );
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(activeHead);
    expect(fs.readFileSync(recovery)).to.deep.equal(saved);
    expect(fixture.observe().rebase).to.equal(true);
    const resume = fixture.run(['continue', '--no-interactive']);
    expect(resume.status, resume.stdout + resume.stderr).to.equal(0);
    expect(fixture.observe().rebase).to.equal(false);
    expect(fixture.git('rev-parse', 'active~2')).to.equal(
      fixture.git('rev-parse', 'main')
    );
  });

  it('refuses required cleanup replays before parent or deletion effects during another active operation', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('survivor', 'candidate');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    fixture.succeed('checkout', 'main');
    pauseCleanPublicRebase();
    const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
    const saved = fs.readFileSync(recovery);
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('Git operation').and.to.include('active');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fs.readFileSync(recovery)).to.deep.equal(saved);
    fixture.succeed('continue');
    expect(fixture.observe().rebase).to.equal(false);
  });
  it('retains optional trunk-stack work and skips an unrelated frozen anchor alongside mandatory cleanup replays', () => {
    fixture.branch('candidate', 'main');
    closed('candidate');
    fixture.branch('survivor', 'candidate');
    fixture.branch('anchor', 'main');
    fixture.succeed('freeze');
    fixture.branch('other', 'main');
    const other = fixture.git('rev-parse', 'other');
    fixture.git('checkout', 'main');
    fixture.commit('trunk-advance');
    const anchor = fixture.git('rev-parse', 'anchor');
    const metadata = fixture.git('rev-parse', 'refs/branch-metadata/anchor');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Skipping frozen branch anchor');
    expect(fixture.git('rev-parse', 'anchor')).to.equal(anchor);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/anchor')).to.equal(
      metadata
    );
    expect(fixture.git('rev-parse', 'survivor^')).to.equal(
      fixture.git('rev-parse', 'main')
    );
    expect(fixture.git('rev-parse', 'other')).not.to.equal(other);
    expect(fixture.git('rev-parse', 'other^')).to.equal(
      fixture.git('rev-parse', 'main')
    );
    expect(fixture.git('show', 'other:trunk-advance.txt')).to.equal(
      'trunk-advance'
    );
  });

  it('deletes a frozen leaf whose changes are actually merged into trunk without adding PR authority', () => {
    fixture.branch('merged', 'main');
    fixture.succeed('freeze');
    const tree = fixture.git('rev-parse', 'merged^{tree}');
    fixture.git('checkout', 'main');
    fixture.git('merge', '--squash', 'merged');
    fixture.git('commit', '-m', 'actual squash merge');
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal('main');
    expect(fixture.git('rev-parse', 'main^{tree}')).to.equal(tree);
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.calls().every((call) => call[1] === 'view')).to.equal(true);
  });
  it('retains staged, unstaged and untracked work and emits errors under quiet before sync writes', () => {
    fixture.branch('feature', 'main');
    fixture.succeed('freeze');
    fs.writeFileSync(path.join(fixture.repo, 'feature.txt'), 'staged');
    fixture.git('add', 'feature.txt');
    fs.writeFileSync(path.join(fixture.repo, 'feature.txt'), 'unstaged');
    fs.writeFileSync(path.join(fixture.repo, 'untracked'), 'preserved');
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--force',
      '--restack',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('tracked changes');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('cleans an independent metadata-only subgroup below a blocked ancestor using its retained actual parent', () => {
    fixture.branch('ancestor', 'main');
    closed('ancestor');
    fixture.git('checkout', '-b', 'empty', 'ancestor');
    fixture.succeed('track', 'empty', '--parent', 'ancestor');
    fixture.setPrs([
      ...fixture.prs(),
      {
        number: 2,
        url: 'https://github.com/fixture/submit/pull/2',
        headRefName: 'empty',
        baseRefName: 'ancestor',
        title: 'empty',
        body: '',
        state: 'OPEN',
        isDraft: true,
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequests: [],
      },
    ]);
    fixture.succeed('sync', '--no-pull', '--no-delete');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    fixture.branch('editable', 'empty');
    fixture.branch('indirect', 'editable');
    fixture.succeed('freeze');
    fixture.succeed('track', 'indirect', '--parent', 'main');
    fixture.succeed('unfreeze', 'editable');
    fixture.succeed('track', 'indirect', '--parent', 'editable');
    fixture.branch('blocked', 'ancestor');
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    const heads = ['ancestor', 'editable', 'indirect', 'blocked'].map(
      (branch) => fixture.git('rev-parse', branch)
    );
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git('branch', '--format=%(refname:short)')).not.to.include(
      'empty'
    );
    expect(
      ['ancestor', 'editable', 'indirect', 'blocked'].map((branch) =>
        fixture.git('rev-parse', branch)
      )
    ).to.deep.equal(heads);
    expect(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/editable')
    ).to.include('"parentBranchName": "ancestor"');
  });
  it('protects a different remaining mandatory survivor frozen by the real fresh continuation commit hook', () => {
    conflictCleanup();
    fixture.succeed('checkout', 'main');
    const start = fixture.run([
      'sync',
      '--no-pull',
      '--force',
      '--restack',
      '--no-interactive',
    ]);
    expect(start.status, start.stdout + start.stderr).to.equal(1);
    const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
    expect(fs.readFileSync(recovery, 'utf8')).to.include('z-later');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'resolved');
    fixture.git('add', 'main.txt');
    const active = fixture.git('rev-parse', 'HEAD');
    const later = fixture.git('rev-parse', 'z-later');
    const freeze = getTestCliCommand(['freeze', 'z-later', '--no-interactive']);
    const quote = (value: string): string =>
      "'" + value.replace(/'/g, "'\\''") + "'";
    const hook = path.join(fixture.repo, '.git', 'hooks', 'prepare-commit-msg');
    const detach = getTestCliCommand([
      'track',
      'z-later',
      '--parent',
      'main',
      '--no-interactive',
    ]);
    const restore = getTestCliCommand([
      'track',
      'z-later',
      '--parent',
      'survivor',
      '--no-interactive',
    ]);
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nset -e\n' +
        [detach, freeze, restore]
          .map((command) => command.map(quote).join(' '))
          .join('\n') +
        '\n'
    );
    fs.chmodSync(hook, 0o755);
    const result = fixture.run(['cont', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch z-later');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(active);
    expect(fixture.git('rev-parse', 'z-later')).to.equal(later);
    expect(fixture.observe().rebase).to.equal(true);
    fs.unlinkSync(hook);
    fixture.succeed('unfreeze', 'z-later');
    fixture.succeed('continue');
    expect(fixture.observe().rebase).to.equal(false);
    expect(fixture.git('show', 'survivor:main.txt')).to.equal('resolved');
    expect(fixture.git('rev-parse', 'z-later^')).to.equal(
      fixture.git('rev-parse', 'survivor')
    );
  });

  it('skips a newly frozen later generic sync queue item while actually continuing the editable active replay', () => {
    conflictCleanup();
    fixture.succeed('checkout', 'main');
    const originalSurvivor = fixture.git('rev-parse', 'survivor');
    const later = fixture.git('rev-parse', 'z-later');
    const start = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--restack',
      '--no-interactive',
    ]);
    expect(start.status, start.stdout + start.stderr).to.equal(1);
    const recovery = path.join(fixture.repo, '.git', '.gtcontinue');
    expect(fs.readFileSync(recovery, 'utf8')).to.include('z-later');
    fixture.succeed('track', 'z-later', '--parent', 'main');
    fixture.succeed('freeze', 'z-later');
    fixture.succeed('track', 'z-later', '--parent', 'survivor');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'resolved');
    fixture.git('add', 'main.txt');
    const result = fixture.run(['continue', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Skipping frozen branch z-later');
    expect(fixture.observe().rebase).to.equal(false);
    expect(fixture.git('rev-parse', 'z-later')).to.equal(later);
    expect(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/z-later')
    ).to.include(originalSurvivor);
    expect(fixture.git('rev-parse', 'survivor~2')).to.equal(
      fixture.git('rev-parse', 'candidate')
    );
    expect(fixture.git('show', 'survivor:main.txt')).to.equal('resolved');
  });
});
