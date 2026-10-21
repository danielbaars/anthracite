import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// This callback groups independent CLI scenarios, rather than one operation.
// eslint-disable-next-line max-lines-per-function
describe('submit branch scope through the built CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  it('submits the explicit target and its ancestors while preserving an updated current sibling', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.succeed('submit');
    fixture.branch('current', 'parent');
    fixture.succeed('submit');
    const currentRemote = fixture.remoteSha('current');
    const currentPr = fixture.prs().find((pr) => pr.headRefName === 'current');
    fixture.setPrs(
      fixture.prs().map((pr) =>
        pr.headRefName === 'target'
          ? {
              ...pr,
              title: 'Approved target title',
              body: `Approved target core\n${pr.body}`,
              reviewRequests: [{ login: 'existing-reviewer' }],
            }
          : pr
      )
    );
    fixture.git('checkout', 'target');
    const targetHead = fixture.commit('target-update');
    fixture.git('checkout', 'current');
    const currentHead = fixture.commit('current-update');
    fs.appendFileSync(
      path.join(fixture.repo, 'current.txt'),
      '\nunstaged content'
    );
    fs.writeFileSync(path.join(fixture.repo, 'staged.txt'), 'staged content');
    fixture.git('add', 'staged.txt');
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.txt'),
      'untracked content'
    );
    const before = {
      status: fixture.git('status', '--porcelain'),
      index: fixture.git('write-tree'),
      diff: fixture.git('diff', '--binary'),
    };
    fixture.clearCalls();

    const output = fixture.succeed('submit', '--branch', 'target');

    expect({
      target: fixture.remoteSha('target'),
      current: fixture.remoteSha('current'),
    }).to.deep.equal({ target: targetHead, current: currentRemote });
    expect(output).to.include('target (Update)');
    expect(fixture.git('branch', '--show-current')).to.equal('current');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(currentHead);
    expect({
      status: fixture.git('status', '--porcelain'),
      index: fixture.git('write-tree'),
      diff: fixture.git('diff', '--binary'),
    }).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
    ).to.equal('untracked content');
    expect(
      fixture.prs().find((pr) => pr.headRefName === 'current')
    ).to.deep.equal(currentPr);
    const targetPr = fixture.prs().find((pr) => pr.headRefName === 'target');
    expect(targetPr).to.include({
      headRefName: 'target',
      baseRefName: 'parent',
      title: 'Approved target title',
      isDraft: true,
    });
    expect(targetPr?.body).to.include('Approved target core');
    expect(targetPr?.body.match(/#### PR Dependency Tree/g)).to.have.length(1);
    expect(targetPr?.reviewRequests).to.deep.equal([
      { login: 'existing-reviewer' },
    ]);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit'].includes(args[1]))
        .every(
          (args) =>
            args[2] !== 'current' && args[2] !== String(currentPr?.number)
        )
    ).to.equal(true);
  });

  it('expands --stack from the target instead of the checked out sibling', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.branch('target-child', 'target');
    fixture.branch('current', 'parent');
    fixture.branch('current-child', 'current');
    fixture.git('checkout', 'current');

    const preview = fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--stack',
      '--dry-run'
    );
    expect(preview)
      .to.include('parent (Create)')
      .and.include('target (Create)')
      .and.include('target-child (Create)');
    expect(preview)
      .not.to.include('current (Create)')
      .and.not.to.include('current-child (Create)');
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.remoteSha('target-child')).to.equal('');
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);

    const submitted = fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--stack'
    );
    expect(submitted)
      .to.include('parent (Create)')
      .and.include('target (Create)')
      .and.include('target-child (Create)');
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.baseRefName])
    ).to.deep.equal([
      ['parent', 'main'],
      ['target', 'parent'],
      ['target-child', 'target'],
    ]);
    for (const name of ['parent', 'target', 'target-child']) {
      expect(fixture.remoteSha(name)).to.equal(fixture.git('rev-parse', name));
    }
    expect(fixture.remoteSha('current')).to.equal('');
    expect(fixture.remoteSha('current-child')).to.equal('');
    expect(fixture.git('branch', '--show-current')).to.equal('current');
  });

  it('rejects unknown and untracked explicit targets before PR or remote changes', () => {
    fixture.branch('current', 'main');
    fixture.git('branch', 'untracked', 'current');
    const before = fixture.git('ls-remote', '--heads', 'origin');
    for (const target of ['missing-target', 'untracked']) {
      fixture.clearCalls();
      const result = fixture.cli('submit', '--branch', target);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(target);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(before);
      expect(fixture.prs()).to.deep.equal([]);
      expect(
        fixture
          .calls()
          .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
      ).to.deep.equal([]);
      expect(fixture.git('branch', '--show-current')).to.equal('current');
    }
  });

  it('uses current branch by default and is a no-op after checking out an already submitted target', () => {
    fixture.branch('target', 'main');
    fixture.branch('target-child', 'target');
    fixture.branch('current', 'main');
    fixture.succeed('submit');
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal([
      'current',
    ]);
    expect(fixture.remoteSha('target')).to.equal('');

    fixture.succeed('submit', '--branch', 'target');
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal([
      'current',
      'target',
    ]);
    expect(fixture.remoteSha('target-child')).to.equal('');
    const prs = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.git('checkout', 'target');
    fixture.clearCalls();

    expect(fixture.succeed('submit')).to.include('All PRs up to date');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
    expect(fixture.succeed('down')).to.include('main');
    expect(fixture.git('branch', '--show-current')).to.equal('main');
  });

  it('preserves force-with-lease protection for the selected target and requires explicit force to overwrite', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    const originalPrs = fixture.prs();
    const localHead = fixture.commit('local-target-update');
    fixture.branch('current', 'main');
    const collaborator = path.join(fixture.root, 'collaborator');
    fixture.git('clone', '--branch', 'target', fixture.remote, collaborator);
    fixture.git('-C', collaborator, 'config', 'user.name', 'Collaborator');
    fixture.git(
      '-C',
      collaborator,
      'config',
      'user.email',
      'collaborator@example.test'
    );
    fs.writeFileSync(
      path.join(collaborator, 'external.txt'),
      'external change'
    );
    fixture.git('-C', collaborator, 'add', 'external.txt');
    fixture.git('-C', collaborator, 'commit', '-m', 'external update');
    fixture.git('-C', collaborator, 'push', 'origin', 'target');
    const externalHead = fixture.remoteSha('target');
    fixture.clearCalls();

    const rejected = fixture.cli('submit', '--branch', 'target');
    expect(rejected.status).not.to.equal(0);
    expect(rejected.stdout + rejected.stderr).to.include('external changes');
    expect(fixture.remoteSha('target')).to.equal(externalHead);
    expect(fixture.prs()).to.deep.equal(originalPrs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
    expect(fixture.git('branch', '--show-current')).to.equal('current');

    fixture.succeed('submit', '--branch', 'target', '--force');
    expect(fixture.remoteSha('target')).to.equal(localHead);
    expect(fixture.remoteSha('current')).to.equal('');
    expect(fixture.prs()).to.deep.equal(originalPrs);
  });

  it('previews the selected update scope without pushing or changing PR fields', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.succeed('submit');
    fixture.commit('target-update');
    fixture.branch('current', 'main');
    fixture.succeed('submit');
    fixture.commit('current-update');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const prs = fixture.prs();
    fixture.clearCalls();

    const preview = fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--dry-run'
    );
    expect(preview).to.include('parent (No-op)').and.include('target (Update)');
    expect(preview).not.to.include('current (Update)');
    fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--dry-run',
      '--publish',
      '--reviewers',
      'preview-reviewer'
    );
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.prs()).to.deep.equal(prs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
    expect(fixture.git('branch', '--show-current')).to.equal('current');
  });
});
