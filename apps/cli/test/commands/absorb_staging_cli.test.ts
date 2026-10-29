import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('absorb staging and interaction through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    fixture.git(['switch', 'tip']);
  });
  afterEach(() => fixture.cleanup());
  it('previews tracked-only all through ab -a -d without changing the raw index or work', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'loose.txt'),
      'untracked sentinel\n'
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['ab', '-a', '-d']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('base.txt: absorb into base');
    expect(result.stdout).not.to.include('loose.txt');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('applies tracked-only all and retains staged new entries and untracked bytes', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    fs.writeFileSync(path.join(fixture.repo, 'prepared.txt'), 'staged new\n');
    fixture.git(['add', 'prepared.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'loose.txt'),
      'untracked sentinel\n'
    );
    const result = fixture.run(['ab', '-a', '-f', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['show', 'base:base.txt'])).to.equal('corrected base');
    expect(fixture.git(['show', ':prepared.txt'])).to.equal('staged new');
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal(
      'prepared.txt'
    );
    expect(
      fixture.git(['ls-files', '--others', '--exclude-standard'])
    ).to.equal('loose.txt');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
    ).to.equal('untracked sentinel\n');
  });
  it('shows the complete plan once and preserves the original index on declined confirmation', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    const before = fixture.inspectionSnapshot();
    const result = runCliInPty(getTestCliCommand(['absorb', '--all']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Apply this absorb plan?', input: 'n\n' }],
    });
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('base.txt: absorb into base');
    expect(result.output).to.include('Absorb canceled; no changes applied.');
    expect(result.output).not.to.include('Dry run complete');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('uses real Git patch selection and absorbs only the accepted hunk while retaining prior staged work', () => {
    const original =
      Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    fs.writeFileSync(path.join(fixture.repo, 'patch.txt'), original);
    fixture.git(['add', 'patch.txt']);
    fixture.git(['commit', '-m', 'patch baseline']);
    const old = fixture.git(['rev-parse', 'tip']);
    fs.writeFileSync(path.join(fixture.repo, 'prepared.txt'), 'staged new\n');
    fixture.git(['add', 'prepared.txt']);
    const selected = original.replace('line 0\n', 'selected hunk\n');
    const work = selected.replace('line 39\n', 'unfinished hunk\n');
    fs.writeFileSync(path.join(fixture.repo, 'patch.txt'), work);
    fs.writeFileSync(
      path.join(fixture.repo, 'loose.txt'),
      'untracked sentinel\n'
    );
    const result = runCliInPty(
      getTestCliCommand(['ab', '-p', '-f', '--all=false', '--dry-run=false']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Stage this hunk', input: 'y\n' },
          { prompt: 'Stage this hunk', input: 'n\n' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(result.output.match(/Stage this hunk/g)).to.have.length(2);
    expect(result.output).not.to.include('Apply this absorb plan?');
    expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(old);
    expect(fixture.git(['show', 'tip:patch.txt'])).to.equal(selected.trim());
    expect(fixture.git(['show', ':patch.txt'])).to.equal(selected.trim());
    expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal(
      'prepared.txt'
    );
    expect(fixture.git(['diff']))
      .to.include('+unfinished hunk')
      .and.not.to.include('+selected hunk');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'patch.txt'), 'utf8')
    ).to.equal(work);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
    ).to.equal('untracked sentinel\n');
  });
  for (const phase of ['selection', 'confirmation'])
    it(`preserves original state when terminal ${phase} is canceled`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
      const before = fixture.inspectionSnapshot();
      const result = runCliInPty(
        getTestCliCommand([
          'absorb',
          phase === 'selection' ? '--patch' : '--all',
        ]),
        {
          cwd: fixture.repo,
          env: fixture.env,
          responses: [
            {
              prompt:
                phase === 'selection'
                  ? 'Stage this hunk'
                  : 'Apply this absorb plan?',
              input: '\u0003',
            },
          ],
        }
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status, result.output).not.to.equal(124);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(
        fs
          .readdirSync(path.join(fixture.repo, '.git'))
          .filter((name) => name.startsWith('an-absorb-stage-'))
      ).to.deep.equal([]);
    });
  for (const [name, args, error] of [
    ['active all and patch', ['-a', '-p', '-f'], 'mutually exclusive'],
    ['dry-run and patch', ['-d', '-p', '-f'], 'cannot be combined'],
    ['closed stdin without force', ['-a'], '--force'],
    ['quiet without force', ['-a', '--quiet'], '--force'],
    [
      'explicit noninteractive without force',
      ['-a', '--no-interactive'],
      '--force',
    ],
    ['forced patch without a terminal', ['-p', '-f'], 'terminal interaction'],
    ['an unknown option', ['--unknown-absorb-option'], 'Unknown argument'],
    ['an operand', ['base', '-f'], 'Unknown argument: base'],
  ] as const)
    it(`refuses ${name} before staging or effects`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['absorb', ...args]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include(error);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  it('does not activate false staging options or false force during a safe explicit preview', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged only\n');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'ab',
      '--all=false',
      '--patch=false',
      '--force=false',
      '-d',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('No staged changes to absorb.');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('publishes tracked deletion as staging-only and never claims an amendment', () => {
    fs.unlinkSync(path.join(fixture.repo, 'base.txt'));
    const refs = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
    ]);
    const result = fixture.run(['absorb', '--all', '--force']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Retained base.txt')
      .and.to.include('nothing was absorbed');
    expect(result.stdout).not.to.include('Absorbed ');
    expect(fixture.git(['diff', '--cached', '--name-status'])).to.equal(
      'D\tbase.txt'
    );
    expect(
      fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
    ).to.equal(refs);
  });
  it('applies staged input after one terminal confirmation and returns the caller checkout', () => {
    fs.writeFileSync(path.join(fixture.repo, 'tip.txt'), 'corrected tip\n');
    fixture.git(['add', 'tip.txt']);
    const result = runCliInPty(getTestCliCommand(['absorb']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Apply this absorb plan?', input: 'y\n' }],
    });
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include('tip.txt: absorb into tip');
    // prompts redraws its one question when showing the answer.
    expect(result.output.match(/tip.txt: absorb into tip/g)).to.have.length(1);
    expect(result.output).not.to.include('Dry run complete');
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('corrected tip');
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['diff', '--cached'])).to.equal('');
  });
  it('refuses a source edit made during confirmation without overwriting that external edit or the original index', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
    const refs = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
    ]);
    const result = runCliInPty(getTestCliCommand(['absorb', '--all']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        {
          prompt: 'Apply this absorb plan?',
          input: 'y\n',
          beforeInput: [
            '/usr/bin/python3',
            '-c',
            `open(${JSON.stringify(
              path.join(fixture.repo, 'base.txt')
            )}, 'w').write('external edit\\n')`,
          ],
        },
      ],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(
      'source changed during selection or confirmation'
    );
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
    ).to.deep.equal(index);
    expect(
      fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
    ).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('external edit\n');
  });
  for (const mode of ['all preview', 'patch selection'])
    it(`refuses unstaged content filters before ${mode} can run them`, () => {
      const marker = path.join(fixture.root, 'filter-invoked');
      fixture.git([
        'config',
        'filter.sentinel.clean',
        `printf invoked >> '${marker}'; cat`,
      ]);
      fs.writeFileSync(
        path.join(fixture.repo, '.gitattributes'),
        'base.txt filter=sentinel\n'
      );
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
      const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
      const refs = fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
      ]);
      const result =
        mode === 'all preview'
          ? fixture.run(['absorb', '-a', '-d'])
          : runCliInPty(getTestCliCommand(['absorb', '-p', '-f']), {
              cwd: fixture.repo,
              env: fixture.env,
            });
      const output =
        'output' in result && typeof result.output === 'string'
          ? result.output
          : 'stdout' in result
          ? result.stdout + result.stderr
          : '';
      expect(result.status, output).to.equal(1);
      expect(output).to.include('conversions');
      expect(output).not.to.include('Stage this hunk');
      expect(fs.existsSync(marker)).to.equal(false);
      expect(
        fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
      ).to.deep.equal(index);
      expect(
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
      ).to.equal(refs);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
      ).to.equal('corrected base\n');
    });
  for (const blocker of [
    'frozen descendant',
    'occupied descendant',
    'foreign cache lock',
    'foreign index lock',
  ])
    it(`refuses all before publishing its index with a ${blocker}`, () => {
      fixture.git(['switch', 'base']);
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
      let linked: string | undefined;
      if (blocker === 'frozen descendant') {
        const metadata: unknown = JSON.parse(
          fixture.git(['cat-file', '-p', 'refs/branch-metadata/tip'])
        );
        if (
          !metadata ||
          typeof metadata !== 'object' ||
          Array.isArray(metadata)
        )
          throw new Error('Invalid fixture metadata');
        const file = path.join(fixture.root, 'frozen-tip.json');
        fs.writeFileSync(file, JSON.stringify({ ...metadata, frozen: true }));
        fixture.git([
          'update-ref',
          'refs/branch-metadata/tip',
          fixture.git(['hash-object', '-w', file]),
        ]);
      } else if (blocker === 'occupied descendant') {
        linked = path.join(fixture.root, 'linked');
        fixture.git(['worktree', 'add', linked, 'tip']);
        fs.writeFileSync(path.join(linked, 'tip.txt'), 'linked sentinel\n');
      } else {
        fs.writeFileSync(
          path.join(
            fixture.repo,
            '.git',
            blocker === 'foreign cache lock'
              ? '.graphite_cache_lock'
              : 'index.lock'
          ),
          'foreign opaque lock bytes'
        );
      }
      const before = fixture.inspectionSnapshot();
      const outside = linked ? fixture.inspectionSnapshot(linked) : undefined;
      const result = fixture.run(['absorb', '-a', '-f']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      if (linked)
        expect(fixture.inspectionSnapshot(linked)).to.deep.equal(outside);
    });
  it('refuses an intermediate untracked file collision before all publishes its index', () => {
    fs.writeFileSync(
      path.join(fixture.repo, 'transient.txt'),
      'historical file\n'
    );
    fixture.git(['add', 'transient.txt']);
    fixture.git(['commit', '-m', 'intermediate file']);
    fixture.git(['rm', 'transient.txt']);
    fixture.git(['commit', '-m', 'remove intermediate file']);
    fs.writeFileSync(
      path.join(fixture.repo, 'transient.txt'),
      'untracked collision\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'tip.txt'), 'corrected tip\n');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '-a', '-f']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('transient.txt');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('describes absorb/ab and its options through help and completion outside Git without external tools', () => {
    const before = fixture.inspectionSnapshot();
    const restore = fixture.refuseExternalTools();
    try {
      for (const command of ['absorb', 'ab']) {
        const help = fixture.run([command, '--help'], fixture.root);
        expect(help.status, help.stdout + help.stderr).to.equal(0);
        for (const text of [
          '--dry-run',
          '--force',
          '--all',
          '--patch',
          'tracked',
          'terminal',
          'Unsupported entries',
          'recovery',
          'signatures',
        ])
          expect(help.stdout).to.include(text);
        const completion = fixture.run(
          ['--get-yargs-completions', 'an', command, '--'],
          fixture.root
        );
        expect(
          completion.status,
          completion.stdout + completion.stderr
        ).to.equal(0);
        for (const flag of ['--dry-run', '--force', '--all', '--patch'])
          expect(
            completion.stdout.split('\n').map((line) => line.split(':')[0])
          ).to.include(flag);
      }
      const root = fixture.run(
        ['--get-yargs-completions', 'an', ''],
        fixture.root
      );
      expect(root.status, root.stdout + root.stderr).to.equal(0);
      const names = root.stdout.split('\n').map((line) => line.split(':')[0]);
      expect(names).to.include('absorb').and.to.include('ab');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('projects root-relative spaces and Unicode paths from the effective subdirectory cwd', () => {
    const file = 'space [literal] Ω.txt';
    fs.writeFileSync(path.join(fixture.repo, file), 'original text\n');
    fixture.git(['add', '--', file]);
    fixture.git(['commit', '-m', 'literal path baseline']);
    fs.mkdirSync(path.join(fixture.repo, 'nested'));
    fs.writeFileSync(path.join(fixture.repo, file), 'corrected text\n');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(
      ['ab', '-a', '-d', '--cwd', path.join(fixture.repo, 'nested')],
      fixture.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(`${file}: absorb into tip`);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('suppresses routine no-input and staging-only progress in quiet mode', () => {
    let before = fixture.inspectionSnapshot();
    let result = fixture.run(['absorb', '-f', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fs.unlinkSync(path.join(fixture.repo, 'base.txt'));
    result = fixture.run(['ab', '-a', '-f', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(fixture.git(['diff', '--cached', '--name-status'])).to.equal(
      'D\tbase.txt'
    );
    before = fixture.inspectionSnapshot();
    result = fixture.run(['ab', '-a', '--quiet']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('--force');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  for (const state of [
    'saved recovery',
    'split index',
    'intent-to-add',
    'skip-worktree',
    'assume-unchanged',
  ])
    it(`refuses all with ${state} before private staging`, () => {
      if (state === 'saved recovery')
        fs.writeFileSync(
          path.join(fixture.repo, '.git', '.gtcontinue'),
          'opaque saved recovery'
        );
      else if (state === 'split index')
        fixture.git(['update-index', '--split-index']);
      else if (state === 'intent-to-add') {
        fs.writeFileSync(
          path.join(fixture.repo, 'intent.txt'),
          'intent sentinel\n'
        );
        fixture.git(['add', '--intent-to-add', 'intent.txt']);
      } else
        fixture.git([
          'update-index',
          state === 'skip-worktree' ? '--skip-worktree' : '--assume-unchanged',
          'base.txt',
        ]);
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['absorb', '-a', '-f']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(
        fs
          .readdirSync(path.join(fixture.repo, '.git'))
          .filter((name) => name.startsWith('an-absorb-stage-'))
      ).to.deep.equal([]);
    });
  for (const name of ['.graphite_cache_lock', 'index.lock'])
    it(`refuses an all preview blocked by foreign ${name} while preserving its bytes`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
      fs.writeFileSync(
        path.join(fixture.repo, '.git', name),
        'foreign opaque lock bytes'
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['absorb', '-a', '-d']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('lock');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  it('keeps the original raw index when all patch hunks are declined', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    const before = fixture.inspectionSnapshot();
    const result = runCliInPty(getTestCliCommand(['absorb', '-p', '-f']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Stage this hunk', input: 'n\n' }],
    });
    expect(result.status, result.output).to.equal(0);
    expect(result.output).to.include(
      'No changes selected; nothing was absorbed.'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('does not execute configured external diff, textconv or patch diff filters during private selection', () => {
    const marker = path.join(fixture.root, 'unexpected-diff-tool');
    const tool = `printf invoked >> '${marker}'; cat`;
    fixture.git(['config', 'diff.external', tool]);
    fixture.git(['config', 'diff.sentinel.textconv', tool]);
    fixture.git(['config', 'interactive.diffFilter', tool]);
    fs.writeFileSync(
      path.join(fixture.repo, '.gitattributes'),
      'base.txt diff=sentinel\n'
    );
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'corrected base\n');
    const before = fixture.inspectionSnapshot();
    const result = runCliInPty(getTestCliCommand(['absorb', '-p', '-f']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Stage this hunk', input: 'n\n' }],
    });
    expect(result.status, result.output).to.equal(0);
    expect(fs.existsSync(marker)).to.equal(false);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('checks mandatory participants from the prospective all input rather than replaced staged hunks', () => {
    fixture.git(['switch', 'base']);
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'staged correction\n'
    );
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'base');
    const metadata: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/tip'])
    );
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      throw new Error('Invalid fixture metadata');
    const file = path.join(fixture.root, 'frozen-tip.json');
    fs.writeFileSync(file, JSON.stringify({ ...metadata, frozen: true }));
    fixture.git([
      'update-ref',
      'refs/branch-metadata/tip',
      fixture.git(['hash-object', '-w', file]),
    ]);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['absorb', '-a', '-d']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('No staged changes to absorb.');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
