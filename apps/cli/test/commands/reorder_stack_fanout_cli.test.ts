import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('unique-tip stack reorder preserves fan-out through the public editor', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  it('offers only the chain above departure and replays multiple roots and deep original own ranges', () => {
    fixture.branch('side-a', 'base');
    fixture.commit('side-a-second');
    fixture.branch('deep', 'side-a');
    fixture.branch('empty', 'deep', true);
    fixture.branch('last', 'empty');
    fixture.branch('side-b', 'base');
    fixture.git(['switch', 'child']);
    const main = fixture.git(['rev-parse', 'main']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.editor('base\ntip\nchild\n');
    fixture.edit();
    expect(
      fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 3)
    ).to.deep.equal(['tip', 'child', 'base']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    for (const [name, parent, own] of [
      ['child', 'main', 'child'],
      ['tip', 'child', 'tip'],
      ['base', 'tip', 'base'],
      ['side-a', 'base', 'side-a\nside-a-second'],
      ['deep', 'side-a', 'deep'],
      ['empty', 'deep', ''],
      ['last', 'empty', 'last'],
      ['side-b', 'base', 'side-b'],
    ]) {
      expect(fixture.parent(name)).to.equal(parent);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
      ).to.equal(own);
      expect(fixture.git(['merge-base', name, parent])).to.equal(
        fixture.git(['rev-parse', parent])
      );
    }
    expect(fixture.git(['ls-tree', '-r', '--name-only', 'last'])).to.equal(
      'base.txt\nchild.txt\ndeep.txt\nlast.txt\nmain.txt\nside-a-second.txt\nside-a.txt\ntip.txt'
    );
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(fixture.git(['log', '--all', '--merges', '--format=%s'])).to.equal(
      ''
    );
  });
  it('retains newer parent work and original stale subtree own commits', () => {
    fixture.branch('side', 'base');
    fixture.commit('side-second');
    fixture.branch('deep', 'side');
    fixture.git(['switch', 'base']);
    fixture.commit('base-later');
    fixture.ok(['restack', '--branch', 'child']);
    fixture.git(['switch', 'child']);
    fixture.editor('tip\nbase\nchild\n');
    fixture.edit();
    expect(fixture.parent('side')).to.equal('base');
    expect(fixture.parent('deep')).to.equal('side');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..deep'])
    ).to.equal('child\nbase\nbase-later\nside\nside-second\ndeep');
    expect(fixture.git(['show', 'deep:base-later.txt'])).to.equal('base-later');
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });
  it('refuses an invalid off-chain own boundary before editor or any mutation', () => {
    fixture.branch('side', 'base');
    fixture.branch('deep', 'side');
    fixture.git(['switch', 'child']);
    fixture.git([
      'update-ref',
      'refs/heads/side',
      fixture.git(['rev-parse', 'main']),
    ]);
    const before = fixture.snapshot();
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(fs.existsSync(fixture.offered)).to.equal(false);
    expect(fixture.snapshot()).to.deep.equal(before);
  });
  it('blocks a deep empty descendant inheriting an unknown future parent tip in another dirty worktree', () => {
    fixture.branch('side', 'base');
    fixture.branch('deep', 'side', true);
    fixture.git(['switch', 'child']);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'deep']);
    fs.writeFileSync(path.join(linked, 'side.txt'), 'staged linked');
    fixture.git(['add', 'side.txt'], linked);
    fs.appendFileSync(path.join(linked, 'side.txt'), ' and unstaged');
    const before = fixture.snapshot();
    const other = fixture.snapshot(linked);
    const parents = fixture.ok(['log', 'short']);
    fixture.editor('base\ntip\nchild\n');
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('deep');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(linked)).to.deep.equal(other);
    expect(fixture.ok(['log', 'short'])).to.equal(parents);
  });
  it('allows an unchanged deep dirty worktree when empty reordered ancestors preserve known tips', () => {
    fixture.branch('e-base', 'main', true);
    fixture.branch('e-work', 'e-base');
    fixture.branch('e-top', 'e-work', true);
    fixture.branch('side', 'e-base', true);
    fixture.branch('deep', 'side');
    fixture.git(['switch', 'e-work']);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'deep']);
    fs.writeFileSync(path.join(linked, 'deep.txt'), 'staged deep');
    fixture.git(['add', 'deep.txt'], linked);
    fs.appendFileSync(path.join(linked, 'deep.txt'), ' and unstaged');
    const before = fixture.snapshot(linked);
    const side = fixture.git(['rev-parse', 'side']);
    const deep = fixture.git(['rev-parse', 'deep']);
    fixture.editor('e-work\ne-top\ne-base\n');
    fixture.edit();
    expect(fixture.git(['rev-parse', 'side'])).to.equal(side);
    expect(fixture.git(['rev-parse', 'deep'])).to.equal(deep);
    expect({ ...fixture.snapshot(linked), refs: '' }).to.deep.equal({
      ...before,
      refs: '',
    });
    expect(fixture.git(['branch', '--show-current'])).to.equal('e-work');
  });
  it('executes the full fan-out from its own linked worktree while preserving a dirty read-only trunk', () => {
    fixture.branch('side', 'base');
    fixture.branch('deep', 'side');
    fixture.git(['switch', 'main']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged trunk');
    fixture.git(['add', 'main.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'main.txt'), ' and unstaged');
    const before = fixture.snapshot();
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    fixture.editor('base\ntip\nchild\n');
    fixture.edit(['reorder', '--stack'], linked);
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal('child');
    expect(fixture.git(['status', '--porcelain'], linked)).to.equal('');
    expect({ ...fixture.snapshot(), refs: '' }).to.deep.equal({
      ...before,
      refs: '',
    });
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..deep'])
    ).to.equal('child\ntip\nbase\nside\ndeep');
  });
  for (const mutation of ['ref', 'parent', 'worktree', 'ignored']) {
    it(`rechecks an off-chain ${mutation} introduced by the editor without subsequent CLI effects`, () => {
      fixture.branch('side', 'base');
      fixture.branch('deep', 'side');
      fixture.git(['switch', 'child']);
      const saved = path.join(fixture.root, 'editor-state.json');
      const track = getTestCliCommand([
        'track',
        'deep',
        '--parent',
        'base',
        '--no-interactive',
      ]);
      const effects: Record<string, string> = {
        ref: "git(['update-ref','refs/heads/deep',git(['rev-parse','side'])]);",
        parent: `execFileSync(${JSON.stringify(track[0])},${JSON.stringify(
          track.slice(1)
        )},{env:process.env});`,
        worktree: `git(['worktree','add',${JSON.stringify(
          path.join(fixture.root, 'editor-linked')
        )},'deep']);`,
        ignored:
          "fs.writeFileSync('.git/info/exclude','deep.txt\\n'); fs.writeFileSync('deep.txt',Buffer.from([0,255,13]));",
      };
      fixture.editor(
        'base\ntip\nchild\n',
        `const {execFileSync}=require('child_process'); const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim(); ${
          effects[mutation]
        } fs.writeFileSync(${JSON.stringify(
          saved
        )},JSON.stringify({refs:git(['for-each-ref','--format=%(refname) %(objectname)']),head:git(['rev-parse','HEAD']),index:fs.readFileSync(git(['rev-parse','--git-path','index'])).toString('base64')}));`
      );
      const result = fixture.run(['reorder', '--stack', '--interactive']);
      expect(result.status).not.to.equal(0);
      const after: unknown = JSON.parse(fs.readFileSync(saved, 'utf8'));
      expect({
        refs: fixture.git([
          'for-each-ref',
          '--format=%(refname) %(objectname)',
        ]),
        head: fixture.git(['rev-parse', 'HEAD']),
        index: fixture.index(),
      }).to.deep.equal(after);
      if (mutation === 'ignored')
        expect(
          fs.readFileSync(path.join(fixture.repo, 'deep.txt'))
        ).to.deep.equal(Buffer.from([0, 255, 13]));
      expect(fixture.parent('base')).to.equal('main');
      expect(fixture.parent('child')).to.equal('base');
    });
  }
  it('resolves the first real off-chain conflict using fresh info log and continue and returns to C', () => {
    fixture.branch('side', 'base', true);
    fs.writeFileSync(
      path.join(fixture.repo, 'side-conflict.txt'),
      'side version'
    );
    fixture.git(['add', 'side-conflict.txt']);
    fixture.git(['commit', '-m', 'side own conflict']);
    fixture.branch('deep', 'side');
    fixture.git(['switch', 'child']);
    fs.writeFileSync(
      path.join(fixture.repo, 'side-conflict.txt'),
      'child version'
    );
    fixture.git(['add', 'side-conflict.txt']);
    fixture.git(['commit', '-m', 'child own conflict']);
    fixture.ok(['restack', '--branch', 'tip']);
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\n');
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Hit conflict restacking side'
    );
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(fixture.ok(['info'])).to.include('child');
    expect(fixture.ok(['log'])).to.include('deep');
    fs.writeFileSync(
      path.join(fixture.repo, 'side-conflict.txt'),
      'resolved side version'
    );
    fixture.git(['add', 'side-conflict.txt']);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.parent('side')).to.equal('base');
    expect(fixture.parent('deep')).to.equal('side');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'base..side'])
    ).to.equal('side own conflict');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'side..deep'])
    ).to.equal('deep');
    expect(fixture.git(['show', 'deep:side-conflict.txt'])).to.equal(
      'resolved side version'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(false);
  });
  it('keeps an unchanged chain a true no-op even with a stale off-chain subtree', () => {
    fixture.branch('side', 'base');
    fixture.git(['switch', 'base']);
    fixture.commit('base-later');
    fixture.ok(['restack', '--branch', 'child']);
    fixture.git(['switch', 'child']);
    const before = fixture.snapshot();
    fixture.editor();
    fixture.edit();
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.parent('side')).to.equal('base');
  });
  for (const missing of ['side', 'deep']) {
    it(`refuses a missing tracked off-chain ${missing} ref before the editor or any mutation`, () => {
      fixture.branch('side', 'base');
      fixture.branch('deep', 'side');
      fixture.git(['switch', 'child']);
      fixture.git(['branch', '-D', missing]);
      fixture.editor('base\ntip\nchild\n');
      const before = fixture.snapshot();
      const result = fixture.run(['reorder', '--stack', '--interactive']);
      expect(result.status).not.to.equal(0);
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }
});
