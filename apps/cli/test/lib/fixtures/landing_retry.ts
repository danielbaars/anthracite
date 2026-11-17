import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from './relation_cli';
import { prepareLand } from './land_gh';

export function leaveLandingUnconfirmed(
  fixture: RelationCliFixture,
  github: ReturnType<typeof prepareLand>,
  producer?: string
): void {
  const recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
  const gh = path.join(github.bin, 'gh');
  const original = fs.readFileSync(gh, 'utf8');
  fs.writeFileSync(
    gh,
    original.replace(
      "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "process.stderr.write('error connecting to api.github.com: timeout\\n');process.exit(1);\nconst input = JSON.parse(fs.readFileSync(0, 'utf8'));"
    )
  );
  const args = ['land', 'leaf', '--yes', '--no-interactive'];
  const stopped = producer
    ? spawnSync(producer, args, {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
        timeout: 120000,
      })
    : fixture.run(args);
  expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
  expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).phase).to.equal(
    'merge-requested'
  );
  fs.writeFileSync(gh, original);
}
