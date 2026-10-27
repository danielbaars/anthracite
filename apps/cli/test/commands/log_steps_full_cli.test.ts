import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import {
  getFullLogNodes,
  LogStepsCliFixture,
} from '../lib/fixtures/log_steps_cli';

const minimalCases = [
  [
    'selects the current child rather than trunk at explicit zero',
    ['log', '--steps', '0'],
  ],
  ['accepts equals zero through full log', ['log', '--steps=0']],
  ['accepts separated short zero through full log', ['log', '-n', '0']],
  ['accepts attached short zero through full log', ['log', '-n0']],
  ['selects the current child through the full alias', ['l', '--steps', '0']],
  ['accepts attached short zero through the full alias', ['l', '-n0']],
  [
    'excludes downstack ancestors when zero is combined with stack',
    ['log', '--steps', '0', '--stack'],
  ],
] as const;

// eslint-disable-next-line max-lines-per-function
describe('full log zero depth through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  afterEach(() => fixture.cleanup());

  function recordCase(title: string | undefined): void {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (!evidence) return;
    fs.mkdirSync(evidence, { recursive: true });
    fs.appendFileSync(
      path.join(evidence, 'full-log-cases.jsonl'),
      JSON.stringify({ fullTitle: title, fixture: fixture.root }) + '\n'
    );
  }

  function expectCurrentOnly(args: readonly string[]): void {
    const before = fixture.logSnapshot();
    const current = fixture.git(['branch', '--show-current']);
    const revision = fixture.git(['rev-parse', '--short', 'HEAD']);
    const subject = fixture.git(['log', '-1', '--format=%s']);
    const result = fixture.run([...args, '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(getFullLogNodes(result.stdout)).to.deep.equal([current]);
    expect(result.stdout).to.include(`${current} (current)`);
    expect(result.stdout).to.include(revision).and.include(subject);
    expect(result.stderr).to.equal('');
    expect(fixture.logSnapshot()).to.deep.equal(before);
  }

  describe('minimal main-to-child stack', () => {
    beforeEach(function () {
      fixture = new LogStepsCliFixture();
      recordCase(this.currentTest?.fullTitle());
    });
    for (const [title, args] of minimalCases) {
      it(title, () => expectCurrentOnly(args));
    }
  });

  describe('recorded branching topology', () => {
    beforeEach(function () {
      fixture = new LogStepsCliFixture('branched');
      recordCase(this.currentTest?.fullTitle());
    });
    for (const route of ['log', 'l']) {
      it(`shows only search through ${route} with and without stack`, () => {
        for (const flags of [[], ['--stack']])
          expectCurrentOnly([route, '--steps', '0', ...flags]);
      });
    }

    it('preserves omitted depth with and without stack selection', () => {
      const before = fixture.logSnapshot();
      for (const flags of [[], ['--stack']]) {
        const result = fixture.run(['log', ...flags, '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const expected = [
          'main',
          'base',
          'search',
          'ui',
          'empty-tip',
          'feature/café-long-branch-name-for-terminal-width',
          ...(flags.length ? [] : ['api', 'api-followup', 'maintenance']),
        ];
        const actual = getFullLogNodes(result.stdout);
        expect(actual)
          .to.have.members(expected)
          .and.have.length(expected.length);
        expect(result.stderr).to.equal('');
      }
      expect(fixture.logSnapshot()).to.deep.equal(before);
    });

    it('preserves positive depths one and two', () => {
      const before = fixture.logSnapshot();
      for (const depth of [1, 2]) {
        const result = fixture.run([
          'log',
          '--steps',
          String(depth),
          '--no-interactive',
        ]);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const expected = [
          'base',
          'search',
          'ui',
          'feature/café-long-branch-name-for-terminal-width',
          ...(depth === 2 ? ['main', 'empty-tip'] : []),
        ];
        const actual = getFullLogNodes(result.stdout);
        expect(actual)
          .to.have.members(expected)
          .and.have.length(expected.length);
        expect(result.stderr).to.equal('');
      }
      expect(fixture.logSnapshot()).to.deep.equal(before);
    });
  });
});
