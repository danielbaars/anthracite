import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('cwd documentation grammar through the public CLI', function () {
  this.timeout(120000);
  let start: CwdCliFixture;
  let target: CwdCliFixture;
  beforeEach(() => {
    start = new CwdCliFixture();
    target = new CwdCliFixture();
    start.commit('only-start');
    target.commit('only-target');
  });
  afterEach(() => {
    start.cleanup();
    target.cleanup();
  });

  it('commits only staged B content and invokes only B hooks when help is explicitly false', () => {
    const startMarker = path.join(start.root, 'start-hook');
    const targetMarker = path.join(target.root, 'target-hook');
    for (const [fixture, marker, content] of [
      [start, startMarker, 'staged in A'],
      [target, targetMarker, 'staged in B'],
    ] as const) {
      fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), content);
      fixture.git(['add', 'selected.txt']);
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          marker
        )}, process.cwd());`,
        { mode: 0o755 }
      );
    }
    const before = start.inspectionSnapshot();
    const parent = target.git(['rev-parse', 'HEAD']);
    const selected = start.run([
      'create',
      'disabled-help',
      '--cwd',
      target.repo,
      '--help',
      'false',
      '--message=disabled documentation still selects B',
      '--no-interactive',
    ]);
    expect(selected.status, selected.stdout + selected.stderr).to.equal(0);
    expect(target.git(['branch', '--show-current'])).to.equal('disabled-help');
    expect(target.git(['rev-parse', 'HEAD^'])).to.equal(parent);
    expect(target.git(['show', 'HEAD:selected.txt'])).to.equal('staged in B');
    expect(fs.readFileSync(targetMarker, 'utf8')).to.equal(
      fs.realpathSync(target.repo)
    );
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
      fs.copyFileSync(
        targetMarker,
        path.join(
          process.env.CHARCOAL_TEST_EVIDENCE_DIR,
          path.basename(target.root) + '-documentation-target-hook'
        )
      );
    expect(fs.existsSync(startMarker)).to.equal(false);
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('selects B for disabled, negated and overridden documentation booleans', () => {
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    for (const flags of [
      ['--help', 'false'],
      ['--version', 'false'],
      ['--help=false'],
      ['--version=false'],
      ['--no-help'],
      ['--no-version'],
      ['--help', '--help=false'],
      ['--version', '--version=false'],
      ['--help', 'true', '--no-help'],
      ['--version=true', '--version', 'false'],
    ]) {
      const result = start.run([
        'info',
        '--cwd',
        target.repo,
        ...flags,
        '--no-interactive',
      ]);
      expect(result.status, JSON.stringify(flags) + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout))
        .to.include('only-target')
        .and.not.include('only-start');
    }
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('serves effective documentation forms without loading configuration or invoking external tools', () => {
    const missing = path.join(target.root, 'missing-docs');
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const restoreTools = start.refuseExternalTools();
    const original = start.env.GRAPHITE_USER_CONFIG_PATH;
    const broken = path.join(start.root, 'broken-docs-config');
    fs.writeFileSync(broken, 'must never parse this configuration');
    start.env.GRAPHITE_USER_CONFIG_PATH = broken;
    try {
      for (const args of [
        ['--help=true'],
        ['help'],
        ['help', '--no-interactive'],
        ['--help=true', '--', 'info'],
        ['help', '--', 'info'],
        ['info', '--help=true'],
        ['info', '--help', 'true'],
        ['info', '--no-help', '--help=true'],
        ['info', 'help'],
        ['info', '--stat', 'help'],
        ['l', 's', 'help'],
        ['repo', 'name', '--help=true'],
        ['create', 'never-created', '--help=true'],
        ['create', 'never-created', '--version=true'],
        ['info', '--help=false', '--version=true'],
        ['--version=true', '--no-get-yargs-completions=false'],
        ['--version=true', '--no-get-yargs-completions=true'],
        ['--version=true', '--no-get-yargs-completions.child=false'],
        ['--version=true', '--getYargsCompletions=false'],
      ]) {
        const result = start.run(['--cwd', missing, ...args], start.root);
        expect(result.status, JSON.stringify(args) + result.stderr).to.equal(0);
        expect(result.stderr).to.equal('');
        if (args.includes('--version=true'))
          expect(result.stdout).to.match(/^1\.0\.1\s*$/);
        else expect(result.stdout).to.include('--cwd');
        expect(
          fs.existsSync(path.join(start.root, 'unexpected-tool'))
        ).to.equal(false);
      }
    } finally {
      start.env.GRAPHITE_USER_CONFIG_PATH = original;
      restoreTools();
    }
    expect(fs.existsSync(missing)).to.equal(false);
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('rejects malformed cwd even alongside equals and positional documentation', () => {
    const missing = path.join(target.root, 'malformed-docs');
    const restoreTools = start.refuseExternalTools();
    try {
      for (const malformed of [
        ['--cwd='],
        ['--cwd', ''],
        ['--cwd', '--help=true'],
        ['--cwd', missing, '--cwd=' + missing],
        ['--no-cwd'],
      ]) {
        for (const args of [
          ['info', '--help=true'],
          ['--version=true'],
          ['info', 'help'],
        ]) {
          const result = start.run([...args, ...malformed]);
          expect(result.status, JSON.stringify({ args, malformed })).to.equal(
            1
          );
          expect(result.stdout).to.equal('');
          expect(result.stderr).to.include('--cwd');
        }
      }
      expect(fs.existsSync(path.join(start.root, 'unexpected-tool'))).to.equal(
        false
      );
    } finally {
      restoreTools();
    }
    expect(fs.existsSync(missing)).to.equal(false);
  });

  it('preserves literal string values and help-looking payload after the terminator', () => {
    const before = start.inspectionSnapshot();
    for (const value of ['help', '--help', '--version=true']) {
      const result = start.run([
        'repo',
        'name',
        '--set=' + value,
        '--cwd',
        target.repo,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(target.ok(['repo', 'name']))).to.include(value);
    }
    for (const payload of ['help', '--help=true', '--version=true']) {
      const ordinary = target.run(['info', '--no-interactive', '--', payload]);
      const selected = start.run([
        'info',
        '--cwd',
        target.repo,
        '--no-interactive',
        '--',
        payload,
      ]);
      expect(selected.status).to.equal(ordinary.status).and.not.equal(0);
      expect(selected.stdout).to.equal(ordinary.stdout);
      expect(selected.stderr).to.equal(ordinary.stderr);
      expect(selected.stderr).to.include('Could not find branch ' + payload);
    }
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });

  it('applies cwd before special completion rather than treating its output as documentation', () => {
    start.git(['branch', 'completion-only-A']);
    target.git(['branch', 'completion-only-B']);
    const missing = path.join(target.root, 'missing-completion');
    const before = start.inspectionSnapshot();
    for (const flags of [
      ['--get-yargs-completions'],
      ['--get-yargs-completions=false'],
      ['--no-get-yargs-completions'],
      ['--get-yargs-completions.child=false'],
      ['--no-get-yargs-completions.child'],
    ]) {
      const args = ['--version=true', ...flags, 'ch', 'checkout', ''];
      const ordinary = target.run(args);
      const selected = start.run(['--cwd', target.repo, ...args]);
      expect(ordinary.status, ordinary.stderr).to.equal(0);
      expect(selected.status, selected.stderr).to.equal(0);
      expect(selected.stdout).to.equal(ordinary.stdout);
      expect(selected.stdout)
        .to.include('completion-only-B')
        .and.not.include('completion-only-A')
        .and.not.include('1.0.1');
      const restoreTools = start.refuseExternalTools();
      try {
        const rejected = start.run(['--cwd', missing, ...args]);
        expect(rejected.status).to.equal(1);
        expect(rejected.stdout).to.equal('');
        expect(rejected.stderr).to.include('Cannot use --cwd');
        expect(
          fs.existsSync(path.join(start.root, 'unexpected-tool'))
        ).to.equal(false);
      } finally {
        restoreTools();
      }
    }
    const script = target.run(['completion', '--help=true']);
    const selected = start.run([
      '--cwd',
      target.repo,
      'completion',
      '--help=true',
    ]);
    expect(selected.status).to.equal(script.status).and.equal(0);
    expect(selected.stdout).to.equal(script.stdout).and.include('completions');
    const rejected = start.run(['--cwd', missing, 'completion', '--help=true']);
    expect(rejected.status).to.equal(1);
    expect(rejected.stdout).to.equal('');
    expect(rejected.stderr).to.include('Cannot use --cwd');
    expect(start.inspectionSnapshot()).to.deep.equal(before);
  });
});
