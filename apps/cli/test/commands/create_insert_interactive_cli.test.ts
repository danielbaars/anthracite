import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('create --insert child selection through a real terminal', function () {
  this.timeout(120000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    const date = process.env.GIT_COMMITTER_DATE;
    // Fixed fixture dates keep terminal navigation independent of wall-clock ties.
    process.env.GIT_COMMITTER_DATE = '2030-01-02T00:00:00Z';
    try {
      fixture = new CreateCliFixture();
    } finally {
      if (date === undefined) delete process.env.GIT_COMMITTER_DATE;
      else process.env.GIT_COMMITTER_DATE = date;
    }
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'base']);
  });
  afterEach(() => fixture?.cleanup());

  function parent(branch: string): unknown {
    const meta: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
    );
    if (
      typeof meta !== 'object' ||
      meta === null ||
      !('parentBranchName' in meta)
    )
      throw new Error('Expected branch parent');
    return meta.parentBranchName;
  }

  function select(input: string, flags: readonly string[] = []) {
    return runCliInPty(
      getTestCliCommand(['create', 'inserted', '--insert', ...flags]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Choose children of base', input }],
      }
    );
  }

  it('reparents the selected child and replays its descendants, preserving the unselected arm', () => {
    const sibling = fixture.git(['rev-parse', 'sibling']);
    const siblingMeta = fixture.git([
      'rev-parse',
      'refs/branch-metadata/sibling',
    ]);
    fixture.stage();
    const result = select('\u001b[B \r', ['-m', 'shared prerequisite']);
    expect(result.status, result.output).to.equal(0);
    expect(parent('child')).to.equal('inserted');
    expect(parent('tip')).to.equal('child');
    expect(parent('sibling')).to.equal('base');
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/sibling'])).to.equal(
      siblingMeta
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'inserted..tip'])
    ).to.equal('child\ntip');
    expect(fixture.git(['show', 'tip:new.txt'])).to.equal('new work');
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('refuses a chosen child tip changed during the menu, preserving the external tip and prepared input', () => {
    fixture.stage();
    const external = path.join(fixture.root, 'change-child.js');
    fs.writeFileSync(
      external,
      `require('child_process').execFileSync('git', ['update-ref', 'refs/heads/child', 'base']);`
    );
    const before = fixture.snapshot();
    const result = runCliInPty(
      getTestCliCommand(['create', 'inserted', '--insert', '-m', 'shared']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Choose children of base',
            input: '\u001b[B \r',
            beforeInput: [process.execPath, external],
          },
        ],
      }
    );
    expect(result.status, result.output).not.to.equal(0);
    expect(result.status).not.to.equal(124);
    expect(result.output).to.include('changed during child selection');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['show', ':new.txt'])).to.equal('new work');
    expect(fixture.snapshot().files).to.deep.equal(before.files);
    expect(fixture.git(['branch', '--list', 'inserted'])).to.equal('');
    expect(parent('child')).to.equal('base');
  });

  function observe() {
    return {
      work: fixture.snapshot(),
      refs: fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']),
      index: fixture.git(['ls-files', '--stage']),
      recovery: fs.existsSync(path.join(fixture.repo, '.git', '.gtcontinue')),
    };
  }

  function duringMenu(script: string, flags: readonly string[] = []) {
    const executable = path.join(fixture.root, 'menu-effect.js');
    fs.writeFileSync(
      executable,
      `const fs = require('fs'); const { execFileSync } = require('child_process'); const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim(); ${script}`
    );
    return runCliInPty(
      getTestCliCommand(['create', 'inserted', '--insert', ...flags]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Choose children of base',
            input: '\u001b[B \r',
            beforeInput: [process.execPath, executable],
          },
        ],
      }
    );
  }

  function changeMetadata(
    branch: string,
    fields: Readonly<Record<string, unknown>>
  ): string {
    return `const meta = JSON.parse(git(['cat-file', '-p', 'refs/branch-metadata/${branch}'])); const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {input: JSON.stringify({...meta, ...${JSON.stringify(
      fields
    )}}), encoding: 'utf8'}).trim(); git(['update-ref', 'refs/branch-metadata/${branch}', oid]);`;
  }

  it('accepts every child by default without rewriting aligned tips for an empty insertion', () => {
    const tips = ['child', 'tip', 'sibling'].map((name) =>
      fixture.git(['rev-parse', name])
    );
    const result = select('\r');
    expect(result.status, result.output).to.equal(0);
    for (const name of ['child', 'sibling'])
      expect(parent(name)).to.equal('inserted');
    expect(
      ['child', 'tip', 'sibling'].map((name) =>
        fixture.git(['rev-parse', name])
      )
    ).to.deep.equal(tips);
  });

  it('keeps zero choices in the menu with an actionable minimum and permits safe cancellation', () => {
    fixture.stage();
    const before = observe();
    const result = runCliInPty(
      getTestCliCommand(['create', 'inserted', '--insert', '-m', 'shared']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Choose children of base', input: 'a\r' },
          {
            prompt: 'You must select a minimum of 1 choices.',
            input: '\u0003',
          },
        ],
      }
    );
    expect(result.status, result.output).not.to.equal(0);
    expect(result.status).not.to.equal(124);
    expect(result.output).to.include('You must select a minimum of 1 choices.');
    expect(observe()).to.deep.equal(before);
  });

  for (const flags of [['--all'], ['--patch'], ['--all', '--patch'], []]) {
    it(`cancels before ${
      flags.join(' ') || 'editor'
    } input effects and preserves staged modes, unstaged, untracked and ignored bytes`, () => {
      fixture.stage('main.txt', 'prepared');
      fixture.git(['update-index', '--chmod=+x', 'main.txt']);
      fixture.write('main.txt', 'prepared and unfinished');
      fixture.write('loose.txt', 'untracked');
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'info', 'exclude'),
        'ignored.txt\n'
      );
      fixture.write('ignored.txt', 'private ignored bytes');
      const editor = path.join(fixture.root, 'editor.sh');
      const offered = path.join(fixture.root, 'editor-offered');
      fs.writeFileSync(editor, `#!/bin/sh\ntouch '${offered}'\n`, {
        mode: 0o755,
      });
      fixture.env.GIT_EDITOR = editor;
      const before = observe();
      const result = select('\u0003', flags);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(observe()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'ignored.txt'), 'utf8')
      ).to.equal('private ignored bytes');
      expect(fs.existsSync(offered)).to.equal(false);
    });
  }

  it('keeps --all precedence over --patch after choosing one child', () => {
    fixture.write('main.txt', 'all input');
    fixture.write('loose.txt', 'all untracked input');
    const result = select('\u001b[B \r', [
      '--all',
      '--patch',
      '-m',
      'all selected',
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('base');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal('all input');
    expect(fixture.git(['show', 'tip:loose.txt'])).to.equal(
      'all untracked input'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('uses --onto candidates from an unselected departure arm', () => {
    fixture.git(['switch', 'sibling']);
    const source = fixture.git(['rev-parse', 'sibling']);
    const result = select('\u001b[B \r', ['--onto', 'base']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('child').and.include('sibling');
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('base');
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(source);
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
  });

  it('lets a frozen occupied sibling be deselected while preserving its dirty checkout', () => {
    const metadataScript = path.join(fixture.root, 'freeze-sibling.js');
    fs.writeFileSync(
      metadataScript,
      `const {execFileSync}=require('child_process'); const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim(); ${changeMetadata(
        'sibling',
        { frozen: true }
      )}`
    );
    // Persist protection on this independent arm without freezing its read-only parent.
    execFileSync(process.execPath, [metadataScript], {
      cwd: fixture.repo,
      env: fixture.env,
    });
    fixture.git(['worktree', 'add', fixture.linked, 'sibling']);
    fixture.stage('sibling.txt', 'linked prepared', fixture.linked);
    fixture.write('sibling.txt', 'linked unfinished', fixture.linked);
    const linked = fixture.snapshot(fixture.linked);
    const meta = fixture.git(['rev-parse', 'refs/branch-metadata/sibling']);
    fixture.stage();
    const result = select('\u001b[B \r', ['-m', 'chosen prerequisite']);
    expect(result.status, result.output).to.equal(0);
    expect(parent('child')).to.equal('inserted');
    expect(fixture.snapshot(fixture.linked)).to.deep.equal({
      ...linked,
      refs: fixture.refs(),
    });
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/sibling'])).to.equal(
      meta
    );
  });

  for (const mutation of [
    'source tip',
    'source parent',
    'parent tip',
    'parent relationship',
    'chosen parent',
    'chosen base',
    'checkout',
  ]) {
    it(`refuses a changed ${mutation} after the menu without overwriting external work`, () => {
      fixture.git(['switch', 'sibling']);
      fixture.stage();
      const snapshot = path.join(fixture.root, 'external-state.json');
      const effects: Record<string, string> = {
        'source tip': "git(['update-ref', 'refs/heads/sibling', 'base']);",
        'source parent': changeMetadata('sibling', {
          parentBranchName: 'other',
        }),
        'parent tip': "git(['update-ref', 'refs/heads/base', 'main']);",
        'parent relationship': changeMetadata('base', {
          parentBranchName: 'other',
        }),
        'chosen parent': changeMetadata('child', { parentBranchName: 'main' }),
        'chosen base': changeMetadata('child', {
          parentBranchRevision: fixture.git(['rev-parse', 'main']),
        }),
        checkout: "git(['switch', 'other']);",
      };
      const beforeFiles = fixture.snapshot().files;
      const result = duringMenu(
        `${effects[mutation]} fs.writeFileSync(${JSON.stringify(
          snapshot
        )}, JSON.stringify([git(['for-each-ref', '--format=%(refname) %(objectname)']), git(['branch', '--show-current']), git(['ls-files', '--stage']), git(['diff', '--cached', '--binary'])]));`,
        ['--onto', 'base', '-m', 'shared']
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).to.include('changed during child selection');
      expect([
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']),
        fixture.git(['branch', '--show-current']),
        fixture.git(['ls-files', '--stage']),
        fixture.git(['diff', '--cached', '--binary']),
      ]).to.deep.equal(JSON.parse(fs.readFileSync(snapshot, 'utf8')));
      if (mutation !== 'checkout')
        expect(fixture.snapshot().files).to.deep.equal(beforeFiles);
      expect(fixture.git(['branch', '--list', 'inserted'])).to.equal('');
    });
  }

  for (const protectedBranch of ['child', 'tip']) {
    it(`rechecks newly frozen mandatory ${protectedBranch} before all staging`, () => {
      fixture.write('loose.txt', 'unstaged user input');
      const before = fixture.snapshot();
      const result = duringMenu(
        changeMetadata(protectedBranch, { frozen: true }),
        ['--all', '-m', 'shared']
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).to.include(`an unfreeze ${protectedBranch}`);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(parent('child')).to.equal('base');
    });
  }

  it('does not treat an independent unselected-arm ref change as a stale choice', () => {
    const result = duringMenu(
      "git(['update-ref', 'refs/heads/sibling', 'base']);"
    );
    expect(result.status, result.output).to.equal(0);
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('base');
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
  });

  it('checks fresh necessary descendants rather than retaining the old replay closure', () => {
    fixture.stage();
    const tip = fixture.git(['rev-parse', 'tip']);
    const result = duringMenu(
      changeMetadata('tip', { parentBranchName: 'base' }),
      ['-m', 'shared']
    );
    expect(result.status, result.output).to.equal(0);
    expect(parent('child')).to.equal('inserted');
    expect(parent('tip')).to.equal('base');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
  });

  it('keeps explicit child choices authoritative in a terminal', () => {
    const result = select('\u0003', ['--insert-child', 'child']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Choose children');
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('base');
  });

  it('suppresses only child selection when explicit choices still need a commit editor', () => {
    fixture.stage();
    const editor = path.join(fixture.root, 'commit-editor.sh');
    const offered = path.join(fixture.root, 'commit-editor-offered');
    fs.writeFileSync(
      editor,
      `#!/bin/sh\nprintf 'editor message\\n' > "$1"\ntouch '${offered}'\n`,
      { mode: 0o755 }
    );
    fixture.env.GIT_EDITOR = editor;
    const result = select('\u0003', ['--insert-child', 'child']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Choose children');
    expect(fs.existsSync(offered)).to.equal(true);
    expect(fixture.git(['log', '-1', '--format=%s', 'inserted'])).to.equal(
      'editor message'
    );
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('base');
  });

  for (const flags of [['--no-interactive'], ['--quiet']]) {
    it(`retains all children without a menu with ${flags.join(' ')}`, () => {
      const result = select('\u0003', flags);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).not.to.include('Choose children');
      expect(parent('child')).to.equal('inserted');
      expect(parent('sibling')).to.equal('inserted');
    });
  }

  it('honors the existing GRAPHITE_INTERACTIVE prompt-disabling policy', () => {
    fixture.env.GRAPHITE_INTERACTIVE = '1';
    const result = select('\u0003', ['--interactive']);
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Choose children');
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('inserted');
  });

  for (const onto of ['other', 'child']) {
    it(`creates without a child menu above ${onto} with zero or one candidate`, () => {
      const result = select('\u0003', ['--onto', onto]);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).not.to.include('Choose children');
      expect(parent('inserted')).to.equal(onto);
      if (onto === 'child') expect(parent('tip')).to.equal('inserted');
    });
  }

  it('permits choosing multiple children while leaving another independent arm untouched', () => {
    fixture.env.GIT_COMMITTER_DATE = '2029-01-02T00:00:00Z';
    fixture.branch('arm', 'base');
    fixture.git(['switch', 'base']);
    const sibling = fixture.git(['rev-parse', 'sibling']);
    const result = select('\u001b[B \r');
    expect(result.status, result.output).to.equal(0);
    expect(parent('child')).to.equal('inserted');
    expect(parent('arm')).to.equal('inserted');
    expect(parent('sibling')).to.equal('base');
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
  });

  for (const branch of ['child', 'tip']) {
    it(`refuses newly occupied mandatory ${branch} before staging or creation`, () => {
      fixture.write('loose.txt', 'unstaged work');
      const before = fixture.snapshot();
      const result = duringMenu(
        `git(['worktree', 'add', ${JSON.stringify(
          fixture.linked
        )}, '${branch}']);`,
        ['--all', '-m', 'shared']
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).to.include(branch).and.include('worktree');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal(branch);
    });
  }

  for (const effect of [
    'tracked dirt',
    'ignored obstruction',
    'Git operation',
  ]) {
    it(`rechecks ${effect} created during selection before mutation`, () => {
      fixture.stage();
      if (effect === 'Git operation')
        fixture.git(['restore', '--staged', 'new.txt']);
      const before = fixture.snapshot();
      const scripts: Record<string, string> = {
        'tracked dirt':
          "fs.writeFileSync('main.txt', 'external unfinished work');",
        'ignored obstruction':
          "fs.writeFileSync('.git/info/exclude', 'child.txt\\n'); fs.writeFileSync('child.txt', 'external private bytes');",
        'Git operation': "git(['merge', '--no-commit', '--no-ff', 'other']);",
      };
      const result = duringMenu(scripts[effect], ['-m', 'shared']);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).to.include(
        effect === 'tracked dirt'
          ? 'unstaged tracked changes'
          : effect === 'ignored obstruction'
          ? 'child.txt'
          : 'MERGE_HEAD'
      );
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(fixture.git(['branch', '--list', 'inserted'])).to.equal('');
      expect(fixture.refs()).to.equal(before.refs);
      if (effect === 'Git operation') {
        expect(fixture.git(['diff', '--cached', '--name-status'])).to.equal(
          'A\tother.txt'
        );
        expect(fixture.git(['rev-parse', 'MERGE_HEAD'])).to.equal(
          fixture.git(['rev-parse', 'other'])
        );
      } else {
        expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(
          before.staged
        );
      }
      if (effect !== 'Git operation')
        expect(
          fs.readFileSync(
            path.join(
              fixture.repo,
              effect === 'tracked dirt' ? 'main.txt' : 'child.txt'
            ),
            'utf8'
          )
        ).to.equal(
          effect === 'tracked dirt'
            ? 'external unfinished work'
            : 'external private bytes'
        );
      else
        expect(
          fs.existsSync(path.join(fixture.repo, '.git', 'MERGE_HEAD'))
        ).to.equal(true);
    });
  }

  it('retains all children when forced interaction has no usable terminal', () => {
    const [command, ...args] = getTestCliCommand([
      'create',
      'inserted',
      '--insert',
      '--interactive',
    ]);
    const result = spawnSync(command, args, {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).not.to.include('Choose children');
    expect(parent('child')).to.equal('inserted');
    expect(parent('sibling')).to.equal('inserted');
  });
});
