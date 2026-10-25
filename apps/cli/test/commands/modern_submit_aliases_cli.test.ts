import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

function observe(fixture: SubmitCliFixture) {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: fixture.repo,
      env: { ...fixture.env, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
    }).trim();
  return {
    branch: git('branch', '--show-current'),
    head: git('rev-parse', 'HEAD'),
    heads: git(
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads'
    ),
    stage: git('ls-files', '--stage'),
    status: git('status', '--porcelain'),
    diff: git('diff', '--binary'),
    remote: git('ls-remote', '--heads', 'origin'),
    prs: fixture.prs(),
  };
}

function invoke(
  fixture: SubmitCliFixture,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}
) {
  const cwd = options.cwd ?? fixture.repo;
  const env = options.env ?? fixture.env;
  fixture.git('status', '--porcelain');
  const before = observe(fixture);
  const command = getTestCliCommand(args);
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    env,
    timeout: 20000,
  });
  fs.appendFileSync(
    path.join(fixture.root, 'cli.jsonl'),
    JSON.stringify({
      command,
      cwd,
      environment: Object.fromEntries(
        [
          'HOME',
          'XDG_CONFIG_HOME',
          'GRAPHITE_USER_CONFIG_PATH',
          'GRAPHITE_PROFILE',
          'GRAPHITE_INTERACTIVE',
          'GH_CONFIG_DIR',
          'GIT_CONFIG_NOSYSTEM',
          'GIT_CONFIG_GLOBAL',
          'PATH',
          'CHARCOAL_TEST_BINARY',
        ].map((key) => [key, env[key]])
      ),
      before,
      after: observe(fixture),
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdoutBase64: result.stdout.toString('base64'),
      stderrBase64: result.stderr.toString('base64'),
    }) + '\n'
  );
  if (result.error) throw result.error;
  expect(result.signal).to.equal(null);
  return {
    status: result.status,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function expectPublished(
  fixture: SubmitCliFixture,
  branches: readonly string[]
) {
  expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal(branches);
  for (const name of branches) {
    expect(fixture.remoteSha(name)).to.equal(fixture.git('rev-parse', name));
  }
  expect(fixture.remoteSha('other')).to.equal('');
  expect(fixture.git('branch', '--show-current')).to.equal('child');
}

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('modern submit aliases through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('tip', 'child');
    fixture.branch('other', 'main');
    fixture.git('switch', 'child');
    fixture.clearCalls();
  });
  afterEach(function () {
    const destination = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (destination) {
      const target = path.join(destination, path.basename(fixture.root));
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(
        path.join(target, 'final.json'),
        JSON.stringify(
          {
            test: this.currentTest?.fullTitle(),
            observation: observe(fixture),
          },
          null,
          2
        )
      );
      for (const file of [
        'cli.jsonl',
        'gh.jsonl',
        'prs.json',
        'caller-preservation.json',
      ]) {
        const source = path.join(fixture.root, file);
        if (fs.existsSync(source))
          fs.copyFileSync(source, path.join(target, file));
      }
    }
    fixture.cleanup();
  });

  it('submits downstack through s without publishing descendants or another stack', () => {
    const result = invoke(fixture, ['s', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expectPublished(fixture, ['base', 'child']);
    expect(fixture.remoteSha('tip')).to.equal('');
    expect(
      fixture.prs().map((pr) => [pr.baseRefName, pr.isDraft])
    ).to.deep.equal([
      ['main', true],
      ['base', true],
    ]);
  });
  it('submits the whole selected stack through ss by default', () => {
    const result = invoke(fixture, ['ss', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expectPublished(fixture, ['base', 'child', 'tip']);
    expect(fixture.prs().map((pr) => pr.baseRefName)).to.deep.equal([
      'main',
      'base',
      'child',
    ]);
  });

  for (const [name, args, expected] of [
    ['canonical downstack', ['submit'], ['base', 'child']],
    ['canonical stack', ['submit', '--stack'], ['base', 'child', 'tip']],
    ['s with explicit stack', ['s', '--stack'], ['base', 'child', 'tip']],
    ['ss with no-stack', ['ss', '--no-stack'], ['base', 'child']],
    ['ss with long false', ['ss', '--stack=false'], ['base', 'child']],
    ['ss with short false', ['ss', '-s=false'], ['base', 'child']],
    ['ss with spaced false', ['ss', '--stack', 'false'], ['base', 'child']],
    [
      'ss with later true',
      ['ss', '--no-stack', '--stack=true'],
      ['base', 'child', 'tip'],
    ],
    [
      'ss with later false',
      ['ss', '--stack=true', '--stack=false'],
      ['base', 'child'],
    ],
    [
      'ss with later bare true',
      ['ss', '--stack=false', '--stack'],
      ['base', 'child', 'tip'],
    ],
  ] as const) {
    it(`preserves the effective boolean scope for ${name}`, () => {
      const result = invoke(fixture, [...args, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expectPublished(fixture, expected);
      if (expected.length === 2) expect(fixture.remoteSha('tip')).to.equal('');
    });
  }

  it('selects the explicit sibling stack through ss and preserves dirty current work and an outside PR', () => {
    fixture.git('switch', 'other');
    fixture.succeed('submit');
    const outsidePr = fixture.prs()[0];
    const outsideRemote = fixture.remoteSha('other');
    fixture.branch('target', 'main');
    fixture.branch('target-tip', 'target');
    fixture.git('switch', 'child');
    fs.appendFileSync(
      path.join(fixture.repo, 'child.txt'),
      '\nworking content'
    );
    fs.writeFileSync(path.join(fixture.repo, 'staged.txt'), 'staged content');
    fixture.git('add', 'staged.txt');
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.txt'),
      'untracked content'
    );
    fixture.git('status', '--porcelain');
    const before = observe(fixture);
    const result = invoke(fixture, [
      'ss',
      '--branch',
      'target',
      '--publish',
      '--reviewers',
      'ss,utr',
      '--no-edit',
      '--confirm',
      '--select',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal([
      'other',
      'target',
      'target-tip',
    ]);
    for (const [name, parent] of [
      ['target', 'main'],
      ['target-tip', 'target'],
    ]) {
      expect(fixture.remoteSha(name)).to.equal(fixture.git('rev-parse', name));
      expect(fixture.prs().find((pr) => pr.headRefName === name)).to.include({
        baseRefName: parent,
        isDraft: false,
      });
      expect(
        fixture.prs().find((pr) => pr.headRefName === name)?.reviewRequests
      ).to.deep.equal([{ login: 'ss' }, { login: 'utr' }]);
    }
    const after = observe(fixture);
    for (const key of [
      'branch',
      'head',
      'heads',
      'stage',
      'status',
      'diff',
    ] as const) {
      expect(after[key]).to.equal(before[key]);
    }
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
    ).to.equal('untracked content');
    expect(fixture.remoteSha('other')).to.equal(outsideRemote);
    expect(
      fixture.prs().find((pr) => pr.headRefName === 'other')
    ).to.deep.equal(outsidePr);
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.remoteSha('tip')).to.equal('');
  });

  for (const alias of ['s', 'ss']) {
    it(`previews ${alias} without remote or PR changes`, () => {
      const before = observe(fixture);
      const result = invoke(fixture, [
        alias,
        '--dry-run',
        '--confirm',
        '--select',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('base (Create)')
        .and.include('child (Create)');
      if (alias === 'ss') expect(result.stdout).to.include('tip (Create)');
      else expect(result.stdout).not.to.include('tip (Create)');
      expect(observe(fixture)).to.deep.equal(before);
      expect(
        fixture
          .calls()
          .filter((args) => ['create', 'edit', 'ready'].includes(args[1]))
      ).to.deep.equal([]);
    });
  }

  it('keeps update-only and quiet as existing submit options on ss', () => {
    const before = observe(fixture);
    const result = invoke(fixture, [
      'ss',
      '--update-only',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(observe(fixture)).to.deep.equal(before);
  });

  it('uses a literal alias-named branch value rather than rewriting it', () => {
    fixture.branch('ss', 'main');
    fixture.git('switch', 'child');
    const result = invoke(fixture, ['s', '--branch', 'ss', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.baseRefName])
    ).to.deep.equal([['ss', 'main']]);
    expect(fixture.remoteSha('ss')).to.equal(fixture.git('rev-parse', 'ss'));
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.git('branch', '--show-current')).to.equal('child');
  });

  it('uses prefix and suffix cwd with relative and spaced Unicode paths without touching its caller repository', () => {
    const caller = new SubmitCliFixture();
    try {
      const aliasPath = path.join(caller.root, 'selected ss Ω');
      fs.symlinkSync(fixture.repo, aliasPath, 'dir');
      const relative = path.relative(caller.repo, aliasPath);
      const callerBefore = observe(caller);
      const callerObservations: unknown[] = [];
      for (const args of [
        ['--cwd', relative, 's', '--dry-run', '--no-interactive'],
        ['ss', '--cwd', aliasPath, '--dry-run', '--no-interactive'],
      ]) {
        const result = invoke(fixture, args, { cwd: caller.repo });
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(result.stdout)
          .to.include('base (Create)')
          .and.include('child (Create)');
        const callerAfter = observe(caller);
        expect(callerAfter).to.deep.equal(callerBefore);
        callerObservations.push({
          args,
          before: callerBefore,
          after: callerAfter,
        });
      }
      const submitted = invoke(
        fixture,
        ['--cwd', relative, 'ss', '--no-interactive'],
        { cwd: caller.repo }
      );
      expect(submitted.status, submitted.stdout + submitted.stderr).to.equal(0);
      expectPublished(fixture, ['base', 'child', 'tip']);
      const callerAfter = observe(caller);
      expect(callerAfter).to.deep.equal(callerBefore);
      callerObservations.push({ before: callerBefore, after: callerAfter });
      fs.writeFileSync(
        path.join(fixture.root, 'caller-preservation.json'),
        JSON.stringify(callerObservations, null, 2)
      );
    } finally {
      caller.cleanup();
    }
  });

  it('rejects bad cwd and actual invalid global policy before Git or gh can run', () => {
    const denied = path.join(fixture.root, 'denied-tools');
    const marker = path.join(fixture.root, 'unexpected-tool');
    fs.mkdirSync(denied);
    for (const name of ['git', 'gh']) {
      const tool = path.join(denied, name);
      fs.writeFileSync(
        tool,
        '#!/bin/sh\nprintf tool > "' + marker + '"\nexit 93\n'
      );
      fs.chmodSync(tool, 0o755);
    }
    const env = {
      ...fixture.env,
      PATH: denied + path.delimiter + fixture.env.PATH,
    };
    const before = observe(fixture);
    for (const args of [
      ['--cwd', path.join(fixture.root, 'missing'), 'ss', '--dry-run'],
      ['s', '--quiet=invalid', '--dry-run'],
      ['ss', '--interactive.invalid=true', '--dry-run'],
    ]) {
      const result = invoke(fixture, args, { env });
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(fs.existsSync(marker)).to.equal(false);
      expect(observe(fixture)).to.deep.equal(before);
    }
  });

  it('keeps alias words and flag-like tokens literal in valid string values and after the terminator', () => {
    const message = 'ss --stack --cwd nope --quiet=invalid utr';
    fs.writeFileSync(path.join(fixture.repo, 'literal.txt'), 'literal');
    fixture.git('add', 'literal.txt');
    const created = invoke(fixture, [
      'create',
      'literal',
      '-m',
      message,
      '--no-interactive',
    ]);
    expect(created.status, created.stdout + created.stderr).to.equal(0);
    expect(fixture.git('log', '-1', '--format=%s')).to.equal(message);
    fixture.git('switch', 'child');
    const before = observe(fixture);
    for (const command of ['submit', 'ss']) {
      const preview = invoke(fixture, [
        command,
        '--no-stack',
        '--dry-run',
        '--no-interactive',
        '--',
        's',
        '--stack',
        '--cwd',
        'missing',
      ]);
      expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
      expect(preview.stdout)
        .to.include('base (Create)')
        .and.include('child (Create)');
      expect(preview.stdout)
        .not.to.include('tip (Create)')
        .and.not.to.include('literal (Create)');
      expect(observe(fixture)).to.deep.equal(before);
    }
  });

  it('keeps nested repo s and log s/l scoped to their own groups', () => {
    const before = observe(fixture);
    for (const args of [
      ['repo', 's', '--help'],
      ['log', 's'],
      ['log', 'l'],
    ]) {
      const result = invoke(fixture, [...args, '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      if (args[0] === 'repo')
        expect(result.stdout)
          .to.include('Pull the trunk branch')
          .and.not.to.include('distinct pull requests');
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(
        before.remote
      );
    }
    const sync = invoke(fixture, [
      'repo',
      's',
      '--no-pull',
      '--no-delete',
      '--no-interactive',
    ]);
    expect(sync.status, sync.stdout + sync.stderr).to.equal(0);
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.git('branch', '--show-current')).to.equal('child');
  });

  it('answers real terminal selection and confirmation through s using only the chosen branch', () => {
    const command = getTestCliCommand([
      's',
      '--interactive',
      '--select',
      '--confirm',
      '--no-edit',
      '--draft',
    ]);
    const before = observe(fixture);
    const result = runCliInPty(command, {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Would you like to submit', input: 'y\r' },
        { prompt: 'Would you like to submit', input: 'n\r' },
        { prompt: 'Continue with this submit operation?', input: 'y\r' },
      ],
    });
    fs.appendFileSync(
      path.join(fixture.root, 'cli.jsonl'),
      JSON.stringify({
        command,
        cwd: fixture.repo,
        before,
        after: observe(fixture),
        ...result,
      }) + '\n'
    );
    expect(result.status, result.output).to.equal(0);
    expectPublished(fixture, ['base']);
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.remoteSha('tip')).to.equal('');
  });

  it('shows actual s/ss help outside Git and offers their shared submit options through public completion', () => {
    for (const alias of ['s', 'ss']) {
      const result = invoke(
        fixture,
        [
          alias,
          '--help',
          '--quiet',
          '--cwd',
          path.join(fixture.root, 'missing'),
        ],
        { cwd: fixture.root }
      );
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('--reviewers')
        .and.include('--branch')
        .and.include('--dry-run');
      if (alias === 'ss')
        expect(result.stdout)
          .to.match(/submit\s+--stack\s+by\s+default/)
          .and.include('--no-stack');
      else expect(result.stdout).to.include('trunk to the current branch');
      const completion = invoke(fixture, [
        '--get-yargs-completions',
        'ch',
        alias,
        '--',
      ]);
      expect(completion.status, completion.stdout + completion.stderr).to.equal(
        0
      );
      expect(completion.stdout)
        .to.include('--reviewers')
        .and.include('--branch')
        .and.include('--stack');
    }
    const roots = invoke(fixture, ['--get-yargs-completions', 'ch', '']);
    expect(roots.status, roots.stderr).to.equal(0);
    expect(roots.stdout).to.match(/^ss(?::|$)/m);
  });
});
