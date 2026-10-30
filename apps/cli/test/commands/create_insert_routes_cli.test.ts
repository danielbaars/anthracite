import { spawnSync } from 'child_process';

import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('targeted insert public routes', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('explains terminal and literal defaults in create/c help and offers child selectors in completion', () => {
    const before = fixture.snapshot();
    for (const command of ['create', 'c']) {
      const help = fixture
        .ok([command, '--help'], fixture.root)
        .replace(/\s+/g, ' ');
      for (const text of [
        '--insert-child',
        'exact',
        'repeat',
        'Requires --insert',
        'all initially selected',
        'noninteractive',
        '--onto',
      ])
        expect(help, command).to.include(text);
      const options = fixture.ok(
        ['--get-yargs-completions', 'an', command, '--'],
        fixture.root
      );
      expect(options).to.include('--insert-child');
      const [executable, ...args] = getTestCliCommand([
        '--get-yargs-completions',
        'an',
        command,
        'new',
        '--insert',
        '--insert-child',
        '',
      ]);
      const completion = spawnSync(executable, args, {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(completion.status, completion.stderr).to.equal(0);
      expect(completion.stdout.trim().split('\n'))
        .to.include('child')
        .and.include('base');
    }
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  for (const globalCwd of [false, true]) {
    it(`selects a child through c -i from a subdirectory with global cwd ${globalCwd}`, () => {
      fixture.branch('sibling', 'base');
      fixture.git(['switch', 'base']);
      const untouched = fixture.git([
        'rev-parse',
        'sibling',
        'refs/branch-metadata/sibling',
      ]);
      const subdirectory = path.join(fixture.repo, 'sub directory ü');
      fs.mkdirSync(subdirectory);
      fixture.stage('inserted.txt', 'cwd prerequisite');
      const output = fixture.ok(
        [
          ...(globalCwd ? ['--cwd', subdirectory] : []),
          'c',
          'inserted',
          '-i',
          '--insert-child',
          'child',
          '-m',
          'cwd prerequisite',
        ],
        globalCwd ? fixture.root : subdirectory
      );
      expect(output).to.include('base').and.include('child');
      expect(output).not.to.include('sibling');
      expect(
        fixture.git(['rev-parse', 'sibling', 'refs/branch-metadata/sibling'])
      ).to.equal(untouched);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(
        JSON.parse(
          fixture.git(['cat-file', '-p', 'refs/branch-metadata/child'])
        ).parentBranchName
      ).to.equal('inserted');
      expect(fixture.git(['show', 'tip:inserted.txt'])).to.equal(
        'cwd prerequisite'
      );
    });
  }

  it('warns on stderr for implicit noninteractive fanout even in quiet mode', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'base']);
    const result = fixture.run(['create', 'inserted', '--insert', '--quiet']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr)
      .to.include('WARNING:')
      .and.include('No --insert-child specified')
      .and.include('all 2 direct children of base')
      .and.include('child')
      .and.include('sibling')
      .and.include('--insert-child <branch>');
    for (const branch of ['child', 'sibling']) {
      expect(
        JSON.parse(
          fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
        ).parentBranchName
      ).to.equal('inserted');
    }
  });

  it('keeps explicit scope quiet and retains an actionable invalid-child refusal', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'base']);
    const sibling = fixture.git([
      'rev-parse',
      'sibling',
      'refs/branch-metadata/sibling',
    ]);
    fixture.stage('inserted.txt', 'quiet prerequisite');
    const success = fixture.run([
      'c',
      'inserted',
      '-i',
      '--insert-child',
      'child',
      '-m',
      'quiet prerequisite',
      '--quiet',
    ]);
    expect(success.status, success.stderr).to.equal(0);
    expect(success.stdout).to.equal('');
    expect(success.stderr).not.to.include('No --insert-child specified');
    expect(
      fixture.git(['rev-parse', 'sibling', 'refs/branch-metadata/sibling'])
    ).to.equal(sibling);
    const before = fixture.snapshot();
    const invalid = fixture.run([
      'create',
      'invalid',
      '--onto',
      'base',
      '--insert',
      '--insert-child',
      'missing',
      '--quiet',
    ]);
    expect(invalid.status).not.to.equal(0);
    expect(invalid.stdout).to.equal('');
    expect(invalid.stderr).to.include('missing').and.include('base');
    expect(fixture.snapshot()).to.deep.equal(before);
  });
});
