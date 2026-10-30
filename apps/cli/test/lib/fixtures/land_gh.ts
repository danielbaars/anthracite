import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from './relation_cli';
import { preparePrInspection, PrFixture } from './pr_gh';

export function prepareLand(fixture: RelationCliFixture): PrFixture & {
  readonly policy: string;
  readonly prs: readonly Record<string, unknown>[];
} {
  const github = preparePrInspection(fixture);
  fixture.git(['remote', 'set-url', 'origin', github.remote]);
  const config = path.join(fixture.repo, '.git', '.graphite_repo_config');
  fs.writeFileSync(
    config,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(config, 'utf8')),
      host: 'github.com',
    })
  );
  const policy = path.join(fixture.root, 'land-policy.json');
  fs.writeFileSync(
    policy,
    JSON.stringify({
      allow_rebase_merge: true,
      protected: false,
      rules: [],
      protection: null,
    })
  );
  fixture.env.ANTHRACITE_TEST_LAND_POLICY = policy;
  fixture.env.ANTHRACITE_TEST_LAND_REMOTE = github.remote;
  const original = fs.readFileSync(path.join(github.bin, 'gh'), 'utf8');
  fs.writeFileSync(
    path.join(github.bin, 'gh'),
    `#!${process.execPath}\n${fs.readFileSync(
      path.join(__dirname, 'land_gh_boundary.js'),
      'utf8'
    )}\nif (args[0] !== 'api') {\n${original.slice(
      original.indexOf('\n') + 1
    )}\n}`,
    { mode: 0o755 }
  );
  const prs = ['base', 'child', 'tip'].map((branch, index) =>
    github.pr(branch, 17 + index)
  );
  fs.writeFileSync(github.state, JSON.stringify(prs));
  return { ...github, policy, prs };
}
