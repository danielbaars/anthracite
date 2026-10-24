import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { preparePublicPrRemote } from '../lib/fixtures/public_pr';
import { readSubmitPrs } from '../lib/fixtures/submit_gh';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

const statLines = (output: string): readonly string[] =>
  stripAnsi(output)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => / \| |\bfiles? changed\b/.test(line));

// eslint-disable-next-line max-lines-per-function
describe('cwd read-only inspection through the public CLI', function () {
  this.timeout(120000);
  let start: CwdCliFixture;
  let target: CwdCliFixture;
  let linked: string;
  beforeEach(() => {
    start = new CwdCliFixture();
    target = new CwdCliFixture();
    start.git(['switch', 'other']);
    target.git(['switch', 'other']);
    start.commit('departure-only');
    target.commit('destination-only');
    target.git(['branch', '-m', 'main', 'destination-trunk']);
    target.ok(['init', '--trunk', 'destination-trunk', '--reset']);
    for (const [branch, parent] of [
      ['base', 'destination-trunk'],
      ['child', 'base'],
      ['tip', 'child'],
      ['other', 'destination-trunk'],
    ])
      target.ok(['track', branch, '--parent', parent]);
    linked = path.join(target.root, 'linked');
  });
  afterEach(() => {
    for (const fixture of [start, target]) {
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
      fixture.cleanup();
    }
  });

  function snapshots(): readonly Record<string, unknown>[] {
    const observe = (
      fixture: CwdCliFixture,
      cwd = fixture.repo
    ): Record<string, unknown> => {
      const override = start.env.GRAPHITE_USER_CONFIG_PATH;
      const selectedConfig = override ? path.resolve(cwd, override) : undefined;
      return {
        ...fixture.inspectionSnapshot(cwd),
        invocationUserConfig: selectedConfig
          ? {
              path: selectedConfig,
              bytes: fs.existsSync(selectedConfig)
                ? fs.readFileSync(selectedConfig).toString('base64')
                : null,
            }
          : null,
      };
    };
    const observations = [
      observe(start),
      observe(target),
      ...(fs.existsSync(linked) ? [observe(target, linked)] : []),
    ];
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'cwd-selected-config-observations.jsonl'),
        JSON.stringify(
          observations.map((entry) => entry.invocationUserConfig)
        ) + '\n'
      );
    return observations;
  }

  function inspect(args: readonly string[], directory = target.repo): string {
    const before = snapshots();
    const result = start.run(['--cwd', directory, ...args, '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    expect(snapshots()).to.deep.equal(before);
    return stripAnsi(result.stdout);
  }

  function dirty(fixture: CwdCliFixture, cwd = fixture.repo): void {
    fs.writeFileSync(path.join(cwd, 'base.txt'), 'staged\n');
    fixture.git(['add', 'base.txt'], cwd);
    fs.writeFileSync(path.join(cwd, 'base.txt'), 'unstaged\n');
    fs.writeFileSync(
      path.join(cwd, 'untracked.bin'),
      Buffer.from([0, 255, 13])
    );
    fs.symlinkSync('untracked.bin', path.join(cwd, 'untracked-link'));
    const common = path.resolve(
      cwd,
      fixture.git(['rev-parse', '--git-common-dir'], cwd)
    );
    fs.appendFileSync(path.join(common, 'info', 'exclude'), '\nignored.bin\n');
    fs.writeFileSync(path.join(cwd, 'ignored.bin'), Buffer.from([255, 0, 10]));
    const stable = path.join(cwd, 'main.txt');
    const previous = fs.statSync(stable);
    fs.utimesSync(stable, previous.atime, new Date(previous.mtimeMs + 10000));
  }

  it('reads target content, Git statistics and relations rather than matching departure branch names', () => {
    expect(inspect(['parent'])).to.equal('destination-trunk\n');
    expect(start.ok(['parent'])).to.equal('main\n');
    target.branch('destination-child', 'other');
    target.git(['switch', 'other']);
    expect(inspect(['children'])).to.equal('destination-child\n');
    expect(start.ok(['children'])).to.equal('');
    const expected = statLines(
      target.git(['diff', '--stat', 'destination-trunk', 'other'])
    );
    const output = inspect(['info', '--branch=other', '--diff', '--stat']);
    expect(output)
      .to.include('Parent: destination-trunk')
      .and.include('destination-only')
      .and.not.include('departure-only');
    expect(statLines(output)).to.deep.equal(expected);
    expect(statLines(start.ok(['info', '--diff', '--stat']))).not.to.deep.equal(
      expected
    );
  });
  it('preserves both dirty repositories and a linked worktree, including opaque damaged and missing auxiliary stores', () => {
    target.git(['worktree', 'add', linked, 'child']);
    dirty(start);
    dirty(target);
    dirty(target, linked);
    const common = path.resolve(
      target.repo,
      target.git(['rev-parse', '--git-common-dir'])
    );
    for (const name of ['.graphite_cache_persist', '.graphite_cache_lock'])
      fs.writeFileSync(
        path.join(common, name),
        Buffer.from([255, 0, 123, 13, 10])
      );
    for (const hook of ['post-checkout', 'post-rewrite', 'pre-commit'])
      fs.writeFileSync(
        path.join(common, 'hooks', hook),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          path.join(target.root, 'unexpected-tool')
        )}, 'hook');`,
        { mode: 0o755 }
      );
    expect(inspect(['parent'])).to.equal('destination-trunk\n');
    expect(inspect(['parent'], linked)).to.equal('base\n');
    expect(inspect(['children'], linked)).to.equal('tip\n');
    expect(inspect(['info', '--stat', '--body'], linked))
      .to.match(/^child\s/)
      .and.include('child.txt');
    expect(inspect(['info', '--branch=other', '--stat'], linked))
      .to.include('destination-only')
      .and.not.include('departure-only');
    expect(fs.existsSync(path.join(common, '.graphite_pr_info'))).to.equal(
      false
    );
    for (const name of ['.graphite_cache_persist', '.graphite_cache_lock'])
      fs.unlinkSync(path.join(common, name));
    inspect(['info', '--stat'], linked);
    for (const name of ['.graphite_cache_persist', '.graphite_cache_lock'])
      expect(fs.existsSync(path.join(common, name))).to.equal(false);
    for (const name of ['.gtcontinue', '.graphite_pr_info']) {
      const file = path.join(common, name);
      fs.writeFileSync(file, Buffer.from([255, 0, 123]));
      const before = snapshots();
      for (const command of ['info', 'parent', 'children']) {
        const direct = target.run([command, '--no-interactive']);
        const selected = start.run([
          command,
          '--cwd',
          target.repo,
          '--no-interactive',
        ]);
        expect(selected.status, name).to.equal(direct.status);
        expect(selected.stderr, name).to.equal(direct.stderr);
        if (selected.status !== 0) expect(selected.stdout, name).to.equal('');
        expect(snapshots(), name).to.deep.equal(before);
      }
      fs.unlinkSync(file);
    }
  });

  it('resolves relative user configuration at the target, retains absolute overrides and preserves environment identity', () => {
    const relative = 'selected-config';
    const startConfig = path.join(start.repo, relative);
    const targetConfig = path.join(target.repo, relative);
    fs.writeFileSync(startConfig, JSON.stringify({ tips: false }));
    fs.writeFileSync(targetConfig, JSON.stringify({ tips: true }));
    const originalConfig = start.env.GRAPHITE_USER_CONFIG_PATH;
    start.env.GRAPHITE_USER_CONFIG_PATH = relative;
    start.env.GRAPHITE_PROFILE = 'cwd-inspection-profile';
    const identity = Object.fromEntries(
      [
        'HOME',
        'CODEX_HOME',
        'GRAPHITE_PROFILE',
        'XDG_CONFIG_HOME',
        'GH_CONFIG_DIR',
      ].map((key) => [key, start.env[key]])
    );
    const configBytes = (): readonly string[] =>
      [startConfig, targetConfig].map((file) =>
        fs.readFileSync(file).toString('base64')
      );
    const before = snapshots();
    const beforeConfig = configBytes();
    try {
      expect(start.ok(['user', 'tips'])).to.equal('tips disabled\n');
      const selected = start.run([
        '--cwd',
        target.repo,
        'user',
        'tips',
        '--no-interactive',
      ]);
      expect(selected.status, selected.stderr).to.equal(0);
      expect(selected.stdout).to.equal('tips enabled\n');
      expect(inspect(['info', '--stat'])).to.include('destination-only');
      expect(configBytes()).to.deep.equal(beforeConfig);
      expect(snapshots()).to.deep.equal(before);
      start.env.GRAPHITE_USER_CONFIG_PATH = startConfig;
      expect(inspect(['user', 'tips'])).to.equal('tips disabled\n');
      expect(configBytes()).to.deep.equal(beforeConfig);
      expect(
        Object.fromEntries(
          Object.keys(identity).map((key) => [key, start.env[key]])
        )
      ).to.deep.equal(identity);
      expect(start.env.HOME).to.equal(process.env.HOME);
      expect(start.env.CODEX_HOME).to.equal(process.env.CODEX_HOME);
    } finally {
      start.env.GRAPHITE_USER_CONFIG_PATH = originalConfig;
    }
  });

  it('keeps invalid target user configuration untouched instead of accepting the departure configuration', () => {
    const relative = 'selected-config';
    fs.writeFileSync(
      path.join(start.repo, relative),
      JSON.stringify({ tips: false })
    );
    const invalid = path.join(target.repo, relative);
    fs.writeFileSync(invalid, Buffer.from([255, 0, 123]));
    const original = start.env.GRAPHITE_USER_CONFIG_PATH;
    start.env.GRAPHITE_USER_CONFIG_PATH = relative;
    const before = snapshots();
    try {
      expect(start.ok(['info'])).to.include('departure-only');
      const selected = start.run([
        'info',
        '--cwd',
        target.repo,
        '--no-interactive',
      ]);
      expect(selected.status).to.equal(1);
      expect(selected.stdout).to.equal('');
      expect(selected.stderr).to.include('Malformed data at selected-config');
      expect(fs.readFileSync(invalid)).to.deep.equal(
        Buffer.from([255, 0, 123])
      );
      expect(snapshots()).to.deep.equal(before);
    } finally {
      start.env.GRAPHITE_USER_CONFIG_PATH = original;
    }
  });

  it('refuses uninitialized and invalid subject targets without onboarding, repair or fallback', () => {
    const uninitialized = path.join(target.root, 'uninitialized');
    fs.mkdirSync(uninitialized);
    target.git(['init', '--initial-branch=raw-trunk'], uninitialized);
    target.git(['config', 'user.name', 'Cwd fixture'], uninitialized);
    target.git(['config', 'user.email', 'cwd@example.test'], uninitialized);
    target.git(
      [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        'raw target',
      ],
      uninitialized
    );
    const before = [...snapshots(), target.inspectionSnapshot(uninitialized)];
    for (const command of ['info', 'parent', 'children']) {
      const result = start.run([
        command,
        '--cwd',
        uninitialized,
        '--no-interactive',
      ]);
      expect(result.status, command).to.equal(1);
      expect(result.stdout, command).to.equal('');
      expect(result.stderr, command).to.include('initialized repository');
      expect(
        [...snapshots(), target.inspectionSnapshot(uninitialized)],
        command
      ).to.deep.equal(before);
    }
    target.git(['checkout', '--detach']);
    const detached = snapshots();
    for (const command of ['info', 'parent', 'children']) {
      const result = start.run([
        command,
        '--cwd',
        target.repo,
        '--no-interactive',
      ]);
      expect(result.status, command).to.equal(1);
      expect(result.stdout, command).to.equal('');
      expect(result.stderr, command).to.include('without a branch checked out');
      expect(snapshots(), command).to.deep.equal(detached);
    }
  });

  it('shows only locally submitted target PR body and statistics without querying either external adapter', () => {
    const startRemote = preparePublicPrRemote(start);
    const targetRemote = preparePublicPrRemote(target, 'destination-trunk');
    for (const [fixture, remote, label] of [
      [start, startRemote, 'departure'],
      [target, targetRemote, 'destination'],
    ] as const) {
      fixture.ok(['submit', '--publish']);
      fs.writeFileSync(
        remote.state,
        JSON.stringify(
          readSubmitPrs(remote.state).map((pr) => ({
            ...pr,
            title: `${label} PR title`,
            body: `${label} PR body`,
          }))
        )
      );
      fixture.ok(['sync', '--no-pull', '--no-delete', '--no-restack']);
      remote.refuseQueries();
    }
    const externalBefore = [startRemote, targetRemote].map((remote) =>
      fs.readFileSync(remote.state).toString('base64')
    );
    expect(stripAnsi(start.ok(['info', '--body'])))
      .to.include('departure PR title')
      .and.include('departure PR body')
      .and.not.include('destination PR body');
    for (const flags of [
      ['--body'],
      ['--body', '--stat'],
      ['--body', '--diff', '--stat'],
    ]) {
      const output = inspect(['info', '--branch=other', ...flags]);
      expect(output)
        .to.include('destination PR title')
        .and.include('destination PR body')
        .and.not.include('departure PR body')
        .and.not.include('departure-only');
      if (flags.includes('--stat'))
        expect(statLines(output)).to.deep.equal(
          statLines(
            target.git(['diff', '--stat', 'destination-trunk', 'other'])
          )
        );
    }
    for (const [label, remote] of [
      ['departure', startRemote],
      ['destination', targetRemote],
    ] as const) {
      expect(fs.readFileSync(remote.calls, 'utf8')).to.equal('');
      const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
      if (evidence)
        for (const [name, file] of [
          ['prs.json', remote.state],
          ['calls.jsonl', remote.calls],
        ])
          fs.copyFileSync(file, path.join(evidence, `${label}-${name}`));
    }
    expect(
      [startRemote, targetRemote].map((remote) =>
        fs.readFileSync(remote.state).toString('base64')
      )
    ).to.deep.equal(externalBefore);
  });

  it('keeps target quiet, no-interactive and actual terminal pager behavior with inherited environment', () => {
    const pager = path.join(start.root, 'target-pager.js');
    const receipt = path.join(start.root, 'target-pager.json');
    fs.writeFileSync(
      pager,
      `const fs=require('fs');fs.writeFileSync(${JSON.stringify(
        receipt
      )},JSON.stringify({cwd:process.cwd(),home:process.env.HOME,codexHome:process.env.CODEX_HOME??null,profile:process.env.GRAPHITE_PROFILE,input:fs.readFileSync(0).toString('base64')}));process.stdout.write('TARGET_PAGER\\n');`
    );
    start.env.CH_PAGER = `'${process.execPath}' '${pager}'`;
    start.env.GRAPHITE_PROFILE = 'inherited-profile';
    const before = snapshots();
    for (const flags of [
      ['--quiet', '--interactive'],
      ['--quiet', '--no-interactive'],
    ]) {
      const result = start.run([
        '--cwd',
        target.repo,
        'info',
        '--stat',
        ...flags,
      ]);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.equal('');
    }
    expect(inspect(['info', '--stat'])).to.include('destination-only');
    expect(fs.existsSync(receipt)).to.equal(false);
    const command = getTestCliCommand([
      '--cwd',
      target.repo,
      'info',
      '--stat',
      '--interactive',
    ]);
    const result = runCliInPty(command, { cwd: start.repo, env: start.env });
    start.savePty(result);
    const terminalEvidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (terminalEvidence)
      fs.appendFileSync(
        path.join(terminalEvidence, 'cwd-info-pager-pty.jsonl'),
        JSON.stringify({
          command,
          cwd: start.repo,
          environment: Object.fromEntries(
            [
              'HOME',
              'CODEX_HOME',
              'GRAPHITE_PROFILE',
              'GRAPHITE_USER_CONFIG_PATH',
              'XDG_CONFIG_HOME',
              'GH_CONFIG_DIR',
              'CH_PAGER',
            ].map((key) => [key, start.env[key] ?? null])
          ),
          result,
        }) + '\n'
      );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('TARGET_PAGER');
    const observed: unknown = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (!observed || typeof observed !== 'object')
      throw new Error('Missing pager receipt');
    const input: unknown = Object.getOwnPropertyDescriptor(
      observed,
      'input'
    )?.value;
    if (typeof input !== 'string') throw new Error('Missing pager input');
    expect(Buffer.from(input, 'base64').toString('utf8'))
      .to.include('destination-only')
      .and.not.include('departure-only');
    expect(observed).to.deep.equal({
      cwd: fs.realpathSync(target.repo),
      home: start.env.HOME,
      codexHome: start.env.CODEX_HOME ?? null,
      profile: 'inherited-profile',
      input,
    });
    expect(snapshots()).to.deep.equal(before);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.copyFileSync(
        receipt,
        path.join(evidence, `${path.basename(start.root)}-pager.json`)
      );
  });
});
