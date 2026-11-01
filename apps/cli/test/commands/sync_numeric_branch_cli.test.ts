import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

function respondToNumericLookup(
  fixture: FrozenGetFixture,
  output: string,
  stderr = '',
  status = 0
): void {
  fs.writeFileSync(
    path.join(fixture.bin, 'gh'),
    `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(
      fixture.ghCalls
    )}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'view' && args[2] === '123') {
  process.stderr.write('GraphQL: Could not resolve to a PullRequest with the number of 123. (repository.pullRequest)\\n');
  process.exit(1);
}
const stored = args[0] === 'pr' && args[1] === 'view' && args[2] === '3' && args[3] === '--repo' && args[4] === 'get-fixture/repo' && args[5] === '--json';
const head = args[0] === 'pr' && args[1] === 'list' && args[2] === '--head' && args[3] === '123' && args[4] === '--state' && args[5] === 'open' && args[6] === '--limit' && args[7] === '2' && args[8] === '--repo' && args[9] === 'get-fixture/repo' && args[10] === '--json';
if (!stored && !head) process.exit(2);
const output = ${JSON.stringify(output)};
process.stdout.write(stored ? JSON.stringify(JSON.parse(output)[0]) : output);
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${status});
`,
    { mode: 0o755 }
  );
}

describe('sync CLI numeric branch identity', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  let old: string;
  let incoming: string;
  beforeEach(() => {
    fixture = new FrozenGetFixture(false);
    fixture.git(fixture.producer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', '-c', '123');
    old = fixture.commit(fixture.producer, 'numeric.txt', 'numeric old');
    fixture.git(fixture.producer, 'push', 'origin', '123');
    fixture.git(fixture.consumer, 'fetch', 'origin', '123');
    fixture.git(fixture.consumer, 'branch', '123', 'FETCH_HEAD');
    fixture.ok('track', '123', '--parent', 'main');
    incoming = fixture.commit(fixture.producer, 'numeric.txt', 'numeric new');
    fixture.git(fixture.producer, 'push', 'origin', '123');
  });
  afterEach(() => fixture?.cleanup());

  const pullRequest = () => ({
    headRefName: '123',
    baseRefName: 'main',
    headRefOid: incoming,
    number: 3,
    url: 'https://github.com/get-fixture/repo/pull/3',
    state: 'OPEN',
    headRepository: { nameWithOwner: 'get-fixture/repo' },
  });

  it('refreshes a tracked numeric branch from its open PR with a different number', () => {
    respondToNumericLookup(fixture, JSON.stringify([pullRequest()]));
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('123', incoming);
    expect(
      fixture.git(
        fixture.consumer,
        'cat-file',
        '-p',
        'refs/branch-metadata/123'
      )
    ).to.include('"number": 3');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'main'
    );
    expect(fixture.git(fixture.consumer, 'show', '123:numeric.txt')).to.equal(
      'numeric new'
    );
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.assertTip('123', incoming);
    expect(old).not.to.equal(incoming);
  });

  it('preserves a local-only numeric branch when the head lookup has no open PR', () => {
    respondToNumericLookup(fixture, '[]');
    const before = fixture.observe();
    const result = fixture.ok(
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack'
    );
    expect(result.output).to.include('123 is local-only');
    expect(fixture.observe()).to.deep.equal(before);
    fixture.assertTip('123', old);
  });

  for (const invalid of [
    { label: 'wrong head', override: { headRefName: 'other' } },
    {
      label: 'wrong repository',
      override: { headRepository: { nameWithOwner: 'other/repo' } },
    },
    {
      label: 'wrong URL',
      override: { url: 'https://github.com/other/repo/pull/3' },
    },
    { label: 'closed PR', override: { state: 'CLOSED' } },
    { label: 'missing state', override: { state: undefined } },
    { label: 'ambiguous matches', count: 2 },
    { label: 'malformed JSON', raw: '{' },
    { label: 'non-array response', raw: '{}' },
    { label: 'service failure', stderr: 'API rate limit exceeded', status: 1 },
    {
      label: 'failed lookup claiming absence',
      stderr: 'no pull requests found',
      status: 1,
    },
  ]) {
    it(`refuses numeric head ${invalid.label} before changing refs or files`, () => {
      const pr = { ...pullRequest(), ...invalid.override };
      respondToNumericLookup(
        fixture,
        invalid.raw ?? JSON.stringify(invalid.count === 2 ? [pr, pr] : [pr]),
        invalid.stderr,
        invalid.status
      );
      const before = fixture.observe();
      const result = fixture.run([
        'sync',
        '--no-pull',
        '--no-delete',
        '--no-restack',
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).not.to.include('123 is local-only');
      expect(fixture.observe()).to.deep.equal(before);
    });
  }

  it('keeps the exact stored PR number guard after associating a numeric branch', () => {
    respondToNumericLookup(fixture, JSON.stringify([pullRequest()]));
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    respondToNumericLookup(
      fixture,
      JSON.stringify([
        {
          ...pullRequest(),
          number: 4,
          url: 'https://github.com/get-fixture/repo/pull/4',
        },
      ])
    );
    const before = fixture.observe();
    const result = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('identity');
    expect(fixture.observe()).to.deep.equal(before);
  });
});
