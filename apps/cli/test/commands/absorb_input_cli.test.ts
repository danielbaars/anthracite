import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('absorb input compatibility through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
  });
  afterEach(() => fixture.cleanup());
  function stage(file: string, text: string): void {
    fs.writeFileSync(path.join(fixture.repo, file), text);
    fixture.git(['add', '--', file]);
  }
  function submodule(): string {
    const seed = path.join(fixture.root, 'module-source');
    fs.mkdirSync(seed);
    fixture.git(['init'], seed);
    fixture.git(['config', 'user.name', 'Module author'], seed);
    fixture.git(['config', 'user.email', 'module@example.test'], seed);
    fs.writeFileSync(path.join(seed, 'tracked'), 'nested original\n');
    fixture.git(['add', '.'], seed);
    fixture.git(['commit', '-m', 'Independent module'], seed);
    const oid = fixture.git(['rev-parse', 'HEAD'], seed);
    fixture.git(['switch', 'main']);
    fixture.git([
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      seed,
      'nested',
    ]);
    fixture.git(['commit', '-m', 'Stable module anchor']);
    fixture.git(['switch', 'base']);
    fixture.ok(['restack']);
    fixture.git(['switch', 'tip']);
    expect(
      spawnSync('git', ['cat-file', '-e', oid], {
        cwd: fixture.repo,
        env: fixture.env,
      }).status
    ).not.to.equal(0);
    return oid;
  }
  it('preserves an unchanged initialized gitlink and dirty nested bytes, HEAD and raw index', () => {
    const oid = submodule();
    fixture.git(['config', 'submodule.recurse', 'true']);
    const nested = path.join(fixture.repo, 'nested');
    fs.writeFileSync(path.join(nested, 'tracked'), 'dirty nested tracked\n');
    fs.writeFileSync(
      path.join(nested, 'untracked'),
      Buffer.from([255, 0, 128, 10])
    );
    const index = path.resolve(
      nested,
      fixture.git(['rev-parse', '--git-path', 'index'], nested)
    );
    const head = fixture.git(['rev-parse', 'HEAD'], nested);
    const bytes = fs.readFileSync(index);
    stage('base.txt', 'corrected base\n');
    stage('child.txt', 'corrected child\n');
    const result = fixture.run([
      'absorb',
      '--all',
      '--force',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['ls-tree', 'HEAD', 'nested'])).to.equal(
      '160000 commit ' + oid + '\tnested'
    );
    expect(fixture.git(['rev-parse', 'HEAD'], nested)).to.equal(head);
    expect(fs.readFileSync(index)).to.deep.equal(bytes);
    expect(fs.readFileSync(path.join(nested, 'tracked'), 'utf8')).to.equal(
      'dirty nested tracked\n'
    );
    expect(fs.readFileSync(path.join(nested, 'untracked'))).to.deep.equal(
      Buffer.from([255, 0, 128, 10])
    );
  });
  it('refuses non-UTF8 physical symlink targets before private staging or publication', () => {
    fixture.git(['switch', 'base']);
    const link = path.join(fixture.repo, 'link');
    fs.symlinkSync('target-Ω', link);
    fixture.git(['add', 'link']);
    fixture.git(['commit', '-m', 'Introduce ordinary symlink']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    fs.unlinkSync(link);
    const target = Buffer.from([116, 97, 114, 103, 101, 116, 45, 255]);
    fs.symlinkSync(target, link);
    stage('base.txt', 'corrected base\n');
    const before = fixture.inspectionSnapshot();
    const names = fs.readdirSync(path.join(fixture.repo, '.git'));
    for (const args of [
      ['absorb', '--all', '--dry-run'],
      ['absorb', '--all', '--force', '--no-interactive'],
      ['absorb', '--force', '--no-interactive'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('UTF-8 symlink targets');
      expect(fs.readlinkSync(link, { encoding: 'buffer' })).to.deep.equal(
        target
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readdirSync(path.join(fixture.repo, '.git'))).to.deep.equal(
        names
      );
    }
  });

  it('retains an absent unchanged gitlink without reading its commit object as a blob', () => {
    const oid = submodule();
    fixture.git(['submodule', 'deinit', '--force', 'nested']);
    fs.rmdirSync(path.join(fixture.repo, 'nested'));
    stage('base.txt', 'corrected base\n');
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['ls-tree', 'HEAD', 'nested'])).to.equal(
      '160000 commit ' + oid + '\tnested'
    );
    expect(fs.existsSync(path.join(fixture.repo, 'nested'))).to.equal(false);
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal('corrected base');
  });
  it('refuses a changed submodule checkout or staged pointer before real or private staging', () => {
    submodule();
    const nested = path.join(fixture.repo, 'nested');
    fs.writeFileSync(path.join(nested, 'tracked'), 'new module commit\n');
    fixture.git(['add', 'tracked'], nested);
    fixture.git(['commit', '-m', 'Changed nested pointer'], nested);
    stage('base.txt', 'corrected base\n');
    for (const staged of [false, true]) {
      if (staged) fixture.git(['add', 'nested']);
      const before = fixture.inspectionSnapshot();
      const names = fs.readdirSync(path.join(fixture.repo, '.git'));
      for (const args of [
        ['absorb', '--all', '--dry-run'],
        ['absorb', '--force', '--no-interactive'],
      ]) {
        const result = fixture.run(args);
        expect(result.status, result.stdout + result.stderr).to.equal(1);
        expect(result.stderr).to.match(/unchanged.*(gitlink|submodule)/);
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
        expect(fs.readdirSync(path.join(fixture.repo, '.git'))).to.deep.equal(
          names
        );
      }
    }
  });
  it('refuses a transient gitlink transition inside a replay range even when its tip has the original pointer', () => {
    const oid = submodule();
    fixture.git(['switch', 'base']);
    fixture.git([
      'update-index',
      '--cacheinfo',
      '160000',
      '1111111111111111111111111111111111111111',
      'nested',
    ]);
    fixture.git(['commit', '-m', 'Temporary pointer']);
    fixture.git(['update-index', '--cacheinfo', '160000', oid, 'nested']);
    fixture.git(['commit', '-m', 'Restore pointer']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'corrected base\n');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('unchanged gitlink paths and pointers');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('preserves ordinary Unicode symlink targets while applying an unrelated correction', () => {
    fixture.git(['switch', 'base']);
    const link = path.join(fixture.repo, 'link');
    fs.symlinkSync('target-Ω', link);
    fixture.git(['add', 'link']);
    fixture.git(['commit', '-m', 'Introduce Unicode symlink']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'tip']);
    stage('base.txt', 'corrected base\n');
    fs.unlinkSync(link);
    fs.symlinkSync('unstaged-空間', link);
    const result = fixture.run(['absorb', '--force', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fs.readlinkSync(link)).to.equal('unstaged-空間');
    expect(fixture.git(['show', ':link'])).to.equal('target-Ω');
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
  });
});
