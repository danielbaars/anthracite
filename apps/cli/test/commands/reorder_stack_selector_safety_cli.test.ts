import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('chosen stack reorder rechecks real selection and editor effects', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
    fixture.branch('sibling', 'child');
    fixture.branch('deep', 'sibling');
    fixture.git(['switch', 'child']);
  });
  afterEach(() => fixture?.cleanup());

  for (const phase of ['selector', 'editor']) {
    for (const mutation of ['ref', 'parent', 'dirty', 'worktree', 'ignored']) {
      it(`preserves the external ${phase}-time ${mutation} effect and refuses the stale chosen plan`, () => {
        const saved = path.join(fixture.root, 'external-state.json');
        const linked = path.join(fixture.root, 'external-linked');
        const track = getTestCliCommand([
          'track',
          'tip',
          '--parent',
          'base',
          '--no-interactive',
        ]);
        const effects: Record<string, string> = {
          ref: "git(['update-ref','refs/heads/tip',git(['rev-parse','child'])]);",
          parent: `execFileSync(${JSON.stringify(track[0])},${JSON.stringify(
            track.slice(1)
          )},{env:process.env});`,
          dirty:
            "fs.writeFileSync('child.txt','staged external');git(['add','child.txt']);fs.appendFileSync('child.txt',' and unstaged');",
          worktree: `git(['worktree','add',${JSON.stringify(
            linked
          )},'deep']);fs.writeFileSync(${JSON.stringify(
            path.join(linked, 'deep.txt')
          )},'staged external');git(['-C',${JSON.stringify(
            linked
          )},'add','deep.txt']);fs.appendFileSync(${JSON.stringify(
            path.join(linked, 'deep.txt')
          )},' and unstaged');fs.writeFileSync(${JSON.stringify(
            path.join(fixture.root, 'external-linked-index')
          )},fs.readFileSync(git(['-C',${JSON.stringify(
            linked
          )},'rev-parse','--git-path','index'])).toString('base64'));`,
          ignored:
            "fs.writeFileSync('.git/info/exclude','deep.txt\\n');fs.writeFileSync('deep.txt',Buffer.from([0,255,13,128]));",
        };
        const script = `const {execFileSync}=require('child_process');const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();${
          effects[mutation]
        }fs.writeFileSync(${JSON.stringify(
          saved
        )},JSON.stringify([git(['rev-parse','HEAD']),git(['symbolic-ref','HEAD']),git(['for-each-ref','--format=%(refname) %(objectname)']),fs.readFileSync(git(['rev-parse','--git-path','index'])).toString('base64'),git(['status','--porcelain=v1','-z']),git(['worktree','list','--porcelain','-z']),fs.readFileSync('child.txt').toString('base64'),fs.existsSync('deep.txt')?fs.readFileSync('deep.txt').toString('base64'):null]));`;
        const executable = path.join(fixture.root, 'external.js');
        fs.writeFileSync(executable, `const fs=require('fs');${script}`);
        fixture.editor('base\ntip\nchild\n', phase === 'editor' ? script : '');
        const result = runCliInPty(
          getTestCliCommand(['reorder', '--stack', '--interactive']),
          {
            cwd: fixture.repo,
            env: fixture.env,
            responses: [
              {
                prompt: 'Choose a tip',
                input: 'tip',
                ...(phase === 'selector'
                  ? { beforeInput: [process.execPath, executable] }
                  : {}),
              },
              { prompt: '› tip\r\n', input: '\r' },
            ],
          }
        );
        savePty(result);
        expect(result.status, result.output).not.to.equal(0);
        expect(result.status).not.to.equal(124);
        expect(fs.existsSync(saved), result.output).to.equal(true);
        const external: unknown = JSON.parse(fs.readFileSync(saved, 'utf8'));
        expect([
          fixture.git(['rev-parse', 'HEAD']),
          fixture.git(['symbolic-ref', 'HEAD']),
          fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']),
          fixture.index(),
          fixture.git(['status', '--porcelain=v1', '-z']),
          fixture.git(['worktree', 'list', '--porcelain', '-z']),
          fs
            .readFileSync(path.join(fixture.repo, 'child.txt'))
            .toString('base64'),
          fs.existsSync(path.join(fixture.repo, 'deep.txt'))
            ? fs
                .readFileSync(path.join(fixture.repo, 'deep.txt'))
                .toString('base64')
            : null,
        ]).to.deep.equal(external);
        if (mutation === 'ignored') {
          expect(result.output).to.include('deep.txt');
          expect(
            fs.readFileSync(path.join(fixture.repo, 'deep.txt'))
          ).to.deep.equal(Buffer.from([0, 255, 13, 128]));
          fs.renameSync(
            path.join(fixture.repo, 'deep.txt'),
            path.join(fixture.root, 'preserved-private-bytes')
          );
        } else {
          expect(result.output).to.include(
            phase === 'selector'
              ? 'changed during tip selection'
              : 'changed while the editor'
          );
          expect(fs.existsSync(fixture.offered)).to.equal(phase === 'editor');
        }
        if (mutation === 'dirty')
          fixture.git(['restore', '--staged', '--worktree', 'child.txt']);
        if (mutation === 'worktree') {
          expect(fixture.index(linked)).to.equal(
            fs.readFileSync(
              path.join(fixture.root, 'external-linked-index'),
              'utf8'
            )
          );
          expect(
            fs.readFileSync(path.join(linked, 'deep.txt'), 'utf8')
          ).to.equal('staged external and unstaged');
        }
        expect(fixture.parent('base')).to.equal('main');
        expect(fixture.parent('child')).to.equal('base');
        expect(fixture.parent('tip')).to.equal(
          mutation === 'parent' ? 'base' : 'child'
        );
        expect(fixture.parent('sibling')).to.equal('child');
      });
    }
  }

  for (const guard of [
    'stale-selected',
    'selected-worktree',
    'deep-worktree',
    'dirty',
  ]) {
    it(`applies ${guard} to the chosen route before any topology or ref effects`, () => {
      if (guard === 'stale-selected') fixture.commit('new-child');
      const linked = path.join(fixture.root, 'linked');
      if (guard.endsWith('worktree')) {
        fixture.git([
          'worktree',
          'add',
          linked,
          guard === 'selected-worktree' ? 'tip' : 'deep',
        ]);
        fs.writeFileSync(path.join(linked, 'main.txt'), 'staged linked');
        fixture.git(['add', 'main.txt'], linked);
        fs.appendFileSync(path.join(linked, 'main.txt'), ' and unstaged');
      }
      if (guard === 'dirty') {
        fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'staged');
        fixture.git(['add', 'child.txt']);
        fs.appendFileSync(
          path.join(fixture.repo, 'child.txt'),
          ' and unstaged'
        );
      }
      fixture.editor('base\ntip\nchild\n');
      const before = [
        fixture.snapshot(),
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']),
        ...(guard.endsWith('worktree') ? [fixture.snapshot(linked)] : []),
      ];
      const result = runCliInPty(getTestCliCommand(['reorder', '--stack']), {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Choose a tip', input: 'tip' },
          { prompt: '› tip\r\n', input: '\r' },
        ],
      });
      savePty(result);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).to.include(
        guard === 'stale-selected'
          ? 'needs restack'
          : guard === 'dirty'
          ? 'tracked changes'
          : guard === 'selected-worktree'
          ? 'tip'
          : 'deep'
      );
      expect([
        fixture.snapshot(),
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']),
        ...(guard.endsWith('worktree') ? [fixture.snapshot(linked)] : []),
      ]).to.deep.equal(before);
      if (guard === 'dirty')
        fixture.git(['restore', '--staged', '--worktree', 'child.txt']);
      expect(fixture.parent('base')).to.equal('main');
      expect(fixture.parent('child')).to.equal('base');
    });
  }

  it('continues the chosen tip through an unselected subtree conflict using fresh public processes', () => {
    fixture.git(['switch', 'sibling']);
    fs.writeFileSync(path.join(fixture.repo, 'conflict.txt'), 'side version');
    fixture.git(['add', 'conflict.txt']);
    fixture.git(['commit', '-m', 'side conflict']);
    fixture.ok(['restack', '--branch', 'deep']);
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'conflict.txt'), 'child version');
    fixture.git(['add', 'conflict.txt']);
    fixture.git(['commit', '-m', 'child conflict']);
    fixture.ok(['restack', '--branch', 'tip']);
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\n');
    const result = runCliInPty(getTestCliCommand(['ro', '--stack']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Choose a tip', input: 'tip' },
        { prompt: '› tip\r\n', input: '\r' },
      ],
    });
    savePty(result);
    expect(result.status, result.output).not.to.equal(0);
    expect(result.status).not.to.equal(124);
    expect(result.output)
      .to.include('Departure branch: child')
      .and.include('Conflict branch: sibling')
      .and.include('Completed branches: child, tip, base')
      .and.include('Remaining branches: sibling, deep');
    expect(
      fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 3)
    ).to.deep.equal(['tip', 'child', 'base']);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const before = fixture.snapshot();
    expect(fixture.ok(['info'])).to.include('child');
    expect(fixture.ok(['log'])).to.include('deep');
    expect(fixture.snapshot()).to.deep.equal(before);
    fs.writeFileSync(
      path.join(fixture.repo, 'conflict.txt'),
      'resolved side version'
    );
    fixture.git(['add', 'conflict.txt']);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    for (const [name, parent, own] of [
      ['child', 'main', 'child\nchild conflict'],
      ['tip', 'child', 'tip'],
      ['base', 'tip', 'base'],
      ['sibling', 'child', 'sibling\nside conflict'],
      ['deep', 'sibling', 'deep'],
    ]) {
      expect(fixture.parent(name)).to.equal(parent);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
      ).to.equal(own);
    }
    expect(fixture.git(['show', 'deep:conflict.txt'])).to.equal(
      'resolved side version'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const operation of ['rebase-merge', 'rebase-apply'])
      expect(
        fs.existsSync(
          path.resolve(
            fixture.repo,
            fixture.git(['rev-parse', '--git-path', operation])
          )
        )
      ).to.equal(false);
  });

  function savePty(result: {
    readonly status: number | null;
    readonly output: string;
  }): void {
    const directory = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (directory) {
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(
        path.join(directory, `${path.basename(fixture.root)}-pty.jsonl`),
        JSON.stringify(result) + '\n'
      );
    }
  }
});
