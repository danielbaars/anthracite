import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { allScenes } from '../../lib/scenes/all_scenes';
import { configureTest } from '../../lib/utils/configure_test';
import { expectCommits } from '../../lib/utils/expect_commits';
import { runCliInPty } from '../../lib/utils/run_cli_in_pty';

for (const scene of allScenes) {
  describe(`(${scene}): rename`, function () {
    configureTest(this, scene);

    it('Renames without interaction and preserves work and stack navigation', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand(['create', 'a', '-m', 'a']);
      scene.repo.createChange('b', 'b');
      scene.repo.runCliCommand(['create', 'b', '-m', 'b']);
      const child = scene.repo.getRef('refs/heads/b');
      scene.repo.checkoutBranch('a');
      scene.repo.createChange('staged', 'staged');
      scene.repo.createChange('unstaged', 'a', true);
      const before = {
        head: scene.repo.runGitCommandAndGetOutput(['rev-parse', 'HEAD']),
        index: scene.repo.runGitCommandAndGetOutput(['write-tree']),
        work: scene.repo.runGitCommandAndGetOutput(['diff']),
        status: scene.repo.runGitCommandAndGetOutput(['status', '--porcelain']),
      };

      const result = runBuiltCli(scene.repo.dir, [
        'rename',
        'a1',
        '--no-interactive',
      ]);

      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).not.to.contain('Enter new name');
      expect(scene.repo.currentBranchName()).to.equal('a1');
      expect(scene.repo.getRef('refs/heads/a')).to.equal('');
      expect(scene.repo.getRef('refs/heads/a1')).to.equal(before.head);
      expect(scene.repo.getRef('refs/heads/b')).to.equal(child);
      expect(scene.repo.runGitCommandAndGetOutput(['write-tree'])).to.equal(
        before.index
      );
      expect(scene.repo.runGitCommandAndGetOutput(['diff'])).to.equal(
        before.work
      );
      expect(
        scene.repo.runGitCommandAndGetOutput(['status', '--porcelain'])
      ).to.equal(before.status);

      scene.repo.runGitCommand(['stash', '--include-untracked']);
      expect(
        runBuiltCli(scene.repo.dir, ['up', '--no-interactive']).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('b');
      expect(
        runBuiltCli(scene.repo.dir, ['down', '--no-interactive']).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('a1');
      expect(
        runBuiltCli(scene.repo.dir, ['down', '--no-interactive']).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('main');
    });

    it('Can rename a branch', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand([`create`, `a`, `-m`, `a`]);

      scene.repo.createChange('b', 'b');
      scene.repo.runCliCommand([`create`, `b`, `-m`, `b`]);

      scene.repo.checkoutBranch('a');
      scene.repo.runCliCommand([`rename`, `a1`]);

      expect(() => scene.repo.runCliCommand([`ls`])).not.to.throw();

      scene.repo.checkoutBranch('b');

      expectCommits(scene.repo, 'b, a, 1');

      scene.repo.runCliCommand([`down`, `--no-interactive`]);
      expect(scene.repo.currentBranchName()).to.equal('a1');

      scene.repo.runCliCommand([`down`, `--no-interactive`]);
      expect(scene.repo.currentBranchName()).to.equal('main');
    });

    it('Still prompts for a missing name in an interactive terminal', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand(['create', 'a', '-m', 'a']);
      const refs = scene.repo.runGitCommandAndGetOutput([
        'show-ref',
        '--heads',
      ]);
      const binary = process.env.CHARCOAL_TEST_BINARY;
      if (binary && !path.isAbsolute(binary)) {
        throw new Error('CHARCOAL_TEST_BINARY must be an absolute path');
      }
      const result = runCliInPty(
        binary
          ? [binary, 'rename', '--interactive']
          : [
              process.execPath,
              path.resolve(__dirname, '../../../src/index.js'),
              'rename',
              '--interactive',
            ],
        {
          cwd: scene.repo.dir,
          env: {
            ...process.env,
            GRAPHITE_DISABLE_TELEMETRY: '1',
            GRAPHITE_DISABLE_UPGRADE_PROMPT: '1',
            GRAPHITE_DISABLE_SURVEY: '1',
            GRAPHITE_PROFILE: '',
          },
        }
      );
      expect(result.output).to.contain('Enter new name for');
      expect(result.output).to.contain('Branch Name');
      expect(result.status).to.equal(124);
      expect(scene.repo.currentBranchName()).to.equal('a');
      expect(
        scene.repo.runGitCommandAndGetOutput(['show-ref', '--heads'])
      ).to.equal(refs);
      expect(
        scene.repo.runGitCommandAndGetOutput(['status', '--porcelain'])
      ).to.equal('');
      expect(
        runBuiltCli(scene.repo.dir, ['down', '--no-interactive']).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('main');
    });
    it('Rejects a missing non-interactive name without changing work or navigation', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand(['create', 'a', '-m', 'a']);
      scene.repo.createChange('staged', 'staged');
      scene.repo.createChange('unstaged', 'a', true);
      const refs = scene.repo.runGitCommandAndGetOutput([
        'show-ref',
        '--heads',
      ]);
      const index = scene.repo.runGitCommandAndGetOutput(['write-tree']);
      const diff = scene.repo.runGitCommandAndGetOutput(['diff']);

      const result = runBuiltCli(scene.repo.dir, [
        'rename',
        '--no-interactive',
      ]);

      expect(result.status).to.equal(1);
      expect(result.stdout + result.stderr).to.contain(
        'Please supply a new branch name'
      );
      expect(result.stdout).not.to.contain('Enter new name');
      expect(scene.repo.currentBranchName()).to.equal('a');
      expect(
        scene.repo.runGitCommandAndGetOutput(['show-ref', '--heads'])
      ).to.equal(refs);
      expect(scene.repo.runGitCommandAndGetOutput(['write-tree'])).to.equal(
        index
      );
      expect(scene.repo.runGitCommandAndGetOutput(['diff'])).to.equal(diff);
      scene.repo.runGitCommand(['stash', '--include-untracked']);
      expect(
        runBuiltCli(scene.repo.dir, ['down', '--no-interactive']).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('main');
    });
    it("Renaming a branch to its own name doesn't break", () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand([`create`, `a`, `-m`, `a`]);

      scene.repo.createChange('b', 'b');
      scene.repo.runCliCommand([`create`, `b`, `-m`, `b`]);

      scene.repo.checkoutBranch('a');
      const refs = scene.repo.runGitCommandAndGetOutput([
        'show-ref',
        '--heads',
      ]);
      const result = runBuiltCli(scene.repo.dir, [
        'rename',
        'a',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.contain('Current branch is already named a');
      expect(
        scene.repo.runGitCommandAndGetOutput(['show-ref', '--heads'])
      ).to.equal(refs);

      expect(() => scene.repo.runCliCommand([`ls`])).not.to.throw();
      expect(() => scene.repo.runCliCommand([`up`])).not.to.throw();
      expectCommits(scene.repo, 'b, a, 1');
    });

    for (const name of ['b', 'invalid..name', '...']) {
      it(`Rejects unusable name ${name} without losing branches or work`, () => {
        scene.repo.createChange('a', 'a');
        scene.repo.runCliCommand(['create', 'a', '-m', 'a']);
        scene.repo.createChange('b', 'b');
        scene.repo.runCliCommand(['create', 'b', '-m', 'b']);
        scene.repo.checkoutBranch('a');
        scene.repo.createChange('staged', 'staged');
        scene.repo.createChange('unstaged', 'a', true);
        const refs = scene.repo.runGitCommandAndGetOutput([
          'show-ref',
          '--heads',
        ]);
        const index = scene.repo.runGitCommandAndGetOutput(['write-tree']);
        const diff = scene.repo.runGitCommandAndGetOutput(['diff']);

        const result = runBuiltCli(scene.repo.dir, [
          'rename',
          name,
          '--no-interactive',
        ]);

        expect(result.status).to.equal(1);
        expect(result.stdout + result.stderr).not.to.contain(
          'Successfully renamed'
        );
        expect(scene.repo.currentBranchName()).to.equal('a');
        expect(
          scene.repo.runGitCommandAndGetOutput(['show-ref', '--heads'])
        ).to.equal(refs);
        expect(scene.repo.runGitCommandAndGetOutput(['write-tree'])).to.equal(
          index
        );
        expect(scene.repo.runGitCommandAndGetOutput(['diff'])).to.equal(diff);
        scene.repo.runGitCommand(['stash', '--include-untracked']);
        expect(
          runBuiltCli(scene.repo.dir, ['up', '--no-interactive']).status
        ).to.equal(0);
        expect(scene.repo.currentBranchName()).to.equal('b');
        expect(
          runBuiltCli(scene.repo.dir, ['down', '--no-interactive']).status
        ).to.equal(0);
        expect(scene.repo.currentBranchName()).to.equal('a');
      });
    }

    it('Keeps normalizing an explicit branch name', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand(['create', 'a', '-m', 'a']);
      const head = scene.repo.getRef('refs/heads/a');
      const result = runBuiltCli(scene.repo.dir, [
        'rename',
        'new name/',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('new_name');
      expect(scene.repo.getRef('refs/heads/new_name')).to.equal(head);
      expect(scene.repo.getRef('refs/heads/a')).to.equal('');
      expect(
        runBuiltCli(scene.repo.dir, ['down', '--no-interactive']).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('main');
    });

    it('Requires force for an associated PR and warns before removing the association', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand(['create', 'a', '-m', 'a']);
      const binDir = path.join(scene.repo.dir, '.git', 'rename-bin');
      fs.mkdirpSync(binDir);
      fs.writeFileSync(
        path.join(binDir, 'gh'),
        `#!${process.execPath}
if (process.argv[2] === 'pr' && process.argv[3] === 'view' && ['a', '17'].includes(process.argv[4])) {
  process.stdout.write(JSON.stringify({number: 17, headRefName: 'a', baseRefName: 'main', state: 'OPEN', title: 'Rename fixture', body: 'Fixture body', url: 'https://github.com/fixture/rename/pull/17', isDraft: false}));
} else {
  process.stderr.write('no pull requests found');
  process.exitCode = 1;
}
`,
        { mode: 0o755 }
      );
      const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
      for (const args of [
        ['user', 'tips', '--enable'],
        ['repo', 'owner', '--set', 'fixture'],
        ['repo', 'name', '--set', 'rename'],
        ['repo', 'github', '--enable'],
        [
          'sync',
          '--no-pull',
          '--no-delete',
          '--no-restack',
          '--no-interactive',
        ],
      ]) {
        const result = runBuiltCli(scene.repo.dir, args, env);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
      }
      expect(runBuiltCli(scene.repo.dir, ['info'], env).stdout).to.contain(
        'PR #17'
      );
      const refs = scene.repo.runGitCommandAndGetOutput([
        'show-ref',
        '--heads',
      ]);
      const head = scene.repo.getRef('refs/heads/a');
      const noOp = runBuiltCli(
        scene.repo.dir,
        ['rename', 'a', '--no-interactive'],
        env
      );
      expect(noOp.status, noOp.stdout + noOp.stderr).to.equal(0);

      const rejected = runBuiltCli(
        scene.repo.dir,
        ['rename', 'a1', '--no-interactive'],
        env
      );

      expect(rejected.status).to.equal(1);
      expect(rejected.stdout + rejected.stderr).to.contain(
        'requires the `--force` option'
      );
      expect(rejected.stdout + rejected.stderr).to.contain(
        'removes the association'
      );
      expect(scene.repo.currentBranchName()).to.equal('a');
      expect(
        scene.repo.runGitCommandAndGetOutput(['show-ref', '--heads'])
      ).to.equal(refs);
      expect(runBuiltCli(scene.repo.dir, ['info'], env).stdout).to.contain(
        'PR #17'
      );
      const forced = runBuiltCli(
        scene.repo.dir,
        ['rename', 'a1', '--force', '--no-interactive'],
        env
      );
      expect(forced.status, forced.stdout + forced.stderr).to.equal(0);
      expect(scene.repo.getRef('refs/heads/a')).to.equal('');
      expect(scene.repo.currentBranchName()).to.equal('a1');
      expect(scene.repo.getRef('refs/heads/a1')).to.equal(head);
      expect(runBuiltCli(scene.repo.dir, ['info'], env).stdout).not.to.contain(
        'PR #17'
      );
      expect(
        runBuiltCli(scene.repo.dir, ['down', '--no-interactive'], env).status
      ).to.equal(0);
      expect(scene.repo.currentBranchName()).to.equal('main');
    });
  });
}

function runBuiltCli(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const binary = process.env.CHARCOAL_TEST_BINARY;
  if (binary && !path.isAbsolute(binary)) {
    throw new Error('CHARCOAL_TEST_BINARY must be an absolute path');
  }
  return spawnSync(
    binary || process.execPath,
    binary ? args : [path.resolve(__dirname, '../../../src/index.js'), ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        GRAPHITE_DISABLE_TELEMETRY: '1',
        GRAPHITE_DISABLE_UPGRADE_PROMPT: '1',
        GRAPHITE_DISABLE_SURVEY: '1',
        GRAPHITE_PROFILE: '',
        ...env,
      },
    }
  );
}
