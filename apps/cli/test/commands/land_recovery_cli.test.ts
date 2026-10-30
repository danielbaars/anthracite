import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('public landing interruption recovery', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('reconciles an accepted merge after SIGKILL using only its dead owned cache acquisition', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, interruptAfterMerge: true })
    );
    const gh = path.join(github.bin, 'gh');
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          "process.kill(process.ppid, 'SIGTERM')",
          "process.kill(process.ppid, 'SIGKILL')"
        )
    );
    expect(() => fixture.run(['land', 'base', '--yes'])).to.throw('SIGKILL');
    const lock = path.join(fixture.repo, '.git', '.graphite_cache_lock');
    expect(fs.existsSync(lock)).to.equal(true);
    expect(JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state).to.equal(
      'MERGED'
    );
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(fs.existsSync(lock)).to.equal(false);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(fixture.ok(['info', 'child'])).to.include('Parent: main');
    expect(fixture.git(['rev-parse', 'child'], github.remote)).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
  });
  it('resumes a preserved no-active queue locally after public freeze/unfreeze, then requires explicit land', () => {
    fixture.branch('sibling', 'base');
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    const stopped = fixture.run(['land', 'base', '--yes']);
    expect(stopped.status, stopped.stderr).to.equal(1);
    expect(stopped.stderr).to.include('an continue');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-rewrite');
    const [command, ...args] = getTestCliCommand(['freeze', 'sibling']);
    fs.writeFileSync(
      hook,
      `#!${
        process.execPath
      }\nconst cp=require('child_process'), fs=require('fs'); const r=cp.spawnSync(${JSON.stringify(
        command
      )}, ${JSON.stringify(
        args
      )}, {env:process.env,encoding:'utf8'}); fs.writeFileSync(${JSON.stringify(
        path.join(fixture.root, 'hook-result')
      )}, JSON.stringify({status:r.status,stdout:r.stdout,stderr:r.stderr}));`,
      { mode: 0o755 }
    );
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const paused = fixture.run(['continue']);
    expect(
      paused.status,
      paused.stdout +
        paused.stderr +
        fs.readFileSync(path.join(fixture.root, 'hook-result'), 'utf8')
    ).to.equal(1);
    expect(fixture.git(['rev-parse', '--verify', 'child'])).not.to.equal(
      github.prs[1].headRefOid
    );
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(false);
    const reachedChild = fixture.git(['rev-parse', 'child']);
    fs.unlinkSync(hook);
    fixture.ok(['unfreeze', 'sibling']);
    const busy = path.join(fixture.root, 'pending-worktree');
    fixture.git(['worktree', 'add', busy, 'tip']);
    const queuedHead = fixture.git(['rev-parse', 'tip']);
    const occupied = fixture.run(['continue']);
    expect(occupied.status, occupied.stderr).to.equal(1);
    expect(occupied.stderr).to.include('worktree');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(queuedHead);
    fixture.git(['worktree', 'remove', busy]);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(reachedChild);
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('resolved child');
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(true);
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('preserves an unchanged pending local queue after a rejected pre-rebase hook and resumes explicitly', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-rebase');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const remote = fixture.git(['for-each-ref'], github.remote);
    expect(fixture.run(['continue']).status).to.equal(1);
    const child = fixture.git(['rev-parse', 'child']);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge'))
    ).to.equal(false);
    fs.unlinkSync(hook);
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['show', 'tip:child.txt'])).to.equal('resolved child');
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
  });

  it('preserves raw-aborted replay and foreign continuation with actionable local inspection', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    fixture.git(['rebase', '--abort']);
    const continuation = path.join(fixture.repo, '.git', '.gtcontinue');
    const bytes = fs.readFileSync(continuation, 'utf8');
    const heads = fixture.git(['for-each-ref']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const continued = fixture.run(['continue', '--all']);
    expect(continued.status).to.equal(1);
    expect(continued.stderr).to.include('preserved');
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status).to.equal(1);
    expect(resumed.stderr).to.include('original project');
    expect(fs.readFileSync(continuation, 'utf8')).to.equal(bytes);
    expect(fixture.git(['for-each-ref'])).to.equal(heads);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    fs.writeFileSync(continuation, '{foreign continuation');
    expect(fixture.run(['continue', '--all']).status).to.equal(1);
    expect(fs.readFileSync(continuation, 'utf8')).to.equal(
      '{foreign continuation'
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('preserves malformed, foreign, live and unproven locks rather than guessing acquisition ownership', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, interruptAfterMerge: true })
    );
    const gh = path.join(github.bin, 'gh');
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          "process.kill(process.ppid, 'SIGTERM')",
          "process.kill(process.ppid, 'SIGKILL')"
        )
    );
    expect(() => fixture.run(['land', 'base', '--yes'])).to.throw('SIGKILL');
    const lock = path.join(fixture.repo, '.git', '.graphite_cache_lock');
    const recovery = path.join(fixture.repo, '.git', '.anthracite_landing');
    const originalLock = fs.readFileSync(lock, 'utf8');
    const originalRecord = fs.readFileSync(recovery, 'utf8');
    const identity = JSON.parse(originalLock);
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const heads = fixture.git(['for-each-ref']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    for (const bytes of [
      '{invalid',
      JSON.stringify(
        { pid: process.pid, timestamp: identity.timestamp },
        null,
        2
      ),
      JSON.stringify(
        { ...identity, timestamp: identity.timestamp + 1 },
        null,
        2
      ),
      '{}',
    ]) {
      fs.writeFileSync(lock, bytes);
      const refused = fixture.run(['land', 'base', '--yes']);
      expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
      expect(fs.readFileSync(lock, 'utf8')).to.equal(bytes);
      expect(fs.readFileSync(recovery, 'utf8')).to.equal(originalRecord);
    }
    fs.writeFileSync(lock, originalLock);
    const old = JSON.parse(originalRecord);
    delete old.cacheLock;
    const oldBytes = JSON.stringify(old) + '\n';
    fs.writeFileSync(recovery, oldBytes);
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    expect(fs.readFileSync(recovery, 'utf8')).to.equal(oldBytes);
    expect(fs.readFileSync(lock, 'utf8')).to.equal(originalLock);
    expect(fixture.git(['for-each-ref'])).to.equal(heads);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('retains an interrupted replay with changed refs for guarded manual inspection without replaying again', () => {
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-rewrite');
    fs.writeFileSync(
      hook,
      `#!${process.execPath}\nconst fs=require('fs');process.kill(JSON.parse(fs.readFileSync('.git/.graphite_cache_lock','utf8')).pid, 'SIGKILL');`,
      { mode: 0o755 }
    );
    expect(() => fixture.run(['land', 'base', '--yes'])).to.throw('SIGKILL');
    fs.unlinkSync(hook);
    const heads = fixture.git(['for-each-ref']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(1);
    expect(resumed.stderr).to.include('Saved local replay is incomplete');
    expect(fixture.git(['for-each-ref'])).to.equal(heads);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(true);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
  it('does not invent landing ownership when SIGKILL happens before the first durable record', () => {
    const gh = path.join(github.bin, 'gh');
    const injection = `const f=require('fs'); if(f.existsSync('.git/.graphite_cache_lock') && !f.existsSync('.git/.anthracite_landing')) process.kill(process.ppid,'SIGKILL');`;
    const original = fs.readFileSync(gh, 'utf8');
    fs.writeFileSync(gh, original.replace('\n', '\n' + injection + '\n'));
    const heads = fixture.git(['for-each-ref']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    expect(() => fixture.run(['land', 'base', '--yes'])).to.throw('SIGKILL');
    fs.writeFileSync(gh, original);
    const lock = path.join(fixture.repo, '.git', '.graphite_cache_lock');
    const bytes = fs.readFileSync(lock, 'utf8');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stderr).to.equal(1);
    expect(fs.readFileSync(lock, 'utf8')).to.equal(bytes);
    expect(fixture.git(['for-each-ref'])).to.equal(heads);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('preserves a replaced continuation after a completed replay without starting the next pending branch', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, replayConflict: true })
    );
    expect(fixture.run(['land', 'base', '--yes']).status).to.equal(1);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-rewrite');
    fs.writeFileSync(hook, '#!/bin/sh\nprintf foreign > .git/.gtcontinue\n', {
      mode: 0o755,
    });
    fs.writeFileSync(path.join(fixture.repo, 'child.txt'), 'resolved child\n');
    fixture.git(['add', 'child.txt']);
    const tip = fixture.git(['rev-parse', 'tip']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const continued = fixture.run(['continue']);
    expect(continued.status, continued.stdout + continued.stderr).to.equal(1);
    expect(continued.stderr).to.include('continuation changed');
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', '.gtcontinue'), 'utf8')
    ).to.equal('foreign');
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
  });
  for (const boundary of [
    'trunk advance',
    'head push',
    'PR update',
    'local cleanup',
  ] as const) {
    it(`reconciles SIGKILL after ${boundary} without repeating confirmed merge or completed replay`, () => {
      const recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
      const lockPath = path.join(fixture.repo, '.git', '.graphite_cache_lock');
      const marker = path.join(fixture.root, 'killed-boundary');
      const kill = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(
        marker
      )}, 'observed');process.kill(JSON.parse(fs.readFileSync(${JSON.stringify(
        lockPath
      )},'utf8')).pid,'SIGKILL');`;
      let hook: string;
      if (boundary === 'PR update') {
        hook = path.join(github.bin, 'gh');
        fs.appendFileSync(
          hook,
          `\nif(process.argv[2]==='pr' && process.argv[3]==='edit' && process.argv[4]==='18'){${kill}}\n`
        );
      } else if (boundary === 'head push') {
        hook = path.join(github.remote, 'hooks', 'post-receive');
        fs.writeFileSync(
          hook,
          `#!${process.execPath}\nconst input=require('fs').readFileSync(0,'utf8');if(input.includes('refs/heads/child')){${kill}}`,
          { mode: 0o755 }
        );
      } else {
        hook = path.join(
          fixture.repo,
          '.git',
          'hooks',
          'reference-transaction'
        );
        const pattern =
          boundary === 'trunk advance'
            ? '/^[a-f0-9]{40} (?!0{40})[a-f0-9]{40} refs\\/heads\\/main$/m'
            : '/^[a-f0-9]{40} 0{40} refs\\/heads\\/base$/m';
        fs.writeFileSync(
          hook,
          `#!${process.execPath}\nconst input=require('fs').readFileSync(0,'utf8');if(process.argv[2]==='committed' && ${pattern}.test(input)){${kill}}`,
          { mode: 0o755 }
        );
      }
      expect(() => fixture.run(['land', 'base', '--yes'])).to.throw('SIGKILL');
      expect(fs.readFileSync(marker, 'utf8')).to.equal('observed');
      expect(fs.existsSync(recordPath)).to.equal(true);
      const heads = ['child', 'tip'].map((branch) =>
        fixture.git(['rev-parse', branch])
      );
      if (boundary === 'PR update') {
        const script = fs.readFileSync(hook, 'utf8');
        fs.writeFileSync(
          hook,
          script.slice(0, script.lastIndexOf('\nif(process.argv[2]'))
        );
      } else fs.unlinkSync(hook);
      const resumed = fixture.run(['land', 'base', '--yes']);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
      if (boundary !== 'trunk advance')
        for (const [index, branch] of ['child', 'tip'].entries())
          expect(fixture.git(['rev-parse', branch])).to.equal(heads[index]);
      for (const branch of ['child', 'tip'])
        expect(fixture.git(['rev-parse', branch], github.remote)).to.equal(
          fixture.git(['rev-parse', branch])
        );
      expect(fixture.git(['rev-list', '--count', 'main..child'])).to.equal('1');
      expect(fixture.git(['rev-list', '--count', 'child..tip'])).to.equal('1');
      expect(fs.existsSync(recordPath)).to.equal(false);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      if (boundary === 'PR update') {
        const edits = fs
          .readFileSync(github.calls, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        expect(
          edits.filter(
            (args: string[]) =>
              args[0] === 'pr' && args[1] === 'edit' && args[2] === '18'
          )
        ).to.have.length(1);
      }
    });
  }
  it('permits only an explicit fresh retry after a definite HTTP403 merge rejection and verified unchanged open PR', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, rejectedMerge: true })
    );
    const gh = path.join(github.bin, 'gh');
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          `if(policy.rejectedMerge){process.stdout.write(JSON.stringify({message:'Resource not accessible by integration',status:'403'}));process.stderr.write('gh: Resource not accessible by integration (HTTP 403)\\n');process.exit(1); }\nconst input = JSON.parse(fs.readFileSync(0, 'utf8'));`
        )
    );
    const remote = fixture.git(['for-each-ref'], github.remote);
    const refused = fixture.run(['land', 'base', '--yes']);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
    expect(refused.stderr).to.include('rejected');
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    fs.writeFileSync(github.policy, JSON.stringify(policy));
    const resumed = fixture.run(['land', 'base', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(2);
    expect(JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state).to.equal(
      'MERGED'
    );
  });
});
