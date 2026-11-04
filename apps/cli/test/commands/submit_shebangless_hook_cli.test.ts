import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { FrozenSubmitCliFixture } from '../lib/fixtures/frozen_submit_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

describe('submit with executable shebangless hooks', function () {
  this.timeout(120000);
  let fixture: FrozenSubmitCliFixture;
  beforeEach(() => {
    fixture = new FrozenSubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('still refuses a branch frozen by the shebangless hook before pushing', () => {
    fixture.branch('target', 'main');
    const hooks = path.join(fixture.repo, '.husky');
    fs.mkdirSync(hooks);
    fixture.git('config', 'core.hooksPath', '.husky');
    const freeze = getTestCliCommand(['freeze', 'target', '--no-interactive'])
      .map((arg) => `'${arg.replace(/'/g, `'"'"'`)}'`)
      .join(' ');
    fs.writeFileSync(path.join(hooks, 'pre-push'), `set -e\n${freeze}\n`, {
      mode: 0o755,
    });
    const result = fixture.run(['submit', '--publish', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).not.to.include('ENOEXEC');
    expect(result.stdout + result.stderr).to.include('frozen');
    expect(fixture.remoteSha('target')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
  });

  for (const status of [0, 7]) {
    it(`runs the original hook and respects exit ${status} before PR writes`, () => {
      fixture.branch('target', 'main');
      const hooks = path.join(fixture.repo, '.husky hooks');
      fs.mkdirSync(hooks);
      fixture.git('config', 'core.hooksPath', '.husky hooks');
      const input = path.join(fixture.root, 'input');
      const args = path.join(fixture.root, 'args');
      const marker = path.join(fixture.root, 'runs');
      fs.writeFileSync(
        path.join(hooks, 'pre-push'),
        `set -e\ncat > '${input}'\nprintf '%s\\n' "$@" > '${args}'\nprintf 'run\\n' >> '${marker}'\nexit ${status}\n`,
        { mode: 0o755 }
      );
      if (status === 0) {
        fixture.git('push', '-u', 'origin', 'target');
        fixture.commit('unpushed-work');
      }
      const head = fixture.git('rev-parse', 'target');
      expect(fixture.remoteSha('target')).not.to.equal(head);
      const result = fixture.run(['submit', '--publish', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(
        status === 0 ? 0 : 1
      );
      expect(result.stderr).not.to.include('ENOEXEC');
      expect(fs.readFileSync(marker, 'utf8')).to.equal(
        status === 0 ? 'run\nrun\n' : 'run\n'
      );
      expect(fs.readFileSync(args, 'utf8')).to.equal(
        `origin\n${fixture.remote}\n`
      );
      expect(fs.readFileSync(input, 'utf8')).to.include(
        `refs/heads/target ${head} refs/heads/target`
      );
      expect(fixture.git('config', '--get', 'core.hooksPath')).to.equal(
        '.husky hooks'
      );
      if (status === 0) {
        expect(fixture.remoteSha('target')).to.equal(head);
        expect(fixture.prs()[0]).to.include({
          headRefName: 'target',
          isDraft: false,
        });
      } else {
        expect(fixture.remoteSha('target')).to.equal('');
        expect(fixture.prs()).to.deep.equal([]);
        expect(
          fixture
            .calls()
            .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
        ).to.equal(false);
      }
    });
  }
});
