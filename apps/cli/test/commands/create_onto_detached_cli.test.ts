import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('detached create --onto through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const parentName of ['main', 'other']) {
    it(`creates above occupied ${parentName} without changing the other worktree`, () => {
      fixture.git(['switch', parentName]);
      fixture.git(['worktree', 'add', '--detach', fixture.linked, 'tip']);
      const { refs, ...primary } = fixture.snapshot();
      const parent = fixture.git(['rev-parse', parentName]);

      fixture.ok(
        ['create', 'new-branch', '--onto', parentName],
        fixture.linked
      );

      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal('new-branch');
      expect(fixture.git(['rev-parse', 'HEAD'], fixture.linked)).to.equal(
        parent
      );
      expect(fixture.ok(['parent'], fixture.linked)).to.equal(
        `${parentName}\n`
      );
      const { refs: afterRefs, ...afterPrimary } = fixture.snapshot();
      expect(afterPrimary).to.deep.equal(primary);
      expect(
        afterRefs
          .split('\n')
          .filter((line) => !line.startsWith('refs/heads/new-branch '))
          .join('\n')
      ).to.equal(refs);
    });
  }

  for (const all of [false, true]) {
    it(`restores the original detached commit and partial staging after a rejected commit with all ${all}`, () => {
      fixture.git(['switch', 'main']);
      fixture.git(['worktree', 'add', '--detach', fixture.linked, 'tip']);
      fixture.stage('main.txt', 'prepared version\n', fixture.linked);
      fixture.write(
        'main.txt',
        'prepared version\nunfinished addition\n',
        fixture.linked
      );
      fixture.write('loose.txt', 'untracked work', fixture.linked);
      const hooks = fixture.git(
        ['rev-parse', '--git-path', 'hooks'],
        fixture.linked
      );
      fs.writeFileSync(
        path.resolve(fixture.linked, hooks, 'pre-commit'),
        '#!/bin/sh\nexit 1\n',
        { mode: 0o755 }
      );
      const before = fixture.snapshot(fixture.linked);
      const metadata = fixture.git(['for-each-ref', 'refs/branch-metadata']);

      const result = fixture.run(
        [
          'create',
          'new-branch',
          '--onto',
          'other',
          ...(all ? ['--all'] : []),
          '-m',
          'rejected',
        ],
        fixture.linked
      );

      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(before);
      expect(fixture.git(['for-each-ref', 'refs/branch-metadata'])).to.equal(
        metadata
      );
      expect(result.stderr).not.to.include('Could not clean up');
    });
  }

  for (const insert of [false, true]) {
    it(`requires an explicit parent when detached with insert ${insert} without changing work`, () => {
      fixture.git(['switch', '--detach', 'tip']);
      const before = fixture.snapshot();
      const result = fixture.run([
        'create',
        'new-branch',
        ...(insert ? ['--insert'] : []),
      ]);
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('--onto');
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  it('uses the local parent even when fetched trunk is ahead of it', () => {
    fixture.git(['push', 'origin', 'tip:main']);
    fixture.git(['fetch', 'origin']);
    fixture.git(['switch', 'main']);
    const local = fixture.git(['rev-parse', 'main']);
    const remote = fixture.git(['rev-parse', 'origin/main']);
    expect(local).not.to.equal(remote);
    fixture.git(['worktree', 'add', '--detach', fixture.linked, 'origin/main']);
    fixture.ok(['create', 'new-branch', '--onto', 'main'], fixture.linked);
    expect(fixture.git(['rev-parse', 'HEAD'], fixture.linked)).to.equal(local);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(local);
    expect(fixture.git(['rev-parse', 'origin/main'])).to.equal(remote);
  });

  for (const parent of ['missing', 'untracked']) {
    it(`refuses ${parent} parent without modifying detached work`, () => {
      fixture.git(['branch', 'untracked', 'main']);
      fixture.git(['switch', '--detach', 'tip']);
      const before = fixture.snapshot();
      const result = fixture.run(['create', 'new-branch', '--onto', parent]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }

  it('preserves a colliding branch and untracked file collisions', () => {
    fixture.git(['switch', '--detach', 'tip']);
    fixture.git(['branch', 'new-branch', 'main']);
    const before = fixture.snapshot();
    expect(
      fixture.run(['create', 'new-branch', '--onto', 'other']).status
    ).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.git(['branch', '-D', 'new-branch']);
    fixture.write('other.txt', 'keep local untracked file');
    const dirty = fixture.snapshot();
    expect(
      fixture.run(['create', 'new-branch', '--onto', 'other']).status
    ).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(dirty);
  });

  it('keeps frozen insertion participants protected before creating a branch', () => {
    fixture.ok(['freeze', 'child']);
    fixture.git(['switch', '--detach', 'tip']);
    const before = fixture.snapshot();
    const result = fixture.run([
      'create',
      'new-branch',
      '--onto',
      'base',
      '--insert',
      '--insert-child',
      'child',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.match(/frozen/i);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('selects insertion children interactively from detached HEAD', () => {
    fixture.git(['switch', 'main']);
    fixture.git(['worktree', 'add', '--detach', fixture.linked, 'main']);
    const result = runCliInPty(
      getTestCliCommand([
        'create',
        'new-branch',
        '--onto',
        'main',
        '--insert',
        '--interactive',
      ]),
      {
        cwd: fixture.linked,
        env: fixture.env,
        responses: [{ prompt: 'Choose children of main', input: '\r' }],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(fixture.ok(['parent'], fixture.linked)).to.equal('main\n');
    fixture.ok(['checkout', 'base'], fixture.linked);
    expect(fixture.ok(['parent'], fixture.linked)).to.equal('new-branch\n');
  });

  it('refuses insertion when detached HEAD changes during the selection menu', () => {
    fixture.git(['switch', 'main']);
    fixture.git(['worktree', 'add', '--detach', fixture.linked, 'main']);
    const beforeRefs = fixture.refs();
    const result = runCliInPty(
      getTestCliCommand([
        'create',
        'new-branch',
        '--onto',
        'main',
        '--insert',
        '--interactive',
      ]),
      {
        cwd: fixture.linked,
        env: fixture.env,
        responses: [
          {
            prompt: 'Choose children of main',
            input: '\r',
            beforeInput: [
              'git',
              '-C',
              fixture.linked,
              'switch',
              '--detach',
              'tip',
            ],
          },
        ],
      }
    );
    expect(result.status, result.output).not.to.equal(0);
    expect(result.output).to.include('changed during child selection');
    expect(fixture.git(['rev-parse', 'HEAD'], fixture.linked)).to.equal(
      fixture.git(['rev-parse', 'tip'])
    );
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      ''
    );
    expect(fixture.refs()).to.equal(beforeRefs);
  });
});
