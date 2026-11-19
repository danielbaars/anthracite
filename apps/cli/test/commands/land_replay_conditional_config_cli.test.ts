import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('public landing checkout-dependent configuration', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    fixture.commandTimeoutMs = 90000;
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('refuses an active branch-conditional union policy before preview or first merge', () => {
    const union = path.join(fixture.root, 'union.conf');
    fs.writeFileSync(union, '[merge]\n default=union\n');
    fixture.git(['config', 'includeIf.onbranch:tip.path', union]);
    fixture.git(['switch', 'tip']);
    const independent = path.join(fixture.root, 'independent');
    fixture.git(['clone', github.remote, independent]);
    fixture.git(['switch', 'main'], independent);
    fs.writeFileSync(
      path.join(independent, 'child.txt'),
      'independent change\n'
    );
    fixture.git(['add', 'child.txt'], independent);
    fixture.git(['commit', '-m', 'Independent trunk change'], independent);
    fixture.git(['push', 'origin', 'main'], independent);
    const before = fixture.inspectionSnapshot();
    const objects = fixture.git(['count-objects', '-v']);
    const remote = fixture.git(['for-each-ref'], github.remote);
    for (const option of ['--dry-run', '--yes']) {
      const result = fixture.run(['land', 'tip', option]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout + result.stderr)
        .to.include('checkout-dependent includeIf.onbranch')
        .and.not.to.include('READY')
        .and.not.to.include('Confirmed merged');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['count-objects', '-v'])).to.equal(objects);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fs.readFileSync(github.calls, 'utf8'))
        .not.to.include('"PUT"')
        .and.not.to.include('"edit"');
    }
  });
  it('refuses currently inactive branch includes without executing future project commands', () => {
    fixture.git(['switch', 'tip']);
    const marker = path.join(fixture.root, 'conditional-command-ran');
    const command = path.join(fixture.root, 'conditional-command');
    fs.writeFileSync(command, `#!/bin/sh\nprintf ran > '${marker}'\nexit 0\n`, {
      mode: 0o755,
    });
    const included = path.join(fixture.root, 'conditional.conf');
    fs.writeFileSync(
      included,
      `[core]\n fsmonitor=${command}\n[merge]\n default=union\n`
    );
    fixture.git(['config', 'includeIf.onbranch:main.path', included]);
    const before = fixture.inspectionSnapshot();
    for (const option of ['--dry-run', '--yes']) {
      const result = fixture.run(['land', 'tip', option]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout + result.stderr).to.include(
        'checkout-dependent includeIf.onbranch'
      );
      expect(fs.existsSync(marker)).to.equal(false);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    }
  });

  it('retains stable directory-conditional built-in replay configuration', () => {
    const included = path.join(fixture.root, 'stable.conf');
    fs.writeFileSync(included, '[merge]\n renames=true\n');
    fixture.git([
      'config',
      `includeIf.gitdir:${path.join(fixture.repo, '.git')}.path`,
      included,
    ]);
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.include('conflict-free for captured inputs');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
});
