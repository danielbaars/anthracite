import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// Each spelling executes independently on an equivalent real Git repository.
// eslint-disable-next-line max-lines-per-function
describe('modern alias compatibility through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-alias-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          root: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => fixture?.cleanup());

  const navigation = [
    {
      commands: ['checkout', 'co'],
      start: 'base',
      args: ['other'],
      target: 'other',
    },
    { commands: ['up', 'u'], start: 'base', args: ['2'], target: 'tip' },
    { commands: ['down', 'd'], start: 'tip', args: ['2'], target: 'base' },
    { commands: ['top', 't'], start: 'base', args: [], target: 'tip' },
    { commands: ['bottom', 'b'], start: 'tip', args: [], target: 'base' },
  ];
  for (const row of navigation)
    for (const command of row.commands)
      it(`${command} navigates to ${row.target} while preserving refs and untracked work`, () => {
        fixture.git(['switch', row.start]);
        fs.writeFileSync(path.join(fixture.repo, 'untracked.txt'), 'kept');
        const refs = fixture.refs();
        const result = fixture.run([command, ...row.args, '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(fixture.git(['branch', '--show-current'])).to.equal(row.target);
        expect(fixture.refs()).to.equal(refs);
        expect(
          fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
        ).to.equal('kept');
      });

  for (const command of ['up', 'u'])
    for (const option of ['-n', '--steps'])
      it(`${command} preserves ${option} traversal`, () => {
        fixture.ok([command, option, '2']);
        expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
      });
  for (const command of ['down', 'd'])
    for (const option of ['-n', '--steps'])
      it(`${command} preserves ${option} traversal`, () => {
        fixture.git(['switch', 'tip']);
        fixture.ok([command, option, '2']);
        expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      });

  for (const command of ['rename', 'rn'])
    it(`${command} renames the branch and repairs its child parent without rewriting commits`, () => {
      const head = fixture.git(['rev-parse', 'HEAD']);
      const child = fixture.git(['rev-parse', 'child']);
      fixture.ok([command, 'renamed']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('renamed');
      expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(head);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
      expect(fixture.parent('child')).to.equal('renamed');
      expect(fixture.git(['branch', '--list', 'base'])).to.equal('');
    });

  for (const command of ['delete', 'dl'])
    it(`${command} deletes only the selected leaf and retains other refs`, () => {
      const other = fixture.git(['rev-parse', 'other']);
      const base = fixture.git(['rev-parse', 'base']);
      fixture.ok([command, 'tip', '--force']);
      expect(fixture.git(['branch', '--list', 'tip'])).to.equal('');
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
      expect(fixture.run(['info', 'tip']).status).not.to.equal(0);
      expect(fixture.parent('child')).to.equal('base');
    });

  for (const command of ['squash', 'sq'])
    it(`${command} squashes current commits and restacks descendants`, () => {
      fixture.commit('extra');
      const tree = fixture.git(['rev-parse', 'HEAD^{tree}']);
      fixture.ok([command, '--message', 'combined']);
      expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('1');
      expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
        'combined'
      );
      expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-parse', 'child^'])).to.equal(
        fixture.git(['rev-parse', 'base'])
      );
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });

  for (const command of ['restack', 'r'])
    it(`${command} respects branch and only scope while rebasing a stale child`, () => {
      fixture.git(['commit', '--amend', '-m', 'changed base']);
      const base = fixture.git(['rev-parse', 'base']);
      const tip = fixture.git(['rev-parse', 'tip']);
      const other = fixture.git(['rev-parse', 'other']);
      fixture.ok([command, '--branch', 'child', '--only']);
      expect(fixture.git(['rev-parse', 'child^'])).to.equal(base);
      expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
      expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });

  for (const command of ['track', 'tr'])
    it(`${command} tracks a selected untracked downstack without changing refs`, () => {
      fixture.git(['switch', '-c', 'untracked-parent', 'main']);
      fixture.commit('untracked-parent');
      fixture.git(['switch', '-c', 'untracked-leaf']);
      fixture.commit('untracked-leaf');
      const refs = fixture.refs();
      fixture.git(['switch', 'other']);
      fixture.ok([command, 'untracked-leaf', '--downstack', '--force']);
      expect(fixture.parent('untracked-parent')).to.equal('main');
      expect(fixture.parent('untracked-leaf')).to.equal('untracked-parent');
      expect(fixture.refs()).to.equal(refs);
      expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    });

  for (const command of ['split', 'sp'])
    it(`${command} splits two commits through real terminal selection and names`, () => {
      fixture.git(['switch', 'other']);
      const first = fixture.git(['rev-parse', 'HEAD']);
      fixture.commit('second');
      const second = fixture.git(['rev-parse', 'HEAD']);
      const result = runCliInPty(getTestCliCommand([command, '--by-commit']), {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Toggle a commit', input: '\u001b[B\r' },
          { prompt: 'Branch 2:', input: '\u001b[B\u001b[B\r' },
          { prompt: 'Choose a name for branch 1', input: 'lower\r' },
          { prompt: 'Choose a name for branch 2', input: 'upper\r' },
        ],
      });
      fixture.savePty(result);
      expect(result.status, result.output).to.equal(0);
      expect(fixture.git(['branch', '--list']), result.output).to.include(
        'lower'
      );
      expect(fixture.git(['rev-parse', 'lower'])).to.equal(first);
      expect(fixture.git(['rev-parse', 'upper'])).to.equal(second);
      expect(fixture.parent('lower')).to.equal('main');
      expect(fixture.parent('upper')).to.equal('lower');
      expect(fixture.git(['branch', '--list', 'other'])).to.equal('');
    });
});
