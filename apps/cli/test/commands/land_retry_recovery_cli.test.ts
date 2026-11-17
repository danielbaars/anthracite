import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { leaveLandingUnconfirmed } from '../lib/fixtures/landing_retry';

// eslint-disable-next-line max-lines-per-function
describe('public interrupted landing retry recovery', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  let recordPath: string;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
    recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
    leaveLandingUnconfirmed(fixture, github);
  });
  afterEach(() => fixture?.cleanup());

  function retry(): ReturnType<RelationCliFixture['run']> {
    return fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
  }
  function puts(): number {
    return fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1;
  }

  it('requires fresh consent after uncertainty and completes a further verified attempt preserving every source', () => {
    const original = fs.readFileSync(recordPath, 'utf8');
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, queuedResponse: true })
    );
    expect(retry().status).to.equal(1);
    let uncertain = fs.readFileSync(recordPath, 'utf8');
    const first = JSON.parse(uncertain).retry.attempt;
    const before = puts();
    expect(fixture.run(['land', 'leaf', '--yes']).status).to.equal(1);
    expect(puts()).to.equal(before);
    uncertain = fs.readFileSync(recordPath, 'utf8');
    const preview = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
    ]);
    expect(preview.status, preview.stderr).to.equal(0);
    expect(preview.stdout).to.include('Proposed retry: #31 leaf');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(uncertain);
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const recovered = retry();
    expect(recovered.status, recovered.stdout + recovered.stderr).to.equal(0);
    expect(puts()).to.equal(before + 1);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(
      fixture.git(['rev-parse', 'main'], github.remote)
    );
    expect(fs.existsSync(recordPath)).to.equal(false);
    const evidence = path.join(
      fixture.repo,
      '.git',
      '.anthracite_landing_retry'
    );
    expect(
      fs.readFileSync(path.join(evidence, first, 'original.json'), 'utf8')
    ).to.equal(original);
    const attempts = fs.readdirSync(evidence);
    expect(attempts).to.have.length(2);
    const second = attempts.find((attempt) => attempt !== first);
    expect(second).to.be.a('string');
    expect(
      fs.readFileSync(
        path.join(evidence, String(second), 'original.json'),
        'utf8'
      )
    ).to.equal(uncertain);
  });

  for (const boundary of [
    'archive',
    'intent',
    'dispatch',
    'accepted',
    'readback',
  ]) {
    it(`recovers after interruption at ${boundary} without replaying saved consent`, () => {
      const original = fs.readFileSync(recordPath, 'utf8');
      const gh = path.join(github.bin, 'gh');
      const normal = fs.readFileSync(gh, 'utf8');
      const marker = path.join(fixture.root, 'interrupted');
      const evidence = path.join(
        fixture.repo,
        '.git',
        '.anthracite_landing_retry'
      );
      if (boundary === 'accepted') {
        const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
        fs.writeFileSync(
          github.policy,
          JSON.stringify({ ...policy, interruptAfterMerge: true })
        );
        fs.writeFileSync(
          gh,
          normal.replace(
            "process.kill(process.ppid, 'SIGTERM')",
            "process.kill(process.ppid, 'SIGKILL')"
          )
        );
      } else {
        const condition =
          boundary === 'archive'
            ? 'fs.existsSync(evidence) && !record.retry'
            : boundary === 'intent'
            ? '!!record.retry'
            : boundary === 'dispatch'
            ? "process.argv.includes('PUT')"
            : "process.argv.includes('GET') && prs[0].state === 'MERGED'";
        const injection = `const fs=require('fs');const record=JSON.parse(fs.readFileSync(${JSON.stringify(
          recordPath
        )},'utf8'));const evidence=${JSON.stringify(
          evidence
        )};const prs=JSON.parse(fs.readFileSync(${JSON.stringify(
          github.state
        )},'utf8'));if(${condition}){fs.writeFileSync(${JSON.stringify(
          marker
        )},'observed');process.kill(JSON.parse(fs.readFileSync('.git/.graphite_cache_lock','utf8')).pid,'SIGKILL');process.exit(1);}`;
        const newline = normal.indexOf('\n');
        fs.writeFileSync(
          gh,
          normal.slice(0, newline + 1) +
            '{' +
            injection +
            '}\n' +
            normal.slice(newline + 1)
        );
      }
      expect(() => retry()).to.throw('SIGKILL');
      fs.writeFileSync(gh, normal);
      const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
      delete policy.interruptAfterMerge;
      fs.writeFileSync(github.policy, JSON.stringify(policy));
      const sent = puts();
      const merged =
        JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state === 'MERGED';
      const retained = fs.readFileSync(recordPath, 'utf8');
      expect(JSON.parse(retained).phase).to.equal('merge-requested');
      expect(fs.readdirSync(evidence)).to.have.length(1);
      const first = fs.readdirSync(evidence)[0];
      expect(
        fs.readFileSync(path.join(evidence, first, 'original.json'), 'utf8')
      ).to.equal(original);
      if (boundary === 'intent') {
        for (const producer of [
          process.env.ANTHRACITE_TEST_LANDING_V1_PRODUCER,
          process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER,
        ]) {
          if (!producer) continue;
          const refused = spawnSync(
            producer,
            ['land', 'leaf', '--yes', '--no-interactive'],
            { cwd: fixture.repo, env: fixture.env, encoding: 'utf8' }
          );
          expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
          expect(fs.readFileSync(recordPath, 'utf8')).to.equal(retained);
          expect(puts()).to.equal(sent);
        }
      }
      const resumed = fixture.run(['land', 'leaf', '--yes']);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(
        merged ? 0 : 1
      );
      expect(puts()).to.equal(sent);
      if (!merged) {
        const recovered = retry();
        expect(recovered.status, recovered.stdout + recovered.stderr).to.equal(
          0
        );
        expect(puts()).to.equal(sent + 1);
      }
      expect(fixture.git(['rev-parse', 'main'])).to.equal(
        fixture.git(['rev-parse', 'main'], github.remote)
      );
      expect(fs.existsSync(recordPath)).to.equal(false);
      expect(
        fs.readFileSync(path.join(evidence, first, 'original.json'), 'utf8')
      ).to.equal(original);
    });
  }

  it('retains a concrete refusal when readback fails and permits only a freshly authorized recovery', () => {
    const gh = path.join(github.bin, 'gh');
    const normal = fs.readFileSync(gh, 'utf8');
    const marker = path.join(fixture.root, 'rejected');
    const rejected = normal
      .replace(
        "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
        `fs.writeFileSync(${JSON.stringify(
          marker
        )},'rejected');process.stdout.write(JSON.stringify({status:'405',message:'Merge blocked'}));process.stderr.write('gh: Merge blocked (HTTP 405)');process.exit(1);`
      )
      .replace(
        "else if (endpoint.startsWith(prefix + '/pulls/')) {",
        `else if (endpoint.startsWith(prefix + '/pulls/')) { if(fs.existsSync(${JSON.stringify(
          marker
        )}))throw new Error('readback unavailable');`
      );
    fs.writeFileSync(gh, rejected);
    const stopped = retry();
    expect(stopped.status).to.equal(1);
    expect(stopped.stderr, stopped.stdout + stopped.stderr)
      .to.include('HTTP 405')
      .and.include('Merge readback failed')
      .and.include('New merge request attempted')
      .and.include('land leaf --retry-unconfirmed');
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).phase).to.equal(
      'merge-requested'
    );
    const before = puts();
    fs.writeFileSync(gh, normal);
    expect(fixture.run(['land', 'leaf', '--yes']).status).to.equal(1);
    expect(puts()).to.equal(before);
    const recovered = retry();
    expect(recovered.status, recovered.stdout + recovered.stderr).to.equal(0);
    expect(puts()).to.equal(before + 1);
  });

  it('reconciles an earlier merge completing at the final pre-dispatch read without another PUT', () => {
    const gh = path.join(github.bin, 'gh');
    const normal = fs.readFileSync(gh, 'utf8');
    const reads = path.join(fixture.root, 'active-reads');
    const injection = `const fs=require('fs');const p=JSON.parse(fs.readFileSync(${JSON.stringify(
      recordPath
    )},'utf8'));if(p.retry && process.argv.includes('GET') && process.argv[3]==='repos/fixture/inspection/pulls/31'){const marker=${JSON.stringify(
      reads
    )};const count=fs.existsSync(marker)?Number(fs.readFileSync(marker,'utf8'))+1:1;fs.writeFileSync(marker,String(count));if(count===2){const cp=require('child_process');const git=(args)=>cp.execFileSync('git',['--git-dir='+${JSON.stringify(
      github.remote
    )},...args],{encoding:'utf8'}).trim();const result=git(['-c','user.name=Earlier request','-c','user.email=earlier@example.test','commit-tree',git(['rev-parse','leaf^{tree}']),'-p',git(['rev-parse','main']),'-m','Earlier merge completed']);git(['update-ref','refs/heads/main',result]);const prs=JSON.parse(fs.readFileSync(${JSON.stringify(
      github.state
    )},'utf8'));prs[0].state='MERGED';prs[0].mergeResult=result;fs.writeFileSync(${JSON.stringify(
      github.state
    )},JSON.stringify(prs));}}`;
    const newline = normal.indexOf('\n');
    fs.writeFileSync(
      gh,
      normal.slice(0, newline + 1) +
        '{' +
        injection +
        '}\n' +
        normal.slice(newline + 1)
    );
    const before = puts();
    const recovered = retry();
    expect(recovered.status, recovered.stdout + recovered.stderr).to.equal(0);
    expect(fs.readFileSync(reads, 'utf8')).to.equal('3');
    expect(puts()).to.equal(before);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(
      fixture.git(['rev-parse', 'main'], github.remote)
    );
    expect(fs.existsSync(recordPath)).to.equal(false);
  });

  it('validates original evidence and fresh head again after multiple uncertain attempts', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, queuedResponse: true })
    );
    expect(retry().status).to.equal(1);
    const first = JSON.parse(fs.readFileSync(recordPath, 'utf8')).retry.attempt;
    expect(retry().status).to.equal(1);
    const saved = fs.readFileSync(recordPath, 'utf8');
    const before = puts();
    const original = path.join(
      fixture.repo,
      '.git',
      '.anthracite_landing_retry',
      first,
      'original.json'
    );
    const bytes = fs.readFileSync(original, 'utf8');
    fs.writeFileSync(original, bytes + ' ');
    const invalid = retry();
    expect(invalid.status).to.equal(1);
    expect(invalid.stderr).to.include('Retry evidence unavailable or changed');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(puts()).to.equal(before);
    fs.writeFileSync(original, bytes);
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    prs[0].headRefOid = '1'.repeat(40);
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const changed = retry();
    expect(changed.status, changed.stdout + changed.stderr).to.equal(1);
    expect(changed.stdout + changed.stderr).to.include('head');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(puts()).to.equal(before);
  });

  it('preserves the concrete refusal even when retaining its outcome receipt fails', () => {
    const gh = path.join(github.bin, 'gh');
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          "fs.mkdirSync(path.resolve(common,'.anthracite_landing_retry',progress.retry.attempt,'rejected.json'));process.stdout.write(JSON.stringify({status:'405',message:'Merge blocked'}));process.stderr.write('gh: Merge blocked (HTTP 405)');process.exit(1);"
        )
    );
    const before = puts();
    const refused = retry();
    expect(refused.status).to.equal(1);
    expect(refused.stderr)
      .to.include('HTTP 405')
      .and.include('Merge blocked')
      .and.include('Retry outcome evidence could not be retained')
      .and.include('--retry-unconfirmed');
    expect(puts()).to.equal(before + 1);
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).phase).to.equal(
      'merge-requested'
    );
  });
});
