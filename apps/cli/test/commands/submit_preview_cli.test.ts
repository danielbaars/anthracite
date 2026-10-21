import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('submit action previews through the built CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('previews draft and reviewer actions alongside a selected code update without remote mutations', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--publish');
    fixture.commit('target-update');
    fixture.branch('current', 'main');
    const prs = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();

    const output = fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--draft',
      '--reviewers',
      'alice,bob',
      '--dry-run'
    );

    expect(output)
      .to.include('target (Update)')
      .and.include('Mark as draft')
      .and.include('Request review: alice,bob')
      .and.include('Dry run complete');
    expect(output).not.to.include('current (');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
    expect(fixture.git('branch', '--show-current')).to.equal('current');
  });
  it('omits a ready transition when an updated PR is already ready', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--publish');
    fixture.commit('target-update');
    const prs = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();

    const output = fixture.succeed('submit', '--publish', '--dry-run');

    expect(output).to.include('target (Update)');
    expect(output).not.to.include('Publish as ready for review');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
  });

  for (const status of ['draft', 'publish']) {
    for (const action of ['Create', 'Update', 'New parent']) {
      it(`previews ${status} and reviewers alongside ${action} only for the selected target`, () => {
        fixture.branch('target', 'main');
        if (action !== 'Create') {
          fixture.succeed(
            'submit',
            status === 'draft' ? '--publish' : '--draft'
          );
          if (action === 'Update') fixture.commit('target-update');
          else
            fixture.setPrs(
              fixture.prs().map((pr) => ({ ...pr, baseRefName: 'old-parent' }))
            );
        }
        fixture.branch('current', 'main');
        const prs = fixture.prs();
        const refs = fixture.git('ls-remote', '--heads', 'origin');
        fixture.clearCalls();

        const output = fixture.succeed(
          'submit',
          '--branch',
          'target',
          `--${status}`,
          '--reviewers',
          'alice,bob',
          '--dry-run'
        );

        expect(output)
          .to.include(`target (${action})`)
          .and.include(
            status === 'draft' ? 'Mark as draft' : 'Publish as ready for review'
          )
          .and.include('Request review: alice,bob');
        expect(output).not.to.include('current (');
        expect(fixture.prs()).to.deep.equal(prs);
        expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
        expect(
          fixture
            .calls()
            .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
        ).to.deep.equal([]);
        expect(fixture.git('branch', '--show-current')).to.equal('current');
      });
    }
  }

  it('previews an unchanged status as a no-op and skips explicit actions for new update-only branches', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--draft');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const prs = fixture.prs();
    fixture.clearCalls();

    const unchanged = fixture.succeed('submit', '--draft', '--dry-run');
    expect(unchanged).to.include('target (No-op)');
    expect(unchanged)
      .not.to.include('Mark as draft')
      .and.not.to.include('Request review');
    fixture.branch('new', 'target');
    for (const status of ['--draft', '--publish']) {
      const skipped = fixture.succeed(
        'submit',
        '--branch',
        'new',
        '--update-only',
        status,
        '--reviewers',
        'alice',
        '--dry-run'
      );
      expect(skipped).to.include('target (').and.include('new (No-op)');
      expect(skipped).not.to.match(
        /new \(No-op\)\r?\n {2}(Mark as draft|Publish as ready for review|Request review)/
      );
    }
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture
        .calls()
        .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
    ).to.deep.equal([]);
  });
});
