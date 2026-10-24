import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('whole linear stack reorder through the real public editor', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  it('offers the whole chain from its middle, preserves own ranges and returns to departure', () => {
    fixture.git(['switch', 'child']);
    const main = fixture.git(['rev-parse', 'main']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.editor('base\ntip\nchild\n');
    fixture.edit();
    expect(
      fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 3)
    ).to.deep.equal(['tip', 'child', 'base']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.parent('child')).to.equal('main');
    expect(fixture.parent('tip')).to.equal('child');
    expect(fixture.parent('base')).to.equal('tip');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
    ).to.equal('child\ntip\nbase');
    expect(fixture.git(['ls-tree', '-r', '--name-only', 'base'])).to.equal(
      'base.txt\nchild.txt\nmain.txt\ntip.txt'
    );
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });
  it('refuses a selected stale own boundary without silently repairing it', () => {
    fixture.git(['switch', 'base']);
    fixture.commit('base-second');
    fixture.git(['rebase', 'base', 'child']);
    fixture.git(['rebase', 'child', 'tip']);
    fixture.git(['switch', 'base']);
    const before = fixture.snapshot();
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('needs restack');
    expect(fs.existsSync(fixture.offered)).to.equal(false);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('refuses an uninitialized repository without automatic initialization or normalization', () => {
    const config = path.join(fixture.repo, '.git', '.graphite_repo_config');
    fs.unlinkSync(config);
    const before = fixture.snapshot();
    const result = fixture.run([
      'reorder',
      '--stack',
      '--no-interactive',
      '--input',
      fixture.input('tip\nchild\nbase\n'),
    ]);
    expect(result.status).not.to.equal(0);
    expect(fs.existsSync(config)).to.equal(false);
    expect(fixture.snapshot()).to.deep.equal(before);
  });
  it('publishes the complete new public parent graph before the first real replay', () => {
    const marker = path.join(fixture.root, 'first-replay');
    const hooks = path.join(fixture.root, 'hooks');
    fs.mkdirSync(hooks);
    const log = getTestCliCommand(['log', 'short', '--no-interactive']);
    fs.writeFileSync(
      path.join(hooks, 'pre-rebase'),
      `#!${
        process.execPath
      }\nconst fs=require('fs'); const {execFileSync}=require('child_process'); if (!fs.existsSync(${JSON.stringify(
        marker
      )})) fs.writeFileSync(${JSON.stringify(
        marker
      )},JSON.stringify({log:execFileSync(${JSON.stringify(
        log[0]
      )},${JSON.stringify(
        log.slice(1)
      )},{encoding:'utf8'}),refs:execFileSync('git',['for-each-ref','--format=%(refname) %(objectname)','refs/heads'],{encoding:'utf8'}).trim()}));`,
      { mode: 0o755 }
    );
    fixture.git(['config', 'core.hooksPath', hooks]);
    const refs = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
    ]);
    fixture.editor('base\ntip\nchild\n');
    fixture.edit();
    const first: unknown = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    if (
      !isRecord(first) ||
      typeof first.log !== 'string' ||
      typeof first.refs !== 'string'
    )
      throw new Error('Invalid public hook observation');
    expect(first.refs).to.equal(refs);
    expect(first.log.indexOf('base')).to.be.lessThan(first.log.indexOf('tip'));
    expect(first.log.indexOf('tip')).to.be.lessThan(first.log.indexOf('child'));
  });
  it('does not publish refs or invoke replay hooks for unchanged editor input', () => {
    const marker = path.join(fixture.root, 'hook-ran');
    const hooks = path.join(fixture.root, 'hooks');
    fs.mkdirSync(hooks);
    const script = `#!${
      process.execPath
    }\nrequire('fs').appendFileSync(${JSON.stringify(marker)}, 'called\\n');`;
    for (const hook of ['pre-rebase', 'reference-transaction'])
      fs.writeFileSync(path.join(hooks, hook), script, { mode: 0o755 });
    fixture.git(['config', 'core.hooksPath', hooks]);
    const before = fixture.snapshot();
    fixture.edit();
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.existsSync(marker)).to.equal(false);
  });
});
