import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('modern interactive branch rebase through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.env.CH_PAGER = '';
    fixture.git(['status', '--porcelain']);
  });
  afterEach(function () {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-rebase-cases.jsonl'),
        JSON.stringify({
          case: this.currentTest?.fullTitle(),
          fixture: fixture.root,
          environment: Object.fromEntries(
            [
              'GIT_SEQUENCE_EDITOR',
              'GIT_EDITOR',
              'CH_EDITOR',
              'CH_PAGER',
              'GRAPHITE_USER_CONFIG_PATH',
              'GRAPHITE_INTERACTIVE',
              'HOME',
              'PATH',
              'GIT_CONFIG_NOSYSTEM',
              'GIT_CONFIG_GLOBAL',
              'CHARCOAL_TEST_BINARY',
            ].map((key) => [key, fixture.env[key] ?? null])
          ),
          tools: Object.fromEntries(
            [
              'sequence-input',
              'sequence-editor',
              'message-editor',
              'hook-called',
            ].map((name) => {
              const file = path.join(fixture.root, name);
              return [
                name,
                fs.existsSync(file)
                  ? fs.readFileSync(file).toString('base64')
                  : null,
              ];
            })
          ),
        }) + '\n'
      );
    }
    fixture?.cleanup();
  });

  function script(name: string, contents: string): string {
    const file = path.join(fixture.root, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${contents}`, {
      mode: 0o755,
    });
    return file;
  }

  function reword(): void {
    fixture.env.GIT_SEQUENCE_EDITOR = script(
      'sequence-editor',
      `const fs = require('fs'); const file = process.argv[2]; const text = fs.readFileSync(file, 'utf8'); fs.writeFileSync(${JSON.stringify(
        path.join(fixture.root, 'sequence-input')
      )}, text); fs.writeFileSync(file, text.replace(/^pick /m, 'reword '));`
    );
    fixture.env.GIT_EDITOR = script(
      'message-editor',
      `require('fs').writeFileSync(process.argv[2], 'actually rewritten base\\n');`
    );
  }

  function state(cwd = fixture.repo): Record<string, unknown> {
    const snapshot = fixture.inspectionSnapshot(cwd);
    return Object.fromEntries(
      [
        'head',
        'branch',
        'refs',
        'index',
        'staging',
        'status',
        'files',
        'operation',
      ].map((name) => [name, snapshot[name]])
    );
  }

  it('refuses legacy edit before rewriting current history when a descendant is in another worktree', () => {
    reword();
    const linked = path.join(fixture.root, 'linked child');
    fixture.git(['worktree', 'add', linked, 'child']);
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked staged');
    fixture.git(['add', 'child.txt'], linked);
    fs.appendFileSync(path.join(linked, 'child.txt'), '\nlinked work');
    fs.writeFileSync(path.join(linked, 'untracked.txt'), 'linked untracked');
    fixture.git(['status', '--porcelain'], linked);
    const before = state();
    const linkedBefore = state(linked);
    const result = fixture.run(['edit', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('child').and.include('worktree');
    expect(state()).to.deep.equal(before);
    expect(state(linked)).to.deep.equal(linkedBefore);
    expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
      false
    );
    expect(fixture.parent('base')).to.equal('main');
  });

  for (const command of ['modify', 'm'])
    it(`rewrites only the current branch through ${command} and restacks descendants`, () => {
      reword();
      const base = fixture.git(['rev-parse', 'base']);
      const main = fixture.git(['rev-parse', 'main']);
      const other = fixture.git(['rev-parse', 'other']);
      const trees = ['base', 'child', 'tip'].map((name) =>
        fixture.git(['rev-parse', `${name}^{tree}`])
      );
      const result = fixture.run([
        command,
        '--interactive-rebase',
        '--interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
        'actually rewritten base'
      );
      expect(fixture.git(['rev-parse', 'base'])).not.to.equal(base);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(
        ['base', 'child', 'tip'].map((name) =>
          fixture.git(['rev-parse', `${name}^{tree}`])
        )
      ).to.deep.equal(trees);
      expect(fixture.git(['merge-base', 'base', 'child'])).to.equal(
        fixture.git(['rev-parse', 'base'])
      );
      expect(fixture.git(['merge-base', 'child', 'tip'])).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(fixture.parent('base')).to.equal('main');
      expect(fixture.parent('child')).to.equal('base');
      expect(fixture.parent('tip')).to.equal('child');
      const offered = fs.readFileSync(
        path.join(fixture.root, 'sequence-input'),
        'utf8'
      );
      expect(offered.match(/^pick /gm)).to.have.length(1);
      expect(offered).to.match(/^pick [a-f0-9]+ (?:# )?base$/m);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
    });

  it('chooses interactive rebase before every ordinary modify operation option', () => {
    reword();
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.txt'),
      'keep untracked'
    );
    const result = fixture.run([
      'm',
      '--interactive-rebase=true',
      '--commit',
      '--all',
      '--patch',
      '--message',
      'must not become a commit message',
      '--edit',
      '--no-edit',
      '--interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('1');
    expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
      'actually rewritten base'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('?? untracked.txt');
    expect(fixture.git(['ls-files', 'untracked.txt'])).to.equal('');
  });

  for (const flags of [
    ['--interactive-rebase=false'],
    ['--no-interactive-rebase'],
    ['--interactive-rebase', '--no-interactive-rebase'],
  ])
    it(`retains ordinary modify when the effective selector is false: ${flags.join(
      ' '
    )}`, () => {
      reword();
      const result = fixture.run([
        'm',
        ...flags,
        '--message',
        'ordinary amend',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
        'ordinary amend'
      );
      expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('1');
      expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
        false
      );
    });

  it('uses the last true selector after an explicit false', () => {
    reword();
    const result = fixture.run([
      'm',
      '--no-interactive-rebase',
      '--interactive-rebase',
      '--interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
      'actually rewritten base'
    );
  });

  for (const args of [
    ['modify', '--interactive-rebase'],
    ['m', '--interactive-rebase', '--no-interactive'],
    ['m', '--interactive-rebase', '--interactive', '--quiet'],
    ['e', '--interactive', '--quiet'],
  ])
    it(`refuses an unavailable editor without mutations: ${args.join(
      ' '
    )}`, () => {
      reword();
      const before = state();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.match(/editor|interactive/i);
      expect(state()).to.deep.equal(before);
      expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
        false
      );
    });

  for (const command of ['m', 'e'])
    it(`guards both worktrees and dirty work before the ${command} editor`, () => {
      reword();
      const linked = path.join(fixture.root, 'linked');
      fixture.git(['worktree', 'add', linked, 'child']);
      for (const cwd of [fixture.repo, linked]) {
        fs.writeFileSync(path.join(cwd, 'main.txt'), 'staged');
        fixture.git(['add', 'main.txt'], cwd);
        fs.appendFileSync(path.join(cwd, 'main.txt'), '\nunstaged');
        fs.writeFileSync(path.join(cwd, 'untracked.txt'), 'untracked');
        fixture.git(['status', '--porcelain'], cwd);
      }
      const before = state();
      const linkedBefore = state(linked);
      const result = fixture.run([
        command,
        ...(command === 'm' ? ['--interactive-rebase'] : []),
        '--interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('child').and.include('worktree');
      expect(state()).to.deep.equal(before);
      expect(state(linked)).to.deep.equal(linkedBefore);
      expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
        false
      );
    });

  it('retains dirty staged and unstaged work rather than staging or stashing it', () => {
    reword();
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged');
    fixture.git(['add', 'main.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'main.txt'), '\nunstaged');
    fs.writeFileSync(path.join(fixture.repo, 'untracked.txt'), 'untracked');
    fixture.git(['status', '--porcelain']);
    const before = state();
    const result = fixture.run([
      'm',
      '--interactive-rebase',
      '--all',
      '--patch',
      '--interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.match(/unstaged|index|changes/i);
    expect(state()).to.deep.equal(before);
    expect(fixture.git(['stash', 'list'])).to.equal('');
    expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
      false
    );
  });

  it('applies a sequence editor with terminal defaults', () => {
    reword();
    const result = runCliInPty(
      getTestCliCommand(['m', '--interactive-rebase']),
      {
        cwd: fixture.repo,
        env: fixture.env,
      }
    );
    fixture.savePty(result);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
      'actually rewritten base'
    );
  });

  it('refuses a failed sequence editor without changing public history', () => {
    fixture.env.GIT_SEQUENCE_EDITOR = script(
      'sequence-editor',
      'process.exitCode = 17;'
    );
    const before = state();
    const result = fixture.run(['m', '--interactive-rebase', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.match(/editor|failed|error/i);
    expect(state()).to.deep.equal(before);
  });

  it('retains existing Git rebase hook semantics even with no-verify', () => {
    reword();
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-rebase'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        path.join(fixture.root, 'hook-called')
      )}, 'pre-rebase');process.exitCode=19;`,
      { mode: 0o755 }
    );
    const before = state();
    const result = fixture.run([
      'm',
      '--interactive-rebase',
      '--interactive',
      '--no-verify',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(
      fs.readFileSync(path.join(fixture.root, 'hook-called'), 'utf8')
    ).to.equal('pre-rebase');
    expect(state()).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
      false
    );
  });

  it('documents the selector and exposes it through public completion', () => {
    for (const command of ['modify', 'm']) {
      const help = fixture.run([command, '--help', '--quiet'], fixture.root);
      expect(help.status, help.stdout + help.stderr).to.equal(0);
      expect(help.stdout)
        .to.include('--interactive-rebase')
        .and.include('Ignores other modify');
      const completion = fixture.run([
        '--get-yargs-completions',
        'ch',
        command,
        '--',
      ]);
      expect(completion.status, completion.stdout + completion.stderr).to.equal(
        0
      );
      expect(
        completion.stdout.split('\n').map((line) => line.split(':')[0])
      ).to.include('--interactive-rebase');
    }
  });

  function conflictingOrder(): void {
    for (const [contents, subject] of [
      ['first', 'first change'],
      ['second', 'second change'],
    ]) {
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
      fixture.git(['add', 'main.txt']);
      fixture.git(['commit', '-m', subject]);
    }
    fixture.ok(['restack', '--upstack']);
    fixture.env.GIT_SEQUENCE_EDITOR = script(
      'sequence-editor',
      `const fs=require('fs'); const file=process.argv[2]; const text=fs.readFileSync(file,'utf8'); fs.writeFileSync(${JSON.stringify(
        path.join(fixture.root, 'sequence-input')
      )},text); const lines=text.split('\\n');const picks=lines.filter(line=>/^pick /.test(line)); if(picks.length!==3)throw new Error('expected three branch commits');fs.writeFileSync(file,[picks[0],picks[2],picks[1],...lines.filter(line=>!/^pick /.test(line))].join('\\n'));`
    );
    fixture.env.GIT_EDITOR = 'true';
  }

  for (const continuation of ['continue', 'cont'])
    it(`resolves a real interactive conflict in fresh ${continuation} processes`, () => {
      conflictingOrder();
      const other = fixture.git(['rev-parse', 'other']);
      const stopped = fixture.run([
        'm',
        '--interactive-rebase',
        '--interactive',
        '--quiet',
      ]);
      // Quiet must prevent even the first editor; the same prepared fixture is still intact.
      expect(stopped.status).to.equal(1);
      expect(stopped.stderr).to.match(/editor|interactive/i);
      expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
        false
      );
      const initial = fixture.run([
        'm',
        '--interactive-rebase',
        '--interactive',
      ]);
      expect(initial.status, initial.stdout + initial.stderr).to.equal(1);
      expect(initial.stderr).to.match(/conflict|continue/i);
      expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
      const unresolvedHead = fixture.git(['rev-parse', 'HEAD']);
      const unresolved = fixture.run([continuation, '--quiet']);
      expect(unresolved.status, unresolved.stdout + unresolved.stderr).to.equal(
        1
      );
      expect(unresolved.stdout).to.equal('');
      expect(unresolved.stderr).to.match(/conflict|resolve/i);
      expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(unresolvedHead);
      expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'resolved second');
      fixture.git(['add', 'main.txt']);
      const second = fixture.run([continuation, '--no-interactive']);
      expect(second.status, second.stdout + second.stderr).to.equal(1);
      expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'resolved final');
      fixture.git(['add', 'main.txt']);
      const done = fixture.run([continuation, '--no-interactive']);
      expect(done.status, done.stdout + done.stderr).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
      ).to.equal('base\nsecond change\nfirst change');
      for (const name of ['base', 'child', 'tip'])
        expect(fixture.git(['show', `${name}:main.txt`])).to.equal(
          'resolved final'
        );
      expect(fixture.git(['merge-base', 'base', 'child'])).to.equal(
        fixture.git(['rev-parse', 'base'])
      );
      expect(fixture.git(['merge-base', 'child', 'tip'])).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fixture.inspectionSnapshot().operation).to.deep.equal({
        'rebase-merge': null,
        'rebase-apply': null,
      });
    });

  it('supports the existing bounded Git abort without claiming metadata rollback', () => {
    conflictingOrder();
    const refs = fixture.refs();
    const before = state();
    const initial = fixture.run(['m', '--interactive-rebase', '--interactive']);
    expect(initial.status, initial.stdout + initial.stderr).to.equal(1);
    const abort = fixture.run(['rebase', '--abort']);
    expect(abort.status, abort.stdout + abort.stderr).to.equal(0);
    expect(fixture.refs()).to.equal(refs);
    expect({ ...state(), index: null }).to.deep.equal({
      ...before,
      index: null,
    });
    const later = fixture.run(['cont', '--no-interactive']);
    expect(later.status).to.equal(1);
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('reports a cancelled sequence editor without history changes and permits Git abort', () => {
    fixture.env.GIT_SEQUENCE_EDITOR = script(
      'sequence-editor',
      "process.stdout.write('Controlled sequence editor ready');setInterval(()=>{},1000);"
    );
    const before = state();
    const result = runCliInPty(
      getTestCliCommand(['m', '--interactive-rebase']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Controlled sequence editor ready', input: '\x03' },
        ],
      }
    );
    fixture.savePty(result);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.match(/editor|failed|error/i);
    const cancelled = state();
    expect({ ...cancelled, operation: null }).to.deep.equal({
      ...before,
      operation: null,
    });
    expect(cancelled.operation).not.to.deep.equal(before.operation);
    const abort = fixture.run(['rebase', '--abort']);
    expect(abort.status, abort.stdout + abort.stderr).to.equal(0);
    expect({ ...state(), index: null }).to.deep.equal({
      ...before,
      index: null,
    });
  });

  for (const prefix of [true, false])
    it(`rebases the cwd target and preserves departure state with a ${
      prefix ? 'prefix' : 'suffix'
    } option`, () => {
      const departure = new CwdCliFixture();
      try {
        reword();
        const before = departure.inspectionSnapshot();
        const cwd = ['--cwd', fixture.repo];
        const args = [
          'm',
          '--interactive-rebase',
          '--interactive',
          '--message',
          'literal --cwd ignored',
        ];
        const result = fixture.run(
          prefix ? [...cwd, ...args] : [...args, ...cwd],
          departure.repo
        );
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
          'actually rewritten base'
        );
        expect(departure.inspectionSnapshot()).to.deep.equal(before);
      } finally {
        departure.cleanup();
      }
    });

  for (const args of [
    ['m', '--interactive-rebase', '--quiet=invalid'],
    ['m', '--interactive-rebase', '--cwd', 'missing-target'],
    ['m', '--interactive-rebase', '--unknown-operation-option'],
  ])
    it(`keeps invalid input before editor or mutations: ${args.join(
      ' '
    )}`, () => {
      reword();
      const before = state();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(state()).to.deep.equal(before);
      expect(fs.existsSync(path.join(fixture.root, 'sequence-input'))).to.equal(
        false
      );
    });

  for (const descriptor of ['stdin-pipe', 'stdout-pipe', 'closed-stdin'])
    it(`requires explicit editor permission with ${descriptor}`, () => {
      const wrapper = `
import json, os, subprocess, sys
command = json.loads(sys.argv[1])
if sys.argv[2] == 'stdin-pipe':
    result = subprocess.run(command, input=b'', timeout=4)
elif sys.argv[2] == 'stdout-pipe':
    result = subprocess.run(command, stdout=subprocess.PIPE, timeout=4)
    sys.stdout.buffer.write(result.stdout)
else:
    result = subprocess.run(command, preexec_fn=lambda: os.close(0), timeout=4)
sys.exit(result.returncode)
`;
      reword();
      const before = state();
      for (const explicit of [false, true]) {
        const result = runCliInPty(
          [
            '/usr/bin/python3',
            '-c',
            wrapper,
            JSON.stringify(
              getTestCliCommand([
                'm',
                '--interactive-rebase',
                ...(explicit ? ['--interactive'] : []),
              ])
            ),
            descriptor,
          ],
          { cwd: fixture.repo, env: fixture.env }
        );
        fixture.savePty(result);
        expect(result.status, result.output).to.equal(explicit ? 0 : 1);
        if (explicit) {
          expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
            'actually rewritten base'
          );
          expect(
            fs.existsSync(path.join(fixture.root, 'sequence-input'))
          ).to.equal(true);
        } else {
          expect(state()).to.deep.equal(before);
          expect(
            fs.existsSync(path.join(fixture.root, 'sequence-input'))
          ).to.equal(false);
        }
      }
    });
});
