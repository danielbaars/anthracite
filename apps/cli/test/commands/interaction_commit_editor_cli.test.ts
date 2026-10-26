import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// Public CLI subprocesses and independent Git observations are the test seam.
// eslint-disable-next-line max-lines-per-function
describe('commit and editor interaction through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.env.CH_PAGER = '';
    fixture.env.GIT_SEQUENCE_EDITOR = fixture.env.GIT_EDITOR;
  });
  afterEach(() => {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(
        path.join(evidence, `${path.basename(fixture.root)}-tools.json`),
        JSON.stringify(
          {
            cwd: fixture.repo,
            environment: Object.fromEntries(
              [
                'CH_EDITOR',
                'GIT_EDITOR',
                'GIT_SEQUENCE_EDITOR',
                'GRAPHITE_INTERACTIVE',
                'GIT_OPTIONAL_LOCKS',
                'GRAPHITE_USER_CONFIG_PATH',
                'HOME',
                'CODEX_HOME',
              ].map((name) => [name, fixture.env[name] ?? null])
            ),
            files: Object.fromEntries(
              [
                'unexpected-tool',
                'hook-called',
                'editor-call.json',
                'sequence-call.json',
                'offered',
              ].map((name) => {
                const file = path.join(fixture.root, name);
                return [
                  name,
                  fs.existsSync(file)
                    ? fs.readFileSync(file).toString('base64')
                    : null,
                ];
              })
            ),
          },
          null,
          2
        )
      );
    }
    fixture?.cleanup();
  });

  function messageBytes(name: string): Buffer {
    const commit = execFileSync('git', ['cat-file', 'commit', name], {
      cwd: fixture.repo,
      env: { ...fixture.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return commit.subarray(commit.indexOf(Buffer.from('\n\n')) + 2);
  }

  function work(staged = false): void {
    fs.writeFileSync(path.join(fixture.repo, 'new.txt'), 'selected work\n');
    if (staged) fixture.git(['add', 'new.txt']);
    fixture.git(['update-index', '--refresh']);
  }

  function preserved(): Record<string, unknown> {
    const snapshot = fixture.inspectionSnapshot();
    // Context/cache lifecycle is permitted; refs, index, work and tracking aren't.
    return {
      head: snapshot.head,
      branch: snapshot.branch,
      refs: snapshot.refs,
      index: snapshot.index,
      staging: snapshot.staging,
      status: snapshot.status,
      files: snapshot.files,
      operation: snapshot.operation,
    };
  }

  function noTools(): void {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(fs.existsSync(path.join(fixture.root, 'hook-called'))).to.equal(
      false
    );
  }

  function hook(): void {
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-commit'),
      `#!/bin/sh\nprintf called > '${fixture.root}/hook-called'\n`,
      { mode: 0o755 }
    );
  }

  it('refuses a missing create message before checkout, staging or hook', () => {
    work(true);
    hook();
    const before = preserved();
    const result = fixture.run(['create', 'created', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('commit message');
    expect(preserved()).to.deep.equal(before);
    noTools();
  });
  for (const args of [
    ['create', 'created', '--all', '--quiet'],
    ['create', 'created', '--onto', 'other', '--all', '--no-interactive'],
    ['create', 'created', '--message', '   ', '--all', '--no-interactive'],
  ])
    it(`preflights new create work: ${args.join(' ')}`, () => {
      work();
      hook();
      const before = preserved();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('commit message');
      expect(preserved()).to.deep.equal(before);
      noTools();
    });

  it('refuses a missing modify-commit message before staging or hook', () => {
    work();
    hook();
    const before = preserved();
    const result = fixture.run(['m', '--commit', '--all', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('commit message');
    expect(preserved()).to.deep.equal(before);
    noTools();
  });

  it('amends by default without an editor and retains the exact message and descendants', () => {
    fixture.git([
      'commit',
      '--amend',
      '-m',
      'First subject\n\nLiteral body with spaces  ',
    ]);
    fixture.ok(['restack', '--upstack']);
    const message = messageBytes('base');
    const oldChild = fixture.git(['rev-parse', 'child']);
    work(true);
    const result = fixture.run(['modify', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(messageBytes('base')).to.deep.equal(message);
    expect(fixture.git(['show', 'base:new.txt'])).to.equal('selected work');
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(oldChild);
    expect(fixture.git(['merge-base', 'base', 'child'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
    noTools();
  });

  it('squashes by default without an editor using the first commit message and restacks', () => {
    const first = messageBytes('base');
    fixture.commit('second');
    fixture.ok(['restack', '--upstack']);
    const tree = fixture.git(['rev-parse', 'base^{tree}']);
    const result = fixture.run(['sq', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(messageBytes('base')).to.deep.equal(first);
    expect(fixture.git(['rev-list', '--count', 'main..base'])).to.equal('1');
    expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(tree);
    expect(fixture.git(['merge-base', 'base', 'child'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    noTools();
  });

  for (const args of [
    ['modify', '--edit', '--all', '--no-interactive'],
    ['sq', '--edit', '--quiet'],
  ])
    it(`refuses a necessary explicit editor before mutations: ${args.join(
      ' '
    )}`, () => {
      if (args[0] === 'sq') fixture.commit('second');
      else work();
      hook();
      const before = preserved();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('editor');
      expect(preserved()).to.deep.equal(before);
      noTools();
    });

  for (const args of [
    ['create', 'patched', '--patch', '--message', 'patch', '--no-interactive'],
    [
      'create',
      'patched',
      '--onto',
      'other',
      '--patch',
      '--message',
      'patch',
      '--interactive',
    ],
    ['modify', '--commit', '--patch', '--message', 'patch', '--quiet'],
    ['modify', '--patch', '--no-interactive'],
  ])
    it(`refuses required patch input before writes: ${args.join(' ')}`, () => {
      fs.writeFileSync(
        path.join(fixture.repo, 'base.txt'),
        'changed tracked work'
      );
      fixture.git(['status', '--porcelain']);
      hook();
      const before = preserved();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('patch');
      expect(preserved()).to.deep.equal(before);
      noTools();
    });

  it('creates a named empty branch without an editor at quiet', () => {
    const before = fixture.git(['rev-parse', 'base']);
    const result = fixture.run(['c', 'empty-policy', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty-policy');
    expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(before);
    expect(fixture.run(['parent']).stdout).to.equal('base\n');
    noTools();
  });

  for (const args of [
    ['create', 'made', '--message', 'literal --interactive=invalid', '--quiet'],
    [
      'create',
      'made',
      '--message',
      'literal --quiet body',
      '--all',
      '--patch',
      '--quiet',
    ],
    ['modify', '--commit', '--message', 'new commit', '--all', '--quiet'],
  ])
    it(`performs an explicit new commit without editor: ${args.join(
      ' '
    )}`, () => {
      work(!args.includes('--all'));
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['show', 'HEAD:new.txt'])).to.equal('selected work');
      expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(
        args[args.indexOf('--message') + 1]
      );
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      noTools();
    });

  for (const args of [
    ['modify', '--edit', '--no-edit', '--all', '--quiet'],
    ['modify', '--edit', '--message', 'replacement', '--all', '--quiet'],
    ['sq', '--edit', '--no-edit', '--quiet'],
    ['sq', '--edit', '--message', 'replacement', '--quiet'],
  ])
    it(`preserves no-edit and message precedence: ${args.join(' ')}`, () => {
      if (args[0] === 'sq') fixture.commit('second');
      else work();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%B'])).to.equal(
        args.includes('--message') ? 'replacement' : 'base'
      );
      noTools();
    });
  it('creates onto the selected parent in cwd B while preserving departure repository A', () => {
    const target = new RelationCliFixture();
    try {
      fs.writeFileSync(path.join(target.repo, 'new.txt'), 'cwd selected work');
      target.git(['add', 'new.txt']);
      const beforeA = preserved();
      const parent = target.git(['rev-parse', 'other']);
      const result = fixture.run([
        '--cwd',
        target.repo,
        'create',
        'cwd-made',
        '--onto',
        'other',
        '--message',
        'cwd message',
        '--quiet',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(target.git(['rev-parse', 'HEAD^'])).to.equal(parent);
      expect(target.git(['show', 'HEAD:new.txt'])).to.equal(
        'cwd selected work'
      );
      expect(target.git(['show', 'HEAD:other.txt'])).to.equal('other');
      expect(target.run(['parent']).stdout).to.equal('other\n');
      expect(preserved()).to.deep.equal(beforeA);
      noTools();
    } finally {
      target.cleanup();
    }
  });

  it('preserves staging and work after an explicitly allowed hook fails', () => {
    fixture.git(['switch', 'tip']);
    work();
    const marker = path.join(fixture.root, 'hook-called');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/pre-commit'),
      `#!/bin/sh\nprintf called > '${marker}'\nprintf hook-work > hook-extra.txt\nexit 23\n`,
      { mode: 0o755 }
    );
    const refs = fixture.refs();
    const result = fixture.run([
      'modify',
      '--commit',
      '--all',
      '--message',
      'allowed',
      '--quiet',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['show', ':new.txt'])).to.equal('selected work');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'hook-extra.txt'), 'utf8')
    ).to.equal('hook-work');
    expect(fs.readFileSync(marker, 'utf8')).to.equal('called');
  });
  for (const args of [
    [
      'create',
      'all-patch',
      '--all',
      '--patch',
      '--message',
      'all work',
      '--quiet',
    ],
    [
      'modify',
      '--commit',
      '--all',
      '--patch',
      '--message',
      'all work',
      '--quiet',
    ],
    ['modify', '--all', '--patch', '--quiet'],
  ])
    it(`keeps all precedence over an unnecessary patch UI: ${args.join(
      ' '
    )}`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'all tracked work');
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['show', 'HEAD:base.txt'])).to.equal(
        'all tracked work'
      );
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      noTools();
    });

  it('performs deterministic move and fold at quiet without altering unrelated branches', () => {
    fixture.git(['switch', 'tip']);
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const moved = fixture.run(['move', '--onto', 'other', '--only', '--quiet']);
    expect(moved.status, moved.stdout + moved.stderr).to.equal(0);
    expect(fixture.run(['parent']).stdout).to.equal('other\n');
    expect(fixture.git(['log', '--format=%s', 'other..tip'])).to.equal('tip');
    const folded = fixture.run(['fold', '--quiet']);
    expect(folded.status, folded.stdout + folded.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..other'])
    ).to.equal('other\ntip');
    expect(fixture.git(['show', 'other:tip.txt'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    noTools();
  });
});
