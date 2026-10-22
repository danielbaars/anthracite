import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

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
describe('move only descendant rotation through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('rotates a source above its updated direct child and keeps deeper own history', () => {
    const main = fixture.git(['rev-parse', 'main']);
    const other = fixture.git(['rev-parse', 'other']);
    const oldChild = fixture.git(['rev-parse', 'child']);
    fixture.ok(['move', 'child', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    const child = fixture.git(['rev-parse', 'child']);
    expect(child).not.to.equal(oldChild);
    expect(fixture.git(['rev-parse', 'base^'])).to.equal(child);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
    ).to.equal('child\nbase');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'child..tip'])
    ).to.equal('tip');
    expect(fixture.git(['ls-tree', '--name-only', 'child'])).to.equal(
      'child.txt\nmain.txt'
    );
    expect(fixture.git(['ls-tree', '--name-only', 'base'])).to.equal(
      'base.txt\nchild.txt\nmain.txt'
    );
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'child.txt\nmain.txt\ntip.txt'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const [branch, parent] of [
      ['child', 'main'],
      ['base', 'child'],
      ['tip', 'child'],
    ])
      expectParent(fixture, branch, parent);
  });

  it('rotates above an updated deep target after all fan-out subtrees while preserving an untracked departure', () => {
    fixture.branch('sibling', 'base');
    fixture.commit('sibling-second');
    fixture.branch('sibling-tip', 'sibling');
    fixture.git(['switch', 'child']);
    fixture.commit('child-second');
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    fixture.commit('base-second');
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', '-c', 'departure', 'other']);
    const departure = fixture.git(['rev-parse', 'departure']);
    const other = fixture.git(['rev-parse', 'other']);
    const main = fixture.git(['rev-parse', 'main']);
    const names = fixture.git([
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
    ]);
    const bytes = Buffer.from([0, 255, 13, 10, 42]);
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\nprivate.bin\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'private.bin'), bytes);
    fs.writeFileSync(path.join(fixture.repo, 'untracked.bin'), bytes);
    fixture.ok(['move', '-o', 'tip', '-s', 'base', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('departure');
    expect(fixture.git(['rev-parse', 'departure'])).to.equal(departure);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(
      fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads'])
    ).to.equal(names);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'private.bin'))
    ).to.deep.equal(bytes);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.bin'))
    ).to.deep.equal(bytes);
    expect(fixture.run(['down']).status).not.to.equal(0);
    for (const [branch, parent, own] of [
      ['base', 'tip', 'base\nbase-second'],
      ['child', 'main', 'child\nchild-second'],
      ['tip', 'child', 'tip'],
      ['sibling', 'main', 'sibling\nsibling-second'],
      ['sibling-tip', 'sibling', 'sibling-tip'],
    ]) {
      expect(fixture.git(['merge-base', branch, parent])).to.equal(
        fixture.git(['rev-parse', parent])
      );
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${branch}`])
      ).to.equal(own);
      expectParent(fixture, branch, parent);
    }
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'child-second.txt\nchild.txt\nmain.txt\ntip.txt'
    );
    expect(fixture.git(['show', 'base:base-second.txt'])).to.equal(
      'base-second'
    );
    expect(fixture.git(['show', 'sibling-tip:sibling-second.txt'])).to.equal(
      'sibling-second'
    );
    expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
  });

  it('rotates an empty source without rewriting its already-aligned descendant target', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.branch('retained', 'empty-source');
    fixture.branch('deep-target', 'retained');
    const retained = fixture.git(['rev-parse', 'retained']);
    const target = fixture.git(['rev-parse', 'deep-target']);
    const count = fixture.git(['rev-list', '--count', '--all']);
    fixture.git(['switch', 'empty-source']);
    fixture.ok(['move', 'deep-target', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty-source');
    expect(fixture.git(['rev-parse', 'retained'])).to.equal(retained);
    expect(fixture.git(['rev-parse', 'deep-target'])).to.equal(target);
    expect(fixture.git(['rev-parse', 'empty-source'])).to.equal(target);
    expect(
      fixture.git(['log', '--format=%s', 'deep-target..empty-source'])
    ).to.equal('');
    expect(fixture.git(['rev-list', '--count', '--all'])).to.equal(count);
    for (const [branch, parent] of [
      ['retained', 'main'],
      ['deep-target', 'retained'],
      ['empty-source', 'deep-target'],
    ])
      expectParent(fixture, branch, parent);
  });

  for (const parent of ['base', 'child']) {
    it(`rotates through an empty descendant target originally above ${parent} without helper commits`, () => {
      fixture.git(['switch', parent]);
      fixture.ok(['create', 'empty-target']);
      const source = fixture.git(['rev-parse', 'base']);
      fixture.git(['switch', 'base']);
      fixture.ok(['move', 'empty-target', '--only']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      const targetParent = parent === 'base' ? 'main' : 'child';
      expect(fixture.git(['rev-parse', 'empty-target'])).to.equal(
        fixture.git(['rev-parse', targetParent])
      );
      expect(
        fixture.git(['log', '--format=%s', 'empty-target..base'])
      ).to.equal('base');
      if (parent === 'base')
        expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
      else
        expect(fixture.git(['rev-parse', 'base^'])).to.equal(
          fixture.git(['rev-parse', 'empty-target'])
        );
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
      ).to.equal('child\ntip');
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expectParent(fixture, 'empty-target', targetParent);
      expectParent(fixture, 'base', 'empty-target');
      expectParent(fixture, 'child', 'main');
    });
  }

  it('selects an original descendant in a real terminal and returns to a different departure', () => {
    fixture.git(['switch', 'other']);
    const oldChild = fixture.git(['rev-parse', 'child']);
    const result = runCliInPty(
      getTestCliCommand(['move', '-s', 'base', '--only']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Choose a new base', input: '\u001b[A\u001b[A\r' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('Choose a new base for base');
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(oldChild);
    expect(fixture.git(['rev-parse', 'base^'])).to.equal(
      fixture.git(['rev-parse', 'tip'])
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
    ).to.equal('child\ntip\nbase');
    expectParent(fixture, 'base', 'tip');
    expectParent(fixture, 'child', 'main');
  });
});
