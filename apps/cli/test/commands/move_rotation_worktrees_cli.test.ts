import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

function expectParent(
  fixture: CreateCliFixture,
  branch: string,
  parent: string
): void {
  fixture.ok(['checkout', branch]);
  fixture.ok(['down']);
  expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
}

// eslint-disable-next-line max-lines-per-function
describe('move only descendant worktree safety through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const target of ['child', 'tip']) {
    it(`refuses an occupied descendant target ${target} before any rotation effects`, () => {
      fixture.git(['switch', 'other']);
      fixture.git(['worktree', 'add', fixture.linked, target]);
      fixture.stage('main.txt', 'linked staged work', fixture.linked);
      fixture.write('main.txt', 'linked unstaged work', fixture.linked);
      fixture.write('untracked.txt', 'linked private work', fixture.linked);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\nprivate.bin\n'
      );
      const bytes = Buffer.from([0, 255, 13, 10, 42]);
      fs.writeFileSync(path.join(fixture.linked, 'private.bin'), bytes);
      const before = fixture.snapshot();
      const linked = fixture.snapshot(fixture.linked);
      const result = fixture.run(['move', target, '-s', 'base', '--only']);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr)
        .to.include(target)
        .and.match(/worktree|checked out/i);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
      expect(
        fs.readFileSync(path.join(fixture.linked, 'private.bin'))
      ).to.deep.equal(bytes);
      fixture.git(['switch', '--detach'], fixture.linked);
      expectParent(fixture, 'base', 'main');
      expectParent(fixture, 'child', 'base');
      expectParent(fixture, 'tip', 'child');
    });
  }

  it('refuses an occupied empty child target when only parent names would change', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.ok(['create', 'empty-target']);
    fixture.git(['switch', 'empty-source']);
    fixture.git(['worktree', 'add', fixture.linked, 'empty-target']);
    fixture.stage('main.txt', 'linked staged work', fixture.linked);
    fixture.write('main.txt', 'linked unstaged work', fixture.linked);
    const before = fixture.snapshot();
    const linked = fixture.snapshot(fixture.linked);
    const result = fixture.run(['move', 'empty-target', '--only']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('empty-target')
      .and.match(/worktree|checked out/i);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    fixture.git(['switch', '--detach'], fixture.linked);
    expectParent(fixture, 'empty-target', 'empty-source');
    expectParent(fixture, 'empty-source', 'main');
  });

  it('allows a genuinely unchanged occupied deep target when the empty source rotates above it', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.branch('retained', 'empty-source');
    fixture.branch('deep-target', 'retained');
    fixture.git(['switch', 'empty-source']);
    fixture.git(['worktree', 'add', fixture.linked, 'deep-target']);
    fixture.stage('main.txt', 'linked staged work', fixture.linked);
    fixture.write('main.txt', 'linked unstaged work', fixture.linked);
    const linked = fixture.snapshot(fixture.linked);
    const target = fixture.git(['rev-parse', 'deep-target']);
    const retained = fixture.git(['rev-parse', 'retained']);
    fixture.ok(['move', 'deep-target', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty-source');
    expect(fixture.git(['rev-parse', 'empty-source'])).to.equal(target);
    expect(fixture.git(['rev-parse', 'deep-target'])).to.equal(target);
    expect(fixture.git(['rev-parse', 'retained'])).to.equal(retained);
    expect({
      ...fixture.snapshot(fixture.linked),
      refs: linked.refs,
    }).to.deep.equal(linked);
    fixture.git(['switch', '--detach'], fixture.linked);
    expectParent(fixture, 'retained', 'main');
    expectParent(fixture, 'empty-source', 'deep-target');
    expectParent(fixture, 'deep-target', 'retained');
  });

  it('rotates from its own linked worktree without changing the main worktree index or bytes', () => {
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    fixture.stage('main.txt', 'main staged work');
    fixture.write('main.txt', 'main unstaged work');
    fixture.write('untracked.txt', 'main private work');
    const before = fixture.snapshot();
    fixture.ok(['move', 'tip', '--only'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'base'
    );
    expect({ ...fixture.snapshot(), refs: before.refs }).to.deep.equal(before);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
    ).to.equal('child\ntip\nbase');
    fixture.ok(['down'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'tip'
    );
    fixture.ok(['down'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'child'
    );
  });
});
