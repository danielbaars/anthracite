import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('chosen stack fold PR scope through a real PTY', function () {
  this.timeout(90000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const keep of [false, true]) {
    for (const target of ['tip', 'deep']) {
      it(`selects before refusing the known PR on ${target} without local or remote effects (keep=${keep})`, () => {
        fixture.branch(target, 'main');
        fixture.succeed('submit', '--publish');
        fixture.branch('base', 'main');
        fixture.branch('child', 'base');
        if (target !== 'tip') fixture.branch('tip', 'child');
        fixture.branch('sibling', 'child');
        fixture.succeed(
          'move',
          target === 'tip' ? 'child' : 'sibling',
          '--source',
          target
        );
        if (target !== 'deep') fixture.branch('deep', 'sibling');
        fixture.setPrs(
          fixture.prs().map((pr) => ({
            ...pr,
            state: target === 'tip' ? 'CLOSED' : 'MERGED',
          }))
        );
        fixture.succeed('sync', '--no-pull', '--no-delete', '--no-restack');
        fixture.succeed('checkout', target);
        const info = fixture.succeed('info');
        expect(info).to.include('PR #1');
        fixture.succeed('checkout', 'child');
        const hidden = path.join(fixture.repo, "private '*[é]\n.bin");
        const bytes = Buffer.from([0, 128, 255, 10]);
        fs.appendFileSync(
          path.join(fixture.repo, '.git/info/exclude'),
          '\n*.bin\n'
        );
        fs.writeFileSync(hidden, bytes);
        const trace = path.join(fixture.root, 'mutation-trace');
        fs.writeFileSync(
          path.join(fixture.repo, '.git/hooks/post-checkout'),
          `#!/bin/sh\nprintf checkout >> '${trace}'\n`,
          { mode: 0o755 }
        );
        fs.writeFileSync(
          path.join(fixture.repo, '.git/hooks/reference-transaction'),
          `#!/bin/sh\nwhile read old new ref; do\ncase "$ref" in refs/heads/*) printf ref >> '${trace}';; esac\ndone\n`,
          { mode: 0o755 }
        );
        const before = snapshot();
        const prs = fixture.prs();
        fixture.clearCalls();
        const result = runCliInPty(
          getTestCliCommand(['fold', '--stack', `--keep=${keep}`]),
          {
            cwd: fixture.repo,
            env: fixture.env,
            responses: [
              { prompt: 'Choose a tip', input: 'tip' },
              { prompt: '› tip', input: '\r' },
            ],
          }
        );
        expect(result.status, result.output).not.to.equal(0);
        expect(result.status).not.to.equal(124);
        expect(result.output).to.include('Choose a tip');
        expect(result.output).to.include(
          `Cannot fold ${target}: it has a locally known PR association`
        );
        expect(snapshot()).to.deep.equal(before);
        expect(fs.readFileSync(hidden)).to.deep.equal(bytes);
        expect(fs.existsSync(trace)).to.equal(false);
        expect(fixture.calls()).to.deep.equal([]);
        expect(fixture.prs()).to.deep.equal(prs);
        fixture.succeed('checkout', target);
        const afterInfo = fixture.succeed('info');
        for (const line of info
          .split('\n')
          .filter((line) => /^(PR #|https:)/.test(line))) {
          expect(afterInfo).to.include(line);
        }
        for (const [name, parent] of [
          ['base', 'main'],
          ['child', 'base'],
          ['tip', 'child'],
          ['sibling', 'child'],
          ['deep', 'sibling'],
        ]) {
          fixture.succeed('checkout', name);
          expect(fixture.succeed('info')).to.include(`Parent: ${parent}`);
        }
      });
    }
  }

  function snapshot() {
    return {
      refs: fixture.git(
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
        'refs/remotes'
      ),
      remote: fixture.git('ls-remote', '--heads', 'origin'),
      head: fixture.git('rev-parse', 'HEAD'),
      checkout: fixture.git('branch', '--show-current'),
      index: fs.readFileSync(path.join(fixture.repo, '.git/index')),
      status: fixture.git('status', '--porcelain'),
    };
  }
});
