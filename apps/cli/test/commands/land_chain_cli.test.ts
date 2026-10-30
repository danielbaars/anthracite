import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('public linear landing and prefixes', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());
  it('lands a prefix and replays its draft descendant chain preserving unique work and PR identities', () => {
    const originals = ['base', 'child', 'tip'].map((name) =>
      fixture.git(['rev-parse', name])
    );
    const unique = fixture.git(['log', '--format=%an <%ae> %s', 'child..tip']);
    const tipTree = fixture.git(['rev-parse', 'tip^{tree}']);
    const unrelated = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads/other',
      'refs/branch-metadata/other',
    ]);
    const prs = github.prs.map((pr) => ({
      ...pr,
      isDraft: pr.headRefName === 'child',
      title: 'Keep my title',
      body: 'User text $() `literal`\n\nBot text',
      assignees: ['owner'],
      reviewRequests: ['reviewer'],
    }));
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fixture.git(['switch', 'tip']);
    const result = fixture.run([
      'land',
      'base',
      '--yes',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
    expect(fixture.ok(['info', 'tip'])).to.include('Parent: child');
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tipTree);
    expect(
      fixture.git(['log', '--format=%an <%ae> %s', 'child..tip'])
    ).to.equal(unique);
    expect(fixture.git(['rev-list', '--count', 'main..child'])).to.equal('1');
    expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('1');
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/base',
        'refs/branch-metadata/base',
      ])
    ).to.equal('');
    expect(fixture.git(['rev-parse', 'main'], github.remote)).not.to.equal(
      originals[0]
    );
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads/other',
        'refs/branch-metadata/other',
      ])
    ).to.equal(unrelated);
    const after = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    for (const [name, number, base] of [
      ['child', 18, 'main'],
      ['tip', 19, 'child'],
    ] as const) {
      const pr = after.find(
        (item: { number: number }) => item.number === number
      );
      expect(pr.headRefOid).to.equal(fixture.git(['rev-parse', name]));
      expect(fixture.git(['rev-parse', name], github.remote)).to.equal(
        pr.headRefOid
      );
      expect(pr.baseRefName).to.equal(base);
      expect(pr.title).to.equal('Keep my title');
      expect(pr.body)
        .to.include('User text $() `literal`\n\nBot text')
        .and.include(`PR #${number}`)
        .and.not.include('PR #17');
      expect(pr.assignees).to.deep.equal(['owner']);
      expect(pr.reviewRequests).to.deep.equal(['reviewer']);
      expect(pr.isDraft).to.equal(name === 'child');
      expect(pr.state).to.equal('OPEN');
    }
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
  });
  it('lands the selected linear chain bottom-up and maintains the draft above the target after every merge', () => {
    const prs = github.prs.map((pr) => ({
      ...pr,
      isDraft: pr.headRefName === 'tip',
    }));
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const result = fixture.run(['land', 'child', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    const after = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(after.map((pr: { state: string }) => pr.state)).to.deep.equal([
      'MERGED',
      'MERGED',
      'OPEN',
    ]);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(fixture.git(['rev-list', '--count', 'main..tip'])).to.equal('1');
    expect(fixture.ok(['info', 'tip'])).to.include('Parent: main');
    expect(after[2].baseRefName).to.equal('main');
    expect(after[2].isDraft).to.equal(true);
    expect(after[2].body)
      .to.include('PR #19')
      .and.not.include('PR #17')
      .and.not.include('PR #18');
    expect(
      fixture.git([
        'ls-remote',
        '--heads',
        'origin',
        'refs/heads/base',
        'refs/heads/child',
      ])
    ).to.equal('');
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  for (const scenario of ['dismissAfterPush', 'pendingAfterPush'] as const) {
    it(`stops after required maintenance when ${scenario} and resumes the same target with fresh readiness`, () => {
      const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
      fs.writeFileSync(
        github.policy,
        JSON.stringify({
          ...policy,
          [scenario]: true,
          rules: [
            {
              type: 'pull_request',
              parameters: { required_approving_review_count: 1 },
            },
          ],
        })
      );
      const stopped = fixture.run(['land', 'child', '--yes']);
      expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
      expect(stopped.stderr).to.include('Fresh readiness blocked');
      const after = JSON.parse(fs.readFileSync(github.state, 'utf8'));
      expect(after.map((pr: { state: string }) => pr.state)).to.deep.equal([
        'MERGED',
        'OPEN',
        'OPEN',
      ]);
      expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
      expect(after[1].baseRefName).to.equal('main');
      expect(after[2].body).not.to.include('PR #17');
      expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      const firstHead = fixture.git(['rev-parse', 'child']);
      for (const pr of after) {
        pr.reviewDecision = 'APPROVED';
        pr.statusCheckRollup = [];
      }
      fs.writeFileSync(github.state, JSON.stringify(after));
      fs.writeFileSync(github.policy, JSON.stringify(policy));
      const retry = fixture.run(['land', 'child', '--yes']);
      expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
      const final = JSON.parse(fs.readFileSync(github.state, 'utf8'));
      expect(final[1].headRefOid).to.equal(firstHead);
      expect(final[1].state).to.equal('MERGED');
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(2);
    });
  }

  it('continues a genuine replay conflict locally and requires explicit land for the remaining remote work', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('an continue');
    const remoteBefore = fixture.git(['for-each-ref'], github.remote);
    const callsBefore = fs.readFileSync(github.calls, 'utf8');
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(0);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remoteBefore);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(callsBefore);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(true);
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('resolved child');
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(fixture.git(['show', 'tip:child.txt'], github.remote)).to.equal(
      'resolved child'
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('retains completed replay and push after a PR update failure, then resumes without replaying patches twice', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, failPrEdit: true })
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('survivor maintenance')
      .and.include('Confirmed merged');
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(child);
    expect(fixture.git(['rev-list', '--count', 'main..child'])).to.equal('1');
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const retry = fixture.run(['land', 'base', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
  it('leaves an unpublished descendant local without creating a PR or remote branch', () => {
    fixture.git(['push', 'origin', ':refs/heads/tip']);
    fs.writeFileSync(github.state, JSON.stringify(github.prs.slice(0, 2)));
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
    expect(
      fixture.git(['ls-remote', '--heads', 'origin', 'refs/heads/tip'])
    ).to.equal('');
    expect(JSON.parse(fs.readFileSync(github.state, 'utf8')).length).to.equal(
      2
    );
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('"create"')
      .and.not.include('"ready"');
  });
  it('refuses fanout before the first write until fanout application is supported', () => {
    fixture.branch('sibling', 'base');
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr, fs.readFileSync(github.calls, 'utf8')).to.include(
      'Fanout'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('"PUT"')
      .and.not.include('"edit"');
  });

  it('preserves concurrent remote work when a survivor push loses its explicit captured lease', () => {
    const original = fixture.git(['rev-parse', 'child']);
    const tree = fixture.git(['rev-parse', 'child^{tree}'], github.remote);
    const competing = fixture.git(
      [
        '-c',
        'user.name=Concurrent',
        '-c',
        'user.email=concurrent@example.test',
        'commit-tree',
        tree,
        '-p',
        original,
        '-m',
        'Concurrent child',
      ],
      github.remote
    );
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nwhile read local_ref local_oid remote_ref remote_oid; do\nif [ "$remote_ref" = refs/heads/child ]; then git --git-dir="' +
        github.remote +
        '" update-ref refs/heads/child ' +
        competing +
        ' ' +
        original +
        '; fi\ndone\n',
      { mode: 0o755 }
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('survivor maintenance')
      .and.include('Confirmed merged');
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
      competing
    );
    expect(fixture.git(['rev-list', '--count', 'main..child'])).to.equal('1');
    fs.unlinkSync(hook);
    const retry = fixture.run(['land', 'base', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(1);
    expect(retry.stderr).to.include('captured-OID lease refused survivor push');
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
      competing
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('recognizes a completed owned replay when its checkout hook fails and resumes without duplicating commits', () => {
    const hooks = path.join(fixture.repo, '.git', 'hooks');
    fs.writeFileSync(
      path.join(hooks, 'pre-rebase'),
      '#!/bin/sh\ntouch "$(git rev-parse --git-path replay-started)"\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(hooks, 'post-checkout'),
      '#!/bin/sh\nif [ -f "$(git rev-parse --git-path replay-started)" ] && [ "$(git branch --show-current)" = main ]; then exit 26; fi\n',
      { mode: 0o755 }
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr)
      .to.include('survivor maintenance')
      .and.include('Confirmed merged');
    const child = fixture.git(['rev-parse', 'child']);
    fs.unlinkSync(path.join(hooks, 'post-checkout'));
    fs.unlinkSync(path.join(hooks, 'pre-rebase'));
    const retry = fixture.run(['land', 'base', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-list', '--count', 'main..child'])).to.equal('1');
    expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('1');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('reports incomplete cleanup when an earlier landed remote branch is recreated during final checkout', () => {
    const base = fixture.git(['rev-parse', 'base']);
    fixture.git(['switch', 'tip']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif [ "$(git branch --show-current)" = tip ] && ! git show-ref --verify --quiet refs/heads/child; then git --git-dir="' +
        github.remote +
        '" update-ref refs/heads/base ' +
        base +
        '; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['land', 'child', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('checkout restoration')
      .and.include('recreated');
    expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(base);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(true);
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))
        .slice(0, 2)
        .map((pr: { state: string }) => pr.state)
    ).to.deep.equal(['MERGED', 'MERGED']);
  });
  it('never reports a completed local continuation when a late frozen survivor leaves replay pending', () => {
    fixture.ok(['freeze', 'tip']);
    const frozen = fixture.git(['rev-parse', 'refs/branch-metadata/tip']);
    fixture.ok(['unfreeze', 'base']);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('an continue');
    const tip = fixture.git(['rev-parse', 'tip']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'post-rewrite'),
      '#!/bin/sh\ngit update-ref refs/branch-metadata/tip ' + frozen + '\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(1);
    expect(continued.stderr).to.include('replay queue remains incomplete');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(true);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.gtcontinue'))
    ).to.equal(true);
  });
});
