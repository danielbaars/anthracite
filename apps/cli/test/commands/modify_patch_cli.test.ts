import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('modify patch selection through the public CLI', function () {
  this.timeout(60000);
  let fixture: FreezeCliFixture;
  let before: unknown;
  beforeEach(() => {
    fixture = new FreezeCliFixture();
    before = undefined;
  });
  afterEach(function () {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modify-patch-observations.jsonl'),
        JSON.stringify({
          case: this.currentTest?.fullTitle(),
          root: fixture.root,
          before,
          after: fixture.observe(),
          commits: fixture.git(['log', '--all', '--format=%H %P %T %s']),
          rebase: fs.existsSync(path.join(fixture.repo, '.git/rebase-merge')),
          continuation: fs.existsSync(
            path.join(fixture.repo, '.git/.gtcontinue')
          ),
        }) + '\n'
      );
    }
    fixture.cleanup();
  });

  for (const command of ['modify', 'm'])
    it(`${command} commits the selected patch hunk above a frozen anchor and preserves unselected work`, () => {
      fixture.git(['switch', 'tip']);
      const lines =
        Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
      fixture.stage('main.txt', lines);
      fixture.git(['commit', '-m', 'patch baseline']);
      fixture.ok(['freeze', 'child']);
      const head = fixture.git(['rev-parse', 'tip']);
      const preserved = fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads/base',
        'refs/heads/child',
        'refs/heads/other',
        'refs/branch-metadata/base',
        'refs/branch-metadata/child',
      ]);
      fixture.stage('sentinel.txt', 'already prepared');
      fixture.write(
        'main.txt',
        lines
          .replace('line 0\n', 'selected hunk\n')
          .replace('line 39\n', 'unfinished hunk\n')
      );
      fixture.write('loose.txt', 'untracked work');
      before = fixture.observe();
      const result = runCliInPty(
        getTestCliCommand([
          command,
          '--commit',
          '--patch',
          '-m',
          'selected patch',
        ]),
        {
          cwd: fixture.repo,
          env: fixture.env,
          responses: [
            { prompt: 'Stage this hunk', input: 'y\n' },
            { prompt: 'Stage this hunk', input: 'n\n' },
          ],
        }
      );
      expect(result.status, result.output).to.equal(0);
      expect(result.output.match(/Stage this hunk/g)).to.have.length(2);
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(head);
      expect(fixture.git(['rev-list', '--count', `${head}..tip`])).to.equal(
        '1'
      );
      expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
        lines.replace('line 0\n', 'selected hunk\n').trim()
      );
      expect(fixture.git(['show', 'tip:sentinel.txt'])).to.equal(
        'already prepared'
      );
      expect(fixture.git(['show', ':main.txt'])).to.equal(
        lines.replace('line 0\n', 'selected hunk\n').trim()
      );
      expect(fixture.git(['diff', '--cached'])).to.equal('');
      expect(fixture.git(['diff']))
        .to.include('+unfinished hunk')
        .and.not.include('+selected hunk');
      expect(
        fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
      ).to.equal(
        lines
          .replace('line 0\n', 'selected hunk\n')
          .replace('line 39\n', 'unfinished hunk\n')
      );
      expect(fixture.git(['status', '--porcelain'])).to.equal(
        'M main.txt\n?? loose.txt'
      );
      expect(
        fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
      ).to.equal('untracked work');
      expect(
        fixture.git([
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/heads/base',
          'refs/heads/child',
          'refs/heads/other',
          'refs/branch-metadata/base',
          'refs/branch-metadata/child',
        ])
      ).to.equal(preserved);
      expect(fixture.ok(['info', 'child']))
        .to.include('(frozen)')
        .and.include('Parent: base');
      expect(fixture.ok(['info', 'tip']))
        .to.include('Parent: child')
        .and.not.include('(frozen)');
      expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
      expect(
        fs.existsSync(path.join(fixture.repo, '.git/rebase-merge'))
      ).to.equal(false);
      expect(
        fs.existsSync(path.join(fixture.repo, '.git/.gtcontinue'))
      ).to.equal(false);
    });
});
