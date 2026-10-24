import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack reorder preflight and editor recheck through public CLI', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  function refuse(message?: string, cwd = fixture.repo): void {
    const before = fixture.snapshot(cwd);
    const result = fixture.run(['reorder', '--stack', '--interactive'], cwd);
    expect(result.status).not.to.equal(0);
    if (message) expect(result.stdout + result.stderr).to.include(message);
    expect(fixture.snapshot(cwd)).to.deep.equal(before);
  }
  for (const current of ['main', 'untracked', 'detached']) {
    it(`refuses ${current} departure without invoking the editor`, () => {
      if (current === 'untracked') fixture.git(['switch', '-c', 'untracked']);
      else if (current === 'detached')
        fixture.git(['switch', '--detach', 'base']);
      else fixture.git(['switch', 'main']);
      refuse();
      expect(fs.existsSync(fixture.offered)).to.equal(false);
    });
  }
  for (const dirty of ['staged', 'unstaged', 'partial']) {
    it(`preserves raw index and tracked ${dirty} work even for unchanged order`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'first edit');
      if (dirty !== 'unstaged') fixture.git(['add', 'base.txt']);
      if (dirty === 'partial')
        fs.appendFileSync(path.join(fixture.repo, 'base.txt'), '\nsecond edit');
      refuse('tracked changes');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
    });
  }
  for (const operation of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
    'rebase-merge',
    'rebase-apply',
  ]) {
    it(`refuses an existing Git ${operation} operation before editor or topology changes`, () => {
      const location = path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', operation])
      );
      if (operation.endsWith('HEAD'))
        fs.writeFileSync(location, fixture.git(['rev-parse', 'other']) + '\n');
      else fs.mkdirSync(location);
      refuse('operation');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      fs.rmSync(location, { force: true, recursive: true });
    });
  }
  for (const stale of ['base', 'child', 'main']) {
    it(`names the selected stale ${stale} boundary and offers a public restack instruction`, () => {
      fixture.git(['switch', stale]);
      fixture.commit(`${stale}-later`);
      fixture.git(['switch', 'tip']);
      refuse('needs restack');
      const result = fixture.run(['reorder', '--stack', '--interactive']);
      expect(result.stdout + result.stderr).to.include('ch restack --branch');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
    });
  }
  it('refuses a missing tracked parent without recreating or tracking it', () => {
    fixture.git(['switch', 'tip']);
    fixture.git(['branch', '-D', 'child']);
    refuse();
    expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
  });
  for (const parent of ['base', 'child']) {
    it(`bounds fan-out at ${parent} before editor or effects`, () => {
      fixture.branch('sibling', parent);
      fixture.git(['switch', 'base']);
      refuse('fan-out');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
    });
  }
  it('bounds an off-chain sibling below departure until subtree replay is supported', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'child']);
    refuse('other subtrees');
  });
  it('preserves noncolliding untracked and ignored binary bytes while reordering', () => {
    const bytes = Buffer.from([0, 255, 13, 10, 128]);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'ignored.bin\n'
    );
    for (const name of ['ignored.bin', 'untracked.bin'])
      fs.writeFileSync(path.join(fixture.repo, name), bytes);
    fixture.editor('base\ntip\nchild\n');
    fixture.edit();
    for (const name of ['ignored.bin', 'untracked.bin'])
      expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
        bytes
      );
  });
  for (const name of ['child.txt', 'tip.txt']) {
    for (const ignored of [false, true]) {
      it(`protects ${
        ignored ? 'ignored' : 'untracked'
      } bytes in future checkout ${name}`, () => {
        if (ignored)
          fs.writeFileSync(
            path.join(fixture.repo, '.git', 'info', 'exclude'),
            `${name}\n`
          );
        fs.writeFileSync(
          path.join(fixture.repo, name),
          Buffer.from([255, 0, 10])
        );
        fixture.editor('base\ntip\nchild\n');
        refuse(ignored ? 'ignored' : 'untracked');
      });
    }
  }
  for (const mutation of [
    'tracked',
    'checkout',
    'ref',
    'parent',
    'operation',
    'worktree',
    'ignored',
  ]) {
    it(`rechecks ${mutation} changed during the editor and preserves exactly the editor's own effects`, () => {
      const saved = path.join(fixture.root, 'editor-state.json');
      const git =
        "const {execFileSync} = require('child_process'); const git = args => execFileSync('git', args, {encoding:'utf8'}).trim();";
      const track = getTestCliCommand([
        'track',
        'tip',
        '--parent',
        'base',
        '--no-interactive',
      ]);
      const effects: Record<string, string> = {
        tracked:
          "fs.writeFileSync('base.txt', 'editor work'); git(['add', 'base.txt']);",
        checkout: "git(['switch', 'other']);",
        ref: "git(['branch', 'editor-created', 'main']);",
        parent: `execFileSync(${JSON.stringify(track[0])}, ${JSON.stringify(
          track.slice(1)
        )}, {env:process.env});`,
        operation: "fs.mkdirSync(git(['rev-parse','--git-path','sequencer']));",
        worktree: `git(['worktree','add',${JSON.stringify(
          path.join(fixture.root, 'editor-worktree')
        )},'tip']);`,
        ignored:
          "fs.writeFileSync('.git/info/exclude', 'tip.txt\\n'); fs.writeFileSync('tip.txt', Buffer.from([0,255,1]));",
      };
      const capture = `fs.writeFileSync(${JSON.stringify(
        saved
      )}, JSON.stringify({refs:git(['for-each-ref','--format=%(refname) %(objectname)']), head:git(['rev-parse','HEAD']), branch:git(['branch','--show-current']), index:fs.readFileSync(git(['rev-parse','--git-path','index'])).toString('base64')}));`;
      fixture.editor(
        'base\ntip\nchild\n',
        `${git}\n${effects[mutation]}\n${capture}`
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
        branch: fixture.git(['branch', '--show-current']),
        index: fixture.index(),
      }).to.deep.equal(after);
      if (mutation === 'tracked')
        expect(
          fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
        ).to.equal('editor work');
      if (mutation === 'ignored')
        expect(
          fs.readFileSync(path.join(fixture.repo, 'tip.txt'))
        ).to.deep.equal(Buffer.from([0, 255, 1]));
    });
  }
});
