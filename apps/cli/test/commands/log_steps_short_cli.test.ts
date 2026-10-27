import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import {
  getFullLogNodes,
  getShortLogNodes,
  LogStepsCliFixture,
} from '../lib/fixtures/log_steps_cli';

const shortRoutes = [
  ['log', 'short'],
  ['log', 's'],
  ['l', 'short'],
  ['l', 's'],
  ['ls'],
] as const;

// eslint-disable-next-line max-lines-per-function
describe('short log zero depth through the public CLI', function () {
  this.timeout(120000);
  let fixture: LogStepsCliFixture;
  afterEach(() => fixture.cleanup());

  function recordCase(title: string | undefined): void {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (!evidence) return;
    fs.mkdirSync(evidence, { recursive: true });
    fs.appendFileSync(
      path.join(evidence, 'short-log-cases.jsonl'),
      JSON.stringify({ fullTitle: title, fixture: fixture.root }) + '\n'
    );
  }

  function expectCurrentOnly(args: readonly string[]): void {
    const before = fixture.logSnapshot();
    const current = fixture.git(['branch', '--show-current']);
    const revision = fixture.git(['rev-parse', '--short', 'HEAD']);
    const result = fixture.run([...args, '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(getShortLogNodes(result.stdout)).to.deep.equal([current]);
    expect(result.stdout.match(/^◉/gm)).to.have.length(1);
    expect(result.stdout)
      .not.to.include(revision)
      .and.not.to.include('(current)');
    expect(result.stderr).to.equal('');
    expect(fixture.logSnapshot()).to.deep.equal(before);
  }

  describe('minimal main-to-child stack', () => {
    beforeEach(function () {
      fixture = new LogStepsCliFixture();
      recordCase(this.currentTest?.fullTitle());
    });
    for (const route of shortRoutes) {
      it(`selects the current child through ${route.join(' ')}`, () => {
        expectCurrentOnly([...route, '--steps', '0']);
      });
    }
    for (const flags of [['--steps=0'], ['-n', '0'], ['-n0']]) {
      it(`accepts ${flags.join(' ')} through canonical short log`, () => {
        expectCurrentOnly(['log', 'short', ...flags]);
      });
    }
    it('accepts attached short zero through the compact alias', () => {
      expectCurrentOnly(['ls', '-n0']);
    });
  });

  describe('recorded branching topology', () => {
    beforeEach(function () {
      fixture = new LogStepsCliFixture('branched');
      recordCase(this.currentTest?.fullTitle());
    });
    for (const route of shortRoutes) {
      it(`shows only search through ${route.join(
        ' '
      )} with and without stack`, () => {
        for (const flags of [[], ['--stack']])
          expectCurrentOnly([...route, '--steps', '0', ...flags]);
      });
    }

    it('shows the current branch even when its hidden descendants fan out', () => {
      fixture.branch('release-next', 'search');
      fixture.git(['switch', 'search']);
      const before = fixture.logSnapshot();
      const current = fixture.git(['branch', '--show-current']);
      const revision = fixture.git(['rev-parse', '--short', 'HEAD']);
      const subject = fixture.git(['log', '-1', '--format=%s']);
      for (const flags of [[], ['--reverse']]) {
        for (const route of [['log', 'short'], ['ls']])
          expectCurrentOnly([...route, '--steps', '0', '--stack', ...flags]);
        const full = fixture.run([
          'log',
          '--steps',
          '0',
          ...flags,
          '--no-interactive',
        ]);
        expect(full.status, full.stdout + full.stderr).to.equal(0);
        expect(getFullLogNodes(full.stdout)).to.deep.equal([current]);
        expect(full.stdout).to.include(`${current} (current)`);
        expect(full.stdout).to.include(revision).and.include(subject);
        expect(full.stderr).to.equal('');
      }
      expect(fixture.logSnapshot()).to.deep.equal(before);
    });

    it('preserves short output with omitted depth and stack selection', () => {
      const before = fixture.logSnapshot();
      for (const flags of [[], ['--stack']]) {
        const result = fixture.run([
          'log',
          'short',
          ...flags,
          '--no-interactive',
        ]);
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
        expect(getShortLogNodes(result.stdout))
          .to.have.members(expected)
          .and.have.length(expected.length);
        expect(result.stdout).to.match(/◉[─┬┴┐┘ ]+search(?: |$)/m);
        expect(result.stderr).to.equal('');
      }
      expect(fixture.logSnapshot()).to.deep.equal(before);
    });

    it('preserves short output with positive depths one and two', () => {
      const before = fixture.logSnapshot();
      for (const depth of [1, 2]) {
        const result = fixture.run([
          'log',
          'short',
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
        expect(getShortLogNodes(result.stdout))
          .to.have.members(expected)
          .and.have.length(expected.length);
        expect(result.stdout).to.match(/◉[─┬┴┐┘ ]+search(?: |$)/m);
        expect(result.stderr).to.equal('');
      }
      expect(fixture.logSnapshot()).to.deep.equal(before);
    });
  });
});
