import { expect } from 'chai';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

function invoke(fixture: SubmitCliFixture, args: string[]) {
  const command = getTestCliCommand(args);
  const before = observe(fixture);
  const allRefsBefore = fixture.git('show-ref');
  const result = spawnSync(command[0], command.slice(1), {
    cwd: fixture.repo,
    env: fixture.env,
    timeout: 20000,
  });
  const record = {
    command,
    before,
    after: observe(fixture),
    allRefsBefore,
    allRefsAfter: fixture.git('show-ref'),
    cwd: fixture.repo,
    environment: observedEnvironment(fixture),
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdoutBase64: result.stdout.toString('base64'),
    stderrBase64: result.stderr.toString('base64'),
  };
  fs.appendFileSync(
    path.join(fixture.root, 'cli.jsonl'),
    JSON.stringify(record) + '\n'
  );
  if (result.error) throw result.error;
  expect(result.signal).to.equal(null);
  return {
    status: result.status,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function observedEnvironment(fixture: SubmitCliFixture) {
  return Object.fromEntries(
    [
      'HOME',
      'XDG_CONFIG_HOME',
      'GH_CONFIG_DIR',
      'GRAPHITE_USER_CONFIG_PATH',
      'GRAPHITE_PROFILE',
      'GRAPHITE_INTERACTIVE',
      'CH_EDITOR',
      'PATH',
      'TERM',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_CONFIG_GLOBAL',
      'GIT_OPTIONAL_LOCKS',
      'CHARCOAL_TEST_BINARY',
    ].map((key) => [key, fixture.env[key]])
  );
}

function observe(fixture: SubmitCliFixture) {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: fixture.repo,
      env: { ...fixture.env, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
    }).trim();
  return {
    head: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    refs: git(
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/remotes'
    ),
    tree: git('ls-tree', '-r', 'HEAD'),
    stage: git('ls-files', '--stage'),
    work: git('status', '--porcelain'),
    remote: git('ls-remote', '--heads', 'origin'),
    prs: fixture.prs(),
  };
}

function editor(fixture: SubmitCliFixture, body: string): void {
  const script = path.join(fixture.root, 'editor.js');
  fs.writeFileSync(
    script,
    `const fs = require('fs');
const file = process.argv[2];
fs.appendFileSync(${JSON.stringify(
      path.join(fixture.root, 'editor.jsonl')
    )}, JSON.stringify({argv: process.argv, cwd: process.cwd(), initial: fs.readFileSync(file, 'utf8')}) + '\\n');
fs.writeFileSync(file, ${JSON.stringify(body)});`
  );
  fixture.env.CH_EDITOR = `${shellQuote(process.execPath)} ${shellQuote(
    script
  )}`;
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function terminal(
  fixture: SubmitCliFixture,
  args: string[],
  responses: { prompt: string; input: string }[]
) {
  const command = getTestCliCommand(args);
  const before = observe(fixture);
  const allRefsBefore = fixture.git('show-ref');
  const result = runCliInPty(command, {
    cwd: fixture.repo,
    env: fixture.env,
    responses,
  });
  fs.appendFileSync(
    path.join(fixture.root, 'cli.jsonl'),
    JSON.stringify({
      command,
      cwd: fixture.repo,
      environment: observedEnvironment(fixture),
      responses,
      before,
      after: observe(fixture),
      allRefsBefore,
      allRefsAfter: fixture.git('show-ref'),
      ...result,
    }) + '\n'
  );
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function failPrLookups(fixture: SubmitCliFixture): void {
  const shim = path.join(fixture.root, 'bin', 'gh');
  const original = shim + '-original';
  fs.renameSync(shim, original);
  fs.writeFileSync(
    shim,
    `#!${process.execPath}
const cp = require('child_process');
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'view') {
  process.stderr.write('controlled gh lookup failure\\n');
  process.exitCode = 17;
} else {
  const result = cp.spawnSync(${JSON.stringify(
    original
  )}, args, {stdio: 'inherit'});
  process.exitCode = result.status ?? 1;
}`
  );
  fs.chmodSync(shim, 0o755);
}

// Independent public subprocess scenarios, not a production operation.
// eslint-disable-next-line max-lines-per-function
describe('submit under the shared interaction policy', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
    for (const key of [
      'GRAPHITE_INTERACTIVE',
      'GIT_OPTIONAL_LOCKS',
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'CH_EDITOR',
      'GIT_EDITOR',
      'VISUAL',
      'EDITOR',
    ]) {
      delete fixture.env[key];
    }
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
            calls: fixture.calls(),
          },
          null,
          2
        )
      );
      for (const file of ['cli.jsonl', 'editor.jsonl']) {
        const source = path.join(fixture.root, file);
        if (fs.existsSync(source))
          fs.copyFileSync(source, path.join(target, file));
      }
    }
    fixture.cleanup();
  });

  it('ignores select and confirm without interaction and submits the explicit downstack rather than a current sibling', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('current', 'main');
    const before = observe(fixture);
    const result = invoke(fixture, [
      'submit',
      '--branch',
      'child',
      '--select',
      '--confirm',
      '--no-interactive',
      '--publish',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.baseRefName, pr.isDraft])
    ).to.deep.equal([
      ['base', 'main', false],
      ['child', 'base', false],
    ]);
    expect(fixture.remoteSha('base')).to.equal(
      fixture.git('rev-parse', 'base')
    );
    expect(fixture.remoteSha('child')).to.equal(
      fixture.git('rev-parse', 'child')
    );
    expect(fixture.remoteSha('current')).to.equal('');
    expect(observe(fixture)).to.include({
      head: before.head,
      branch: before.branch,
      tree: before.tree,
      stage: before.stage,
      work: before.work,
    });
  });
  it('skips multiple optional templates under default pipes while retaining configured commit-message inclusion and draft defaults', () => {
    fixture.branch('target', 'main');
    fixture.git(
      'commit',
      '--amend',
      '-m',
      'A topic',
      '-m',
      'Body from the real commit'
    );
    const templates = path.join(
      fixture.repo,
      '.github',
      'PULL_REQUEST_TEMPLATE'
    );
    fs.mkdirSync(templates, { recursive: true });
    fs.writeFileSync(
      path.join(templates, 'first.md'),
      'FIRST OPTIONAL TEMPLATE'
    );
    fs.writeFileSync(
      path.join(templates, 'second.md'),
      'SECOND OPTIONAL TEMPLATE'
    );
    fs.writeFileSync(
      fixture.env.GRAPHITE_USER_CONFIG_PATH ?? '',
      JSON.stringify({ tips: false, submitIncludeCommitMessages: true })
    );
    const before = observe(fixture);
    const result = invoke(fixture, ['submit', '--edit']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    const pr = fixture.prs()[0];
    expect(pr?.body).to.include('Body from the real commit');
    expect(pr?.body).not.to.include('OPTIONAL TEMPLATE');
    expect(pr?.isDraft).to.equal(true);
    expect(pr?.title).to.equal('A topic');
    expect(fixture.remoteSha('target')).to.equal(before.head);
    expect(observe(fixture)).to.include({
      head: before.head,
      branch: before.branch,
      tree: before.tree,
      stage: before.stage,
      work: before.work,
    });
  });

  it('uses non-prompt defaults even with explicit interactive on pipes instead of opening inline edit, selection or draft UI', () => {
    fixture.branch('target', 'main');
    const result = invoke(fixture, [
      'submit',
      '--interactive',
      '--select',
      '--confirm',
      '--edit',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.title, pr.isDraft])
    ).to.deep.equal([['target', 'target', true]]);
    expect(fixture.remoteSha('target')).to.equal(
      fixture.git('rev-parse', 'target')
    );
    expect(result.stdout + result.stderr).not.to.include('Title ›');
  });

  it('creates a PR after an answered terminal title prompt and a real body editor, preserving one footer and the committed code', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    editor(fixture, 'Updated body\nsecond line\n');
    const result = terminal(
      fixture,
      ['submit', '--interactive', '--edit', '--publish'],
      [{ prompt: 'Title', input: 'Updated title\r' }]
    );
    expect(result.status, result.output).to.equal(0);
    const pr = fixture.prs()[0];
    expect(pr).to.include({
      headRefName: 'target',
      baseRefName: 'main',
      title: 'Updated title',
      isDraft: false,
      state: 'OPEN',
    });
    expect(pr?.reviewRequests).to.deep.equal([]);
    expect(pr?.body).to.include('Updated body\nsecond line');
    expect(pr?.body.match(/#### PR Dependency Tree/g)).to.have.length(1);
    expect(pr?.body.match(/\*\*PR #1\*\*/g)).to.have.length(1);
    expect(
      fs
        .readFileSync(path.join(fixture.root, 'editor.jsonl'), 'utf8')
        .trim()
        .split('\n')
    ).to.have.length(1);
    expect(fixture.remoteSha('target')).to.equal(before.head);
    expect(observe(fixture)).to.include({
      head: before.head,
      branch: before.branch,
      tree: before.tree,
      stage: before.stage,
      work: before.work,
    });
  });

  it('edits an existing PR body through a real terminal editor and updates its code without claiming the pre-existing title propagation gap is fixed', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--publish');
    const previous = fixture.prs()[0];
    const head = fixture.commit('updated-code');
    editor(fixture, 'Replacement existing body\n');
    const result = terminal(
      fixture,
      ['submit', '--interactive', '--edit', '--publish'],
      [{ prompt: 'Title', input: 'Locally edited title\r' }]
    );
    expect(result.status, result.output).to.equal(0);
    const pr = fixture.prs()[0];
    expect(pr).to.include({
      number: previous.number,
      title: previous.title,
      headRefName: 'target',
      baseRefName: 'main',
      isDraft: false,
    });
    expect(pr?.body).to.include('Replacement existing body');
    expect(pr?.body.match(/#### PR Dependency Tree/g)).to.have.length(1);
    const inputs = fs
      .readFileSync(path.join(fixture.root, 'editor.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value) || typeof value.initial !== 'string') {
          throw new Error('Invalid external editor record');
        }
        return value.initial;
      });
    expect(inputs).to.deep.equal([previous.body]);
    expect(fixture.remoteSha('target')).to.equal(head);
  });

  it('uses a unique template without an editor and preserves an existing PR body over later template changes', () => {
    fixture.branch('target', 'main');
    const template = path.join(fixture.repo, 'pull_request_template.md');
    fs.writeFileSync(template, 'UNIQUE TEMPLATE\n');
    const created = invoke(fixture, [
      'submit',
      '--no-interactive',
      '--edit',
      '--publish',
    ]);
    expect(created.status, created.stdout + created.stderr).to.equal(0);
    expect(fixture.prs()[0]?.body).to.include('UNIQUE TEMPLATE');
    const previous = fixture.prs()[0];
    fs.writeFileSync(template, 'CHANGED TEMPLATE');
    fixture.commit('new-code');
    const result = invoke(fixture, [
      'submit',
      '--no-interactive',
      '--edit',
      '--confirm',
      '--select',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.prs()[0]).to.deep.equal(previous);
    expect(fixture.remoteSha('target')).to.equal(
      fixture.git('rev-parse', 'HEAD')
    );
    expect(fs.existsSync(path.join(fixture.root, 'editor.jsonl'))).to.equal(
      false
    );
  });

  it('allows a real terminal template choice and passes that selected content to the configured editor', () => {
    fixture.branch('target', 'main');
    const templates = path.join(
      fixture.repo,
      '.github',
      'PULL_REQUEST_TEMPLATE'
    );
    fs.mkdirSync(templates, { recursive: true });
    fs.writeFileSync(path.join(templates, '01-first.md'), 'FIRST CHOICE');
    fs.writeFileSync(path.join(templates, '02-second.md'), 'SECOND CHOICE');
    editor(fixture, 'Chosen body\n');
    const result = terminal(
      fixture,
      ['submit', '--interactive', '--edit', '--publish'],
      [
        { prompt: 'Title', input: 'Chosen title\r' },
        { prompt: 'Body Template', input: '\u001b[B\r' },
      ]
    );
    expect(result.status, result.output).to.equal(0);
    const firstPosition = result.output.indexOf('01-first.md');
    const secondPosition = result.output.indexOf('02-second.md');
    expect(firstPosition).to.be.greaterThan(-1);
    expect(secondPosition).to.be.greaterThan(-1);
    const expectedTemplate =
      firstPosition < secondPosition ? 'SECOND CHOICE' : 'FIRST CHOICE';
    const editorRecord: unknown = JSON.parse(
      fs.readFileSync(path.join(fixture.root, 'editor.jsonl'), 'utf8').trim()
    );
    expect(isRecord(editorRecord) && editorRecord.initial).to.equal(
      expectedTemplate
    );
    expect(fixture.prs()[0]).to.include({
      title: 'Chosen title',
      isDraft: false,
    });
    expect(fixture.prs()[0]?.body).to.include('Chosen body');
  });

  it('completes answered terminal selection and confirmation using only the chosen branch', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const result = terminal(
      fixture,
      ['submit', '--interactive', '--select', '--confirm', '-n', '--draft'],
      [
        { prompt: 'Would you like to submit', input: 'y\r' },
        { prompt: 'Would you like to submit', input: 'n\r' },
        { prompt: 'Continue with this submit operation?', input: 'y\r' },
      ]
    );
    expect(result.status, result.output).to.equal(0);
    expect(fixture.prs().map((pr) => pr.headRefName)).to.deep.equal(['base']);
    expect(fixture.remoteSha('base')).to.equal(
      fixture.git('rev-parse', 'base')
    );
    expect(fixture.remoteSha('child')).to.equal('');
  });

  it('ignores select and confirm during a real terminal dry-run and preserves remote and PR state', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    const result = terminal(
      fixture,
      [
        'submit',
        '--interactive',
        '--dry-run',
        '--select',
        '--confirm',
        '--edit',
      ],
      []
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('Dry run complete');
    expect(result.output).not.to.include('Would you like to submit');
    expect(observe(fixture)).to.deep.equal(before);
  });

  it('submits quietly despite absent prior PRs, ignores inline edit, and retains explicit reviewers without invoking an editor', () => {
    fixture.branch('target', 'main');
    editor(fixture, 'This editor must not run');
    const result = invoke(fixture, [
      'submit',
      '--quiet',
      '--interactive',
      '--edit',
      '--select',
      '--confirm',
      '--publish',
      '--reviewers',
      'alice,bob',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).not.to.include('no pull requests found');
    expect(fs.existsSync(path.join(fixture.root, 'editor.jsonl'))).to.equal(
      false
    );
    const pr = fixture.prs()[0];
    expect(pr).to.include({ title: 'target', isDraft: false });
    expect(pr?.body).not.to.include('This editor must not run');
    expect(pr?.reviewRequests).to.deep.equal([
      { login: 'alice' },
      { login: 'bob' },
    ]);
    expect(fixture.remoteSha('target')).to.equal(
      fixture.git('rev-parse', 'target')
    );
  });

  it('reports a real gh lookup failure on stderr before any push or PR mutation', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    failPrLookups(fixture);
    const result = invoke(fixture, ['submit', '--quiet']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('controlled gh lookup failure');
    expect(observe(fixture)).to.deep.equal(before);
  });

  it('reports a real pre-push hook failure while retaining committed work and remote PR state', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nprintf "controlled push hook failure\\n" >&2\nexit 1\n'
    );
    fs.chmodSync(hook, 0o755);
    const result = invoke(fixture, ['submit', '--quiet', '--publish']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('controlled push hook failure');
    expect(observe(fixture)).to.deep.equal(before);
  });

  it('rejects empty reviewer input on explicit-interactive pipes before partial field writes, push or PR mutations', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    const result = invoke(fixture, [
      'submit',
      '--interactive',
      '--reviewers=',
      '--edit',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('reviewer');
    expect(observe(fixture)).to.deep.equal(before);
    expect(
      fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
    ).to.equal(false);
  });

  it('cancels a real terminal title prompt without pushing or invoking the editor', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    editor(fixture, 'not applied');
    const result = terminal(
      fixture,
      ['submit', '--interactive', '--edit', '--publish'],
      [{ prompt: 'Title', input: '\u0003' }]
    );
    expect(result.status, result.output).to.equal(1);
    expect(fs.existsSync(path.join(fixture.root, 'editor.jsonl'))).to.equal(
      false
    );
    expect(observe(fixture)).to.deep.equal(before);
  });
  it('keeps quiet dry-run data silent without editor, push or PR mutations', () => {
    fixture.branch('target', 'main');
    const before = observe(fixture);
    editor(fixture, 'not applied');
    const result = invoke(fixture, [
      'submit',
      '--quiet',
      '--interactive',
      '--dry-run',
      '--select',
      '--confirm',
      '--edit',
    ]);
    expect(result).to.deep.equal({ status: 0, stdout: '', stderr: '' });
    expect(observe(fixture)).to.deep.equal(before);
    expect(fs.existsSync(path.join(fixture.root, 'editor.jsonl'))).to.equal(
      false
    );
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
  });

  it('skips multiple optional templates without injecting commit messages when that preference is disabled', () => {
    fixture.branch('target', 'main');
    fixture.git(
      'commit',
      '--amend',
      '-m',
      'Topic',
      '-m',
      'EXCLUDED COMMIT BODY'
    );
    const templates = path.join(
      fixture.repo,
      '.github',
      'PULL_REQUEST_TEMPLATE'
    );
    fs.mkdirSync(templates, { recursive: true });
    fs.writeFileSync(
      path.join(templates, 'first.md'),
      'FIRST OPTIONAL TEMPLATE'
    );
    fs.writeFileSync(
      path.join(templates, 'second.md'),
      'SECOND OPTIONAL TEMPLATE'
    );
    fs.writeFileSync(
      fixture.env.GRAPHITE_USER_CONFIG_PATH ?? '',
      JSON.stringify({ tips: false, submitIncludeCommitMessages: false })
    );
    const result = invoke(fixture, ['submit', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.prs()[0]?.body)
      .not.to.include('OPTIONAL TEMPLATE')
      .and.not.to.include('EXCLUDED COMMIT BODY');
    expect(fixture.prs()[0]?.body).to.include('#### PR Dependency Tree');
    expect(fixture.prs()[0]?.isDraft).to.equal(true);
    expect(fixture.remoteSha('target')).to.equal(
      fixture.git('rev-parse', 'target')
    );
  });
});
