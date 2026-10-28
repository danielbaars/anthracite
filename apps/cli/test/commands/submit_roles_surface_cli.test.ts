import { expect } from 'chai';
import { spawnSync } from 'child_process';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

function complete(fixture: SubmitCliFixture, args: readonly string[]) {
  const [executable, ...parameters] = getTestCliCommand([
    '--get-yargs-completions',
    'an',
    ...args,
  ]);
  const result = spawnSync(executable, parameters, {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error) throw result.error;
  return result;
}

describe('submit role options through public routes', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('completes role-target branches for every submit route without remote writes', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const status = fixture.git('status', '--porcelain');
    fixture.clearCalls();
    for (const command of ['submit', 's', 'ss']) {
      const result = complete(fixture, [command, '--roles-branch', 'an']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout.trim().split('\n')).to.include('child');
    }
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    expect(fixture.git('status', '--porcelain')).to.equal(status);
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.calls()).to.deep.equal([]);
  });

  it('explains additive scope-wide roles and the independent exact branch selector in route help', () => {
    for (const command of ['submit', 's', 'ss']) {
      const help = fixture.cli(command, '--help');
      expect(help.status, help.stderr).to.equal(0);
      const text = help.stdout.replace(/\s+/g, ' ');
      expect(text)
        .to.include('--reviewers')
        .and.include('--assignees')
        .and.include('--roles-branch')
        .and.include('Add reviewers without removing existing requests')
        .and.include('every selected PR unless --roles-branch is set')
        .and.include('exact selected branch PR')
        .and.include('without narrowing the submission scope');
      const options = complete(fixture, [command, '--']);
      expect(options.status, options.stderr).to.equal(0);
      expect(options.stdout)
        .to.include('--roles-branch')
        .and.include('--assignees');
    }
    expect(fixture.calls()).to.deep.equal([]);
  });

  it('answers one terminal reviewer prompt for the target while submitting the full stack', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('tip', 'child');
    fixture.succeed('ss');
    const result = runCliInPty(
      getTestCliCommand([
        'ss',
        '--reviewers',
        '--assignees',
        'bob',
        '--roles-branch',
        'child',
        '--draft',
        '--no-edit',
        '--interactive',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Reviewers (comma-separated GitHub usernames)',
            input: 'alice\r',
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(
      fixture
        .prs()
        .map((pr) => [pr.headRefName, pr.reviewRequests, pr.assignees ?? []])
    ).to.deep.equal([
      ['base', [], []],
      ['child', [{ login: 'alice' }], [{ login: 'bob' }]],
      ['tip', [], []],
    ]);
  });

  it('keeps separate terminal reviewer choices per PR without an explicit role target', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    const result = runCliInPty(
      getTestCliCommand([
        's',
        '--reviewers',
        '--draft',
        '--no-edit',
        '--interactive',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Reviewers (comma-separated GitHub usernames)',
            input: 'alice\r',
          },
          {
            prompt: 'Reviewers (comma-separated GitHub usernames)',
            input: 'bob\r',
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.reviewRequests])
    ).to.deep.equal([
      ['base', [{ login: 'alice' }]],
      ['child', [{ login: 'bob' }]],
    ]);
  });

  for (const command of ['submit', 's', 'ss']) {
    it(`forwards roles and an alias-named target through ${command} with its existing scope`, () => {
      fixture.branch('ss', 'main');
      fixture.branch('child', 'ss');
      fixture.branch('tip', 'child');
      fixture.branch('outside', 'main');
      fixture.succeed(
        command,
        '--branch',
        'child',
        '--reviewers',
        'alice',
        '--assignees',
        'bob',
        '--roles-branch',
        'ss'
      );
      const heads = command === 'ss' ? ['ss', 'child', 'tip'] : ['ss', 'child'];
      expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal(heads);
      expect(
        fixture.prs().map((pr) => [pr.reviewRequests, pr.assignees ?? []])
      ).to.deep.equal([
        [[{ login: 'alice' }], [{ login: 'bob' }]],
        ...heads.slice(1).map(() => [[], []]),
      ]);
      expect(fixture.remoteSha('outside')).to.equal('');
      expect(fixture.remoteSha('tip') !== '').to.equal(command === 'ss');
      expect(fixture.git('branch', '--show-current')).to.equal('outside');
    });
  }

  it('previews a pending reviewer choice and explicit assignees without input or writes', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const before = fixture.git('ls-remote', '--heads', 'origin');
    const result = fixture.cli(
      'ss',
      '--dry-run',
      '--roles-branch',
      'base',
      '--reviewers',
      '--assignees',
      'bob'
    );
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('base')
      .and.include('child')
      .and.include('interactive selection required')
      .and.include('bob');
    expect(result.stdout).not.to.include(
      'Reviewers (comma-separated GitHub usernames)'
    );
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(before);
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('rejects missing noninteractive reviewers and keeps quiet role submission silent', () => {
    fixture.branch('base', 'main');
    const before = fixture.git('ls-remote', '--heads', 'origin');
    const invalid = fixture.cli(
      's',
      '--reviewers',
      '--assignees',
      'bob',
      '--roles-branch',
      'base'
    );
    expect(invalid.status).not.to.equal(0);
    expect(invalid.stderr).to.include('non-empty reviewer');
    for (const reviewers of ['alice,', 'alice,,bob']) {
      const malformed = fixture.cli(
        'ss',
        '--dry-run',
        '--reviewers',
        reviewers,
        '--assignees',
        'bob',
        '--roles-branch',
        'base'
      );
      expect(malformed.status).not.to.equal(0);
      expect(malformed.stderr).to.include('non-empty reviewer');
    }
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(before);
    expect(fixture.prs()).to.deep.equal([]);
    const quiet = fixture.cli('ss', '--assignees', 'bob', '--quiet');
    expect(quiet.status, quiet.stderr).to.equal(0);
    expect(quiet.stdout).to.equal('');
    expect(fixture.prs()[0]?.assignees).to.deep.equal([{ login: 'bob' }]);
  });
});
