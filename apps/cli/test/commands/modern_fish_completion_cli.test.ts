import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// Fish is not installed: generated content and its public argv are the boundary.
// eslint-disable-next-line max-lines-per-function
describe('modern Fish completion through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  let departure: string;
  let selected: string;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    fixture.env.SHELL = '/usr/local/bin/fish';
    delete fixture.env.ZSH_NAME;
    departure = path.join(fixture.root, 'departure');
    selected = path.join(fixture.root, 'selected repo ü');
    fs.mkdirSync(departure);
    fixture.git(['init', '--initial-branch=departure-only'], departure);
    fixture.git(
      [
        '-c',
        'user.name=Completion fixture',
        '-c',
        'user.email=completion@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'departure',
      ],
      departure
    );
    fs.symlinkSync(fixture.repo, selected, 'dir');
    fixture.git(['branch', 'selected-only']);
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-fish-completion-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          root: fixture.root,
          selected,
          departure,
          shell: fixture.env.SHELL,
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture?.cleanup());

  function candidates(args: readonly string[]): string[] {
    const result = fixture.run(
      ['--get-yargs-completions', 'an', ...args],
      departure
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stderr).to.equal('');
    return result.stdout.trim().split('\n');
  }

  it('selects only remote get/g branches for Fish in prefix and suffix cwd while preserving other shells', () => {
    fixture.git(
      ['update-ref', 'refs/remotes/origin/departure-remote', 'HEAD'],
      departure
    );
    fixture.git([
      'update-ref',
      'refs/remotes/origin/remote-selected/ü',
      'HEAD',
    ]);
    fixture.git(['update-ref', 'refs/remotes/upstream/another-remote', 'HEAD']);
    const before = fixture.inspectionSnapshot(selected);
    const departureBefore = fixture.inspectionSnapshot(departure);
    for (const command of ['get', 'g']) {
      for (const args of [
        ['--cwd', selected, '--quiet', '--no-interactive', command, ''],
        [command, '--cwd', selected, '--quiet', '--no-interactive', 'remote'],
      ]) {
        expect(candidates(args), args.join(' ')).to.have.members([
          'remote-selected/ü',
          'another-remote',
        ]);
      }
      for (const shell of ['/bin/bash', '/bin/zsh', '']) {
        fixture.env.SHELL = shell;
        expect(candidates(['--cwd', selected, command, ''])).to.have.members([
          'main',
          'base',
          'child',
          'tip',
          'other',
          'selected-only',
        ]);
      }
      fixture.env.SHELL = '/usr/local/bin/fish';
    }
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(departure)).to.deep.equal(
      departureBefore
    );
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('completes local branch operands from the selected repository in both cwd positions without mutation or UI', () => {
    const before = fixture.inspectionSnapshot(selected);
    const departureBefore = fixture.inspectionSnapshot(departure);
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
    ]) {
      for (const args of [
        ['--cwd', selected, '--quiet', '--no-interactive', command, ''],
        [command, '--cwd', selected, '--quiet', '--no-interactive', 'selected'],
      ]) {
        expect(candidates(args), args.join(' ')).to.have.members([
          'main',
          'base',
          'child',
          'tip',
          'other',
          'selected-only',
        ]);
      }
    }
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(departure)).to.deep.equal(
      departureBefore
    );
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('refuses an inaccessible selected directory before external tools for Fish local and remote operands', () => {
    const before = fixture.inspectionSnapshot(selected);
    const departureBefore = fixture.inspectionSnapshot(departure);
    const restore = fixture.refuseExternalTools();
    try {
      for (const command of ['utr', 'get', 'g']) {
        const result = fixture.run(
          [
            '--get-yargs-completions',
            'an',
            '--cwd',
            path.join(fixture.root, 'missing repo ü'),
            '--quiet',
            '--no-interactive',
            command,
            '',
          ],
          departure
        );
        expect(result.status).not.to.equal(0);
        expect(result.stdout).to.equal('');
        expect(result.stderr).to.include('Cannot use --cwd directory');
      }
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(departure)).to.deep.equal(
      departureBefore
    );
  });

  it('keeps a relative cwd named like an alias separate from the root word and its operand', () => {
    fs.symlinkSync(fixture.repo, path.join(departure, 'utr'), 'dir');
    const before = fixture.inspectionSnapshot(selected);
    const departureBefore = fixture.inspectionSnapshot(departure);
    for (const cwdArgs of [['--cwd', 'utr'], ['--cwd=utr']]) {
      const roots = candidates([...cwdArgs, 'utr']);
      expect(roots).to.include('utr').and.include('ss');
      expect(roots).not.to.include('selected-only');
      expect(candidates([...cwdArgs, 'utr', ''])).to.have.members([
        'main',
        'base',
        'child',
        'tip',
        'other',
        'selected-only',
      ]);
    }
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(departure)).to.deep.equal(
      departureBefore
    );
  });

  it('keeps root aliases out of literal string values, nested commands and branch operands', () => {
    const before = fixture.inspectionSnapshot(selected);
    for (const args of [
      ['m', '--message', 'utr'],
      ['m', '--message', 'm'],
      ['m', '--message', 'm', '--message', 'm'],
      ['create', '--message', 'get', ''],
      ['repo', 's', ''],
      ['log', 'l', ''],
    ]) {
      const names = candidates(['--cwd', selected, ...args]);
      for (const rootAlias of ['co', 'ss', 'utr'])
        expect(names, args.join(' ')).not.to.include(rootAlias);
      expect(names, args.join(' ')).not.to.include('selected-only');
    }
    for (const current of ['', 'utr', 'ss'])
      expect(candidates(['--quiet', current]))
        .to.include('ss')
        .and.include('utr');
    expect(candidates(['']))
      .to.include('create')
      .and.include('modify');
    expect(candidates(['m', '--'])).to.include('--interactive-rebase');
    expect(candidates(['get', '--'])).to.include('--force');
    expect(
      candidates(['--cwd', selected, 'utr', '--branch', 'utr'])
    ).to.have.members([
      'main',
      'base',
      'child',
      'tip',
      'other',
      'selected-only',
    ]);
    expect(candidates(['--cwd', selected, 'mv', ''])).not.to.include(
      'selected-only'
    );
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('delegates complete tokens and a quoted current word to the existing protocol for selected branch candidates', () => {
    const before = fixture.inspectionSnapshot(selected);
    const generated = fixture.run(['fish', '--quiet'], departure);
    expect(generated.status, generated.stderr).to.equal(0);
    expect(generated.stderr).to.equal('');
    expect(generated.stdout).to.include('set -l tokens (commandline -opc)');
    expect(generated.stdout).to.include('set -l current (commandline -ct)');
    expect(generated.stdout).to.include(
      '$tokens[1] --get-yargs-completions $tokens "$current"'
    );
    expect(generated.stdout).not.to.include('command git');
    expect(generated.stdout).not.to.include('__fish_seen_subcommand_from');
    expect(generated.stdout).not.to.include('string replace');
    const names = candidates([
      '--cwd',
      selected,
      '--quiet',
      '--no-interactive',
      'utr',
      '',
    ]);
    expect(names).to.have.members([
      'main',
      'base',
      'child',
      'tip',
      'other',
      'selected-only',
    ]);
    expect(fixture.inspectionSnapshot(selected)).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });
});
