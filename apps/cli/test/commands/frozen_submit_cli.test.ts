import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { FrozenSubmitCliFixture } from '../lib/fixtures/frozen_submit_cli';

function terminal(
  fixture: FrozenSubmitCliFixture,
  command: readonly string[],
  options: Parameters<typeof runCliInPty>[1]
): ReturnType<typeof runCliInPty> {
  const before = fixture.observe();
  const result = runCliInPty(command, options);
  fs.appendFileSync(
    path.join(fixture.root, 'cli.jsonl'),
    JSON.stringify({
      command,
      cwd: options.cwd,
      responses: options.responses,
      before,
      after: fixture.observe(),
      pty: true,
      ...result,
    }) + '\n'
  );
  return result;
}

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('frozen publication through the public CLI', function () {
  this.timeout(120000);
  let fixture: FrozenSubmitCliFixture;
  beforeEach(() => {
    fixture = new FrozenSubmitCliFixture();
  });
  afterEach(function () {
    fixture.saveEvidence(this.currentTest?.fullTitle());
    fixture.cleanup();
  });

  it('treats all frozen submit targets as a successful explained no-op before publication preparation', () => {
    fixture.branch('base', 'main');
    fixture.succeed('freeze');
    const before = fixture.observe();
    const result = fixture.run([
      'submit',
      '--no-interactive',
      '--force',
      '--always',
      '--publish',
      '--reviewers',
      'alice',
      '--edit',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Skipping frozen branch base')
      .and.to.include('No editable branches to submit');
    expect(fixture.observe()).to.deep.equal(before);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
    expect(fixture.remoteSha('base')).to.equal('');
  });
  it('publishes an editable child on an existing frozen base while preserving protected and outside-scope PRs', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit', '--draft');
    fixture.branch('other', 'main');
    fixture.succeed('submit', '--publish');
    fixture.succeed('freeze', 'base');
    fixture.branch('child', 'base');
    const child = fixture.git('rev-parse', 'child');
    const base = fixture.git('rev-parse', 'base');
    const baseMetadata = fixture.git('rev-parse', 'refs/branch-metadata/base');
    const protectedPrs = fixture.prs();
    fixture.clearCalls();
    const result = fixture.run([
      'ss',
      '--no-interactive',
      '--force',
      '--always',
      '--publish',
      '--reviewers',
      'alice,bob',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Skipping frozen branch base');
    expect(fixture.remoteSha('base')).to.equal(base);
    expect(fixture.remoteSha('child')).to.equal(child);
    expect(fixture.git('rev-parse', 'child^')).to.equal(base);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/base')).to.equal(
      baseMetadata
    );
    expect(
      fixture.prs().filter((pr) => pr.headRefName !== 'child')
    ).to.deep.equal(protectedPrs);
    expect(fixture.prs().find((pr) => pr.headRefName === 'child')).to.include({
      headRefName: 'child',
      baseRefName: 'base',
      isDraft: false,
    });
    expect(
      fixture.prs().find((pr) => pr.headRefName === 'child')?.reviewRequests
    ).to.deep.equal([{ login: 'alice' }, { login: 'bob' }]);
    expect(
      fixture
        .calls()
        .filter((call) => ['create', 'edit', 'ready'].includes(call[1]))
        .every((call) => !['base', '1', 'other', '2'].includes(call[2]))
    ).to.equal(true);
    expect(fixture.succeed('info', 'base')).to.include('(frozen)');
  });

  it('rechecks a branch frozen by its real PR editor before saving fields or publishing', () => {
    fixture.branch('target', 'main');
    const head = fixture.git('rev-parse', 'HEAD');
    const editor = path.join(fixture.root, 'editor.js');
    fs.writeFileSync(
      editor,
      `const fs = require('fs');
const cp = require('child_process');
const result = cp.spawnSync(${JSON.stringify(
        getTestCliCommand(['freeze', 'target', '--no-interactive'])[0]
      )}, ${JSON.stringify(
        getTestCliCommand(['freeze', 'target', '--no-interactive']).slice(1)
      )}, {stdio: 'inherit'});
if (result.status !== 0) throw new Error('freeze failed');
fs.writeFileSync(process.argv[2], 'FROZEN EDITOR BODY');
fs.appendFileSync(${JSON.stringify(
        path.join(fixture.root, 'editor.jsonl')
      )}, 'editor completed\\n');`
    );
    fixture.env.CH_EDITOR = `'${process.execPath}' '${editor}'`;
    const result = terminal(
      fixture,
      getTestCliCommand([
        'submit',
        '--interactive',
        '--edit',
        '--publish',
        '--reviewers',
        'alice',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Title', input: 'Changed title\r' }],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('frozen branch target');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.remoteSha('target')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.git('cat-file', '-p', 'refs/branch-metadata/target'))
      .not.to.include('FROZEN EDITOR BODY')
      .and.not.to.include('Changed title');
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
  });

  it('rechecks after the original configured pre-push hook freezes the branch before any remote ref publication', () => {
    fixture.branch('target', 'main');
    const head = fixture.git('rev-parse', 'HEAD');
    const hooks = path.join(fixture.root, 'original hooks');
    fs.mkdirSync(hooks);
    fixture.git('config', 'core.hooksPath', hooks);
    const hook = path.join(hooks, 'pre-push');
    const freeze = getTestCliCommand(['freeze', 'target', '--no-interactive']);
    fs.writeFileSync(
      hook,
      `#!/bin/sh
cat > '${path.join(fixture.root, 'push-input')}'
printf '%s\\n' "$@" > '${path.join(fixture.root, 'push-args')}'
${freeze.map((part) => "'" + part.replace(/'/g, "'\\''") + "'").join(' ')}
`
    );
    fs.chmodSync(hook, 0o755);
    const result = fixture.run([
      's',
      '--no-interactive',
      '--force',
      '--always',
      '--draft',
      '--reviewers',
      'alice',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch target');
    expect(fixture.remoteSha('target')).to.equal('');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fs.readFileSync(path.join(fixture.root, 'push-input'), 'utf8')
    ).to.include(`refs/heads/target ${head} refs/heads/target`);
    expect(
      fs.readFileSync(path.join(fixture.root, 'push-args'), 'utf8')
    ).to.equal(`origin\n${fixture.remote}\n`);
    expect(fixture.git('config', '--get', 'core.hooksPath')).to.equal(hooks);
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
  });

  it('rechecks after external PR discovery before creating a PR for a newly frozen head', () => {
    fixture.branch('target', 'main');
    const head = fixture.git('rev-parse', 'target');
    fixture.freezeAfterGhView(
      'headRefName,url,number,baseRefName,body,isDraft',
      'target'
    );
    const result = fixture.run([
      'submit',
      '--no-interactive',
      '--publish',
      '--reviewers',
      'alice',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr)
      .to.include('frozen branch target')
      .and.to.include('was already pushed');
    expect(fixture.remoteSha('target')).to.equal(head);
    expect(fixture.prs()).to.deep.equal([]);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
  });

  it('rechecks after external reviewer discovery before requesting reviews on a newly frozen PR', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--draft');
    const prs = fixture.prs();
    const remote = fixture.remoteSha('target');
    fixture.clearCalls();
    fixture.freezeAfterGhView(
      'headRefName,number,reviewRequests,reviews',
      'target'
    );
    const result = fixture.run([
      'submit',
      '--no-interactive',
      '--reviewers',
      'alice',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch target');
    expect(fixture.remoteSha('target')).to.equal(remote);
    expect(fixture.prs()).to.deep.equal(prs);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
  });

  it('preserves a frozen recorded base before ordinary submit context can repair a skipped target', () => {
    fixture.branch('base', 'main');
    fixture.branch('target', 'base');
    fixture.succeed('freeze');
    const metadata: unknown = JSON.parse(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/target')
    );
    if (typeof metadata !== 'object' || metadata === null)
      throw new Error('Invalid fixture metadata');
    const damaged = path.join(fixture.root, 'old-base.json');
    fs.writeFileSync(
      damaged,
      JSON.stringify({
        ...metadata,
        parentBranchRevision: fixture.git('rev-parse', 'main'),
      })
    );
    fixture.git(
      'update-ref',
      'refs/branch-metadata/target',
      fixture.git('hash-object', '-w', damaged)
    );
    const before = fixture.observe();
    const result = fixture.run(['submit', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('No editable branches to submit');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
    expect(fixture.git('rev-parse', 'refs/branch-metadata/target')).to.equal(
      before.refs
        .split('\n')
        .find((line) => line.startsWith('refs/branch-metadata/target '))
        ?.split(' ')[1]
    );
  });

  for (const scope of [
    {
      name: 'submit downstack',
      args: ['submit', '--branch', 'child'],
      heads: ['child'],
    },
    {
      name: 's explicit stack',
      args: ['s', '--stack=true'],
      heads: ['child', 'tip'],
    },
    { name: 'ss default stack', args: ['ss'], heads: ['child', 'tip'] },
    {
      name: 'ss false stack',
      args: ['ss', '--branch', 'child', '--stack=false'],
      heads: ['child'],
    },
  ]) {
    it(`preserves frozen base while ${scope.name} publishes precisely its editable selection`, () => {
      fixture.branch('base', 'main');
      fixture.succeed('submit', '--publish');
      fixture.succeed('freeze', 'base');
      fixture.branch('child', 'base');
      fixture.branch('tip', 'child');
      fixture.git('checkout', 'base');
      const basePr = fixture.prs()[0];
      const base = fixture.git('rev-parse', 'base');
      const result = fixture.run([
        ...scope.args,
        '--no-interactive',
        '--draft',
        '--reviewers',
        'alice',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.prs()[0]).to.deep.equal(basePr);
      expect(
        fixture
          .prs()
          .slice(1)
          .map((pr) => pr.headRefName)
      ).to.deep.equal(scope.heads);
      for (const head of scope.heads) {
        expect(fixture.remoteSha(head)).to.equal(
          fixture.git('rev-parse', head)
        );
        expect(fixture.prs().find((pr) => pr.headRefName === head)).to.include({
          baseRefName: head === 'child' ? 'base' : 'child',
          isDraft: true,
        });
        expect(
          fixture.prs().find((pr) => pr.headRefName === head)?.reviewRequests
        ).to.deep.equal([{ login: 'alice' }]);
      }
      if (!scope.heads.includes('tip'))
        expect(fixture.remoteSha('tip')).to.equal('');
      expect(fixture.remoteSha('base')).to.equal(base);
      expect(fixture.git('branch', '--show-current')).to.equal('base');
      expect(fixture.git('rev-parse', 'child^')).to.equal(base);
      expect(fixture.succeed('info', 'base')).to.include('(frozen)');
    });
  }

  for (const alias of ['submit', 's', 'ss']) {
    it(`${alias} cannot override frozen existing PR protection with force always draft reviewers edit or no-verify`, () => {
      fixture.branch('target', 'main');
      fixture.succeed('submit', '--publish');
      fixture.succeed('freeze');
      fixture.commit('direct-git-is-outside-policy');
      const before = fixture.observe();
      fixture.clearCalls();
      const result = fixture.run([
        alias,
        '--no-interactive',
        '--force',
        '--always',
        '--draft',
        '--reviewers',
        'alice',
        '--edit',
        '--no-verify',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('Skipping frozen branch target')
        .and.to.include('No editable branches to submit');
      expect(fixture.observe()).to.deep.equal(before);
      expect(
        fixture
          .calls()
          .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
      ).to.equal(false);
    });
  }

  it('dry-run filters the same mixed stack even with always and makes no field remote or PR writes', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit', '--draft');
    fixture.succeed('freeze');
    fixture.branch('child', 'base');
    const before = fixture.observe();
    const result = fixture.run([
      'ss',
      '--no-interactive',
      '--dry-run',
      '--always',
      '--publish',
      '--reviewers',
      'alice',
      '--select',
      '--confirm',
      '--edit',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Skipping frozen branch base')
      .and.to.include('child (Create)')
      .and.to.include('Dry run complete');
    expect(result.stdout)
      .not.to.include('base (Mark')
      .and.not.to.include('Enter info');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('retains parent remote-match validation instead of silently pushing an omitted frozen parent', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit', '--publish');
    fixture.succeed('freeze');
    fixture.commit('external-base-update');
    fixture.branch('child', 'base');
    const before = fixture.observe();
    const result = fixture.run([
      'ss',
      '--no-interactive',
      '--force',
      '--always',
      '--publish',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('base does not match its parent remotely');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fixture.remoteSha('child')).to.equal('');
  });

  it('skips newly frozen later selection items before prompting and completes an all-frozen no-op', () => {
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    const head = fixture.git('rev-parse', 'HEAD');
    const result = terminal(
      fixture,
      getTestCliCommand([
        'ss',
        '--interactive',
        '--select',
        '--confirm',
        '--no-edit',
        '--publish',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Would you like to submit base?',
            input: 'y\r',
            beforeInput: getTestCliCommand([
              'freeze',
              'child',
              '--no-interactive',
            ]),
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .not.to.include('Would you like to submit child?')
      .and.not.to.include('Continue with this submit operation?');
    expect(result.output).to.include('No editable branches to submit');
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.remoteSha('base')).to.equal('');
    expect(fixture.remoteSha('child')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
  });

  it('documents frozen skips and existing bases in help and offers pure explicit branch completion for submit s and ss', () => {
    fixture.branch('base', 'main');
    fixture.succeed('freeze');
    fixture.branch('child', 'base');
    const before = fixture.observe();
    for (const alias of ['submit', 's', 'ss']) {
      const help = fixture.run([alias, '--help']);
      expect(help.status).to.equal(0);
      expect(help.stdout.replace(/\s+/g, ' '))
        .to.include('Frozen branches are skipped')
        .and.to.include('existing base');
      const completed = fixture.run([
        '--get-yargs-completions',
        'an',
        alias,
        '--branch',
        'an',
      ]);
      expect(completed.status, completed.stderr).to.equal(0);
      expect(completed.stdout.trim().split('\n')).to.include('child');
    }
    const roots = fixture.run(['--get-yargs-completions', 'an', '']);
    expect(roots.stdout).not.to.include('internal-push-guard');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('finishes all-frozen terminal selection edit and reviewer requests without invoking any UI or editor', () => {
    fixture.branch('target', 'main');
    fixture.succeed('freeze');
    const before = fixture.observe();
    const editor = path.join(fixture.root, 'editor.js');
    fs.writeFileSync(
      editor,
      `require('fs').writeFileSync(${JSON.stringify(
        path.join(fixture.root, 'editor.jsonl')
      )}, 'must not run'); throw new Error('unexpected editor');`
    );
    fixture.env.CH_EDITOR = `'${process.execPath}' '${editor}'`;
    const result = terminal(
      fixture,
      getTestCliCommand([
        'ss',
        '--interactive',
        '--select',
        '--confirm',
        '--edit',
        '--reviewers',
        '--publish',
      ]),
      { cwd: fixture.repo, env: fixture.env }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('No editable branches to submit');
    expect(result.output)
      .not.to.include('Would you like')
      .and.not.to.include('Title')
      .and.not.to.include('Reviewers (')
      .and.not.to.include('Continue with');
    expect(fs.existsSync(path.join(fixture.root, 'editor.jsonl'))).to.equal(
      false
    );
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('preserves selection and confirmation for the remaining editable child in a real terminal', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit', '--publish');
    fixture.succeed('freeze');
    fixture.branch('child', 'base');
    const basePr = fixture.prs()[0];
    const result = terminal(
      fixture,
      getTestCliCommand([
        'ss',
        '--interactive',
        '--select',
        '--confirm',
        '--no-edit',
        '--publish',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Would you like to submit child?', input: 'y\r' },
          { prompt: 'Continue with this submit operation?', input: 'y\r' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Would you like to submit base?');
    expect(fixture.prs()[0]).to.deep.equal(basePr);
    expect(fixture.prs()[1]).to.include({
      headRefName: 'child',
      baseRefName: 'base',
      isDraft: false,
    });
    expect(fixture.remoteSha('child')).to.equal(
      fixture.git('rev-parse', 'child')
    );
  });

  it('rechecks status changed at confirmation before the first real push', () => {
    fixture.branch('target', 'main');
    const head = fixture.git('rev-parse', 'HEAD');
    const result = terminal(
      fixture,
      getTestCliCommand([
        's',
        '--interactive',
        '--confirm',
        '--no-edit',
        '--publish',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'Continue with this submit operation?',
            input: 'y\r',
            beforeInput: getTestCliCommand([
              'freeze',
              'target',
              '--no-interactive',
            ]),
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('frozen branch target');
    expect(fixture.remoteSha('target')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
  });

  it('retains no-verify hook skipping for a real editable push while still filtering a frozen follow-up', () => {
    fixture.branch('target', 'main');
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nprintf 'must not run' > '${path.join(
        fixture.root,
        'hook-ran'
      )}'\nexit 19\n`
    );
    fs.chmodSync(hook, 0o755);
    const result = fixture.run([
      'submit',
      '--no-interactive',
      '--no-verify',
      '--publish',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fs.existsSync(path.join(fixture.root, 'hook-ran'))).to.equal(false);
    expect(fixture.prs()[0]).to.include({
      headRefName: 'target',
      baseRefName: 'main',
      isDraft: false,
    });
    expect(fixture.remoteSha('target')).to.equal(
      fixture.git('rev-parse', 'target')
    );
    fixture.succeed('freeze');
    fixture.commit('direct-git-after-freeze');
    const before = fixture.observe();
    const skipped = fixture.run([
      's',
      '--no-interactive',
      '--no-verify',
      '--force',
      '--always',
      '--publish',
    ]);
    expect(skipped.status, skipped.stdout + skipped.stderr).to.equal(0);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('keeps existing argument and branch validation errors visible for frozen selections including quiet', () => {
    fixture.branch('target', 'main');
    fixture.succeed('freeze');
    const before = fixture.observe();
    for (const flags of [
      ['--draft', '--publish'],
      ['--reviewers='],
      ['--branch', 'missing-target'],
      ['unexpected-positional'],
    ]) {
      const result = fixture.run([
        'submit',
        '--quiet',
        '--no-interactive',
        ...flags,
      ]);
      expect(result.status, JSON.stringify(flags)).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(fixture.observe()).to.deep.equal(before);
    }
  });

  it('keeps update-only selection after skipping the frozen parent and does not create or push a new child', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit', '--draft');
    fixture.succeed('freeze');
    fixture.branch('child', 'base');
    const before = fixture.observe();
    const result = fixture.run([
      'ss',
      '--no-interactive',
      '--update-only',
      '--publish',
      '--reviewers',
      'alice',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Skipping frozen branch base')
      .and.to.include('child (No-op)');
    expect(fixture.observe()).to.deep.equal(before);
  });

  for (const transition of ['base', 'publish']) {
    it(`blocks the ${transition} PR write after external discovery freezes an existing selected PR`, () => {
      fixture.branch('target', 'main');
      fixture.succeed('submit', '--draft');
      if (transition === 'base')
        fixture.setPrs(
          fixture.prs().map((pr) => ({ ...pr, baseRefName: 'old-base' }))
        );
      const prs = fixture.prs();
      fixture.clearCalls();
      fixture.freezeAfterGhView(
        'headRefName,url,number,baseRefName,body,isDraft',
        'target'
      );
      const result = fixture.run(['s', '--no-interactive', '--publish']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('frozen branch target');
      expect(fixture.prs()).to.deep.equal(prs);
      expect(
        fixture
          .calls()
          .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
      ).to.equal(false);
    });
  }

  it('publishes quietly from a Unicode spaced linked worktree using cwd while preserving both dirty worktrees', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit', '--draft');
    fixture.succeed('freeze');
    fixture.branch('child', 'base');
    fixture.git('checkout', 'base');
    const linked = path.join(fixture.root, 'linked café worktree');
    fixture.git('worktree', 'add', '--detach', linked, 'main');
    fs.writeFileSync(path.join(linked, 'staged.txt'), 'linked staged bytes');
    fixture.git('-C', linked, 'add', 'staged.txt');
    fs.writeFileSync(path.join(linked, 'staged.txt'), 'linked dirty bytes');
    fs.writeFileSync(
      path.join(linked, 'untracked.txt'),
      'linked untracked bytes'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.txt'),
      'original worktree bytes'
    );
    const linkedIndex = fixture.git(
      '-C',
      linked,
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'index'
    );
    const indexBefore = fs.readFileSync(linkedIndex);
    const baseBefore = fixture.git('rev-parse', 'base');
    const baseMetadata = fixture.git('rev-parse', 'refs/branch-metadata/base');
    const result = fixture.run(
      [
        '--cwd',
        linked,
        's',
        '--branch',
        'child',
        '--quiet',
        '--interactive',
        '--edit',
        '--select',
        '--confirm',
        '--publish',
        '--reviewers',
        'alice',
      ],
      fixture.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(fixture.remoteSha('child')).to.equal(
      fixture.git('rev-parse', 'child')
    );
    expect(fixture.prs().find((pr) => pr.headRefName === 'child')).to.include({
      headRefName: 'child',
      baseRefName: 'base',
      isDraft: false,
    });
    expect(fixture.git('rev-parse', 'base')).to.equal(baseBefore);
    expect(fixture.git('rev-parse', 'refs/branch-metadata/base')).to.equal(
      baseMetadata
    );
    expect(fs.readFileSync(linkedIndex).equals(indexBefore)).to.equal(true);
    expect(fs.readFileSync(path.join(linked, 'staged.txt'), 'utf8')).to.equal(
      'linked dirty bytes'
    );
    expect(
      fs.readFileSync(path.join(linked, 'untracked.txt'), 'utf8')
    ).to.equal('linked untracked bytes');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
    ).to.equal('original worktree bytes');
    expect(fixture.git('-C', linked, 'rev-parse', 'HEAD')).to.equal(
      fixture.git('rev-parse', 'main')
    );
    expect(fixture.git('branch', '--show-current')).to.equal('base');
    const before = fixture.observe();
    const skipped = fixture.run(
      [
        's',
        '--cwd',
        path.relative(fixture.root, fixture.repo),
        '--branch',
        'base',
        '--quiet',
        '--interactive',
        '--edit',
        '--select',
        '--confirm',
        '--publish',
      ],
      fixture.root
    );
    expect(skipped).to.deep.equal({ status: 0, stdout: '', stderr: '' });
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('does not start a dangling remote discovery promise when every selected branch is frozen', () => {
    fixture.branch('target', 'main');
    fixture.succeed('freeze');
    fixture.git(
      'remote',
      'set-url',
      'origin',
      path.join(fixture.root, 'missing-remote.git')
    );
    const before = fixture.observe();
    fixture.clearCalls();
    const result = fixture.run([
      'ss',
      '--no-interactive',
      '--dry-run',
      '--publish',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Skipping frozen branch target')
      .and.to.include('No editable branches to submit');
    expect(result.stderr).to.equal('');
    expect(fixture.calls()).to.deep.equal([]);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('forwards original pre-push effects input arguments and inherited hook configuration on an actual editable publication', () => {
    fixture.branch('target', 'main');
    const head = fixture.git('rev-parse', 'target');
    const hooks = path.join(fixture.root, 'forwarded hooks');
    fs.mkdirSync(hooks);
    fixture.git('config', 'core.hooksPath', hooks);
    const hook = path.join(hooks, 'pre-push');
    fs.writeFileSync(
      hook,
      `#!/bin/sh
cat > '${path.join(fixture.root, 'forwarded-input')}'
printf '%s\\n' "$@" > '${path.join(fixture.root, 'forwarded-args')}'
git config --get core.hooksPath > '${path.join(
        fixture.root,
        'forwarded-hooks'
      )}'
printf 'real original hook work' > hook-work.txt
`
    );
    fs.chmodSync(hook, 0o755);
    const result = fixture.run(['submit', '--no-interactive', '--publish']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.remoteSha('target')).to.equal(head);
    expect(fixture.prs()[0]).to.include({
      headRefName: 'target',
      baseRefName: 'main',
      isDraft: false,
    });
    expect(
      fs.readFileSync(path.join(fixture.root, 'forwarded-input'), 'utf8')
    ).to.include(`refs/heads/target ${head} refs/heads/target`);
    expect(
      fs.readFileSync(path.join(fixture.root, 'forwarded-args'), 'utf8')
    ).to.equal(`origin\n${fixture.remote}\n`);
    expect(
      fs.readFileSync(path.join(fixture.root, 'forwarded-hooks'), 'utf8').trim()
    ).to.equal(hooks);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-work.txt'), 'utf8')
    ).to.equal('real original hook work');
    expect(fixture.git('config', '--get', 'core.hooksPath')).to.equal(hooks);
  });
  it('rechecks a freeze during template selection before invoking the next PR editor', () => {
    fixture.branch('target', 'main');
    const templates = path.join(
      fixture.repo,
      '.github',
      'PULL_REQUEST_TEMPLATE'
    );
    fs.mkdirSync(templates, { recursive: true });
    fs.writeFileSync(path.join(templates, 'one.md'), 'FIRST TEMPLATE');
    fs.writeFileSync(path.join(templates, 'two.md'), 'SECOND TEMPLATE');
    const script = path.join(fixture.root, 'editor.js');
    fs.writeFileSync(
      script,
      `require('fs').writeFileSync(${JSON.stringify(
        path.join(fixture.root, 'editor.jsonl')
      )}, 'unexpected editor');`
    );
    fixture.env.CH_EDITOR = `'${process.execPath}' '${script}'`;
    const head = fixture.git('rev-parse', 'HEAD');
    const result = terminal(
      fixture,
      getTestCliCommand(['submit', '--interactive', '--edit', '--publish']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Title', input: '\r' },
          {
            prompt: 'Body Template',
            input: '\r',
            beforeInput: getTestCliCommand([
              'freeze',
              'target',
              '--no-interactive',
            ]),
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('frozen branch target');
    expect(fs.existsSync(path.join(fixture.root, 'editor.jsonl'))).to.equal(
      false
    );
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(head);
    expect(fixture.remoteSha('target')).to.equal('');
    expect(fixture.prs()).to.deep.equal([]);
  });

  it('preserves a freeze performed during allowed PR-info discovery instead of wiping protection with a cached upsert', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--draft');
    const prs = fixture.prs();
    const remote = fixture.remoteSha('target');
    fixture.clearCalls();
    fixture.freezeAfterGhView(
      'state,url,title,body,number,headRefName,baseRefName,reviewDecision,isDraft',
      'target'
    );
    const result = fixture.run([
      'submit',
      '--no-interactive',
      '--always',
      '--publish',
      '--reviewers',
      'alice',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('frozen branch target');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.remoteSha('target')).to.equal(remote);
    expect(
      fixture
        .calls()
        .some((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.equal(false);
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
  });

  it('rechecks a freeze from closed-PR discovery before offering a replacement PR prompt', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--draft');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    const prs = fixture.prs();
    fixture.freezeAfterGhView(
      'state,url,title,body,number,headRefName,baseRefName,reviewDecision,isDraft',
      'target'
    );
    const result = terminal(
      fixture,
      getTestCliCommand(['submit', '--interactive', '--edit', '--publish']),
      { cwd: fixture.repo, env: fixture.env }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('frozen branch target')
      .and.not.to.include('How would you like to proceed?');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.succeed('info', 'target')).to.include('(frozen)');
  });

  it('rechecks a freeze at the replacement-PR choice before clearing the existing PR association', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--draft');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    const prs = fixture.prs();
    const remote = fixture.remoteSha('target');
    const result = terminal(
      fixture,
      getTestCliCommand(['submit', '--interactive', '--edit', '--publish']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          {
            prompt: 'How would you like to proceed?',
            input: '\u001b[B\r',
            beforeInput: getTestCliCommand([
              'freeze',
              'target',
              '--no-interactive',
            ]),
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output)
      .to.include('frozen branch target')
      .and.not.to.include('Enter info');
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.remoteSha('target')).to.equal(remote);
    const info = fixture.succeed('info', 'target');
    expect(info).to.include('(frozen)').and.to.include('PR #1');
  });

  it('skips frozen empty branches with closed PRs before their ordinary interactive validation', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--draft');
    fixture.succeed('freeze');
    fixture.git('reset', '--hard', 'main');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state: 'CLOSED' })));
    const before = fixture.observe();
    const result = terminal(
      fixture,
      getTestCliCommand([
        'ss',
        '--interactive',
        '--select',
        '--confirm',
        '--edit',
        '--publish',
      ]),
      { cwd: fixture.repo, env: fixture.env }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output)
      .to.include('Skipping frozen branch target')
      .and.to.include('No editable branches to submit')
      .and.not.to.include('How would you like to proceed?');
    expect(fixture.observe()).to.deep.equal(before);
  });
  it('preserves disabled user hooks with core.hooksPath=/dev/null while publishing only editable branches', () => {
    fixture.branch('target', 'main');
    fixture.git('config', 'core.hooksPath', '/dev/null');
    const head = fixture.git('rev-parse', 'target');
    const result = fixture.run([
      'submit',
      '--no-interactive',
      '--publish',
      '--reviewers',
      'alice',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.remoteSha('target')).to.equal(head);
    expect(fixture.prs()[0]).to.include({
      headRefName: 'target',
      baseRefName: 'main',
      isDraft: false,
    });
    expect(fixture.prs()[0]?.reviewRequests).to.deep.equal([
      { login: 'alice' },
    ]);
    expect(fixture.git('config', '--get', 'core.hooksPath')).to.equal(
      '/dev/null'
    );
    fixture.succeed('freeze');
    fixture.commit('direct-git-disabled-hooks');
    const before = fixture.observe();
    const skipped = fixture.run([
      'ss',
      '--no-interactive',
      '--no-verify',
      '--force',
      '--always',
      '--publish',
    ]);
    expect(skipped.status, skipped.stdout + skipped.stderr).to.equal(0);
    expect(fixture.observe()).to.deep.equal(before);
  });
});
