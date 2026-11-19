import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing effective replay configuration', function () {
  this.timeout(180000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 150000;
    github = prepareLand(fixture);
    const global = path.join(fixture.root, 'isolated.gitconfig');
    fs.writeFileSync(global, '');
    fixture.env.GIT_CONFIG_GLOBAL = global;
  });
  afterEach(() => fixture?.cleanup());

  it('uses local false overrides during replay despite global true and an old resolution cache', () => {
    for (const key of ['rerere.enabled', 'rebase.updateRefs']) {
      fixture.git(['config', '--global', key, 'true']);
      fixture.git(['config', '--local', key, 'false']);
    }
    const cache = path.join(fixture.repo, '.git', 'rr-cache');
    fs.mkdirSync(cache);
    fs.writeFileSync(
      path.join(cache, 'retained-evidence'),
      'old resolutions\n'
    );
    fixture.git(['branch', 'untracked-prototype', 'main']);
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.include('conflict-free for captured inputs');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(
      fs.readFileSync(path.join(cache, 'retained-evidence'), 'utf8')
    ).to.equal('old resolutions\n');
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
  it('lands a leaf without applying local replay settings to the server-only rebase', () => {
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
    fixture.git(['switch', 'leaf']);
    fixture.git(['config', '--global', 'rerere.enabled', 'true']);
    fixture.git(['config', '--global', 'rebase.updateRefs', 'true']);
    fixture.git(['branch', 'untracked-prototype', 'leaf']);
    const prototype = fixture.git(['rev-parse', 'untracked-prototype']);
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'leaf', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.include('conflict-free for captured inputs');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const result = fixture.run(['land', 'leaf', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Confirmed merged #31');
    expect(fixture.git(['rev-parse', 'untracked-prototype'])).to.equal(
      prototype
    );
    expect(
      fixture.git(['config', '--type=bool', '--get', 'rerere.enabled'])
    ).to.equal('true');
    expect(fixture.git(['show', 'main:leaf.txt'])).to.equal('leaf');
  });

  for (const key of ['rebase.updateRefs', 'rerere.enabled'])
    it(`refuses effective global ${key} only when local replay is needed and identifies its source`, () => {
      fixture.git(['config', '--global', key, 'yes']);
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      for (const option of ['--dry-run', '--yes']) {
        const result = fixture.run(['land', 'tip', option]);
        expect(result.status, result.stdout + result.stderr).to.equal(1);
        expect(result.stdout + result.stderr)
          .to.include(`${key.toLowerCase()}=true`)
          .and.to.include('global, file:')
          .and.to.include('isolated.gitconfig')
          .and.to.include('then preview again');
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
        expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
        expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
      }
    });

  it('reports a local true override instead of accepting a lower-priority global false', () => {
    fixture.git(['config', '--global', 'rerere.enabled', 'false']);
    fixture.git(['config', '--local', 'rerere.enabled', 'on']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr)
      .to.include('rerere.enabled=true')
      .and.to.include('local, file:.git/config');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('honors command-scope false overrides and ignores inactive rerere autoupdate', () => {
    fixture.git(['config', 'rerere.enabled', 'true']);
    fixture.git(['config', 'rebase.updateRefs', 'true']);
    fixture.git(['config', 'rerere.autoupdate', 'true']);
    fixture.env.GIT_CONFIG_COUNT = '2';
    fixture.env.GIT_CONFIG_KEY_0 = 'rerere.enabled';
    fixture.env.GIT_CONFIG_VALUE_0 = 'NO';
    fixture.env.GIT_CONFIG_KEY_1 = 'rebase.updateRefs';
    fixture.env.GIT_CONFIG_VALUE_1 = '0';
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('conflict-free for captured inputs');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('honors worktree configuration above local configuration', () => {
    fixture.git(['config', 'extensions.worktreeConfig', 'true']);
    for (const key of ['rerere.enabled', 'rebase.updateRefs']) {
      fixture.git(['config', '--local', key, 'true']);
      fixture.git(['config', '--worktree', key, 'off']);
    }
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('identifies implicit recorded-resolution use without changing the old cache', () => {
    const cache = path.join(fixture.repo, '.git', 'rr-cache');
    fs.mkdirSync(cache);
    fs.writeFileSync(
      path.join(cache, 'retained-evidence'),
      'old resolutions\n'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr)
      .to.include('implicit rerere.enabled=true')
      .and.to.include(cache)
      .and.not.to.include('READY');
    expect(
      fs.readFileSync(path.join(cache, 'retained-evidence'), 'utf8')
    ).to.equal('old resolutions\n');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  it('lands a stack with effective disabled controls without modifying unrelated refs or configuration', () => {
    for (const key of ['rerere.enabled', 'rebase.updateRefs']) {
      fixture.git(['config', '--global', key, 'true']);
      fixture.git(['config', '--local', key, 'false']);
    }
    fixture.git(['branch', 'untracked-prototype', 'tip']);
    const prototype = fixture.git(['rev-parse', 'untracked-prototype']);
    const config = fs.readFileSync(path.join(fixture.repo, '.git', 'config'));
    const global = fs.readFileSync(fixture.env.GIT_CONFIG_GLOBAL ?? '');
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    for (const number of [17, 18, 19])
      expect(result.stdout).to.include(`Confirmed merged #${number}`);
    expect(fixture.git(['show', 'main:tip.txt'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'untracked-prototype'])).to.equal(
      prototype
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'config'))
    ).to.deep.equal(config);
    expect(fs.readFileSync(fixture.env.GIT_CONFIG_GLOBAL ?? '')).to.deep.equal(
      global
    );
  });
  it('refuses a newly enabled implicit resolution cache after inspection before any merge request', () => {
    const cache = path.join(fixture.repo, '.git', 'rr-cache');
    const record = path.join(fixture.repo, '.git', '.anthracite_landing');
    const script = path.join(github.bin, 'gh');
    const original = fs.readFileSync(script, 'utf8');
    const newline = original.indexOf('\n') + 1;
    fs.writeFileSync(
      script,
      original.slice(0, newline) +
        `
      {
        const fs = require('fs');
        const record = ${JSON.stringify(record)};
        if (fs.existsSync(record) && JSON.parse(fs.readFileSync(record, 'utf8')).phase === 'merge-requested' && process.argv.includes('repos/fixture/inspection/pulls/17')) {
          fs.mkdirSync(${JSON.stringify(cache)}, {recursive:true});
        }
      }
    ` +
        original.slice(newline)
    );
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(fs.existsSync(cache)).to.equal(true);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr).to.include('Replay inputs changed');
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    expect(fs.existsSync(record)).to.equal(false);
  });
  it('retains included-file origins and accepts a later repository override', () => {
    const included = path.join(fixture.root, 'included settings.conf');
    fs.writeFileSync(included, '[rerere]\n enabled=true\n');
    fixture.git(['config', '--global', 'include.path', included]);
    const refused = fixture.run(['land', 'tip', '--dry-run']);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
    expect(refused.stdout + refused.stderr)
      .to.include('rerere.enabled=true')
      .and.to.include(`global, file:${included}`);
    fixture.git(['config', 'rerere.enabled', 'false']);
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses invalid effective boolean values without echoing their contents', () => {
    fixture.git(['config', 'rerere.enabled', 'invalid-private-value']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr)
      .to.include('rerere.enabled=invalid boolean')
      .and.to.include('local, file:.git/config')
      .and.not.to.include('invalid-private-value');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
});
