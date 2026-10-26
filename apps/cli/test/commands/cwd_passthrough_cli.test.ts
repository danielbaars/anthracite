import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('cwd Git passthrough through the public CLI', function () {
  this.timeout(120000);
  let start: CwdCliFixture;
  let target: CwdCliFixture;
  beforeEach(() => {
    start = new CwdCliFixture();
    target = new CwdCliFixture();
  });
  afterEach(() => {
    start.cleanup();
    target.cleanup();
  });

  it('preserves the literal --cwd filename after Git terminator with and without the global prefix', () => {
    for (const fixture of [start, target])
      fs.writeFileSync(path.join(fixture.repo, '--cwd'), 'literal cwd file');
    for (const [fixture, args] of [
      [start, ['add', '--', '--cwd']],
      [target, ['--cwd', target.repo, 'add', '--', '--cwd']],
    ] as const) {
      const result = start.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('Passing command through to git...');
      expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal(
        '--cwd'
      );
      expect(fixture.git(['show', ':--cwd'])).to.equal('literal cwd file');
    }
  });

  it('keeps the Git argument tail and its pipe channels and exit status equivalent to direct Git', () => {
    fs.writeFileSync(path.join(target.repo, 'target-only.txt'), 'target');
    const beforeStart = start.inspectionSnapshot();
    for (const args of [
      ['status', '--short'],
      ['status', '--cwd', start.repo],
      ['status', '--cwd=' + start.repo],
      ['add', '--no-cwd'],
      ['status', '-h'],
    ]) {
      const direct = spawnSync('git', args, {
        cwd: target.repo,
        env: target.env,
      });
      if (direct.error) throw direct.error;
      if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
        fs.appendFileSync(
          path.join(target.root, 'git.jsonl'),
          JSON.stringify({
            args,
            cwd: target.repo,
            status: direct.status,
            stdoutBase64: direct.stdout.toString('base64'),
            stderrBase64: direct.stderr.toString('base64'),
          }) + '\n'
        );
      for (const prefix of [
        [],
        ['--cwd', target.repo],
        ['--cwd=' + target.repo],
      ]) {
        const selected = start.run(
          [...prefix, ...args],
          prefix.length === 0 ? target.repo : start.repo
        );
        expect(selected.status, JSON.stringify(args)).to.equal(direct.status);
        expect(selected.stdout).to.equal(direct.stdout.toString('utf8'));
        expect(selected.stderr).to.equal(
          `Passing command through to git...\nRunning: "git ${args.join(
            ' '
          )}"\n\n` + direct.stderr.toString('utf8')
        );
      }
    }
    expect(start.inspectionSnapshot()).to.deep.equal(beforeStart);
  });

  it('passes original stdin bytes to Git and preserves its output on separate pipes', () => {
    const patch =
      'diff --git a/stream.txt b/stream.txt\nnew file mode 100644\n--- /dev/null\n+++ b/stream.txt\n@@ -0,0 +1 @@\n+payload --cwd=literal\n';
    const args = ['apply', '--stat', '-'];
    const direct = spawnSync('git', args, {
      cwd: target.repo,
      env: target.env,
      input: patch,
    });
    if (direct.error) throw direct.error;
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
      fs.appendFileSync(
        path.join(target.root, 'git.jsonl'),
        JSON.stringify({
          args,
          cwd: target.repo,
          status: direct.status,
          stdinBase64: Buffer.from(patch).toString('base64'),
          stdoutBase64: direct.stdout.toString('base64'),
          stderrBase64: direct.stderr.toString('base64'),
        }) + '\n'
      );
    const selected = start.run(
      ['--cwd', target.repo, ...args],
      start.repo,
      patch
    );
    expect(selected.status).to.equal(direct.status).and.to.equal(0);
    expect(selected.stdout).to.equal(direct.stdout.toString('utf8'));
    expect(selected.stderr).to.equal(
      `Passing command through to git...\nRunning: "git ${args.join(
        ' '
      )}"\n\n` + direct.stderr.toString('utf8')
    );
    expect(selected.stdout).to.include('stream.txt');

    expect(fs.existsSync(path.join(target.repo, 'stream.txt'))).to.equal(false);
  });

  it('stages only the relative file in the selected subdirectory and linked worktree index', () => {
    const nested = path.join(target.repo, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'same.txt'), 'nested target');
    fs.writeFileSync(path.join(target.repo, 'same.txt'), 'root target');
    fs.writeFileSync(path.join(start.repo, 'same.txt'), 'departure');
    const beforeStart = start.inspectionSnapshot();
    const staged = start.run(['--cwd', nested, 'add', 'same.txt']);
    expect(staged.status, staged.stdout + staged.stderr).to.equal(0);
    expect(target.git(['diff', '--cached', '--name-only'])).to.equal(
      'nested/same.txt'
    );
    expect(target.git(['show', ':nested/same.txt'])).to.equal('nested target');
    const linked = path.join(target.root, 'linked');
    target.git(['worktree', 'add', linked, 'other']);
    fs.writeFileSync(path.join(linked, 'same.txt'), 'linked target');
    const beforePrimaryIndex = target.inspectionSnapshot().index;
    const beforeLinkedIndex = target.inspectionSnapshot(linked).index;
    const linkedResult = start.run(['--cwd=' + linked, 'add', 'same.txt']);
    expect(
      linkedResult.status,
      linkedResult.stdout + linkedResult.stderr
    ).to.equal(0);
    expect(target.inspectionSnapshot().index).to.equal(beforePrimaryIndex);
    expect(target.inspectionSnapshot(linked).index).not.to.equal(
      beforeLinkedIndex
    );
    expect(target.git(['diff', '--cached', '--name-only'], linked)).to.equal(
      'same.txt'
    );
    expect(target.git(['show', ':same.txt'], linked)).to.equal('linked target');
    expect(start.inspectionSnapshot()).to.deep.equal(beforeStart);
  });

  it('clones a local bare remote from the selected non-Git directory without loading Anthracite configuration', () => {
    const bare = path.join(target.root, 'remote.git');
    target.git(['clone', '--bare', target.repo, bare], target.root);
    const destination = path.join(target.root, 'destination');
    fs.mkdirSync(destination);
    const beforeStart = start.inspectionSnapshot();
    const broken = path.join(start.root, 'broken-config');
    fs.writeFileSync(broken, 'not valid configuration');
    start.env.GRAPHITE_USER_CONFIG_PATH = broken;
    const result = start.run([
      '--cwd',
      destination,
      'clone',
      bare,
      'relative-clone',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    const clone = path.join(destination, 'relative-clone');
    expect(target.git(['rev-parse', 'HEAD'], clone)).to.equal(
      target.git(['rev-parse', 'HEAD'])
    );
    expect(fs.readFileSync(path.join(clone, 'base.txt'), 'utf8')).to.equal(
      'base'
    );
    expect(fs.existsSync(path.join(start.repo, 'relative-clone'))).to.equal(
      false
    );
    expect(fs.existsSync(path.join(destination, '.git'))).to.equal(false);
    expect(
      fs.existsSync(path.join(clone, '.git', '.graphite_repo_config'))
    ).to.equal(false);
    // Restore the observer's original user configuration identity.
    start.env.GRAPHITE_USER_CONFIG_PATH = path.join(start.root, 'user-config');
    expect(start.inspectionSnapshot()).to.deep.equal(beforeStart);
  });

  it('routes status in an uninitialized target without onboarding and does not exempt Git help from cwd validation', () => {
    const plain = path.join(target.root, 'plain');
    fs.mkdirSync(plain);
    target.git(['init', '--initial-branch=main'], plain);
    fs.writeFileSync(path.join(plain, 'only-plain.txt'), 'plain');
    const result = start.run(['--cwd=' + plain, 'status', '--short']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('?? only-plain.txt');
    expect(
      fs.existsSync(path.join(plain, '.git', '.graphite_repo_config'))
    ).to.equal(false);
    const missing = path.join(target.root, 'missing-git-help');
    const help = start.run(['--cwd', missing, 'status', '--help']);
    expect(help.status).to.equal(1);
    expect(help.stdout).to.equal('');
    expect(help.stderr).to.include('Cannot use --cwd');
    expect(fs.existsSync(missing)).to.equal(false);
  });

  it('keeps unsupported other-global prefixes from executing a guessed Git command', () => {
    fs.writeFileSync(path.join(start.repo, 'departure.txt'), 'departure');
    fs.writeFileSync(path.join(target.repo, 'target.txt'), 'target');
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    for (const prefix of [
      ['--quiet'],
      ['--no-interactive'],
      ['--cwd', target.repo, '--quiet'],
      ['--quiet', '--cwd', target.repo],
    ]) {
      const result = start.run([...prefix, 'add', '.']);
      expect(result.status, JSON.stringify(prefix)).not.to.equal(0);
      expect(result.stdout).not.to.include('Passing command through to git...');
    }
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });
});
