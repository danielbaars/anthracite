import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing plan presentation', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('puts dirty-worktree blockers and the next action before the planned merge scope', () => {
    fs.writeFileSync(
      path.join(fixture.repo, 'local-notes.txt'),
      'Keep this work.\n'
    );
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'child',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.match(/^Cannot land yet:/);
    expect(result.stdout).to.include('git status --short');
    expect(result.stdout)
      .to.include('Merge 1: base #17')
      .and.include('Merge 2: child #18');
    expect(result.stdout).not.to.include(fixture.git(['rev-parse', 'base']));
    expect(result.stdout).not.to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });

  it('shows the complete ordered PR scope without commit-level diagnostics by default', () => {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'tip',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Target: tip -> main');
    expect(result.stdout)
      .to.include('Merge 1: base #17')
      .and.include('Merge 2: child #18')
      .and.include('Merge 3: tip #19');
    expect(result.stdout.indexOf('Merge 1:')).to.be.lessThan(
      result.stdout.indexOf('Merge 2:')
    );
    expect(result.stdout.indexOf('Merge 2:')).to.be.lessThan(
      result.stdout.indexOf('Merge 3:')
    );
    expect(result.stdout).to.include(
      'Between merges: restack and push affected published branches'
    );
    expect(result.stdout)
      .to.include('Cleanup: base, child, tip')
      .and.include('locally and on GitHub')
      .and.include('Readiness: READY');
    expect(result.stdout)
      .not.to.include('replay base')
      .and.not.to.include('Head:');
    for (const branch of ['main', 'base', 'child', 'tip'])
      expect(result.stdout).not.to.include(fixture.git(['rev-parse', branch]));
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });

  it('retains exact heads and replay boundaries through the existing debug option', () => {
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'child',
      '--dry-run',
      '--debug',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Merge 1: base #17')
      .and.include('Maintain: tip');
    expect(result.stderr)
      .to.include(`Head: ${fixture.git(['rev-parse', 'base'])}`)
      .and.include(`replay base ${fixture.git(['rev-parse', 'base'])}`)
      .and.include(`Trunk: ${fixture.git(['rev-parse', 'main'])}`);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });

  it('separates mandatory fanout updates from merges and identifies work that remains unpublished', () => {
    fixture.branch('sibling', 'base');
    fixture.branch('local-only', 'base');
    fixture.git(['push', 'origin', 'sibling']);
    fs.writeFileSync(
      github.state,
      JSON.stringify([...github.prs, github.pr('sibling', 20)])
    );
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'base',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Other branches to restack (not merge targets):')
      .and.include('Maintain: sibling -> main')
      .and.include('update PR #20 base and dependency footer')
      .and.include('Maintain: local-only -> main')
      .and.include('Keep local; no push; no PR creation');
    expect(result.stdout)
      .not.to.include('Merge 2:')
      .and.not.to.include('Maintain: other');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });
});
