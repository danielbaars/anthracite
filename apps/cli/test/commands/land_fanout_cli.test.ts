import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('public scoped fanout landing', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    fixture.branch('sibling', 'base');
    fixture.branch('sibling-tip', 'sibling');
    fixture.branch('local-only', 'base');
    fixture.git(['push', 'origin', 'sibling', 'sibling-tip']);
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        ...github.prs,
        {
          ...github.pr('sibling', 20),
          isDraft: true,
          assignees: ['owner'],
          reviewRequests: ['reviewer'],
        },
        github.pr('sibling-tip', 21),
      ])
    );
  });
  afterEach(() => fixture?.cleanup());

  it('merges only the chosen chain and maintains every necessary arm while preserving unpublished and independent work', () => {
    fixture.ok(['freeze', 'other']);
    fixture.git([
      'worktree',
      'add',
      path.join(fixture.root, 'independent'),
      'other',
    ]);
    const names = ['tip', 'sibling', 'sibling-tip', 'local-only'];
    const trees = names.map((name) =>
      fixture.git(['rev-parse', `${name}^{tree}`])
    );
    const unique = fixture.git([
      'log',
      '--format=%an <%ae> %s',
      'sibling..sibling-tip',
    ]);
    const other = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads/other',
      'refs/branch-metadata/other',
    ]);
    fixture.git(['switch', 'sibling-tip']);
    const result = fixture.run(['land', 'child', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('sibling-tip');
    names.forEach((name, index) =>
      expect(fixture.git(['rev-parse', `${name}^{tree}`])).to.equal(
        trees[index]
      )
    );
    for (const name of ['tip', 'sibling', 'local-only']) {
      expect(fixture.ok(['info', name])).to.include('Parent: main');
      expect(fixture.git(['rev-list', '--count', `main..${name}`])).to.equal(
        '1'
      );
    }
    expect(fixture.ok(['info', 'sibling-tip'])).to.include('Parent: sibling');
    expect(
      fixture.git(['log', '--format=%an <%ae> %s', 'sibling..sibling-tip'])
    ).to.equal(unique);
    expect(
      fixture.git(['ls-remote', '--heads', 'origin', 'refs/heads/local-only'])
    ).to.equal('');
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads/other',
        'refs/branch-metadata/other',
      ])
    ).to.equal(other);
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    expect(prs.map((pr: { state: string }) => pr.state)).to.deep.equal([
      'MERGED',
      'MERGED',
      'OPEN',
      'OPEN',
      'OPEN',
    ]);
    expect(prs[3].isDraft).to.equal(true);
    expect(prs[3].assignees).to.deep.equal(['owner']);
    expect(prs[3].reviewRequests).to.deep.equal(['reviewer']);
    expect(prs[3].body)
      .to.include('User body')
      .and.include('PR #20')
      .and.not.include('PR #17');
    for (const name of ['tip', 'sibling', 'sibling-tip'])
      expect(fixture.git(['rev-parse', name], github.remote)).to.equal(
        fixture.git(['rev-parse', name])
      );
    const calls = fs.readFileSync(github.calls, 'utf8');
    expect(calls.split('"PUT"').length - 1).to.equal(2);
    expect(calls).not.to.include('"create"').and.not.to.include('"ready"');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
  });
  it('continues a first-arm conflict across all reparented roots locally, then explicitly publishes the surviving arms', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('an continue');
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(0);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
    for (const name of ['child', 'sibling', 'local-only']) {
      expect(fixture.ok(['info', name])).to.include('Parent: main');
      expect(fixture.git(['rev-list', '--count', `main..${name}`])).to.equal(
        '1'
      );
    }
    expect(fixture.git(['show', 'sibling-tip:child.txt'])).to.equal(
      'concurrent trunk change'
    );
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('resolved child');
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(
      fixture.git(['show', 'sibling-tip:child.txt'], github.remote)
    ).to.equal('concurrent trunk change');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  for (const protection of ['frozen', 'worktree'] as const) {
    it(`does not replay, push or demand ${protection} changes on an independent arm completed by the previous merge`, () => {
      fixture.ok(['freeze', 'sibling']);
      const frozen = fixture.git(['rev-parse', 'refs/branch-metadata/sibling']);
      fixture.ok(['unfreeze', 'base']);
      const marker = path.join(fixture.root, 'completed-arm');
      const gh = path.join(github.bin, 'gh');
      const script = fs.readFileSync(gh, 'utf8');
      const injection = `
      if (process.argv[3] === 'repos/fixture/inspection/pulls/18') {
        const fs = require('fs'), cp = require('child_process');
        const record = JSON.parse(fs.readFileSync('.git/.anthracite_landing', 'utf8'));
        if (record.index === 1 && !fs.existsSync(${JSON.stringify(marker)})) {
          fs.writeFileSync(${JSON.stringify(
            marker
          )}, cp.execFileSync('git', ['rev-parse', 'sibling', 'sibling-tip'], {encoding:'utf8'}));
          if ('${protection}' === 'frozen') {
            const meta = JSON.parse(cp.execFileSync('git', ['cat-file', '-p', 'refs/branch-metadata/sibling'], {encoding:'utf8'}));
            meta.frozen = JSON.parse(cp.execFileSync('git', ['cat-file', '-p', '${frozen}'], {encoding:'utf8'})).frozen;
            const oid = cp.execFileSync('git', ['hash-object', '-w', '--stdin'], {input:JSON.stringify(meta),encoding:'utf8'}).trim();
            cp.execFileSync('git', ['update-ref', 'refs/branch-metadata/sibling', oid]);
            fs.writeFileSync(${JSON.stringify(marker + '.metadata')}, oid);
          } else cp.execFileSync('git', ['worktree', 'add', ${JSON.stringify(
            path.join(fixture.root, 'completed-worktree')
          )}, 'sibling']);
        }
      }
    `;
      fs.writeFileSync(gh, script.replace('\n', '\n' + injection + '\n'), {
        mode: 0o755,
      });
      const result = fixture.run(['land', 'child', '--yes']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['rev-parse', 'sibling', 'sibling-tip'])).to.equal(
        fs.readFileSync(marker, 'utf8').trim()
      );
      if (protection === 'frozen')
        expect(
          fixture.git(['rev-parse', 'refs/branch-metadata/sibling'])
        ).to.equal(fs.readFileSync(marker + '.metadata', 'utf8'));
      else
        expect(fixture.git(['worktree', 'list'])).to.include(
          'completed-worktree'
        );
      const edits = fs
        .readFileSync(github.calls, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((args: string[]) => args[0] === 'pr' && args[1] === 'edit');
      expect(edits.filter((args: string[]) => args[2] === '20')).to.have.length(
        1
      );
      expect(edits.filter((args: string[]) => args[2] === '21')).to.have.length(
        1
      );
    });
  }

  for (const protection of ['frozen', 'worktree'] as const) {
    it(`refuses a necessary ${protection} sibling before the first merge while unrelated protection is irrelevant`, () => {
      if (protection === 'frozen') fixture.ok(['freeze', 'sibling']);
      else
        fixture.git([
          'worktree',
          'add',
          path.join(fixture.root, 'occupied'),
          'sibling',
        ]);
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      const result = fixture.run(['land', 'base', '--yes']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    });
  }

  for (const change of ['protection', 'scope', 'head'] as const) {
    it(`stops before replay when a necessary sibling's ${change} changes after the merge`, () => {
      let mutation: string;
      if (change === 'protection') {
        fixture.ok(['freeze', 'sibling']);
        const frozen = fixture.git([
          'rev-parse',
          'refs/branch-metadata/sibling',
        ]);
        fixture.ok(['unfreeze', 'base']);
        mutation = `git update-ref refs/branch-metadata/sibling ${frozen}`;
      } else if (change === 'scope') {
        fixture.branch('new-required', 'sibling');
        const metadata = fixture.git([
          'rev-parse',
          'refs/branch-metadata/new-required',
        ]);
        fixture.ok(['untrack', 'new-required']);
        mutation = `git update-ref refs/branch-metadata/new-required ${metadata}`;
      } else {
        mutation = 'git update-ref refs/heads/sibling refs/heads/sibling-tip';
      }
      fixture.git(['switch', 'base']);
      const original = fixture.git(['rev-parse', 'child']);
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'hooks', 'post-checkout'),
        '#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then ' +
          mutation +
          '; fi\n',
        { mode: 0o755 }
      );
      const result = fixture.run(['land', 'child', '--yes']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('Confirmed merged');
      expect(fixture.git(['rev-parse', 'child'])).to.equal(original);
      expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
        original
      );
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      expect(
        fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
      ).to.equal(true);
    });
  }

  it('retains earlier arms when a later PR update fails and retries without duplicate replay or merge', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, failPrEditNumber: 21 })
    );
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('survivor maintenance')
      .and.include('sibling');
    expect(result.stdout)
      .to.include('Maintained: child')
      .and.include('Maintained: sibling');
    const names = ['child', 'tip', 'sibling', 'sibling-tip', 'local-only'];
    const heads = names.map((name) => fixture.git(['rev-parse', name]));
    for (const name of ['child', 'sibling', 'sibling-tip'])
      expect(fixture.git(['rev-parse', name], github.remote)).to.equal(
        fixture.git(['rev-parse', name])
      );
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    names.forEach((name, index) =>
      expect(fixture.git(['rev-parse', name])).to.equal(heads[index])
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('preserves a changed pending sibling before resolving an owned conflict continuation', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('an continue');
    fixture.git(['update-ref', 'refs/heads/sibling', 'refs/heads/sibling-tip']);
    const changed = fixture.git(['rev-parse', 'sibling']);
    const child = fixture.git(['rev-parse', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(1);
    expect(continued.stderr).to.include('Landing replay participant changed');
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(changed);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
  });

  it('preserves a later arm lease race and earlier published arms across retry', () => {
    const old = fixture.git(['rev-parse', 'sibling']);
    const tree = fixture.git(['rev-parse', 'sibling^{tree}'], github.remote);
    const competing = fixture.git(
      [
        '-c',
        'user.name=Concurrent',
        '-c',
        'user.email=concurrent@example.test',
        'commit-tree',
        tree,
        '-p',
        old,
        '-m',
        'Concurrent sibling',
      ],
      github.remote
    );
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nwhile read local_ref local_oid remote_ref remote_oid; do\nif [ "$remote_ref" = refs/heads/sibling ]; then git --git-dir="' +
        github.remote +
        '" update-ref refs/heads/sibling ' +
        competing +
        ' ' +
        old +
        '; fi\ndone\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(fixture.git(['rev-parse', 'sibling'], github.remote)).to.equal(
      competing
    );
    const child = fixture.git(['rev-parse', 'child']);
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(child);
    fs.unlinkSync(hook);
    const retry = fixture.run(['land', 'base', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(1);
    expect(retry.stderr).to.include('captured-OID lease refused survivor push');
    expect(fixture.git(['rev-parse', 'sibling'], github.remote)).to.equal(
      competing
    );
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('rechecks queued sibling identity between completed local replays', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const result = fixture.run(['land', 'base', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('an continue');
    const changed = fixture.git(['rev-parse', 'sibling-tip']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'post-rewrite'),
      '#!/bin/sh\ngit update-ref refs/heads/sibling refs/heads/sibling-tip\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const remote = fixture.git(['for-each-ref'], github.remote);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(1);
    expect(continued.stderr).to.include('Landing replay participant changed');
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(changed);
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
