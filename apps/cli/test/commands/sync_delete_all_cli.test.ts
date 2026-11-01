import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { FrozenSyncCliFixture } from '../lib/fixtures/frozen_sync_cli';

describe('sync cleanup-only consent through the public CLI', function () {
  this.timeout(120000);
  let fixture: FrozenSyncCliFixture;
  beforeEach(() => {
    fixture = new FrozenSyncCliFixture();
  });
  afterEach(function () {
    fixture.saveEvidence(this.currentTest?.fullTitle());
    fixture.cleanup();
  });

  function closedLeaf(): void {
    fixture.branch('candidate', 'main');
    fixture.succeed('submit', '--draft');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    fixture.succeed('checkout', 'main');
  }

  it('deletes an eligible closed local branch without changing the remote or PR', () => {
    closedLeaf();
    const before = fixture.observe();

    fixture.succeed('sync', '--no-pull', '--no-restack', '--delete-all');

    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal('main');
    expect(fixture.observe().remote).to.equal(before.remote);
    expect(fixture.prs()).to.deep.equal(before.prs);
    expect(fixture.git('branch', '--show-current')).to.equal('main');
  });

  it('cleans a closed branch whose remote head was already deleted', () => {
    closedLeaf();
    fixture.git('push', 'origin', '--delete', 'candidate');
    const remote = fixture.observe().remote;
    fixture.succeed('sync', '--no-pull', '--no-restack', '--delete-all=true');
    expect(fixture.git('branch', '--list', 'candidate')).to.equal('');
    expect(fixture.observe().remote).to.equal(remote);
  });

  for (const route of [['sync'], ['repo', 'sync'], ['repo', 's']]) {
    it(`honors boolean forms and no-delete precedence through ${route.join(
      ' '
    )}`, () => {
      closedLeaf();
      for (const flags of [
        [],
        ['--delete-all=false'],
        ['--delete-all', 'false'],
        ['--no-delete-all'],
        ['--delete-all', '--no-delete'],
        ['--delete-all=true', '--force', '--delete=false'],
      ]) {
        fixture.succeed(...route, '--no-pull', '--no-restack', ...flags);
        expect(fixture.git('branch', '--list', 'candidate')).to.include(
          'candidate'
        );
      }
      fixture.succeed(
        ...route,
        '--no-pull',
        '--no-restack',
        '--delete-all',
        'true'
      );
      expect(fixture.git('branch', '--list', 'candidate')).to.equal('');
    });
  }

  it('refuses divergent trunk reset with delete-all while legacy force retains reset authority', () => {
    fixture.commit('local-trunk-work');
    const local = fixture.git('rev-parse', 'main');
    fixture.git('checkout', '-b', 'remote-trunk', 'origin/main');
    fixture.commit('remote-trunk-work');
    fixture.git('push', 'origin', 'remote-trunk:main');
    fixture.git('checkout', 'main');
    fixture.git('branch', '-D', 'remote-trunk');
    const remote = fixture.remoteSha('main');
    const result = fixture.run([
      'sync',
      '--delete-all',
      '--no-restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(fixture.git('rev-parse', 'main')).to.equal(local);
    expect(fixture.git('show', 'main:local-trunk-work.txt')).to.equal(
      'local-trunk-work'
    );
    expect(fixture.remoteSha('main')).to.equal(remote);

    fixture.succeed('sync', '--force', '--no-restack');
    expect(fixture.git('rev-parse', 'main')).to.equal(remote);
    expect(fixture.remoteSha('main')).to.equal(remote);
  });

  it('keeps an empty unassociated branch and open local work outside cleanup consent', () => {
    fixture.branch('local-work', 'main');
    fixture.git('checkout', '-b', 'empty', 'main');
    fixture.succeed('track', 'empty', '--parent', 'main');
    fixture.succeed('checkout', 'main');
    const before = fixture.observe();
    fixture.succeed('sync', '--no-pull', '--no-restack', '--delete-all=true');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('retains frozen mandatory survivors while cleaning an independent frozen leaf without replay', () => {
    closedLeaf();
    fixture.branch('protected', 'candidate');
    fixture.succeed('freeze');
    fixture.branch('safe', 'main');
    fixture.succeed('submit', '--draft');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    fixture.succeed('freeze');
    fixture.succeed('checkout', 'main');
    const heads = ['candidate', 'protected'].map((branch) =>
      fixture.git('rev-parse', branch)
    );
    const metadata = fixture.git('rev-parse', 'refs/branch-metadata/protected');

    const output = fixture.succeed(
      'sync',
      '--no-pull',
      '--no-restack',
      '--delete-all'
    );

    expect(output).to.include('Skipping cleanup').and.to.include('protected');
    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
      'candidate\nmain\nprotected'
    );
    expect(
      ['candidate', 'protected'].map((branch) =>
        fixture.git('rev-parse', branch)
      )
    ).to.deep.equal(heads);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/protected')).to.equal(
      metadata
    );
    expect(fixture.succeed('info', 'protected')).to.include(
      'Parent: candidate'
    );
    expect(fixture.observe().rebase).to.equal(false);
  });

  it('refuses an occupied cleanup target before deleting it', () => {
    closedLeaf();
    fixture.succeed('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.git(
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'candidate'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-restack',
      '--delete-all',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('worktree');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses an occupied mandatory survivor before changing parents or deleting candidates', () => {
    closedLeaf();
    fixture.branch('survivor', 'candidate');
    fixture.succeed('checkout', 'main');
    fixture.succeed('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.git(
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'survivor'
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-restack',
      '--delete-all',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('worktree');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('still visits a closed child after a terminal user declines its closed ancestor', () => {
    fixture.branch('ancestor', 'main');
    fixture.branch('child', 'ancestor');
    fixture.succeed('submit', '--draft');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    fixture.succeed('checkout', 'main');
    const ancestor = fixture.git('rev-parse', 'ancestor');
    const result = runCliInPty(
      getTestCliCommand(['sync', '--no-pull', '--no-restack', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Delete it?', input: 'n\r' },
          { prompt: 'Delete it?', input: 'y\r' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
      'ancestor\nmain'
    );
    expect(fixture.git('rev-parse', 'ancestor')).to.equal(ancestor);
  });

  it('preserves staged and unstaged work before cleanup even with narrow consent', () => {
    closedLeaf();
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged');
    fixture.git('add', 'main.txt');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'unstaged');
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--delete-all',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('tracked changes');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('cleans locally merged work with GitHub disabled without making service calls', () => {
    fixture.branch('merged', 'main');
    fixture.git('checkout', 'main');
    fixture.git('merge', '--squash', 'merged');
    fixture.git('commit', '-m', 'local squash merge');
    const config = path.join(fixture.repo, '.git', '.graphite_repo_config');
    fs.writeFileSync(
      config,
      JSON.stringify({ trunk: 'main', isGithubIntegrationEnabled: false })
    );
    fixture.clearCalls();
    const remote = fixture.observe().remote;

    fixture.succeed('sync', '--no-pull', '--no-restack', '--delete-all');

    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal('main');
    expect(fixture.calls()).to.deep.equal([]);
    expect(fixture.observe().remote).to.equal(remote);
  });

  it('advertises narrow cleanup permission in help and completion for every sync route', () => {
    for (const route of [['sync'], ['repo', 'sync'], ['repo', 's']]) {
      const help = fixture.succeed(...route, '--help').replace(/\s+/g, ' ');
      expect(help).to.include('--delete-all').and.to.include('cleanup only');
      expect(help).to.include(
        'does not authorize trunk reset or feature overwrite'
      );
      expect(help).to.include('Ignored with --no-delete');
      const completion = fixture.run([
        '--get-yargs-completions',
        'an',
        ...route,
        '--',
      ]);
      expect(completion.status, completion.stderr).to.equal(0);
      expect(completion.stdout).to.include('--delete-all');
    }
    const unknown = fixture.run([
      'sync',
      '--delete-everything',
      '--no-interactive',
    ]);
    expect(unknown.status).to.equal(1);
    expect(unknown.stderr).to.include('Unknown argument');
  });
});
