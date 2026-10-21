import { expect } from 'chai';
import path from 'path';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('explicit reviewers through the built CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  it('preserves explicit reviewers on creation without prompting or requesting a current sibling', () => {
    fixture.branch('target', 'main');
    fixture.branch('current', 'main');
    fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--reviewers',
      'alice, bob'
    );
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.reviewRequests])
    ).to.deep.equal([['target', [{ login: 'alice' }, { login: 'bob' }]]]);
    expect(fixture.remoteSha('current')).to.equal('');
    expect(fixture.git('branch', '--show-current')).to.equal('current');
  });
  it('adds reviewers to unchanged existing selected PRs without --always, retains others, and leaves requests alone without the option', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--reviewers', 'existing');
    fixture.branch('current', 'main');
    fixture.succeed('submit');
    const sibling = fixture.prs().find((pr) => pr.headRefName === 'current');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.succeed('submit', '--branch', 'target', '--reviewers', 'alice,bob');
    expect(
      fixture.prs().find((pr) => pr.headRefName === 'target')?.reviewRequests
    ).to.deep.equal([
      { login: 'existing' },
      { login: 'alice' },
      { login: 'bob' },
    ]);
    expect(
      fixture.prs().find((pr) => pr.headRefName === 'current')
    ).to.deep.equal(sibling);
    const prs = fixture.prs();
    fixture.clearCalls();
    fixture.succeed('submit', '--branch', 'target');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(
      fixture
        .calls()
        .some(
          (args) =>
            args.includes('--add-reviewer') || args.includes('--reviewer')
        )
    ).to.equal(false);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
  });

  it('rejects an explicitly empty non-interactive reviewer value before pushing or changing PRs', () => {
    fixture.branch('target', 'main');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    for (const args of [
      ['--reviewers'],
      ['--reviewers='],
      ['--reviewers', '  '],
      ['--reviewers', 'alice,'],
    ]) {
      const result = fixture.cli('submit', ...args);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('reviewer');
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
      expect(fixture.prs()).to.deep.equal([]);
      expect(
        fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
      ).to.equal(false);
    }
  });

  it('fails honestly when gh exits zero without assigning a requested reviewer after creation', () => {
    fixture.branch('target', 'main');
    fixture.env.CHARCOAL_TEST_GH_REVIEW_MODE = 'ignore';
    const result = fixture.cli('submit', '--reviewers', 'author');
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('author')
      .and.include('not confirmed');
    expect(fixture.remoteSha('target')).to.equal(
      fixture.git('rev-parse', 'target')
    );
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([]);
    expect(result.stdout + result.stderr)
      .to.include('created')
      .and.include('pull/1');
  });

  it('reports rejected reviewer operations after code and PR progress without claiming success', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    const head = fixture.commit('code-update');
    fixture.env.CHARCOAL_TEST_GH_REVIEW_MODE = 'reject';
    const result = fixture.cli('submit', '--reviewers', 'unknown');
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('unknown')
      .and.include('rejected')
      .and.include('pushed');
    expect(result.stdout + result.stderr).to.include(
      'PR updated at https://github.com/fixture/submit/pull/1'
    );
    expect(fixture.remoteSha('target')).to.equal(head);
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([]);
  });

  it('identifies confirmed and unconfirmed names when only part of a reviewer list is assigned', () => {
    fixture.branch('target', 'main');
    fixture.env.CHARCOAL_TEST_GH_REVIEW_MODE = 'partial';
    const result = fixture.cli('submit', '--reviewers', 'alice,denied');
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('not confirmed for denied')
      .and.include('Confirmed reviewers: alice');
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([
      { login: 'alice' },
    ]);
  });

  it('does not treat an old review as confirmation of an ignored new request, but accepts an already pending request', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--reviewers', 'pending');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        reviews: [{ id: 'old-review', author: { login: 'alice' } }],
      }))
    );
    fixture.env.CHARCOAL_TEST_GH_REVIEW_MODE = 'ignore';
    const ignored = fixture.cli('submit', '--reviewers', 'alice');
    expect(ignored.status).not.to.equal(0);
    expect(ignored.stdout + ignored.stderr).to.include(
      'not confirmed for alice'
    );
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([
      { login: 'pending' },
    ]);
    fixture.succeed('submit', '--reviewers', 'pending');
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([
      { login: 'pending' },
    ]);
  });

  it('recognizes a newly submitted review when the pending request has already been fulfilled', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    fixture.env.CHARCOAL_TEST_GH_REVIEW_MODE = 'reviewed';
    fixture.succeed('submit', '--reviewers', 'alice');
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([]);
    expect(fixture.prs()[0]?.reviews).to.deep.equal([
      { id: 'new-review', author: { login: 'alice' } },
    ]);
  });

  it('fails when reviewer readback names a different PR even though gh assigned the reviewer', () => {
    fixture.branch('target', 'main');
    fixture.env.CHARCOAL_TEST_GH_REVIEW_MODE = 'invalid';
    const result = fixture.cli('submit', '--reviewers', 'alice');
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('invalid PR response')
      .and.include('pushed');
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([
      { login: 'alice' },
    ]);
  });
  it('updates code and adds a single reviewer while preserving the PR identity and approved content', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    const original = fixture.prs()[0];
    const head = fixture.commit('updated-code');
    fixture.succeed('submit', '--reviewers', 'alice');
    expect(fixture.remoteSha('target')).to.equal(head);
    expect(fixture.prs()[0]).to.deep.equal({
      ...original,
      reviewRequests: [{ login: 'alice' }],
    });
  });
  it('still prompts for reviewers interactively before pushing when the option has no value', () => {
    fixture.branch('target', 'main');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const binary = process.env.CHARCOAL_TEST_BINARY;
    const command = binary
      ? [binary]
      : [process.execPath, path.resolve(__dirname, '../../src/index.js')];
    const result = runCliInPty(
      [
        ...command,
        'submit',
        '--reviewers',
        '--no-edit',
        '--draft',
        '--interactive',
      ],
      { cwd: fixture.repo, env: fixture.env }
    );
    expect(result.status).to.equal(124);
    expect(result.output).to.include(
      'Reviewers (comma-separated GitHub usernames)'
    );
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fixture.calls().some((args) => ['create', 'edit'].includes(args[1]))
    ).to.equal(false);
  });
});
