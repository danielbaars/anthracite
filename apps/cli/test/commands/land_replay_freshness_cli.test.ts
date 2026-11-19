import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

// eslint-disable-next-line max-lines-per-function
describe('public landing replay freshness', function () {
  this.timeout(240000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 180000;
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  function futureTrunk(): string {
    const clone = path.join(fixture.root, 'independent');
    fixture.git(['clone', github.remote, clone]);
    fixture.git(['switch', 'main'], clone);
    fs.writeFileSync(
      path.join(clone, 'child.txt'),
      'independent trunk change\n'
    );
    fixture.git(['add', 'child.txt'], clone);
    fixture.git(['commit', '-m', 'Independent trunk change'], clone);
    fixture.git(['push', 'origin', 'HEAD:refs/heads/incoming-trunk'], clone);
    return fixture.git(['rev-parse', 'HEAD'], clone);
  }

  function duringFirstRequest(code: string, phase = 'merge-requested'): string {
    const marker = path.join(fixture.root, 'changed-before-request');
    const script = path.join(github.bin, 'gh');
    const original = fs.readFileSync(script, 'utf8');
    const progress = path.join(fixture.repo, '.git/.anthracite_landing');
    fs.writeFileSync(
      script,
      original.slice(0, original.indexOf('\n') + 1) +
        `
{
 const recordPath=${JSON.stringify(progress)}, markerPath=${JSON.stringify(
          marker
        )};
 if (require('fs').existsSync(recordPath) && !require('fs').existsSync(markerPath) &&
     JSON.parse(require('fs').readFileSync(recordPath,'utf8')).phase === ${JSON.stringify(
       phase
     )} &&
     process.argv.includes('repos/fixture/inspection/pulls/17')) {
   ${code}
   require('fs').writeFileSync(markerPath,'changed');
 }
}
` +
        original.slice(original.indexOf('\n') + 1)
    );
    return marker;
  }

  it('refuses a compatible trunk advance after locked inspection but before the first merge request', () => {
    const next = futureTrunk();
    const marker = duringFirstRequest(
      `require('child_process').execFileSync('git', ['update-ref','refs/heads/main',${JSON.stringify(
        next
      )}], {cwd:${JSON.stringify(github.remote)}});`
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--yes', '--wait-timeout', '0']);
    expect(fs.existsSync(marker)).to.equal(true);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    expect(result.stdout + result.stderr).to.include('Replay inputs changed');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['rev-parse', 'main'], github.remote)).to.equal(next);
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status).to.equal(1);
    expect(preview.stdout).to.include('Replay conflict in child');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('preserves a changed recovery record instead of clearing foreign progress', () => {
    const progress = path.join(fixture.repo, '.git/.anthracite_landing');
    const external = path.join(fixture.root, 'external-progress');
    const marker = duringFirstRequest(`
      const fs = require('fs');
      const record = JSON.parse(fs.readFileSync(recordPath,'utf8'));
      record.target = 'externally-changed-target';
      const bytes = JSON.stringify(record);
      fs.writeFileSync(recordPath, bytes);
      fs.writeFileSync(${JSON.stringify(external)}, bytes);
    `);
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(fs.existsSync(marker)).to.equal(true);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    expect(fs.readFileSync(progress, 'utf8')).to.equal(
      fs.readFileSync(external, 'utf8')
    );
  });

  for (const mutation of ['configuration', 'head', 'parent metadata'])
    it(`refuses changed ${mutation} after inspection without losing the external change`, () => {
      const replacement = fixture.git([
        'rev-parse',
        mutation === 'parent metadata' ? 'refs/branch-metadata/other' : 'other',
      ]);
      const args =
        mutation === 'configuration'
          ? ['config', 'rebase.backend', 'apply']
          : [
              'update-ref',
              mutation === 'head'
                ? 'refs/heads/tip'
                : 'refs/branch-metadata/tip',
              replacement,
            ];
      const marker = duringFirstRequest(
        `require('child_process').execFileSync('git', ${JSON.stringify(
          args
        )}, {cwd:${JSON.stringify(fixture.repo)}});`
      );
      const result = fixture.run(['land', 'tip', '--yes']);
      expect(fs.existsSync(marker)).to.equal(true);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
      expect(result.stdout + result.stderr).to.include('Replay inputs changed');
      expect(result.stdout + result.stderr).not.to.include('Recovery retained');
      expect(
        fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
      ).to.equal(false);
      if (mutation === 'configuration')
        expect(fixture.git(['config', 'rebase.backend'])).to.equal('apply');
      else
        expect(
          fixture.git([
            'rev-parse',
            mutation === 'head' ? 'tip' : 'refs/branch-metadata/tip',
          ])
        ).to.equal(replacement);
    });

  for (const confirm of [false, true])
    it(`preserves a trunk change at confirmation with acceptance ${confirm}`, () => {
      const next = futureTrunk();
      const before = fixture.inspectionSnapshot();
      const result = runCliInPty(getTestCliCommand(['land', 'tip']), {
        cwd: fixture.repo,
        env: fixture.env,
        timeoutMs: 90000,
        responses: [
          {
            prompt: 'Apply this landing plan?',
            input: confirm ? 'y\n' : 'n\n',
            beforeInput: [
              'git',
              '--git-dir',
              github.remote,
              'update-ref',
              'refs/heads/main',
              next,
            ],
          },
        ],
      });
      expect(result.status, result.output).to.equal(confirm ? 1 : 0);
      expect(result.output).to.include('Apply this landing plan?');
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['rev-parse', 'main'], github.remote)).to.equal(next);
      expect(
        fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
      ).to.equal(false);
    });

  it('lands unchanged captured inputs despite an unrelated advice preference changing', () => {
    const marker = duringFirstRequest(
      `require('child_process').execFileSync('git', ['config','advice.detachedHead','false'], {cwd:${JSON.stringify(
        fixture.repo
      )}});`
    );
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(fs.existsSync(marker)).to.equal(true);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
    expect(fixture.git(['config', 'advice.detachedHead'])).to.equal('false');
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'main:tip.txt'])).to.equal('tip');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git/.anthracite_landing'))
    ).to.equal(false);
  });

  it('revalidates before maintaining an already externally merged first target', () => {
    const clone = path.join(fixture.root, 'external-merge');
    fixture.git(['clone', github.remote, clone]);
    const oldMain = fixture.git(['rev-parse', 'main']);
    fixture.git(['checkout', '-B', 'landing', 'origin/base'], clone);
    fixture.env.GIT_COMMITTER_DATE = '2035-01-01T00:00:00Z';
    fixture.git(
      ['rebase', '--force-rebase', '--onto', oldMain, oldMain, 'landing'],
      clone
    );
    delete fixture.env.GIT_COMMITTER_DATE;
    const result = fixture.git(['rev-parse', 'HEAD'], clone);
    fixture.git(['push', 'origin', 'HEAD:refs/heads/main'], clone);
    const prs = [...github.prs];
    Object.assign(prs[0], { state: 'MERGED', mergeResult: result });
    fs.writeFileSync(github.state, JSON.stringify(prs));
    const next = futureTrunk();
    const marker = duringFirstRequest(
      `require('child_process').execFileSync('git', ['update-ref','refs/heads/main',${JSON.stringify(
        next
      )}], {cwd:${JSON.stringify(github.remote)}});`,
      'prepared'
    );
    const before = fixture.inspectionSnapshot();
    const refused = fixture.run(['land', 'tip', '--yes']);
    expect(fs.existsSync(marker)).to.equal(true);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
    expect(refused.stdout + refused.stderr).to.include('Replay inputs changed');
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('"PUT"')
      .and.not.to.include('"edit"');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['rev-parse', 'base'], github.remote)).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(fixture.git(['rev-parse', 'main'], github.remote)).to.equal(next);
  });

  for (const command of ['filter', 'fsmonitor'])
    it(`executes no newly introduced ${command} during pre-effect source inspection`, () => {
      const sentinel = path.join(fixture.root, 'project-command-ran');
      const hook = path.join(fixture.root, 'project-command');
      fs.writeFileSync(
        hook,
        `#!/bin/sh\nprintf ran > '${sentinel}'\n${
          command === 'filter' ? 'cat' : 'exit 0'
        }\n`,
        { mode: 0o755 }
      );
      const code =
        command === 'filter'
          ? `
        require('child_process').execFileSync('git', ['config','filter.late.clean',${JSON.stringify(
          hook
        )}], {cwd:${JSON.stringify(fixture.repo)}});
        require('fs').writeFileSync(${JSON.stringify(
          path.join(fixture.repo, '.git/info/attributes')
        )}, '*.txt filter=late\\n');
      `
          : `require('child_process').execFileSync('git', ['config','core.fsmonitor',${JSON.stringify(
              hook
            )}], {cwd:${JSON.stringify(fixture.repo)}});`;
      const marker = duringFirstRequest(code, 'prepared');
      const refused = fixture.run(['land', 'tip', '--yes']);
      expect(fs.existsSync(marker)).to.equal(true);
      expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
      expect(
        fs.existsSync(sentinel),
        'project command executed before invalidation'
      ).to.equal(false);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    });
  it('cancels a blocked fresh-input GitHub read under lock without leaking owned state', async () => {
    const temporary = path.join(fixture.root, 'temporary');
    fs.mkdirSync(temporary);
    const foreign = path.join(temporary, 'an-land-inputs-foreign');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'sentinel'), 'foreign');
    fixture.env.TMPDIR = temporary;
    const blocked = path.join(fixture.root, 'blocked-gh');
    const script = path.join(github.bin, 'gh');
    const original = fs.readFileSync(script, 'utf8');
    const progress = path.join(fixture.repo, '.git/.anthracite_landing');
    fs.writeFileSync(
      script,
      original.slice(0, original.indexOf('\n') + 1) +
        `
const ownFs=require('fs');
if (ownFs.existsSync(${JSON.stringify(
          progress
        )}) && JSON.parse(ownFs.readFileSync(${JSON.stringify(
          progress
        )},'utf8')).phase==='merge-requested' && process.argv[2]==='pr' && process.argv[3]==='view' && process.argv[4]==='17') {
 ownFs.writeFileSync(${JSON.stringify(blocked)},String(process.pid));
 setInterval(()=>{},1000);
} else {
` +
        original.slice(original.indexOf('\n') + 1) +
        '\n}\n'
    );
    const before = fixture.inspectionSnapshot();
    const [executable, ...args] = getTestCliCommand(['land', 'tip', '--yes']);
    const child = spawn(executable, args, {
      cwd: fixture.repo,
      env: fixture.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const ended = new Promise<boolean>((resolve) =>
      child.once('exit', () => resolve(true))
    );
    let ghPid: number | undefined;
    try {
      const deadline = Date.now() + 60000;
      while (!fs.existsSync(blocked) && Date.now() < deadline) await delay(50);
      expect(fs.existsSync(blocked), output).to.equal(true);
      const observedPid = Number(fs.readFileSync(blocked, 'utf8'));
      ghPid = observedPid;
      child.kill('SIGINT');
      expect(
        await Promise.race([ended, delay(5000, false)]),
        'inspection did not unwind'
      ).to.equal(true);
      expect(
        fs.readdirSync(temporary).filter((name) => name.startsWith('an-land-'))
      ).to.deep.equal(['an-land-inputs-foreign']);
      expect(fs.existsSync(progress)).to.equal(false);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
      expect(fs.readFileSync(path.join(foreign, 'sentinel'), 'utf8')).to.equal(
        'foreign'
      );
      expect(() => process.kill(observedPid, 0)).to.throw();
    } finally {
      for (const pid of [child.pid, ghPid])
        if (pid !== undefined) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* owned group already exited */
          }
        }
    }
  });
});
