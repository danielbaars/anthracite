import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { observeLandingPushes } from '../lib/fixtures/land_push_observer';
import { z } from 'zod';

// eslint-disable-next-line max-lines-per-function
describe('public landing replay graph inspection', function () {
  this.timeout(300000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 240000;
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('inspects a clean mandatory fanout and excludes independent trunk branches', () => {
    fixture.branch('side', 'base');
    fixture.branch('side-child', 'side');
    fixture.branch('local-only', 'base');
    fixture.ok(['freeze', 'other']);
    fixture.git([
      'worktree',
      'add',
      path.join(fixture.root, 'other-worktree'),
      'other',
    ]);
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.include(
      'Replay: conflict-free for captured inputs'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('"PUT"')
      .and.not.to.include('"edit"');
  });
  function advanceTrunk(
    file: string,
    content = 'independent trunk change\n'
  ): void {
    const clone = path.join(fixture.root, 'independent');
    fixture.git(['clone', github.remote, clone]);
    fixture.git(['switch', 'main'], clone);
    fs.writeFileSync(path.join(clone, file), content);
    fixture.git(['add', file], clone);
    fixture.git(['commit', '-m', 'Independent trunk change'], clone);
    fixture.git(['push', 'origin', 'main'], clone);
  }

  for (const scenario of [
    { branch: 'published-side', parent: 'base', published: true },
    { branch: 'local-side', parent: 'base', published: false },
    { branch: 'deep-side', parent: 'side', published: false },
  ])
    it(`refuses a replay conflict in mandatory ${scenario.branch} before any merge`, () => {
      if (scenario.parent === 'side') fixture.branch('side', 'base');
      fixture.branch(scenario.branch, scenario.parent);
      if (scenario.published) {
        fixture.git(['push', 'origin', scenario.branch]);
        fs.writeFileSync(
          github.state,
          JSON.stringify([...github.prs, github.pr(scenario.branch, 20)])
        );
      }
      advanceTrunk(scenario.branch + '.txt');
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      for (const option of ['--dry-run', '--yes']) {
        const result = fixture.run(['land', 'tip', option]);
        expect(result.status, result.stdout + result.stderr).to.equal(1);
        expect(result.stdout)
          .to.include('Replay conflict in ' + scenario.branch)
          .and.to.include(scenario.branch + '.txt')
          .and.to.include('Dependent replay remains unverified');
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
        expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
        expect(fs.readFileSync(github.calls, 'utf8'))
          .not.to.include('"PUT"')
          .and.not.to.include('"edit"');
      }
    });

  it('lands a clean fanout without replaying a completed side arm onto unrelated later trunk work', () => {
    fixture.git(['switch', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'shared.txt'), 'base content\n');
    fixture.git(['add', 'shared.txt']);
    fixture.git(['commit', '-m', 'Add shared base']);
    fixture.ok(['restack']);
    fixture.branch('side', 'base');
    fs.writeFileSync(path.join(fixture.repo, 'shared.txt'), 'side content\n');
    fixture.git(['add', 'shared.txt']);
    fixture.git(['commit', '-m', 'Independent side correction']);
    fixture.branch('side-child', 'side');
    fixture.branch('local-only', 'base');
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'shared.txt'), 'target content\n');
    fixture.git(['add', 'shared.txt']);
    fixture.git(['commit', '-m', 'Target correction']);
    fixture.ok(['restack']);
    fixture.git([
      'push',
      '--force',
      'origin',
      'base',
      'child',
      'tip',
      'side',
      'side-child',
    ]);
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        github.pr('base', 17),
        github.pr('child', 18),
        github.pr('tip', 19),
        {
          ...github.pr('side', 20),
          body: 'Preserve side text',
          isDraft: true,
          assignees: ['owner'],
          reviewRequests: ['reviewer'],
        },
        github.pr('side-child', 21),
      ])
    );
    fixture.git(['switch', 'tip']);
    const other = fixture.git(['rev-parse', 'other']);
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'child', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const observer = observeLandingPushes(fixture, github.remote);
    const landed = fixture.run(['land', 'child', '--yes']);
    expect(landed.status, landed.stdout + landed.stderr).to.equal(0);
    const updates = observer
      .client()
      .flatMap((entry) => entry.refs)
      .filter((entry) => entry.next !== '0'.repeat(40));
    for (const branch of ['side', 'side-child', 'child'])
      expect(
        updates.filter((entry) => entry.ref === 'refs/heads/' + branch)
      ).to.have.length(1);
    expect(
      updates.filter((entry) => entry.ref === 'refs/heads/tip')
    ).to.have.length(2);
    expect(
      updates.some((entry) => entry.ref === 'refs/heads/local-only')
    ).to.equal(false);
    expect(
      fixture.git(['ls-remote', github.remote, 'refs/heads/local-only'])
    ).to.equal('');
    expect(fixture.git(['show', 'main:shared.txt'])).to.equal('target content');
    expect(fixture.git(['show', 'side:shared.txt'])).to.equal('side content');
    expect(fixture.git(['show', 'side-child:shared.txt'])).to.equal(
      'side content'
    );
    expect(fixture.git(['show', 'local-only:shared.txt'])).to.equal(
      'base content'
    );
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['rev-parse', 'other'], github.remote)).to.equal(other);
    const prs = z
      .array(
        z.object({
          number: z.number(),
          state: z.string(),
          body: z.string(),
          isDraft: z.boolean(),
          assignees: z.array(z.string()).optional(),
          reviewRequests: z.array(z.string()).optional(),
        })
      )
      .parse(JSON.parse(fs.readFileSync(github.state, 'utf8')));
    const side = prs.find((pr) => pr.number === 20);
    expect(side).to.include({ state: 'OPEN', isDraft: true });
    expect(side?.body).to.include('Preserve side text');
    expect(side?.assignees).to.deep.equal(['owner']);
    expect(side?.reviewRequests).to.deep.equal(['reviewer']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
  });

  it('uses verified cleanup-only results without replaying or publishing retired branches', () => {
    fixture.branch('beside-base', 'base');
    fixture.branch('beside-child', 'child');
    fixture.git(['push', 'origin', 'beside-base', 'beside-child']);
    const prs = [
      ...github.prs,
      github.pr('beside-base', 20),
      github.pr('beside-child', 21),
    ];
    const external = path.join(fixture.root, 'external');
    fixture.git(['clone', github.remote, external]);
    const main = fixture.git(['rev-parse', 'main']);
    let trunk = main;
    fixture.env.GIT_COMMITTER_DATE = '2035-01-01T00:00:00Z';
    for (let index = 0; index < 2; index++) {
      const pr = prs[index];
      if (!pr) throw new Error('Missing synthetic cleanup PR');
      fixture.git(
        ['checkout', '-B', 'landing', String(pr.headRefOid)],
        external
      );
      fixture.git(
        [
          'rebase',
          '--force-rebase',
          '--onto',
          trunk,
          String(pr.baseRefOid),
          'landing',
        ],
        external
      );
      const parent = trunk;
      trunk = fixture.git(['rev-parse', 'HEAD'], external);
      fixture.git(['push', 'origin', 'HEAD:refs/heads/main'], external);
      Object.assign(pr, {
        state: 'MERGED',
        mergeResult: trunk,
        baseRefName: 'main',
        baseRefOid: parent,
      });
    }
    delete fixture.env.GIT_COMMITTER_DATE;
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include('Cleanup-only 1: base')
      .and.to.include('Cleanup-only 2: child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const observer = observeLandingPushes(fixture, github.remote);
    const landed = fixture.run(['land', 'tip', '--yes']);
    expect(landed.status, landed.stdout + landed.stderr).to.equal(0);
    const updates = observer
      .client()
      .flatMap((entry) => entry.refs)
      .filter((entry) => entry.next !== '0'.repeat(40));
    expect(
      updates.some((entry) =>
        ['refs/heads/base', 'refs/heads/child'].includes(entry.ref)
      )
    ).to.equal(false);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    for (const branch of ['beside-base', 'beside-child']) {
      expect(fixture.ok(['info', branch])).to.include('Parent: main');
      expect(fixture.git(['rev-parse', branch], github.remote)).to.equal(
        fixture.git(['rev-parse', branch])
      );
      expect(fixture.git(['show', `${branch}:${branch}.txt`])).to.equal(branch);
    }
  });
  it('inspects already-applied work and empty commits without changing captured history', () => {
    fixture.git(['switch', 'child']);
    fixture.git([
      'commit',
      '--allow-empty',
      '-m',
      'Keep intentional empty commit',
    ]);
    fixture.ok(['restack']);
    fixture.git(['push', '--force', 'origin', 'child', 'tip']);
    fixture.branch('empty-side', 'base', true);
    advanceTrunk('child.txt', 'child');
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.include(
      'Replay: conflict-free for captured inputs'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['log', '--format=%s', 'base..child'])).to.include(
      'Keep intentional empty commit'
    );
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
});
