import { expect } from 'chai';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('submit reviewer role targets through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  it('submits the selected stack but adds reviewers only to its explicit role target', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('leaf', 'child');
    fixture.branch('other', 'main');
    fixture.succeed(
      'submit',
      '--branch',
      'base',
      '--stack',
      '--roles-branch',
      'child',
      '--reviewers',
      'alice'
    );
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.reviewRequests])
    ).to.deep.equal([
      ['base', []],
      ['child', [{ login: 'alice' }]],
      ['leaf', []],
    ]);
    for (const branch of ['base', 'child', 'leaf'])
      expect(fixture.remoteSha(branch)).to.equal(
        fixture.git('rev-parse', branch)
      );
    expect(fixture.remoteSha('other')).to.equal('');
    expect(fixture.git('branch', '--show-current')).to.equal('other');
  });

  it('previews reviewer names for an unchanged target without changing other PRs', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const prs = fixture.prs();
    fixture.clearCalls();
    const output = fixture.succeed(
      'submit',
      '--dry-run',
      '--roles-branch',
      'base',
      '--reviewers',
      'alice,bob'
    );
    expect(output).to.include('base (Request review: alice,bob)');
    expect(output).to.include('child (No-op)');
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.prs()).to.deep.equal(prs);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('retains scope-wide defaults and adds reviewers to an unchanged ancestor target only', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit', '--reviewers', 'existing');
    expect(fixture.prs().map((pr) => pr.reviewRequests)).to.deep.equal([
      [{ login: 'existing' }],
      [{ login: 'existing' }],
    ]);
    const prs = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();
    fixture.succeed(
      'submit',
      '--roles-branch',
      'base',
      '--reviewers',
      'alice,bob'
    );
    expect(fixture.prs()).to.deep.equal([
      {
        ...prs[0],
        reviewRequests: [
          { login: 'existing' },
          { login: 'alice' },
          { login: 'bob' },
        ],
      },
      prs[1],
    ]);
    const requests = fixture
      .calls()
      .filter((call) => call.includes('--add-reviewer'));
    expect(requests.map((call) => call[2])).to.deep.equal(['1']);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.git('branch', '--show-current')).to.equal('child');
  });

  it('refuses unknown, trunk, outside-scope and frozen explicit targets before any remote mutation', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('other', 'main');
    for (const target of ['missing', 'main', 'other', 'child']) {
      fixture.clearCalls();
      const before = fixture.git('ls-remote', '--heads', 'origin');
      const result = fixture.cli(
        'submit',
        '--branch',
        'base',
        '--roles-branch',
        target,
        '--reviewers',
        'alice'
      );
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr)
        .to.include('Role target')
        .and.include(target);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(before);
      expect(fixture.prs()).to.deep.equal([]);
      expect(
        fixture
          .calls()
          .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
      ).to.equal(false);
    }
    fixture.succeed('freeze', 'base');
    const result = fixture.cli(
      'submit',
      '--branch',
      'base',
      '--roles-branch',
      'base',
      '--reviewers',
      'alice'
    );
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('Role target')
      .and.include('base');
    expect(fixture.remoteSha('base')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
  });

  it('refuses an update-only-skipped role target before submitting its existing ancestor', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.branch('child', 'base');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const prs = fixture.prs();
    fixture.clearCalls();
    const result = fixture.cli(
      'submit',
      '--update-only',
      '--roles-branch',
      'child',
      '--reviewers',
      'alice'
    );
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('child')
      .and.include('--update-only');
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.prs()).to.deep.equal(prs);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('refuses a role target deselected in a real terminal before pushing any selected branch', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--select',
        '--roles-branch',
        'child',
        '--reviewers',
        'alice',
        '--draft',
        '--no-edit',
        '--interactive',
      ]),
      {
        cwd: fixture.repo,
        env: { ...fixture.env, NO_COLOR: '1' },
        responses: [
          { prompt: 'Would you like to submit base?', input: 'y\r' },
          { prompt: 'Would you like to submit child?', input: 'n\r' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Role target "child"');
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('previews a bare reviewer choice without asking for input or changing PRs', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--dry-run',
        '--roles-branch',
        'base',
        '--reviewers',
        '--interactive',
      ]),
      {
        cwd: fixture.repo,
        env: { ...fixture.env, NO_COLOR: '1' },
        timeoutMs: 5000,
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('interactive selection required');
    expect(result.output).not.to.include(
      'Reviewers (comma-separated GitHub usernames)'
    );
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.remoteSha('base')).to.equal('');
    expect(fixture.remoteSha('child')).to.equal('');
  });
});
