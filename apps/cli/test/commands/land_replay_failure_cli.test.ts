import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { expect } from 'chai';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing replay failure boundaries', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 90000;
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  function advanceTrunk(
    file = 'independent.txt',
    content = 'independent work\n'
  ): void {
    const clone = path.join(fixture.root, 'independent');
    fixture.git(['clone', github.remote, clone]);
    fixture.git(['switch', 'main'], clone);
    fs.writeFileSync(path.join(clone, file), content);
    fixture.git(['add', file], clone);
    fixture.git(['commit', '-m', 'Independent trunk advance'], clone);
    fixture.git(['push', 'origin', 'main'], clone);
  }

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function until(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 15000;
    while (!check()) {
      if (Date.now() > deadline)
        throw new Error('Timed out waiting for fixture transport');
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  for (const kind of ['grafts', 'shallow'])
    it(`refuses unsupported ${kind} history without a clean replay claim`, () => {
      if (kind === 'grafts')
        fixture.git(['config', 'advice.graftFileDeprecated', 'false']);
      const file = path.join(
        fixture.repo,
        '.git',
        kind === 'grafts' ? 'info/grafts' : 'shallow'
      );
      const bytes = fixture.git(['rev-parse', 'main']) + '\n';
      fs.writeFileSync(file, bytes);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['land', 'tip', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout + result.stderr)
        .to.include('shallow or grafted history')
        .and.not.to.include('READY');
      expect(fs.readFileSync(file, 'utf8')).to.equal(bytes);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    });

  it('refuses active clean filters before inspecting dirty work without executing project commands', () => {
    const attributes = path.join(fixture.repo, '.git', 'info', 'attributes');
    fs.writeFileSync(attributes, '*.txt filter=probe\n');
    const marker = path.join(fixture.root, 'active-filter-ran');
    const filter = path.join(fixture.root, 'active-filter');
    fs.writeFileSync(
      filter,
      `#!${
        process.execPath
      }\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(
        marker
      )},'filter');process.stdout.write(fs.readFileSync(0));\n`,
      { mode: 0o755 }
    );
    fixture.git(['config', 'filter.probe.clean', filter]);
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'local unpublished dirty work\n'
    );
    const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
    const config = fs.readFileSync(path.join(fixture.repo, '.git', 'config'));
    const refs = fixture.git(['for-each-ref']);
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(fs.existsSync(marker)).to.equal(false);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr).to.include(
      'active filter attributes'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
    ).to.deep.equal(index);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'config'))
    ).to.deep.equal(config);
    expect(fixture.git(['for-each-ref'])).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('local unpublished dirty work\n');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('preserves built-in text attributes and harmless replay configuration without executing unused drivers', () => {
    fs.writeFileSync(
      path.join(fixture.repo, '.gitattributes'),
      '*.txt text eol=lf merge=union\n'
    );
    fixture.git(['add', '.gitattributes']);
    fixture.git(['commit', '-m', 'Use built-in text attributes']);
    fixture.ok(['restack']);
    fixture.git([
      'push',
      '--force-with-lease',
      'origin',
      'base',
      'child',
      'tip',
    ]);
    const marker = path.join(fixture.root, 'unused-driver-ran');
    const driver = path.join(fixture.root, 'unused-driver');
    fs.writeFileSync(
      driver,
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        marker
      )},'driver');process.exitCode=83;\n`,
      { mode: 0o755 }
    );
    fixture.git(['config', 'filter.unused.clean', driver]);
    fixture.git(['config', 'merge.tool', driver]);
    fixture.git(['config', 'merge.conflictStyle', 'zdiff3']);
    fixture.git(['config', 'rebase.autoStash', 'true']);
    const globalAttributes = path.join(fixture.root, 'global-attributes');
    fs.writeFileSync(globalAttributes, '*.txt text eol=lf\n');
    fixture.git(['config', 'core.attributesFile', globalAttributes]);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'attributes'),
      '*.txt -diff\n'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      'Replay: conflict-free for captured inputs'
    );
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps clean local CRLF replays separate from server defaults across actual landing', () => {
    advanceTrunk();
    const attributes = path.join(fixture.root, 'local-crlf-attributes');
    fs.writeFileSync(attributes, '*.txt text eol=crlf\n');
    fixture.git(['config', 'core.attributesFile', attributes]);
    fixture.git(['config', 'core.autocrlf', 'true']);
    fixture.git(['config', 'core.eol', 'crlf']);
    fixture.git(['checkout-index', '--all', '--force']);
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'main:tip.txt'])).to.equal('tip');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'independent.txt'), 'utf8')
    ).to.equal('independent work\r\n');
  });

  it('does not let local union attributes authorize a conflicting server merge', () => {
    advanceTrunk('base.txt', 'independent base content\n');
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'attributes'),
      '*.txt merge=union\n'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout)
      .to.include('Replay conflict in base')
      .and.to.include('base.txt');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('refuses selected custom merge drivers without executing them or changing state', () => {
    const marker = path.join(fixture.root, 'merge-driver-ran');
    const driver = path.join(fixture.root, 'merge-driver');
    fs.writeFileSync(
      driver,
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        marker
      )},'merge');process.exitCode=84;\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'attributes'),
      '*.txt merge=project-driver\n'
    );
    fixture.git(['config', 'merge.project-driver.driver', driver]);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout)
      .to.include('custom merge attributes')
      .and.not.to.include('READY');
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('"PUT"')
      .and.not.to.include('"edit"');
  });

  it('refuses a real missing-object transport failure without retaining its stderr or source writes', () => {
    advanceTrunk();
    const temporary = path.join(fixture.root, 'temporary');
    fs.mkdirSync(temporary);
    fixture.env.TMPDIR = temporary;
    const transport = path.join(fixture.root, 'failing-transport');
    fs.writeFileSync(
      transport,
      `#!${
        process.execPath
      }\nconst fs=require('fs');const cp=require('child_process');if(fs.readdirSync(${JSON.stringify(
        temporary
      )}).some(name=>name.startsWith('an-land-read-'))){process.stderr.write('secret-transport-sentinel');process.exit(32);}const result=cp.spawnSync('git',['upload-pack',${JSON.stringify(
        github.remote
      )}],{stdio:'inherit'});process.exit(result.status??1);\n`,
      { mode: 0o755 }
    );
    fixture.git(['config', 'core.sshCommand', transport]);
    fixture.env.GIT_SSH_VARIANT = 'ssh';
    fixture.git([
      'remote',
      'set-url',
      'origin',
      'git@github.com:fixture/inspection.git',
    ]);
    fixture.git([
      'remote',
      'set-url',
      '--push',
      'origin',
      'git@github.com:fixture/inspection.git',
    ]);
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr)
      .to.include('required remote history')
      .and.not.to.include('secret-transport-sentinel')
      .and.not.to.include('READY');
    expect(
      fs.readdirSync(temporary).filter((name) => name.startsWith('an-land-'))
    ).to.deep.equal([]);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('"PUT"')
      .and.not.to.include('"edit"');
  });

  for (const underLock of [false, true])
    for (const signal of ['SIGINT', 'SIGTERM', 'timeout'] as const) {
      if (underLock && signal === 'timeout') continue;
      it(`cancels missing-object acquisition under lock ${underLock} with ${signal} without touching foreign resources`, async () => {
        advanceTrunk();
        const temporary = path.join(fixture.root, 'temporary');
        fs.mkdirSync(temporary);
        const foreign = path.join(temporary, 'an-land-read-foreign');
        fs.mkdirSync(foreign);
        fs.writeFileSync(path.join(foreign, 'sentinel'), 'foreign');
        fixture.env.TMPDIR = temporary;
        const transport = path.join(fixture.root, 'ssh-transport');
        const counter = path.join(fixture.root, 'transport-count');
        const blocked = path.join(fixture.root, 'blocked-transport');
        fs.writeFileSync(
          transport,
          `#!${
            process.execPath
          }\nconst fs=require('fs');const cp=require('child_process');const counter=${JSON.stringify(
            counter
          )};const count=(fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0)+1;fs.writeFileSync(counter,String(count));if(fs.readdirSync(${JSON.stringify(
            temporary
          )}).some(name=>name.startsWith('an-land-read-')&&name!=='an-land-read-foreign')&&(!${JSON.stringify(
            underLock
          )}||fs.existsSync(${JSON.stringify(
            path.join(fixture.repo, '.git', '.graphite_cache_lock')
          )}))){fs.writeFileSync(${JSON.stringify(
            blocked
          )},String(process.pid));setInterval(()=>{},1000);}else{const p=cp.spawnSync('git',['upload-pack',${JSON.stringify(
            github.remote
          )}],{stdio:'inherit'});process.exit(p.status??1);}\n`,
          { mode: 0o755 }
        );
        fixture.git(['config', 'core.sshCommand', transport]);
        fixture.env.GIT_SSH_VARIANT = 'ssh';
        fixture.git([
          'remote',
          'set-url',
          'origin',
          'git@github.com:fixture/inspection.git',
        ]);
        fixture.git([
          'remote',
          'set-url',
          '--push',
          'origin',
          'git@github.com:fixture/inspection.git',
        ]);
        const before = fixture.inspectionSnapshot();
        const remote = fixture.git(['for-each-ref'], github.remote);
        const foreignProcess = spawn(
          process.execPath,
          ['-e', 'setInterval(()=>{},1000)'],
          { detached: true, stdio: 'ignore' }
        );
        let child: ChildProcess | undefined;
        try {
          const [executable, ...args] = getTestCliCommand([
            'land',
            'tip',
            underLock ? '--yes' : '--dry-run',
          ]);
          child = spawn(executable, args, {
            cwd: fixture.repo,
            env: fixture.env,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let output = '';
          child.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
          });
          child.stderr?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
          });
          const ended = new Promise<number | null>((resolve) =>
            child?.once('exit', (code) => resolve(code))
          );
          await until(() => fs.existsSync(blocked));
          const transportPid = Number(fs.readFileSync(blocked, 'utf8'));
          if (signal !== 'timeout') child.kill(signal);
          await ended;
          if (!underLock) expect(output).not.to.include('READY');
          expect(output).not.to.include('Confirmed merged');
          expect(fixture.inspectionSnapshot()).to.deep.equal(before);
          expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
          expect(
            fs
              .readdirSync(temporary)
              .filter((name) => name.startsWith('an-land-'))
          ).to.deep.equal(['an-land-read-foreign']);
          await until(() => !alive(transportPid));
          expect(alive(transportPid)).to.equal(false);
          expect(
            foreignProcess.pid !== undefined && alive(foreignProcess.pid)
          ).to.equal(true);
          expect(
            fs.readFileSync(path.join(foreign, 'sentinel'), 'utf8')
          ).to.equal('foreign');
          expect(fs.readFileSync(github.calls, 'utf8'))
            .not.to.include('"PUT"')
            .and.not.to.include('"edit"');
        } finally {
          for (const ownedChild of [child, foreignProcess]) {
            if (ownedChild?.pid !== undefined) {
              try {
                process.kill(-ownedChild.pid, 'SIGKILL');
              } catch {
                /* owned group already exited */
              }
            }
          }
        }
      });
    }
});
