import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from './relation_cli';
import { readSubmitPrs } from './submit_gh';

export type PrFixture = ReturnType<typeof preparePrInspection>;

/** Real repository/remote; only GitHub and explicit browser effects are synthetic. */
export function preparePrInspection(fixture: RelationCliFixture): {
  readonly state: string;
  readonly calls: string;
  readonly browser: string;
  readonly remote: string;
  readonly bin: string;
  readonly pr: (branch: string, number?: number) => Record<string, unknown>;
  readonly associate: () => number;
} {
  const bin = path.join(fixture.root, 'pr-gh-bin');
  fs.mkdirSync(bin);
  const state = path.join(fixture.root, 'pr-state.json');
  const calls = path.join(fixture.root, 'pr-gh.jsonl');
  const browser = path.join(fixture.root, 'browser.jsonl');
  fs.writeFileSync(state, '[]');
  fs.writeFileSync(calls, '');
  fs.writeFileSync(browser, '');
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!${process.execPath}\n${fs.readFileSync(
      path.join(__dirname, 'pr_gh_boundary.js'),
      'utf8'
    )}`,
    { mode: 0o755 }
  );
  fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
  fixture.env.ANTHRACITE_TEST_PR_STATE = state;
  fixture.env.ANTHRACITE_TEST_PR_CALLS = calls;
  fixture.env.ANTHRACITE_TEST_PR_BROWSER = browser;
  const remote = path.join(fixture.root, 'remote.git');
  fixture.git(['init', '--bare', remote]);
  fixture.git(['remote', 'add', 'origin', remote]);
  fixture.git(['push', 'origin', '--all']);
  fixture.ok(['repo', 'owner', '--set', 'fixture']);
  fixture.ok(['repo', 'name', '--set', 'inspection']);
  fixture.git(['remote', 'set-url', '--push', 'origin', remote]);
  fixture.git([
    'remote',
    'set-url',
    'origin',
    'https://github.com/misleading/parent.git',
  ]);
  return {
    state,
    calls,
    browser,
    remote,
    bin,
    associate: () => {
      const script = path.join(bin, 'gh');
      const inspection = fs.readFileSync(script);
      const submitState = path.join(fixture.root, 'submit-setup.json');
      fs.writeFileSync(submitState, '[]');
      fs.writeFileSync(
        script,
        `#!${process.execPath}\n${fs
          .readFileSync(path.join(__dirname, 'submit_gh.js'), 'utf8')
          .replace(/fixture\/submit/g, 'fixture/inspection')}`,
        { mode: 0o755 }
      );
      fixture.env.ANTHRACITE_TEST_GH_STATE = submitState;
      fixture.env.ANTHRACITE_TEST_GH_LOG = calls;
      fixture.git(['remote', 'set-url', 'origin', remote]);
      try {
        fixture.ok(['submit', '--publish']);
        const number = readSubmitPrs(submitState)[0]?.number;
        if (!number) throw new Error('Public submit did not associate a PR.');
        return number;
      } finally {
        fixture.git([
          'remote',
          'set-url',
          'origin',
          'https://github.com/misleading/parent.git',
        ]);
        fs.writeFileSync(script, inspection, { mode: 0o755 });
        fs.writeFileSync(calls, '');
      }
    },
    pr: (branch, number = 17) => {
      const parent = fixture
        .ok(['info', branch])
        .split('\n')
        .find((line) => line.startsWith('Parent: '))
        ?.slice(8);
      if (!parent) throw new Error(`No public tracking parent for ${branch}.`);
      return {
        number,
        url: `https://github.com/fixture/inspection/pull/${number}`,
        title: `PR for ${branch}`,
        body: 'User body',
        author: { login: 'reviewer' },
        state: 'OPEN',
        isDraft: false,
        headRefName: branch,
        headRefOid: fixture.git(['rev-parse', branch]),
        baseRefName: parent,
        baseRefOid: fixture.git(['rev-parse', parent]),
        headRepository: {
          name: 'inspection',
          nameWithOwner: 'fixture/inspection',
        },
        headRepositoryOwner: { login: 'fixture' },
        isCrossRepository: false,
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'unit',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          },
        ],
      };
    },
  };
}
