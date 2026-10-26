import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// This callback groups independent CLI scenarios, rather than one operation.
// eslint-disable-next-line max-lines-per-function
describe('publish existing PRs through the built CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('publishes two unchanged drafts in the target scope and preserves their PR fields', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.succeed('submit');
    fixture.branch('sibling', 'main');
    fixture.succeed('submit');
    const before = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');

    const output = fixture.succeed('submit', '--branch', 'target', '--publish');

    expect(fixture.prs()).to.deep.equal(
      before.map((pr) => ({ ...pr, isDraft: pr.headRefName === 'sibling' }))
    );
    expect(output).to.include('parent').and.include('target');
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.git('branch', '--show-current')).to.equal('sibling');
    expect(
      fixture.succeed('submit', '--branch', 'target', '--publish')
    ).to.include('All PRs up to date');
  });

  it('reports confirmed partial publication and code already pushed when GitHub refuses the next PR', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.succeed('submit');
    const targetHead = fixture.commit('target-update');
    fixture.env.ANTHRACITE_TEST_GH_STATUS_HEAD = 'target';
    fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE = 'reject';

    const result = fixture.cli('submit', '--publish');

    expect(result.status).not.to.equal(0);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.isDraft])
    ).to.deep.equal([
      ['parent', false],
      ['target', true],
    ]);
    expect(fixture.remoteSha('target')).to.equal(targetHead);
    expect(result.stdout).to.match(/parent: .*ready for review/);
    expect(result.stdout + result.stderr)
      .to.include('GitHub refused ready transition')
      .and.include('Code for target was already pushed');
    expect(result.stdout).not.to.match(/^target: https.*ready for review/m);
    delete fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE;
    expect(fixture.succeed('submit', '--publish')).to.include('target');
    expect(fixture.prs().every((pr) => !pr.isDraft)).to.equal(true);
  });

  it('keeps a ready PR ready when publishing a code update', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--publish');
    const original = fixture.prs();
    const head = fixture.commit('updated-code');

    fixture.succeed('submit', '--publish');

    expect(fixture.prs()).to.deep.equal(original);
    expect(fixture.remoteSha('target')).to.equal(head);
  });

  it('does not recreate a PR or claim success when the final status lookup fails', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    fixture.clearCalls();
    fixture.env.ANTHRACITE_TEST_GH_STATUS_HEAD = 'target';
    fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE = 'read-missing';

    const result = fixture.cli('submit', '--publish');

    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Could not confirm status'
    );
    expect(result.stdout).not.to.match(/^target: https.*ready for review/m);
    expect(
      fixture.calls().filter((args) => args[1] === 'create')
    ).to.deep.equal([]);
    expect(fixture.prs()).to.have.length(1);
    delete fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE;
    expect(fixture.succeed('submit', '--publish')).to.include(
      'All PRs up to date'
    );
  });

  for (const mode of ['unchanged', 'read-invalid']) {
    it(`rejects an unconfirmed publication (${mode}) and remains honest in a following command`, () => {
      fixture.branch('target', 'main');
      fixture.succeed('submit');
      fixture.env.ANTHRACITE_TEST_GH_STATUS_HEAD = 'target';
      fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE = mode;

      const result = fixture.cli('submit', '--publish');

      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        mode === 'unchanged' ? 'did not confirm' : 'Could not confirm status'
      );
      expect(result.stdout).not.to.match(/^target: https.*ready for review/m);
      delete fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE;
      if (mode === 'unchanged') {
        expect(fixture.prs()[0]?.isDraft).to.equal(true);
        expect(fixture.succeed('submit', '--publish')).to.include(
          'target (Ready for review)'
        );
      } else {
        expect(fixture.prs()[0]?.isDraft).to.equal(false);
        expect(fixture.succeed('submit', '--publish')).to.include(
          'All PRs up to date'
        );
      }
    });
  }

  it('preserves existing ready and draft status and content on code updates without a status flag', () => {
    fixture.branch('ready', 'main');
    fixture.succeed('submit', '--publish');
    fixture.branch('draft', 'main');
    fixture.succeed('submit', '--draft');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        title: `Approved ${pr.headRefName} title`,
        body: `Approved description core\n${pr.body}`,
        reviewRequests: [{ login: 'existing-reviewer' }],
      }))
    );
    const before = fixture.prs();

    for (const name of ['ready', 'draft']) {
      fixture.git('checkout', name);
      const head = fixture.commit(`${name}-update`);
      fixture.succeed('submit');
      expect(fixture.remoteSha(name)).to.equal(head);
    }

    expect(fixture.prs()).to.deep.equal(before);
  });

  it('previews publication without mutations and rejects conflicting status flags before pushing', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    fixture.commit('target-update');
    const prs = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();

    expect(fixture.succeed('submit', '--publish', '--dry-run'))
      .to.include('Dry run complete')
      .and.include('Publish as ready for review');
    const conflict = fixture.cli('submit', '--publish', '--draft');

    expect(conflict.status).not.to.equal(0);
    expect(conflict.stdout + conflict.stderr).to.include(
      "Can't use both --publish and --draft"
    );
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
  });
});
