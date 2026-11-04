import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

for (const kind of ['commit', 'push'] as const) {
  for (const shebang of [true, false])
    describe(`Git ${kind} hook forwarding through the CLI subprocess boundary (shebang ${shebang})`, function () {
      this.timeout(120000);
      let fixture: CwdCliFixture;
      beforeEach(() => {
        fixture = new CwdCliFixture();
      });
      afterEach(() => fixture.cleanup());
      const input = `${'0'.repeat(40)} ${'1'.repeat(
        40
      )} refs/heads/base\n`.repeat(16384);

      if (shebang)
        for (const executable of [true, false]) {
          it(`preserves a Node interpreter hook with executable mode ${executable}`, () => {
            const hook = path.join(fixture.root, "node hook ' with spaces");
            const captured = path.join(fixture.root, 'node-output.json');
            const args =
              kind === 'commit'
                ? ['prepared']
                : ["remote with ' spaces", 'https://example.test/repo.git'];
            fs.writeFileSync(
              hook,
              `#!${
                process.execPath
              }\nconst fs = require('fs');fs.writeFileSync(${JSON.stringify(
                captured
              )}, JSON.stringify({args:process.argv.slice(2),input:fs.readFileSync(0,'utf8')}));\n`,
              { mode: executable ? 0o755 : 0o644 }
            );
            const result = fixture.run(
              [`internal-${kind}-guard`, 'base', hook, ...args],
              fixture.repo,
              input
            );
            expect(result.status, result.stderr).to.equal(0);
            if (executable)
              expect(
                JSON.parse(fs.readFileSync(captured, 'utf8'))
              ).to.deep.equal({ args, input });
            else expect(fs.existsSync(captured)).to.equal(false);
          });
        }

      for (const status of [0, 7]) {
        it(`preserves exit status ${status} when the real hook closes stdin without reading it`, () => {
          const hook = path.join(fixture.root, 'early-hook');
          fs.writeFileSync(
            hook,
            `${shebang ? '#!/bin/sh\n' : ''}exit ${status}\n`,
            { mode: 0o755 }
          );
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
        const hook = path.join(fixture.root, 'reading hook with spaces');
        const captured = path.join(fixture.root, 'captured-input');
        fs.writeFileSync(
          hook,
          `${shebang ? '#!/bin/sh\n' : ''}cat > '${captured}'\n`,
          {
            mode: 0o755,
          }
        );
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
