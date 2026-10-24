import fs from 'fs';
import path from 'path';

import { RelationCliFixture } from './relation_cli';

/** Public local remote and external gh adapter; suites own their PR scenarios. */
export function preparePublicPrRemote(fixture: RelationCliFixture): {
  readonly state: string;
  readonly calls: string;
  readonly remote: string;
  readonly refuseQueries: () => void;
} {
  const bin = path.join(fixture.root, 'gh-bin');
  fs.mkdirSync(bin);
  const state = path.join(fixture.root, 'prs.json');
  const calls = path.join(fixture.root, 'gh.jsonl');
  fs.writeFileSync(state, '[]');
  fs.writeFileSync(calls, '');
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!${process.execPath}\n${fs.readFileSync(
      path.join(__dirname, 'submit_gh.js'),
      'utf8'
    )}`,
    { mode: 0o755 }
  );
  fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
  fixture.env.CHARCOAL_TEST_GH_STATE = state;
  fixture.env.CHARCOAL_TEST_GH_LOG = calls;
  const remote = path.join(fixture.root, 'remote.git');
  fixture.git(['init', '--bare', remote]);
  fixture.git(['remote', 'add', 'origin', remote]);
  fixture.git(['push', '-u', 'origin', 'main']);
  fixture.ok(['repo', 'owner', '--set', 'fixture']);
  fixture.ok(['repo', 'name', '--set', 'submit']);
  return {
    state,
    calls,
    remote,
    refuseQueries: () => {
      fs.writeFileSync(calls, '');
      fs.writeFileSync(
        path.join(bin, 'gh'),
        `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(
          calls
        )}, 'forbidden');process.exitCode=99;`,
        { mode: 0o755 }
      );
    },
  };
}
