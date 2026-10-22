import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move only worktree scope through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('allows an occupied deep branch when detaching its child already aligns it with the old parent', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.branch('retained', 'empty-source');
    fixture.branch('deep', 'retained');
    fixture.git(['switch', 'empty-source']);
    fixture.commit('later-source');
    fixture.git(['worktree', 'add', fixture.linked, 'deep']);
    fixture.stage('deep.txt', 'linked staged work', fixture.linked);
    fixture.write('deep.txt', 'linked unstaged work', fixture.linked);
    const retained = fixture.git(['rev-parse', 'retained']);
    const deep = fixture.git(['rev-parse', 'deep']);
    const linked = fixture.snapshot(fixture.linked);
    fixture.ok(['move', 'other', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty-source');
    expect(fixture.git(['rev-parse', 'retained'])).to.equal(retained);
    expect(fixture.git(['rev-parse', 'deep'])).to.equal(deep);
    expect({
      ...fixture.snapshot(fixture.linked),
      refs: linked.refs,
    }).to.deep.equal(linked);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..empty-source'])
    ).to.equal('later-source');
    fixture.ok(['checkout', 'retained']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });
  for (const occupied of ['base', 'child', 'tip', 'sibling', 'sibling-tip']) {
    it(`rejects occupied ${occupied} before either only component changes parents or work`, () => {
      fixture.branch('sibling', 'base');
      fixture.branch('sibling-tip', 'sibling');
      fixture.git(['switch', occupied === 'base' ? 'other' : 'base']);
      fixture.git(['worktree', 'add', fixture.linked, occupied]);
      fixture.stage('main.txt', 'linked staged work', fixture.linked);
      fixture.write('main.txt', 'linked unstaged work', fixture.linked);
      fixture.write('private.txt', 'linked untracked work', fixture.linked);
      const before = fixture.snapshot();
      const linked = fixture.snapshot(fixture.linked);
      expect(
        fixture.run(['move', 'other', '-s', 'base', '--only']).status
      ).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
      fixture.git(['switch', '--detach'], fixture.linked);
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  for (const readonly of ['main', 'other']) {
    it(`allows read-only ${readonly} in a dirty worktree during both only components`, () => {
      fixture.git(['worktree', 'add', fixture.linked, readonly]);
      fixture.stage('main.txt', 'linked staged work', fixture.linked);
      fixture.write('main.txt', 'linked unstaged work', fixture.linked);
      const ignored = path.join(fixture.linked, 'linked-private.bin');
      fs.appendFileSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'info/exclude'])
        ),
        '\nlinked-private.bin\n'
      );
      const bytes = Buffer.from([0, 255, 13, 10, 42]);
      fs.writeFileSync(ignored, bytes);
      const before = fixture.snapshot(fixture.linked);
      fixture.ok(['move', 'other', '--only']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect({
        ...fixture.snapshot(fixture.linked),
        refs: before.refs,
      }).to.deep.equal(before);
      expect(fs.readFileSync(ignored)).to.deep.equal(bytes);
      expect(fixture.git(['log', '--format=%s', 'other..base'])).to.equal(
        'base'
      );
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
      ).to.equal('child\ntip');
      fixture.git(['switch', '--detach'], fixture.linked);
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  it('rejects an occupied empty direct child when only its parent name would change', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.ok(['create', 'empty-child']);
    fixture.git(['switch', 'empty-source']);
    fixture.git(['worktree', 'add', fixture.linked, 'empty-child']);
    fixture.stage('main.txt', 'linked staged work', fixture.linked);
    fixture.write('main.txt', 'linked unstaged work', fixture.linked);
    const before = fixture.snapshot();
    const linked = fixture.snapshot(fixture.linked);
    expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    fixture.git(['switch', '--detach'], fixture.linked);
    fixture.ok(['checkout', 'empty-child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty-source');
  });

  it('includes an already-needs-restack deep branch in the only preflight', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.branch('retained', 'empty-source');
    fixture.branch('deep', 'retained');
    fixture.git(['switch', 'retained']);
    fixture.commit('retained-later');
    fixture.git(['switch', 'empty-source']);
    fixture.git(['worktree', 'add', fixture.linked, 'deep']);
    fixture.stage('deep.txt', 'linked staged work', fixture.linked);
    const before = fixture.snapshot();
    const linked = fixture.snapshot(fixture.linked);
    expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    fixture.git(['switch', '--detach'], fixture.linked);
    fixture.ok(['checkout', 'retained']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty-source');
  });

  it('runs both only components from its own linked worktree and preserves the main index and bytes', () => {
    fixture.git(['switch', 'main']);
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    fixture.stage('main.txt', 'main staged work');
    fixture.write('main.txt', 'main unstaged work');
    fixture.write('private.txt', 'main untracked work');
    const before = fixture.snapshot();
    fixture.ok(['move', 'other', '--only'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'base'
    );
    expect({ ...fixture.snapshot(), refs: before.refs }).to.deep.equal(before);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    fixture.git(['switch', '--detach']);
    fixture.ok(['checkout', 'child'], fixture.linked);
    fixture.ok(['down'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'main'
    );
  });

  for (const dirty of ['staged', 'unstaged', 'partial']) {
    it(`preserves ${dirty} tracked work before changing either only component`, () => {
      fixture.git(['switch', 'other']);
      if (dirty !== 'unstaged') fixture.stage('main.txt', 'staged own work');
      if (dirty !== 'staged') fixture.write('main.txt', 'unstaged own work');
      const before = fixture.snapshot();
      expect(
        fixture.run(['move', 'other', '-s', 'base', '--only']).status
      ).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }
});
