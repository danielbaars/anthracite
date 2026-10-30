import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing review regressions', function () {
  this.timeout(180000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('refuses equal-OID remotes declaring a different repository or provider before transport or service effects', () => {
    const mirror = path.join(fixture.root, 'mirror.git');
    fixture.git(['clone', '--mirror', github.remote, mirror]);
    const refs = fixture.git(['for-each-ref'], mirror);
    for (const url of [
      'https://github.com/other/mirror.git',
      'https://gitlab.com/fixture/inspection.git',
    ]) {
      fixture.git(['config', `url.${mirror}.insteadOf`, url]);
      fixture.git(['remote', 'set-url', 'origin', url]);
      fixture.git(['remote', 'set-url', '--push', 'origin', url]);
      const before = fixture.inspectionSnapshot();
      for (const option of ['--dry-run', '--yes']) {
        const refused = fixture.run(['land', 'base', option]);
        expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
        expect(refused.stdout + refused.stderr).to.include(
          'declared GitHub remote'
        );
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
        expect(fixture.git(['for-each-ref'], mirror)).to.equal(refs);
        expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
      }
    }
  });
  it('accepts canonical SSH declarations and refuses credential, port and URL suffix ambiguity without echoing credentials', () => {
    for (const url of [
      'git@github.com:fixture/inspection',
      'ssh://git@github.com/fixture/inspection.git',
    ]) {
      fixture.git(['config', `url.${github.remote}.insteadOf`, url]);
      fixture.git(['remote', 'set-url', 'origin', url]);
      fixture.git(['remote', 'set-url', '--push', 'origin', url]);
      const before = fixture.inspectionSnapshot();
      const preview = fixture.run(['land', 'base', '--dry-run']);
      expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    for (const url of [
      'https://secret-sentinel@github.com/fixture/inspection.git',
      'ssh://git@github.com:22/fixture/inspection.git',
      'https://github.com/fixture/inspection.git?other=repo',
      'https://github.com/fixture/inspection.git#other',
    ]) {
      fixture.git(['remote', 'set-url', 'origin', url]);
      fixture.git(['remote', 'set-url', '--push', 'origin', url]);
      const before = fixture.inspectionSnapshot();
      const preview = fixture.run(['land', 'base', '--dry-run']);
      expect(preview.status, preview.stdout + preview.stderr).to.equal(1);
      expect(preview.stdout + preview.stderr)
        .to.include('declared GitHub remote')
        .and.not.to.include('secret-sentinel');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('refuses a post-checkout hook redirecting the declared endpoint after the confirmed merge', () => {
    const mirror = path.join(fixture.root, 'mirror.git');
    fixture.git(['clone', '--mirror', github.remote, mirror]);
    fixture.git([
      'config',
      `url.${mirror}.insteadOf`,
      'https://github.com/other/mirror.git',
    ]);
    const before = fixture.git(['for-each-ref'], mirror);
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-checkout'),
      '#!/bin/sh\ngit remote set-url origin https://github.com/other/mirror.git\ngit remote set-url --push origin https://github.com/other/mirror.git\n',
      { mode: 0o755 }
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('declared GitHub remote');
    expect(fixture.git(['for-each-ref'], mirror)).to.equal(before);
    expect(JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state).to.equal(
      'MERGED'
    );
    expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(
      github.prs[0].headRefOid
    );
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(true);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"edit"');
  });

  it('preserves a foreign continuation introduced by a pre-rebase hook before the first conflict publication', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: false,
        rules: [],
        protection: null,
        replayConflict: true,
      })
    );
    const foreign = '{"foreign":"preserve-publication"}\n';
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-rebase'),
      `#!/bin/sh\nprintf '%s\\n' '{"foreign":"preserve-publication"}' > "$(git rev-parse --git-path .gtcontinue)"\n`,
      { mode: 0o755 }
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git/.gtcontinue'), 'utf8')
    ).to.equal(foreign);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(
      github.prs[1].headRefOid
    );
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(true);
    expect(stopped.stderr).to.include('continuation').and.include('preserved');
    expect(JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state).to.equal(
      'MERGED'
    );
  });

  it('preserves a foreign continuation introduced during the final local replay and records its reached head', () => {
    fixture.git(['switch', 'base']);
    fixture.ok(['delete', 'tip', '--force']);
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: false,
        rules: [],
        protection: null,
        replayConflict: true,
      })
    );
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const foreign = '{"foreign":"preserve-finalization"}\n';
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-rewrite'),
      `#!/bin/sh\nprintf '%s\\n' '{"foreign":"preserve-finalization"}' > "$(git rev-parse --git-path .gtcontinue)"\n`,
      { mode: 0o755 }
    );
    const beforeRemote = fixture.git(['for-each-ref'], github.remote);
    const beforeCalls = fs.readFileSync(github.calls, 'utf8');
    const stopped = fixture.run(['continue']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git/.gtcontinue'), 'utf8')
    ).to.equal(foreign);
    expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(beforeRemote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(beforeCalls);
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(fixture.repo, '.git/.anthracite_landing'),
        'utf8'
      )
    );
    expect(journal.maintenance[0].reached.head).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(stopped.stderr).to.include('continuation').and.include('preserved');
  });

  it('cleans multiple verified merged ancestors without replaying or publishing them while maintaining the open target and fanout', () => {
    fixture.branch('beside-base', 'base');
    fixture.branch('beside-child', 'child');
    fixture.git(['push', 'origin', '--all']);
    const prs = [
      ...github.prs,
      github.pr('beside-base', 20),
      github.pr('beside-child', 21),
    ];
    const external = path.join(fixture.root, 'external');
    fixture.git(['clone', github.remote, external]);
    fixture.git(['config', 'user.name', 'External'], external);
    fixture.git(['config', 'user.email', 'external@example.test'], external);
    const originalMain = fixture.git(['rev-parse', 'main']);
    let result = originalMain;
    fixture.env.GIT_COMMITTER_DATE = '2035-01-01T00:00:00Z';
    for (let index = 0; index < 2; index++) {
      const pr = prs[index];
      fixture.git(
        ['checkout', '-B', 'landing', String(pr.headRefOid)],
        external
      );
      fixture.git(
        [
          'rebase',
          '--force-rebase',
          '--onto',
          result,
          index ? String(prs[0].headRefOid) : originalMain,
          'landing',
        ],
        external
      );
      const previous = result;
      result = fixture.git(['rev-parse', 'HEAD'], external);
      expect(result).not.to.equal(pr.headRefOid);
      fixture.git(['push', 'origin', 'HEAD:refs/heads/main'], external);
      Object.assign(pr, {
        state: 'MERGED',
        mergeResult: result,
        baseRefName: 'main',
        baseRefOid: previous,
      });
    }
    delete fixture.env.GIT_COMMITTER_DATE;
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const observed = path.join(fixture.root, 'merged-heads-before-push');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-push'),
      `#!/bin/sh\ngit --git-dir='${github.remote}' for-each-ref --format='%(refname) %(objectname)' refs/heads/base refs/heads/child >> '${observed}'\n`,
      { mode: 0o755 }
    );
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include('Cleanup-only 1: base')
      .and.include('Cleanup-only 2: child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const landed = fixture.run(['land', 'tip', '--yes']);
    expect(landed.status, landed.stdout + landed.stderr).to.equal(0);
    const lines = fs.readFileSync(observed, 'utf8').trim().split('\n');
    for (const line of lines)
      expect([
        `refs/heads/base ${prs[0].headRefOid}`,
        `refs/heads/child ${prs[1].headRefOid}`,
      ]).to.include(line);
    const calls = fs
      .readFileSync(github.calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.filter((args) => args.includes('PUT')).length).to.equal(1);
    expect(calls.filter((args) => args[1] === 'edit').map((args) => args[2]))
      .not.to.include('17')
      .and.not.to.include('18');
    for (const branch of ['base', 'child', 'tip']) {
      expect(
        fixture.git([
          'for-each-ref',
          '--format=%(objectname)',
          `refs/heads/${branch}`,
          `refs/branch-metadata/${branch}`,
        ])
      ).to.equal('');
      expect(
        fixture.git(
          ['for-each-ref', '--format=%(objectname)', `refs/heads/${branch}`],
          github.remote
        )
      ).to.equal('');
    }
    for (const branch of ['beside-base', 'beside-child']) {
      expect(fixture.ok(['info', branch])).to.include('Parent: main');
      expect(fixture.git(['rev-parse', branch])).to.equal(
        fixture.git(['rev-parse', branch], github.remote)
      );
      expect(fixture.git(['show', `${branch}:${branch}.txt`])).to.equal(branch);
      const pr = JSON.parse(fs.readFileSync(github.state, 'utf8')).find(
        (pr: Record<string, unknown>) => pr.headRefName === branch
      );
      expect(pr.baseRefName).to.equal('main');
      expect(pr.state).to.equal('OPEN');
    }
  });

  it('previews all remaining recovery work freshly and preserves dirty and pending-check blockers', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
    const stopped = fixture.run(['land', 'child', '--yes']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('readiness');
    fs.writeFileSync(path.join(fixture.repo, 'untracked-blocker'), 'dirty');
    const before = fixture.inspectionSnapshot();
    const journal = fs.readFileSync(
      path.join(fixture.repo, '.git/.anthracite_landing'),
      'utf8'
    );
    const remote = fixture.git(['for-each-ref'], github.remote);
    const state = fs.readFileSync(github.state, 'utf8');
    const preview = fixture.run(['land', 'child', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(1);
    expect(preview.stdout + preview.stderr)
      .to.include('Clean index/worktree')
      .and.include('IN_PROGRESS');
    expect(preview.stdout)
      .to.include('Merge: child')
      .and.include('Maintain: tip')
      .and.include('Push: tip')
      .and.include('PR update: tip')
      .and.include('Cleanup: child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(
        path.join(fixture.repo, '.git/.anthracite_landing'),
        'utf8'
      )
    ).to.equal(journal);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.state, 'utf8')).to.equal(state);
    fs.unlinkSync(path.join(fixture.repo, 'untracked-blocker'));
    const checksOnly = fixture.run(['land', 'child', '--dry-run']);
    expect(checksOnly.status).to.equal(1);
    expect(checksOnly.stdout + checksOnly.stderr).to.include('IN_PROGRESS');
  });

  it('previews a deleted original target and known self-produced unpublished survivor heads without changing progress', () => {
    const hook = path.join(fixture.repo, '.git/hooks/pre-push');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 23\n', { mode: 0o755 });
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status).to.equal(1);
    const localChild = fixture.git(['rev-parse', 'child']);
    expect(localChild).not.to.equal(
      fixture.git(['rev-parse', 'child'], github.remote)
    );
    // A same-content timestamp change requires Git's optional index refresh;
    // a preserving preview must leave the raw index bytes unchanged.
    const touched = path.join(fixture.repo, 'main.txt');
    fs.utimesSync(touched, new Date(), new Date(Date.now() + 5000));
    const before = fixture.inspectionSnapshot();
    const journal = fs.readFileSync(
      path.join(fixture.repo, '.git/.anthracite_landing'),
      'utf8'
    );
    const preview = fixture.run(['land', 'base', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include(`reached head ${localChild}`)
      .and.include('Push: child');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(
        path.join(fixture.repo, '.git/.anthracite_landing'),
        'utf8'
      )
    ).to.equal(journal);
    fs.unlinkSync(hook);
    const checkout = path.join(fixture.repo, '.git/hooks/post-checkout');
    fs.writeFileSync(
      checkout,
      '#!/bin/sh\nif ! git show-ref --verify --quiet refs/heads/base; then exit 24; fi\n',
      { mode: 0o755 }
    );
    const retry = fixture.run(['land', 'base', '--yes']);
    expect(retry.status).to.equal(1);
    expect(
      fixture.git(['for-each-ref', '--format=%(objectname)', 'refs/heads/base'])
    ).to.equal('');
    const deletedBefore = fixture.inspectionSnapshot();
    const deletedPreview = fixture.run(['land', '--dry-run']);
    expect(
      deletedPreview.status,
      deletedPreview.stdout + deletedPreview.stderr
    ).to.equal(0);
    expect(deletedPreview.stdout)
      .to.include('Cleanup: base')
      .and.include('phase local-deleted');
    expect(fixture.inspectionSnapshot()).to.deep.equal(deletedBefore);
  });

  it('refuses a preserving recovery preview with a genuine unresolved Git replay', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: false,
        rules: [],
        protection: null,
        replayConflict: true,
      })
    );
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const before = fixture.inspectionSnapshot();
    const journal = fs.readFileSync(
      path.join(fixture.repo, '.git/.anthracite_landing'),
      'utf8'
    );
    const remote = fixture.git(['for-each-ref'], github.remote);
    const state = fs.readFileSync(github.state, 'utf8');
    const preview = fixture.run(['land', 'base', '--dry-run']);
    expect(preview.status).to.equal(1);
    expect(preview.stdout)
      .to.include('Local replay incomplete: child, tip')
      .and.include('Maintain: tip');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(
        path.join(fixture.repo, '.git/.anthracite_landing'),
        'utf8'
      )
    ).to.equal(journal);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.state, 'utf8')).to.equal(state);
  });
  it('revalidates endpoint identity before active continuation writes and between completed local replays', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: false,
        rules: [],
        protection: null,
        replayConflict: true,
      })
    );
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'guard-untracked'),
      'do not stage'
    );
    const mirror = path.join(fixture.root, 'mirror.git');
    fixture.git(['clone', '--mirror', github.remote, mirror]);
    const wrong = 'https://github.com/other/mirror.git';
    const declared = 'https://github.com/fixture/inspection.git';
    fixture.git(['config', `url.${mirror}.insteadOf`, wrong]);
    fixture.git(['remote', 'set-url', 'origin', wrong]);
    fixture.git(['remote', 'set-url', '--push', 'origin', wrong]);
    const before = fixture.inspectionSnapshot();
    const initial = fixture.run(['continue', '--all']);
    expect(initial.status, initial.stdout + initial.stderr).to.equal(1);
    expect(initial.stderr).to.include('declared GitHub remote');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['remote', 'set-url', 'origin', declared]);
    fixture.git(['remote', 'set-url', '--push', 'origin', declared]);
    fs.unlinkSync(path.join(fixture.repo, 'guard-untracked'));
    const tip = fixture.git(['rev-parse', 'tip']);
    const child = fixture.git(['rev-parse', 'child']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const other = fixture.git(['for-each-ref'], mirror);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const continuation = fs.readFileSync(
      path.join(fixture.repo, '.git/.gtcontinue'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-rewrite'),
      `#!/bin/sh\ngit remote set-url origin ${wrong}\ngit remote set-url --push origin ${wrong}\n`,
      { mode: 0o755 }
    );
    const stopped = fixture.run(['continue']);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('declared GitHub remote');
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git/.gtcontinue'), 'utf8')
    ).to.equal(continuation);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fixture.git(['for-each-ref'], mirror)).to.equal(other);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
  });
});
