import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// This callback groups independent CLI scenarios, rather than one operation.
// eslint-disable-next-line max-lines-per-function
describe('draft existing PRs through the built CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('drafts unchanged ready PRs only in the selected scope and preserves their fields', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.succeed('submit', '--publish');
    fixture.branch('sibling', 'main');
    fixture.succeed('submit', '--publish');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        title: `Approved ${pr.headRefName} title`,
        body: `Approved description core\n${pr.body}`,
        reviewRequests: [{ login: 'existing-reviewer' }],
      }))
    );
    const before = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');

    const output = fixture.succeed('submit', '--branch', 'target', '--draft');

    expect(output).to.include('Mark as draft');
    expect(fixture.prs()).to.deep.equal(
      before.map((pr) => ({ ...pr, isDraft: pr.headRefName !== 'sibling' }))
    );
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.git('branch', '--show-current')).to.equal('sibling');
    expect(
      fixture.succeed('submit', '--branch', 'target', '--draft')
    ).to.include('All PRs up to date');
  });

  it('reports the confirmed draft and code already pushed when the next transition is refused', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.succeed('submit', '--publish');
    const head = fixture.commit('target-update');
    fixture.env.ANTHRACITE_TEST_GH_STATUS_HEAD = 'target';
    fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE = 'reject';

    const result = fixture.cli('submit', '--draft');

    expect(result.status).not.to.equal(0);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.isDraft])
    ).to.deep.equal([
      ['parent', true],
      ['target', false],
    ]);
    expect(fixture.remoteSha('target')).to.equal(head);
    expect(result.stdout).to.match(/parent: .*; draft/);
    expect(result.stdout + result.stderr)
      .to.include('GitHub refused draft transition')
      .and.include('Code for target was already pushed');
    expect(result.stdout).not.to.match(/^target: https.*; draft/m);
    delete fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE;
    expect(fixture.succeed('submit', '--draft')).to.include('target');
    expect(fixture.prs().every((pr) => pr.isDraft)).to.equal(true);
  });

  for (const mode of ['unchanged', 'read-invalid', 'read-missing']) {
    it(`fails honestly when the requested draft cannot be confirmed (${mode})`, () => {
      fixture.branch('target', 'main');
      fixture.succeed('submit', '--publish');
      fixture.clearCalls();
      fixture.env.ANTHRACITE_TEST_GH_STATUS_HEAD = 'target';
      fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE = mode;

      const result = fixture.cli('submit', '--draft');

      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        mode === 'unchanged' ? 'did not confirm' : 'Could not confirm status'
      );
      expect(result.stdout).not.to.match(/^target: https.*; draft/m);
      expect(
        fixture.calls().filter((args) => args[1] === 'create')
      ).to.deep.equal([]);
      expect(fixture.prs()).to.have.length(1);
      delete fixture.env.ANTHRACITE_TEST_GH_STATUS_MODE;
      if (mode === 'unchanged') {
        expect(fixture.prs()[0]?.isDraft).to.equal(false);
        expect(fixture.succeed('submit', '--draft')).to.include(
          'target (Mark as draft)'
        );
      } else {
        expect(fixture.prs()[0]?.isDraft).to.equal(true);
        expect(fixture.succeed('submit', '--draft')).to.include(
          'All PRs up to date'
        );
      }
    });
  }

  it('previews a draft transition and rejects conflicting status flags without mutations', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--publish');
    const prs = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();

    expect(fixture.succeed('submit', '--draft', '--dry-run'))
      .to.include('Mark as draft')
      .and.include('Dry run complete');
    fixture.commit('target-update');
    const conflict = fixture.cli('submit', '--draft', '--publish');

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
