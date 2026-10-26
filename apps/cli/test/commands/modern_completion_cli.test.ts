import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

// Public completion output and independent Git/filesystem observations.
// eslint-disable-next-line max-lines-per-function
describe('modern completion through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    fixture.env.CH_PAGER = path.join(fixture.root, 'sentinel-bin', 'pager');
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-completion-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          root: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture?.cleanup());

  function candidates(args: readonly string[], cwd = fixture.root): string[] {
    const result = fixture.run(['--get-yargs-completions', 'an', ...args], cwd);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    return result.stdout
      .trim()
      .split('\n')
      .map((line) => line.split(':')[0]);
  }

  it('offers all twenty standard aliases and preserved legacy root names outside Git without tools', () => {
    const restore = fixture.refuseExternalTools();
    try {
      const names = candidates(['']);
      for (const name of [
        'c',
        'm',
        's',
        'ss',
        'co',
        'l',
        'ls',
        'll',
        'u',
        'd',
        't',
        'b',
        'rn',
        'dl',
        'sp',
        'sq',
        'r',
        'tr',
        'utr',
        'cont',
        'i',
        'g',
        'ro',
        'ut',
        'edit',
        'e',
      ])
        expect(names, name).to.include(name);
      expect(names).not.to.include('mv');
      expect(new Set(names).size).to.equal(names.length);
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
  });

  it('offers actual options for canonical and alias forms outside Git without tools', () => {
    const restore = fixture.refuseExternalTools();
    try {
      for (const [commands, option] of [
        [['create', 'c'], '--onto'],
        [['modify', 'm'], '--interactive-rebase'],
        [['submit', 's', 'ss'], '--stack'],
        [['log', 'l', 'ls'], '--classic'],
        [['ll'], '--quiet'],
        [['checkout', 'co'], '--show-untracked'],
        [['up', 'u', 'down', 'd'], '--steps'],
        [['top', 't', 'bottom', 'b'], '--quiet'],
        [['rename', 'rn', 'delete', 'dl', 'track', 'tr'], '--force'],
        [['split', 'sp'], '--by-commit'],
        [['squash', 'sq'], '--message'],
        [['restack', 'r'], '--only'],
        [['continue', 'cont'], '--quiet'],
        [['untrack', 'utr', 'ut'], '--quiet'],
      ])
        for (const command of commands)
          expect(candidates([command, '--']), command).to.include(option);
      expect(candidates(['auth', '--'])).not.to.include('--token');
      expect(candidates(['auth', '--'])).not.to.include('--t');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
  });

  it('completes local branch arguments with cwd spaces and preserves inspection state under quiet', () => {
    const selected = path.join(fixture.root, 'selected repo ü');
    fs.symlinkSync(fixture.repo, selected, 'dir');
    const before = fixture.inspectionSnapshot(selected);
    for (const command of [
      'checkout',
      'co',
      'delete',
      'dl',
      'track',
      'tr',
      'untrack',
      'utr',
      'ut',
      'move',
      'get',
      'g',
    ]) {
      const names = candidates(
        ['--cwd', selected, '--quiet', '--no-interactive', command, ''],
        fixture.root
      );
      for (const name of ['main', 'base', 'child', 'tip', 'other'])
        expect(names, command).to.include(name);
    }
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('refuses invalid completion cwd and policy values before external tools', () => {
    const before = fixture.inspectionSnapshot();
    const restore = fixture.refuseExternalTools();
    try {
      for (const args of [
        ['--cwd', path.join(fixture.root, 'absent'), 'co', ''],
        ['--cwd', fixture.repo, '--quiet=invalid', 'co', ''],
      ]) {
        const result = fixture.run(
          ['--get-yargs-completions', 'an', ...args],
          fixture.root
        );
        expect(result.status).not.to.equal(0);
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
      }
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('generates bash and zsh scripts executable without shell startup and preserves fish route content', () => {
    const before = fixture.inspectionSnapshot();
    for (const [shell, executable, startup] of [
      ['bash', '/bin/bash', '--noprofile'],
      ['zsh', '/bin/zsh', '-f'],
    ]) {
      fixture.env.SHELL = executable;
      delete fixture.env.ZSH_NAME;
      const generated = fixture.run(['completion'], fixture.root);
      expect(generated.status, generated.stderr).to.equal(0);
      expect(generated.stderr).to.equal('');
      expect(generated.stdout).to.include('--get-yargs-completions');
      const script = path.join(fixture.root, `${shell}-completion`);
      fs.writeFileSync(script, generated.stdout);
      const cli = getTestCliCommand([]);
      const quote = (value: string): string =>
        `'${value.replace(/'/g, "'\\''")}'`;
      const setup =
        shell === 'bash'
          ? 'source "$1"'
          : 'autoload -Uz compinit; compinit -D; source "$1"';
      const shellArgs = [
        ...(shell === 'bash' ? [startup, '--norc'] : [startup]),
        '-c',
        `${setup}; an() { ${cli.map(quote).join(' ')} "$@"; }; ${
          shell === 'bash'
            ? `COMP_WORDS=(an ''); COMP_CWORD=1; _an_yargs_completions; printf '%s\\n' "\${COMPREPLY[@]}"`
            : `_describe() { printf '%s\\n' "\${reply[@]}"; }; words=(an ''); CURRENT=2; BUFFER='an '; CURSOR=3; _an_yargs_completions`
        }`,
        'completion-smoke',
        script,
      ];
      const shellEnv: NodeJS.ProcessEnv = {
        ...fixture.env,
        HOME: fixture.root,
        ZDOTDIR: fixture.root,
      };
      delete shellEnv.BASH_ENV;
      delete shellEnv.ENV;
      const smoke = spawnSync(executable, shellArgs, {
        cwd: fixture.root,
        env: shellEnv,
        encoding: 'utf8',
        timeout: 20000,
      });
      const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
      if (evidence)
        fs.appendFileSync(
          path.join(evidence, 'shell-smoke.jsonl'),
          JSON.stringify({
            executable,
            args: shellArgs,
            cwd: fixture.root,
            environment: {
              HOME: shellEnv.HOME,
              ZDOTDIR: shellEnv.ZDOTDIR,
              SHELL: shellEnv.SHELL,
              PATH: shellEnv.PATH,
              BASH_ENV: null,
              ENV: null,
            },
            status: smoke.status,
            signal: smoke.signal,
            error: smoke.error?.message,
            stdoutBase64: Buffer.from(smoke.stdout ?? '').toString('base64'),
            stderrBase64: Buffer.from(smoke.stderr ?? '').toString('base64'),
          }) + '\n'
        );
      expect(
        smoke.status,
        smoke.error?.message ?? smoke.stdout + smoke.stderr
      ).to.equal(0);
      expect(smoke.stdout.split('\n').map((line) => line.split(':')[0]))
        .to.include('ss')
        .and.include('co')
        .and.include('freeze')
        .and.include('unfreeze');
      expect(smoke.stdout).not.to.include('internal-commit-guard');
      expect(smoke.stdout).not.to.include('internal-push-guard');
    }
    const fish = fixture.run(
      ['fish', '--quiet', '--no-interactive'],
      fixture.root
    );
    expect(fish.status, fish.stderr).to.equal(0);
    expect(fish.stderr).to.equal('');
    expect(fish.stdout).to.include(
      '$tokens[1] --get-yargs-completions $tokens "$current"'
    );
    // Fish now delegates selection/ownership to the CLI, including get/g remotes.
    expect(fish.stdout).to.include(
      'complete -c an -f -a "(__an_command_completions)"'
    );
    expect(fish.stdout).not.to.include('command git');
    expect(fish.stdout).not.to.include('__fish_seen_subcommand_from');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('prints truthful command help outside Git under quiet and cwd without tools or configuration changes', () => {
    const config = fs.readFileSync(fixture.env.GRAPHITE_USER_CONFIG_PATH ?? '');
    const restore = fixture.refuseExternalTools();
    try {
      for (const [command, fragments] of [
        ['create', ['--onto', 'selected parent']],
        ['c', ['--onto', 'selected parent']],
        ['rename', ['local association', 'not closed or deleted']],
        ['rn', ['local association']],
        ['submit', ['Create ready PRs', 'existing drafts', 'default to draft']],
        ['s', ['Create ready PRs']],
        ['ss', ['ancestors and descendants', 'submit --stack by default']],
        ['modify', ['--interactive-rebase']],
        ['m', ['--interactive-rebase']],
        ['log', ['--classic']],
        ['l', ['--classic']],
      ] as const) {
        const result = fixture.run(
          ['--cwd', fixture.root, '--quiet', command, '--help'],
          fixture.root
        );
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(result.stderr).to.equal('');
        const text = result.stdout.replace(/\s+/g, ' ');
        for (const fragment of fragments)
          expect(text, command).to.include(fragment);
      }
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
      expect(
        fs.readFileSync(fixture.env.GRAPHITE_USER_CONFIG_PATH ?? '')
      ).to.deep.equal(config);
    } finally {
      restore();
    }
  });

  it('keeps nested completion local to its registered group', () => {
    const restore = fixture.refuseExternalTools();
    try {
      const repo = candidates(['repo', '']);
      expect(repo).to.include('sync').and.include('init');
      expect(repo).not.to.include('ss');
      const log = candidates(['log', '']);
      expect(log).to.include('short').and.include('long');
      expect(log).not.to.include('co');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
  });
});
