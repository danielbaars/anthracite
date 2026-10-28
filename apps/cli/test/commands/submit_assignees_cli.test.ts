import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

describe('submit assignees through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('submits a stack with reviewers and assignees only on the explicit role target', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('tip', 'child');
    fixture.branch('outside', 'main');
    fixture.succeed(
      'submit',
      '--branch',
      'tip',
      '--reviewers',
      'alice',
      '--assignees',
      'bob, carol',
      '--roles-branch',
      'child'
    );
    expect(
      fixture
        .prs()
        .map((pr) => [pr.headRefName, pr.reviewRequests, pr.assignees ?? []])
    ).to.deep.equal([
      ['base', [], []],
      ['child', [{ login: 'alice' }], [{ login: 'bob' }, { login: 'carol' }]],
      ['tip', [], []],
    ]);
    expect(fixture.remoteSha('outside')).to.equal('');
    expect(fixture.git('branch', '--show-current')).to.equal('outside');
    expect(fixture.prs().every((pr) => pr.isDraft)).to.equal(true);
  });

  it('adds authenticated and explicit assignees to an unchanged target without replacing existing roles', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--reviewers', 'alice');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        assignees: [{ login: 'existing' }],
      }))
    );
    fixture.branch('outside', 'main');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();
    fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--roles-branch',
      'target',
      '--assignees',
      ' @me, Fixture-User, bob, BOB, existing '
    );
    expect(fixture.prs()[0]?.assignees).to.deep.equal([
      { login: 'existing' },
      { login: 'fixture-user' },
      { login: 'bob' },
    ]);
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([
      { login: 'alice' },
    ]);
    const additions = fixture
      .calls()
      .filter((call) => call.includes('--add-assignee'));
    expect(additions).to.have.length(1);
    expect(
      additions[0]?.filter((arg) => arg === '--add-assignee')
    ).to.have.length(2);
    expect(fixture.calls().filter((call) => call[0] === 'api')).to.deep.equal([
      ['api', 'user'],
    ]);
    expect(
      fixture.calls().some((call) => call.includes('--add-reviewer'))
    ).to.equal(false);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.git('branch', '--show-current')).to.equal('outside');
  });

  it('uses scope-wide assignees without a role target and leaves roles unchanged without the option', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit', '--assignees', 'bob');
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.assignees])
    ).to.deep.equal([
      ['base', [{ login: 'bob' }]],
      ['child', [{ login: 'bob' }]],
    ]);
    fixture.commit('code-update');
    const before = fixture.prs();
    fixture.clearCalls();
    fixture.succeed('submit');
    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture.calls().some((call) => call.includes('--add-assignee'))
    ).to.equal(false);
  });

  it('previews both role lists on an unchanged target without remote mutations', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const before = fixture.prs();
    fixture.clearCalls();
    const output = fixture.succeed(
      'submit',
      '--dry-run',
      '--reviewers',
      'alice',
      '--assignees',
      '@me,bob',
      '--roles-branch',
      'base'
    );
    expect(output)
      .to.include('Request review: alice')
      .and.include('Assign: fixture-user, bob');
    expect(output).to.include('child (No-op)');
    expect(fixture.prs()).to.deep.equal(before);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('rejects missing or malformed assignee input before push or PR writes without prompting', () => {
    fixture.branch('target', 'main');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    for (const args of [
      ['--assignees'],
      ['--assignees='],
      ['--assignees', '  '],
      ['--assignees', 'alice,'],
      ['--assignees', 'org/team'],
      ['--assignees', 'not a user'],
    ]) {
      const result = fixture.cli('submit', ...args);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('assignees');
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
      expect(
        fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
      ).to.equal(false);
    }
  });

  it('rejects unverified authenticated identity before publishing instead of guessing @me', () => {
    fixture.branch('target', 'main');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    for (const mode of ['invalid', 'reject']) {
      fixture.env.ANTHRACITE_TEST_GH_ACCOUNT_MODE = mode;
      const result = fixture.cli('submit', '--assignees', '@me');
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.match(/GitHub|authentication/);
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
      expect(
        fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
      ).to.equal(false);
    }
  });

  for (const mode of ['ignore', 'reject', 'invalid', 'partial']) {
    it(`reports ${mode} assignment results honestly after creating a draft PR`, () => {
      fixture.branch('target', 'main');
      fixture.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE = mode;
      const result = fixture.cli('submit', '--assignees', 'bob,carol');
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr)
        .to.include('assignment failed')
        .and.include('created')
        .and.include('pull/1');
      expect(fixture.remoteSha('target')).to.equal(
        fixture.git('rev-parse', 'target')
      );
      expect(fixture.prs()[0]?.isDraft).to.equal(true);
      expect(fixture.calls().some((call) => call[1] === 'ready')).to.equal(
        false
      );
      if (mode === 'ignore') {
        expect(result.stdout + result.stderr).to.include('not confirmed');
        expect(fixture.prs()[0]?.assignees ?? []).to.deep.equal([]);
      } else if (mode === 'partial') {
        expect(result.stdout + result.stderr)
          .to.include('carol')
          .and.include('Confirmed assignees: bob');
        expect(fixture.prs()[0]?.assignees).to.deep.equal([{ login: 'bob' }]);
      } else if (mode === 'invalid') {
        expect(result.stdout + result.stderr).to.include('invalid PR response');
        expect(fixture.prs()[0]?.assignees).to.deep.equal([
          { login: 'bob' },
          { login: 'carol' },
        ]);
      } else {
        expect(result.stdout + result.stderr).to.include('rejected');
        expect(fixture.prs()[0]?.assignees ?? []).to.deep.equal([]);
      }
    });
  }

  it('honors explicit publication and draft requests independently of assignees', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--assignees', 'bob', '--publish');
    expect(fixture.prs()[0]?.isDraft).to.equal(false);
    expect(fixture.prs()[0]?.assignees).to.deep.equal([{ login: 'bob' }]);
    fixture.succeed('submit', '--assignees', 'carol', '--draft');
    expect(fixture.prs()[0]?.isDraft).to.equal(true);
    expect(fixture.prs()[0]?.assignees).to.deep.equal([
      { login: 'bob' },
      { login: 'carol' },
    ]);
  });
});
