import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

for (const kind of ['commit', 'push'] as const) {
  describe(`Git ${kind} hook forwarding through the CLI subprocess boundary`, function () {
    this.timeout(120000);
    let fixture: CwdCliFixture;
    beforeEach(() => {
      fixture = new CwdCliFixture();
    });
    afterEach(() => fixture.cleanup());
    const input = `${'0'.repeat(40)} ${'1'.repeat(
      40
    )} refs/heads/base\n`.repeat(16384);

    for (const status of [0, 7]) {
      it(`preserves exit status ${status} when the real hook closes stdin without reading it`, () => {
        const hook = path.join(fixture.root, 'early-hook');
        fs.writeFileSync(hook, `#!/bin/sh\nexit ${status}\n`, { mode: 0o755 });
        const result = fixture.run(
          [
            `internal-${kind}-guard`,
            'base',
            hook,
            ...(kind === 'commit'
              ? ['prepared']
              : ['origin', 'https://example.test/repo.git']),
          ],
          fixture.repo,
          input
        );
        expect(result.status, result.stderr).to.equal(status);
        expect(result.stderr).not.to.include('EPIPE');
      });
    }

    it('forwards every original stdin byte to a consuming hook', () => {
      const hook = path.join(fixture.root, 'reading-hook');
      const captured = path.join(fixture.root, 'captured-input');
      fs.writeFileSync(hook, `#!/bin/sh\ncat > '${captured}'\n`, {
        mode: 0o755,
      });
      const result = fixture.run(
        [
          `internal-${kind}-guard`,
          'base',
          hook,
          ...(kind === 'commit'
            ? ['prepared']
            : ['origin', 'https://example.test/repo.git']),
        ],
        fixture.repo,
        input
      );
      expect(result.status, result.stderr).to.equal(0);
      expect(fs.readFileSync(captured, 'utf8')).to.equal(input);
    });
  });
}
