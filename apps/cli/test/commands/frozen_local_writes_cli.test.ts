import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty as executeCliInPty } from '../lib/utils/run_cli_in_pty';
import { expect } from 'chai';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';

// eslint-disable-next-line max-lines-per-function
describe('frozen local writes through the public CLI', function () {
  this.timeout(120000);
  let fixture: FreezeCliFixture;
  beforeEach(() => {
    fixture = new FreezeCliFixture();
  });
  afterEach(function () {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      const files: Record<string, string> = {};
      for (const directory of [
        fixture.root,
        path.join(fixture.repo, '.git/hooks'),
      ])
        for (const name of fs.readdirSync(directory)) {
          const file = path.join(directory, name);
          if (fs.statSync(file).isFile())
            files[file] = fs.readFileSync(file).toString('base64');
        }
      fs.appendFileSync(
        path.join(evidence, 'local-write-cases.jsonl'),
        JSON.stringify({
          case: this.currentTest?.fullTitle(),
          root: fixture.root,
          externalFiles: files,
        }) + '\n'
      );
    }
    fixture.cleanup();
  });

  it('refuses frozen squash before resetting history or staging work', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    fixture.ok(['freeze', 'tip']);
    fixture.stage('tip.txt', 'staged');
    fixture.write('tip.txt', 'unstaged');
    const before = fixture.observe();
    const result = fixture.run(['squash', '-m', 'forbidden']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('stops a sequence editor freeze before rewritten commits and preserves editor work', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    const before = fixture.git(['rev-parse', 'tip']);
    const index = fixture.git(['ls-files', '--stage']);
    const freeze = getTestCliCommand(['freeze', 'tip', '--no-interactive']);
    const editor = path.join(fixture.root, 'sequence-editor');
    fs.writeFileSync(
      editor,
      `#!${process.execPath}
const fs=require('fs'),cp=require('child_process');
const file=process.argv[2];fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/^pick /m,'drop '));
fs.writeFileSync('editor-work.txt','preserve editor work');
const r=cp.spawnSync(${JSON.stringify(freeze[0])},${JSON.stringify(
        freeze.slice(1)
      )},{stdio:'inherit'});process.exitCode=r.status;
`,
      { mode: 0o755 }
    );
    fixture.env.GIT_SEQUENCE_EDITOR = editor;
    const result = fixture.run(['m', '--interactive-rebase', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(before);
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(before);
    expect(fixture.git(['ls-files', '--stage'])).to.equal(index);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'editor-work.txt'), 'utf8')
    ).to.equal('preserve editor work');
  });
  const entries: readonly (readonly string[])[] = [
    ['modify', '--interactive-rebase', '--all', '--patch', '--no-verify'],
    ['m', '--interactive-rebase', '--interactive'],
    ['edit', '--interactive'],
    ['e', '--quiet'],
    ['squash', '--edit', '--interactive'],
    ['sq', '--no-edit', '--no-verify'],
    ...['split', 'sp'].flatMap((command) =>
      [
        [],
        ['--by-commit'],
        ['-c'],
        ['--commit'],
        ['--by-hunk'],
        ['-h'],
        ['--hunk'],
      ].map((flags) => [command, ...flags, '--interactive'])
    ),
    ['pop', '--quiet', '--no-verify'],
  ];
  for (const args of entries)
    it(`refuses frozen source without any write: ${args.join(' ')}`, () => {
      fixture.git(['switch', 'tip']);
      fixture.ok(['freeze', 'tip']);
      fixture.stage('tip.txt', 'staged tip');
      fixture.write('tip.txt', 'work tip');
      fixture.write('untracked.txt', 'keep untracked');
      fixture.git(['status', '--porcelain']);
      const before = fixture.observe();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr)
        .to.include('frozen branch tip')
        .and.include('an unfreeze tip');
      expect(fixture.observe()).to.deep.equal(before);
    });

  for (const args of [
    ['edit', '--interactive'],
    ['sq', '-n'],
    ['sp', '-h', '--interactive'],
    ['pop'],
  ])
    it(`preserves raw damaged metadata before frozen ${args[0]} context repair`, () => {
      fixture.git(['switch', 'tip']);
      fixture.ok(['freeze', 'tip']);
      const value: unknown = JSON.parse(
        fixture.git(['show', 'refs/branch-metadata/tip'])
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('metadata');
      const meta = {
        ...value,
        parentBranchRevision: fixture.git(['rev-parse', 'main']),
      };
      const input = path.join(fixture.root, 'metadata.json');
      fs.writeFileSync(input, JSON.stringify(meta));
      const oid = fixture.git(['hash-object', '-w', input]);
      fixture.git(['update-ref', 'refs/branch-metadata/tip', oid]);
      const before = fixture.observe();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('frozen branch tip');
      expect(fixture.observe()).to.deep.equal(before);
    });

  for (const command of ['squash', 'sq'])
    it(`actually squashes editable ${command} with a frozen parent anchor`, () => {
      fixture.git(['switch', 'tip']);
      fixture.commit('second');
      fixture.ok(['freeze', 'child']);
      const parent = fixture.git(['rev-parse', 'child']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const result = fixture.run([command, '-m', 'combined', '--no-verify']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal('combined');
      expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('1');
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(parent);
      expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(parent);
    });

  it('pops editable content into real work files while preserving its frozen parent', () => {
    fixture.git(['switch', 'tip']);
    fixture.ok(['freeze', 'child']);
    const parent = fixture.git(['rev-parse', 'child']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.write('untracked.txt', 'own work');
    fixture.ok(['pop']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.git(['branch', '--list', 'tip'])).to.equal('');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(parent);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
    ).to.equal('own work');
    expect(fixture.git(['ls-files', 'tip.txt'])).to.equal('');
  });

  for (const command of ['split', 'sp'])
    it(`actually splits editable ${command} commits through terminal prompts`, () => {
      fixture.git(['switch', 'tip']);
      fixture.commit('second');
      fixture.ok(['freeze', 'child']);
      const parent = fixture.git(['rev-parse', 'child']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const result = runCliInPty(getTestCliCommand([command, '--by-commit']), {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Toggle a commit to split the branch there.',
            input: '\x1b[B\r',
          },
          {
            prompt: 'Toggle a commit to split the branch there.',
            input: '\x1b[A\x1b[A\r',
          },
          { prompt: 'Choose a name for branch 1', input: '\r' },
          { prompt: 'Choose a name for branch 2', input: '\r' },
        ],
      });
      expect(result.status, result.output).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal('tip_split');
      expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('1');
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(parent);
      expect(fixture.git(['rev-parse', 'tip_split^'])).to.equal(
        fixture.git(['rev-parse', 'tip'])
      );
      expect(fixture.git(['rev-parse', 'tip_split^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(parent);
      expect(fixture.git(['show', 'refs/branch-metadata/tip_split'])).to.match(
        /"parentBranchName":\s*"tip"/
      );
    });

  function runCliInPty(
    command: Parameters<typeof executeCliInPty>[0],
    options: Parameters<typeof executeCliInPty>[1]
  ): ReturnType<typeof executeCliInPty> {
    const before = fixture.observe();
    const result = executeCliInPty(command, options);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'local-write-pty.jsonl'),
        JSON.stringify({
          root: fixture.root,
          command,
          cwd: options.cwd,
          responses: options.responses,
          environment: Object.fromEntries(
            [
              'HOME',
              'GH_CONFIG_DIR',
              'GRAPHITE_USER_CONFIG_PATH',
              'PATH',
              'TERM',
              'NO_COLOR',
              'GIT_EDITOR',
              'GIT_SEQUENCE_EDITOR',
              'CHARCOAL_TEST_BINARY',
              'GIT_CONFIG_NOSYSTEM',
              'GIT_CONFIG_GLOBAL',
            ].map((key) => [key, options.env[key]])
          ),
          before,
          result,
          after: fixture.observe(),
        }) + '\n'
      );
    }
    return result;
  }
  it('actually splits editable hunks into two real single-commit branches', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    fixture.ok(['freeze', 'child']);
    fixture.env.GIT_EDITOR = 'true';
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const parent = fixture.git(['rev-parse', 'child']);
    const result = runCliInPty(getTestCliCommand(['sp', '--hunk']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Stage addition', input: 'y\r' },
        { prompt: 'Stage addition', input: 'n\r' },
        { prompt: 'Choose a name for branch 1', input: '\r' },
        { prompt: 'Stage addition', input: 'y\r' },
        { prompt: 'Choose a name for branch 2', input: '\r' },
      ],
    });
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip_split');
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(parent);
    expect(fixture.git(['rev-parse', 'tip_split^'])).to.equal(
      fixture.git(['rev-parse', 'tip'])
    );
    expect(fixture.git(['rev-parse', 'tip_split^{tree}'])).to.equal(tree);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  for (const args of [
    ['modify', '--interactive-rebase'],
    ['m', '--interactive-rebase'],
    ['edit'],
    ['e'],
  ])
    it(`rewrites editable current history with frozen ancestor: ${args.join(
      ' '
    )}`, () => {
      fixture.git(['switch', 'tip']);
      fixture.ok(['freeze', 'child']);
      const parent = fixture.git(['rev-parse', 'child']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      fixture.env.GIT_SEQUENCE_EDITOR = script(
        'sequence',
        "const f=process.argv[2];fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^pick /m,'reword '));"
      );
      fixture.env.GIT_EDITOR = script(
        'message',
        "fs.writeFileSync(process.argv[2],'new tip subject\\n');"
      );
      const result = fixture.run([...args, '--interactive', '--no-verify']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
        'new tip subject'
      );
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(parent);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(parent);
      expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    });

  function script(name: string, body: string): string {
    const file = path.join(fixture.root, name);
    fs.writeFileSync(
      file,
      `#!${process.execPath}\nconst fs=require('fs');${body}`,
      { mode: 0o755 }
    );
    return file;
  }
  function freezeCommand(): string {
    return getTestCliCommand(['freeze', 'tip', '--no-interactive'])
      .map((value) => `'${value.replace(/'/g, "'\\''")}'`)
      .join(' ');
  }

  it('rechecks after a real pre-rebase hook before opening the sequence editor', () => {
    fixture.git(['switch', 'tip']);
    const head = fixture.git(['rev-parse', 'HEAD']);
    fixture.env.GIT_SEQUENCE_EDITOR = script(
      'sequence',
      "fs.writeFileSync('unwanted-sequence.txt','called');"
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-rebase'),
      `#!/bin/sh\n${freezeCommand()} || exit $?\nprintf 'hook work' > hook-work.txt\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['edit', '--interactive', '--no-verify']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(head);
    expect(
      fs.existsSync(path.join(fixture.repo, 'unwanted-sequence.txt'))
    ).to.equal(false);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
  });

  it('keeps the actual squash progress and hook work after a late freeze and recovers after unfreeze', () => {
    fixture.git(['switch', 'tip']);
    const first = fixture.git(['rev-parse', 'tip']);
    fixture.commit('second');
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const hook = path.join(fixture.repo, '.git/hooks/pre-commit');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\n${freezeCommand()} || exit $?\nprintf 'hook work' > hook-work.txt\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['sq', '-m', 'blocked']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(first);
    expect(fixture.git(['write-tree'])).to.equal(tree);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'tip']);
    fixture.ok(['sq', '-m', 'recovered']);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(fixture.git(['log', '-1', '--format=%s'])).to.equal('recovered');
  });

  it('rechecks a split commit prompt freeze before detach or branch creation', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    const before = fixture.refs();
    const head = fixture.git(['rev-parse', 'HEAD']);
    const result = runCliInPty(getTestCliCommand(['sp', '-c']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        {
          prompt: 'Toggle a commit to split the branch there.',
          input: '\x1b[A\r',
        },
        {
          prompt: 'Choose a name for branch 1',
          beforeInput: getTestCliCommand(['freeze', 'tip', '--no-interactive']),
          input: '\r',
        },
      ],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('frozen branch tip');
    expect(fixture.refs()).to.equal(before);
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
  });

  it('keeps detached hunk work when its commit editor freezes the source', () => {
    fixture.git(['switch', 'tip']);
    const head = fixture.git(['rev-parse', 'tip']);
    fixture.env.GIT_EDITOR = script(
      'editor',
      `fs.writeFileSync('editor-work.txt','own editor work');require('child_process').execFileSync('/bin/sh',['-c',${JSON.stringify(
        freezeCommand()
      )}],{stdio:'inherit'});`
    );
    const result = runCliInPty(getTestCliCommand(['split', '--by-hunk']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Stage addition', input: 'y\r' }],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(head);
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['show', ':tip.txt'])).to.equal('');
    expect(fixture.git(['diff', '--', 'tip.txt'])).to.include('+tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'editor-work.txt'), 'utf8')
    ).to.equal('own editor work');
    expect(fixture.git(['branch', '--list', 'tip_split'])).to.equal('');
  });

  it('rechecks pop after checkout hooks before deleting the original branch', () => {
    fixture.git(['switch', 'tip']);
    const before = fixture.refs();
    const head = fixture.git(['rev-parse', 'tip']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-checkout'),
      `#!/bin/sh\n${freezeCommand()} || exit $?\nprintf 'hook work' > hook-work.txt\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['pop']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.refs()).to.equal(before);
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('hook work');
  });

  for (const command of ['edit', 'e', 'squash', 'sq', 'split', 'sp', 'pop'])
    it(`documents frozen protection for ${command} without repository writes`, () => {
      const before = fixture.observe();
      const result = fixture.run([command, '--help', '--quiet'], fixture.root);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.match(/frozen|unfreeze/i);
      expect(fixture.observe()).to.deep.equal(before);
    });
  for (const continuation of ['continue', 'cont'])
    it(`blocks an active interactive rebase before all then resumes through ${continuation}`, () => {
      fixture.git(['switch', 'tip']);
      for (const text of ['first', 'second']) {
        fixture.write('main.txt', text);
        fixture.git(['add', 'main.txt']);
        fixture.git(['commit', '-m', text]);
      }
      fixture.env.GIT_SEQUENCE_EDITOR = script(
        'sequence',
        "const f=process.argv[2],rows=fs.readFileSync(f,'utf8').split('\\n'),p=rows.filter(r=>/^pick /.test(r));fs.writeFileSync(f,[p[0],p[2],p[1],...rows.filter(r=>!/^pick /.test(r))].join('\\n'));"
      );
      fixture.env.GIT_EDITOR = 'true';
      const first = fixture.run(['edit', '--interactive']);
      expect(first.status, first.stdout + first.stderr).to.equal(1);
      expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
      fixture.ok(['freeze', 'tip']);
      fixture.write('main.txt', 'first resolved');
      fixture.git(['add', 'main.txt']);
      fixture.write('untracked.txt', 'keep unstaged');
      const before = fixture.observe();
      const operation = fs
        .readFileSync(
          path.join(fixture.repo, '.git/rebase-merge/git-rebase-todo')
        )
        .toString('base64');
      const denied = fixture.run([continuation, '--all', '--quiet']);
      expect(denied.status, denied.stdout + denied.stderr).to.equal(1);
      expect(denied.stderr).to.include('frozen branch tip');
      expect(fixture.observe()).to.deep.equal(before);
      expect(
        fs
          .readFileSync(
            path.join(fixture.repo, '.git/rebase-merge/git-rebase-todo')
          )
          .toString('base64')
      ).to.equal(operation);
      fixture.ok(['unfreeze', 'tip']);
      const next = fixture.run([continuation]);
      expect(next.status, next.stdout + next.stderr).to.equal(1);
      fixture.write('main.txt', 'final resolved');
      fixture.git(['add', 'main.txt']);
      fixture.ok([continuation]);
      expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'child..tip'])
      ).to.equal('tip\nsecond\nfirst');
      expect(fixture.git(['show', 'tip:main.txt'])).to.equal('final resolved');
      expect(
        fs.existsSync(path.join(fixture.repo, '.git/rebase-merge'))
      ).to.equal(false);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
      ).to.equal('keep unstaged');
    });

  it('keeps both worktrees and the departure repository unchanged for a cwd frozen refusal', () => {
    fixture.git(['switch', 'tip']);
    fixture.ok(['freeze', 'tip']);
    fixture.git(['worktree', 'add', fixture.linked, 'other']);
    fixture.stage('other.txt', 'linked staged', fixture.linked);
    fixture.write('other.txt', 'linked work', fixture.linked);
    fixture.write('untracked.txt', 'linked untracked', fixture.linked);
    fixture.git(['status', '--porcelain'], fixture.linked);
    const before = fixture.observe();
    const linked = fixture.snapshot(fixture.linked);
    const index = fixture.git(
      ['rev-parse', '--git-path', 'index'],
      fixture.linked
    );
    const bytes = fs.readFileSync(index).toString('base64');
    const result = fixture.run(
      ['--cwd', fixture.repo, 'e', '--interactive', '--quiet'],
      fixture.linked
    );
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    expect(fs.readFileSync(index).toString('base64')).to.equal(bytes);
  });

  it('uses the default single-commit hunk split with a frozen anchor', () => {
    fixture.git(['switch', 'tip']);
    fixture.ok(['freeze', 'child']);
    fixture.env.GIT_EDITOR = 'true';
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const parent = fixture.git(['rev-parse', 'child']);
    const result = runCliInPty(getTestCliCommand(['split']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Stage addition', input: 'y\r' },
        { prompt: 'Choose a name for branch 1', input: '\r' },
      ],
    });
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(parent);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('keeps editable squash editor failures and their work intact', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    const head = fixture.git(['rev-parse', 'tip']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    fixture.env.GIT_EDITOR = script(
      'editor',
      "fs.writeFileSync('editor-work.txt','error work');process.exitCode=17;"
    );
    const result = fixture.run(['squash', '--edit', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(head);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'editor-work.txt'), 'utf8')
    ).to.equal('error work');
  });
  function referenceHook(predicate: string): void {
    const file = path.join(fixture.repo, '.git/hooks/reference-transaction');
    fs.writeFileSync(
      file,
      `#!${
        process.execPath
      }\nconst fs=require('fs'),cp=require('child_process'),input=fs.readFileSync(0,'utf8');if(process.argv[2]==='prepared'&&(${predicate})){cp.execFileSync('/bin/sh',['-c',${JSON.stringify(
        freezeCommand()
      )}],{stdio:'inherit'});fs.writeFileSync('reference-work.txt','hook work');}\n`,
      { mode: 0o755 }
    );
  }

  it('rechecks a reference hook freeze before the first squash reset publication', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    const head = fixture.git(['rev-parse', 'tip']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    referenceHook("input.includes(' refs/heads/tip')");
    const result = fixture.run(['squash', '-m', 'blocked']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(head);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'reference-work.txt'), 'utf8')
    ).to.equal('hook work');
  });

  it('rechecks a reference hook freeze before pop deletes the source ref', () => {
    fixture.git(['switch', 'tip']);
    const head = fixture.git(['rev-parse', 'tip']);
    referenceHook(
      "input.split('\\n').some(line=>{const p=line.split(' ');return p[1]==='0000000000000000000000000000000000000000'&&p[2]==='refs/heads/tip';})"
    );
    const result = fixture.run(['pop']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(head);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'tip.txt'), 'utf8')
    ).to.equal('tip');
  });

  it('rechecks a reference hook freeze before split publishes a new branch name', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('second');
    const refs = fixture.refs();
    referenceHook("input.includes(' refs/heads/lower')");
    const result = runCliInPty(getTestCliCommand(['split', '-c']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        {
          prompt: 'Toggle a commit to split the branch there.',
          input: '\x1b[B\r',
        },
        {
          prompt: 'Toggle a commit to split the branch there.',
          input: '\x1b[A\x1b[A\r',
        },
        { prompt: 'Choose a name for branch 1', input: 'lower\r' },
        { prompt: 'Choose a name for branch 2', input: 'upper\r' },
      ],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('frozen branch tip');
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['branch', '--list', 'lower', 'upper'])).to.equal('');
  });
  it('preserves a final post-rewrite freeze before interactive metadata writes', () => {
    fixture.git(['switch', 'tip']);
    const before = fixture.git(['rev-parse', 'tip']);
    fixture.env.GIT_SEQUENCE_EDITOR = script(
      'sequence',
      "const f=process.argv[2];fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^pick /m,'reword '));"
    );
    fixture.env.GIT_EDITOR = script(
      'message',
      "fs.writeFileSync(process.argv[2],'rewritten before final hook\\n');"
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-rewrite'),
      `#!/bin/sh\nif [ "$1" = rebase ]; then ${freezeCommand()} || exit $?; printf 'final hook work' > final-hook.txt; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['e', '--interactive']);
    expect(fixture.ok(['info', 'tip'])).to.include('(frozen)');
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch tip');
    expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(before);
    expect(fixture.git(['log', '-1', '--format=%s', 'tip'])).to.equal(
      'rewritten before final hook'
    );
    expect(fixture.ok(['info', 'tip'])).to.include('(frozen)');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'final-hook.txt'), 'utf8')
    ).to.equal('final hook work');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/rebase-merge'))
    ).to.equal(false);
  });
  it('preserves tracked editor work when an editable hunk editor fails', () => {
    fixture.git(['switch', 'tip']);
    const head = fixture.git(['rev-parse', 'tip']);
    fixture.env.GIT_EDITOR = script(
      'editor',
      "fs.writeFileSync('main.txt','editor tracked work');fs.writeFileSync('extra.txt','editor untracked work');process.exitCode=17;"
    );
    const result = runCliInPty(getTestCliCommand(['sp', '--by-hunk']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Stage addition', input: 'y\r' }],
    });
    expect(result.status, result.output).to.equal(1);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('editor tracked work');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'extra.txt'), 'utf8')
    ).to.equal('editor untracked work');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(head);
    expect(fixture.git(['show', ':tip.txt'])).to.equal('');
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    fixture.git(['switch', '-c', 'hunk-recovery']);
    fixture.git(['add', 'tip.txt']);
    fixture.git(['commit', '-m', 'save split content']);
    expect(fixture.git(['rev-parse', 'hunk-recovery^{tree}'])).to.equal(
      fixture.git(['rev-parse', 'tip^{tree}'])
    );
    fixture.ok(['checkout', 'tip']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('editor tracked work');
  });
  it('rechecks a successful hunk commit hook freeze before the next prompt', () => {
    fixture.git(['switch', 'tip']);
    const source = fixture.git(['rev-parse', 'tip']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    fixture.env.GIT_EDITOR = 'true';
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-commit'),
      `#!/bin/sh\n${freezeCommand()} || exit $?\nprintf 'post commit work' > post-work.txt\n`,
      { mode: 0o755 }
    );
    const result = runCliInPty(getTestCliCommand(['split', '-h']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Stage addition', input: 'y\r' }],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('frozen branch tip')
      .and.not.include('Choose a name for branch');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(source);
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['rev-parse', 'HEAD^{tree}'])).to.equal(tree);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'post-work.txt'), 'utf8')
    ).to.equal('post commit work');
    expect(fixture.ok(['info', 'tip'])).to.include('(frozen)');
  });
});
