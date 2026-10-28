import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import stripAnsi from 'strip-ansi';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

function childrenSection(output: string): string[] {
  const lines = stripAnsi(output).split('\n');
  const heading = lines.indexOf('Children:');
  expect(heading, 'rendered Children header').not.to.equal(-1);
  const section = lines.slice(heading + 1);
  const end = section.indexOf('');
  return end === -1 ? section : section.slice(0, end);
}

describe('info children rendering through the public CLI', function () {
  this.timeout(60000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture({
      ...process.env,
      GIT_AUTHOR_DATE: '2026-10-20T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-20T12:00:00Z',
    });
  });
  afterEach(() => {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    fixture.cleanup();
  });

  it('renders the direct child for implicit and explicit subjects from every checkout', () => {
    const expected = fixture.ok(['children']).split('\n').filter(Boolean);
    expect(expected).to.deep.equal(['child']);
    const initial = fixture.ok(['info']);
    expect(childrenSection(initial)).to.deep.equal(['▸ child']);
    expect(stripAnsi(initial)).to.include('Parent: main');
    for (const checkout of ['base', 'tip', 'main']) {
      fixture.git(['switch', checkout]);
      for (const args of [
        ['info', 'base'],
        ['info', '--branch', 'base'],
        ['i', 'base'],
        ...(checkout === 'base' ? [['info']] : []),
      ]) {
        const before = fixture.inspectionSnapshot();
        const output = fixture.ok(args);
        expect(stripAnsi(output), args.join(' ')).to.equal(stripAnsi(initial));
        expect(childrenSection(output)).to.deep.equal(
          expected.map((name) => `▸ ${name}`)
        );
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      }
    }
  });

  it('keeps an empty Children header for a leaf', () => {
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['info', 'tip'],
      ['i', '--branch', 'tip'],
    ]) {
      const output = fixture.ok(args);
      expect(childrenSection(output)).to.deep.equal([]);
      expect(stripAnsi(output)).to.include('Parent: child');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fixture.git(['switch', 'tip']);
    expect(fixture.ok(['children'])).to.equal('');
    expect(childrenSection(fixture.ok(['info']))).to.deep.equal([]);
  });

  it('lists every direct child in public children order with exact Unicode spelling', () => {
    for (const name of ['topic/😀', 'topic/\uE000', 'alpha'])
      fixture.branch(name, 'base', true);
    fixture.git(['switch', 'base']);
    const expected = ['alpha', 'child', 'topic/\uE000', 'topic/😀'];
    expect(fixture.ok(['children']).split('\n').filter(Boolean)).to.deep.equal(
      expected
    );
    fixture.git(['switch', 'other']);
    const before = fixture.inspectionSnapshot();
    expect(childrenSection(fixture.ok(['info', 'base']))).to.deep.equal(
      expected.map((name) => `▸ ${name}`)
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
