import fs from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing replay preflight', function () {
  this.timeout(240000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 180000;
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  function advanceTrunk(file: string, content: string): void {
    const clone = path.join(fixture.root, 'independent');
    fixture.git(['clone', github.remote, clone]);
    fixture.git(['switch', 'main'], clone);
    fs.writeFileSync(path.join(clone, file), content);
    fixture.git(['add', file], clone);
    fixture.git(['commit', '-m', 'Independent trunk change'], clone);
    fixture.git(['push', 'origin', 'main'], clone);
  }

  function objectSnapshot(): string {
    const objects = path.join(fixture.repo, '.git', 'objects');
    const result: string[] = [];
    const walk = (directory: string): void => {
      for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory, name);
        if (fs.statSync(file).isDirectory()) walk(file);
        else
          result.push(
            path.relative(objects, file) +
              ':' +
              createHash('sha256').update(fs.readFileSync(file)).digest('hex')
          );
      }
    };
    walk(objects);
    return result.join('\n');
  }

  it('refuses a later replay conflict before the first merge when remote trunk moved', () => {
    advanceTrunk('child.txt', 'independent trunk change\n');
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const objects = objectSnapshot();
    for (const option of ['--dry-run', '--yes']) {
      const result = fixture.run(['land', 'tip', option]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout + result.stderr)
        .to.include('Replay conflict in child')
        .and.to.include('child.txt')
        .and.to.include('before any PR is merged');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(objectSnapshot()).to.equal(objects);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fs.readFileSync(github.calls, 'utf8'))
        .not.to.include('"PUT"')
        .and.not.to.include('"edit"');
    }
  });
  it('detects an intermediate commit conflict even when the final branch diff removed that file', () => {
    fixture.git(['switch', 'tip']);
    fs.writeFileSync(
      path.join(fixture.repo, 'transient.txt'),
      'branch content\n'
    );
    fixture.git(['add', 'transient.txt']);
    fixture.git(['commit', '-m', 'Add intermediate file']);
    fixture.git(['rm', 'transient.txt']);
    fixture.git(['commit', '-m', 'Remove intermediate file']);
    fixture.git(['push', 'origin', 'tip']);
    advanceTrunk('transient.txt', 'independent content\n');
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(1);
    expect(preview.stdout)
      .to.include('Replay conflict in tip')
      .and.to.include('transient.txt');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });

  for (const advanced of [false, true])
    it(`lands a clean linear chain with advanced trunk ${advanced}`, () => {
      if (advanced) advanceTrunk('independent.txt', 'independent work\n');
      const before = fixture.inspectionSnapshot();
      const objects = objectSnapshot();
      const preview = fixture.run(['land', 'tip', '--dry-run']);
      expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
      expect(preview.stdout).to.include(
        'Replay: conflict-free for captured inputs'
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(objectSnapshot()).to.equal(objects);
      const landed = fixture.run(['land', 'tip', '--yes']);
      expect(landed.status, landed.stdout + landed.stderr).to.equal(0);
      expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
      expect(fixture.git(['show', 'main:tip.txt'])).to.equal('tip');
      if (advanced)
        expect(fixture.git(['show', 'main:independent.txt'])).to.equal(
          'independent work'
        );
    });

  it('runs no source hooks during preserving inspection', () => {
    const marker = path.join(fixture.root, 'hook-ran');
    for (const hook of ['pre-rebase', 'post-checkout', 'pre-commit'])
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks', hook),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          marker
        )},'hook');process.exitCode=81;`,
        { mode: 0o755 }
      );
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses unsupported mandatory fanout rather than ignoring a survivor', () => {
    fixture.ok(['create', 'beside', '--onto', 'base']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', 'tip', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.include('mandatory participant graph');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
  it('does not execute injected hooks while obtaining missing remote objects', () => {
    advanceTrunk('independent.txt', 'independent work\n');
    const hooks = path.join(fixture.root, 'injected-hooks');
    const marker = path.join(fixture.root, 'injected-hook-ran');
    fs.mkdirSync(hooks);
    fs.writeFileSync(
      path.join(hooks, 'reference-transaction'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
        marker
      )},'hook');`,
      { mode: 0o755 }
    );
    fixture.env.GIT_CONFIG_COUNT = '1';
    fixture.env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
    fixture.env.GIT_CONFIG_VALUE_0 = hooks;
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
