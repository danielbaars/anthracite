import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

describe('test command execution scope', function () {
  this.timeout(120000);
  const cases = [
    { flags: [], expected: ['base', 'child', 'tip', 'fork'] },
    { flags: ['--upstack'], expected: ['child', 'tip', 'fork'] },
    { flags: ['-u'], expected: ['child', 'tip', 'fork'] },
    { flags: ['--downstack'], expected: ['base', 'child'] },
    { flags: ['-d'], expected: ['base', 'child'] },
    { flags: ['--trunk'], expected: ['main', 'base', 'child', 'tip', 'fork'] },
    {
      flags: ['--upstack', '--trunk'],
      expected: ['main', 'child', 'tip', 'fork'],
    },
    { flags: ['--downstack', '-t'], expected: ['main', 'base', 'child'] },
    { flags: ['--downstack'], current: 'main', expected: [] },
    { flags: ['--downstack', '--trunk'], current: 'main', expected: ['main'] },
  ];
  for (const scenario of cases) {
    it(`executes exactly ${
      scenario.expected.join(', ') || 'no branches'
    } from ${scenario.current ?? 'child'} with ${
      scenario.flags.join(' ') || 'default scope'
    }`, () => {
      const fixture = new RelationCliFixture();
      try {
        fixture.branch('sibling', 'base');
        fixture.branch('fork', 'child');
        const current = scenario.current ?? 'child';
        fixture.git(['switch', current]);
        const before = fixture.git(['for-each-ref']);
        const index = fixture.git(['ls-files', '--stage']);
        const visited = path.join(fixture.root, 'visited.txt');
        fs.writeFileSync(visited, '');
        fixture.ok([
          'test',
          ...scenario.flags,
          `git branch --show-current >> '${visited}'`,
        ]);
        const actual = fs
          .readFileSync(visited, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean);
        expect(actual.slice().sort()).to.deep.equal(
          scenario.expected.slice().sort()
        );
        expect(fixture.git(['branch', '--show-current'])).to.equal(current);
        expect(fixture.git(['for-each-ref'])).to.equal(before);
        expect(fixture.git(['ls-files', '--stage'])).to.equal(index);
        expect(fixture.git(['status', '--porcelain'])).to.equal('');
        if (scenario.flags.includes('--trunk') || scenario.flags.includes('-t'))
          expect(actual[0]).to.equal('main');
      } finally {
        fixture.cleanup();
      }
    });
  }
});
