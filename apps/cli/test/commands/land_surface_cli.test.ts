import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('review and landing public surface', function () {
  this.timeout(120000);
  it('documents full landing and local-only continue, completes literal branches, preserves quiet cwd preview and raw merge semantics', () => {
    const fixture = new RelationCliFixture();
    try {
      const github = prepareLand(fixture);
      expect(fixture.ok(['land', '--help'])).to.include(
        'selected GitHub PR chain'
      );
      expect(fixture.ok(['continue', '--help'])).to.include('local-only');
      expect(fixture.ok(['review', '--help']))
        .to.include('--head')
        .and.include('--comment');
      const completion = fixture.run([
        '--get-yargs-completions',
        'an',
        'land',
        '',
      ]);
      expect(completion.status, completion.stderr).to.equal(0);
      expect(completion.stdout.split('\n'))
        .to.include('base')
        .and.include('tip');
      const before = fixture.inspectionSnapshot();
      const remote = fixture.git(['for-each-ref'], github.remote);
      const subdirectory = path.join(fixture.repo, 'subdirectory');
      fs.mkdirSync(subdirectory);
      const preview = fixture.run(
        ['--cwd', fixture.repo, 'land', 'base', '--quiet', '--dry-run'],
        subdirectory
      );
      expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
      expect(preview.stdout)
        .to.include('Merge 1: base')
        .and.include('Maintain: child');
      expect(fixture.run(['land', 'base', '--force']).status).to.equal(1);
      fs.rmdirSync(subdirectory);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      const calls = fs.readFileSync(github.calls, 'utf8');
      const merged = fixture.run(['merge', 'other', '--no-edit']);
      expect(merged.status, merged.stdout + merged.stderr).to.equal(0);
      expect(
        fixture.git(['rev-list', '--parents', '-1', 'HEAD']).split(' ')
      ).to.have.length(3);
      expect(fixture.git(['show', 'HEAD:other.txt'])).to.equal('other');
      expect(fixture.git(['show', 'HEAD:base.txt'])).to.equal('base');
      expect(fs.readFileSync(github.calls, 'utf8')).to.equal(calls);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    } finally {
      fixture.cleanup();
    }
  });
});
