import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

function freezeOnly(
  fixture: FreezeCliFixture,
  name: string,
  parent: string
): void {
  fixture.ok(['freeze', name]);
  fixture.ok(['track', name, '--parent', 'main']);
  fixture.ok(['unfreeze', 'base']);
  fixture.ok(['track', name, '--parent', parent]);
}

function refused(
  fixture: FreezeCliFixture,
  args: readonly string[],
  name: string
): void {
  const before = fixture.observe();
  const result = fixture.run(args);
  expect(result.status, result.stdout + result.stderr).to.equal(1);
  expect(result.stderr).to.include(`ch unfreeze ${name}`);
  expect(fixture.observe()).to.deep.equal(before);
}

// eslint-disable-next-line max-lines-per-function
describe('frozen structural route coverage through the public CLI', function () {
  this.timeout(90000);
  let fixture: FreezeCliFixture;
  beforeEach(() => {
    fixture = new FreezeCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const args of [
    ['move', 'other'],
    ['move', '--onto', 'other'],
    ['move', '-o', 'other'],
    ['move', '--source', 'base', '--onto', 'other'],
    ['move', '-s', 'base', '-o', 'other'],
    ['move', '--only', '--onto', 'main'],
    ['move', '--only=false', '-o', 'main'],
    ['move', '--source', 'base', '--only', '-o', 'base'],
  ])
    it(`${args.join(
      ' '
    )} refuses a frozen source before changing work or refs`, () => {
      fixture.ok(['freeze', 'base']);
      fixture.write('portable.txt', 'preserved untracked work');
      refused(fixture, args, 'base');
    });

  for (const only of [false, true]) {
    it(`move only=${only} refuses a frozen mandatory descendant before the first parent edit`, () => {
      freezeOnly(fixture, only ? 'child' : 'tip', only ? 'base' : 'child');
      refused(
        fixture,
        ['move', '-s', 'base', '-o', 'other', `--only=${only}`],
        only ? 'child' : 'tip'
      );
    });
    it(`move only=${only} actually replays editable work onto an untouched frozen destination`, () => {
      fixture.ok(['freeze', 'other']);
      const destination = fixture.git(['rev-parse', 'other']);
      const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/other']);
      const original = fixture.git(['rev-parse', 'base']);
      const child = fixture.git(['rev-parse', 'child']);
      fixture.ok(['move', '-s', 'base', '-o', 'other', `--only=${only}`]);
      expect(fixture.git(['rev-parse', 'base'])).not.to.equal(original);
      expect(fixture.git(['rev-parse', 'base^'])).to.equal(destination);
      expect(fixture.git(['show', 'base:base.txt'])).to.equal('base');
      expect(fixture.git(['show', 'base:other.txt'])).to.equal('other');
      expect(fixture.git(['rev-parse', 'other'])).to.equal(destination);
      expect(fixture.git(['rev-parse', 'refs/branch-metadata/other'])).to.equal(
        metadata
      );
      expect(fixture.git(['rev-parse', 'child'])).not.to.equal(child);
      expect(fixture.ok(['info', 'child'])).to.include(
        `Parent: ${only ? 'main' : 'base'}`
      );
      expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    });
  }

  for (const args of [
    ['fold'],
    ['fold', '--keep'],
    ['fold', '-k'],
    ['fold', '--stack=false'],
    ['fold', '--stack'],
    ['fold', '--stack', '--keep'],
    ['fold', '--stack', '-k'],
  ]) {
    it(`${args.join(
      ' '
    )} refuses its frozen chosen source without staging dirty work`, () => {
      fixture.git(['switch', 'child']);
      fixture.ok(['freeze', 'child']);
      fixture.write('child.txt', 'unstaged own work');
      refused(fixture, args, 'child');
    });
  }

  for (const keep of [false, true]) {
    it(`ordinary fold keep=${keep} refuses a frozen parent-change child`, () => {
      freezeOnly(fixture, 'tip', 'child');
      fixture.git(['switch', 'child']);
      if (keep) {
        // With --keep the existing child retains its parent; a frozen sibling changes parent instead.
        fixture.ok(['track', 'tip', '--parent', 'base']);
      }
      refused(fixture, ['fold', `--keep=${keep}`], 'tip');
    });
    it(`stack fold keep=${keep} refuses a frozen off-chain mandatory replay`, () => {
      fixture.branch('sibling', 'base');
      freezeOnly(fixture, 'sibling', 'base');
      fixture.git(['switch', 'tip']);
      refused(fixture, ['fold', '--stack', `--keep=${keep}`], 'sibling');
    });
  }

  for (const command of ['reorder', 'ro'])
    for (const stack of [false, true]) {
      it(`${command} stack=${stack} refuses the explicit frozen source even for an unchanged plan`, () => {
        fixture.ok(['freeze', 'base']);
        const input = path.join(fixture.root, 'order');
        fs.writeFileSync(input, stack ? 'tip\nchild\nbase\n' : 'base\n');
        refused(
          fixture,
          [command, `--stack=${stack}`, '--input', input],
          'base'
        );
      });
      it(`${command} stack=${stack} reorders editable branches above an unchanged frozen prefix`, () => {
        fixture.ok(['freeze', 'base']);
        fixture.git(['switch', 'tip']);
        const prefix = fixture.git(['rev-parse', 'base']);
        const metadata = fixture.git([
          'rev-parse',
          'refs/branch-metadata/base',
        ]);
        const other = fixture.git(['rev-parse', 'other']);
        const input = path.join(fixture.root, 'order');
        fs.writeFileSync(input, 'child\ntip\nbase\n');
        fixture.ok([command, `--stack=${stack}`, '--input', input]);
        expect(fixture.git(['rev-parse', 'tip^'])).to.equal(prefix);
        expect(fixture.git(['rev-parse', 'child^'])).to.equal(
          fixture.git(['rev-parse', 'tip'])
        );
        expect(fixture.git(['show', 'child:tip.txt'])).to.equal('tip');
        expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
        expect(fixture.git(['rev-parse', 'base'])).to.equal(prefix);
        expect(
          fixture.git(['rev-parse', 'refs/branch-metadata/base'])
        ).to.equal(metadata);
        expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
        expect(fixture.git(['branch', '--show-current'])).to.equal(
          stack ? 'tip' : 'child'
        );
      });
    }

  for (const args of [
    ['create', 'inserted', '--insert'],
    ['c', 'inserted', '--insert'],
    ['create', 'inserted', '--insert', '--all', '-m', 'insert commit'],
    ['c', 'inserted', '--insert', '--patch', '-m', 'insert commit'],
    ['create', 'inserted', '--insert', '--onto', 'base'],
    ['c', 'inserted', '--insert', '-o', 'base'],
  ])
    it(`${args.join(
      ' '
    )} refuses a frozen direct child before checkout editor hooks or staging`, () => {
      freezeOnly(fixture, 'child', 'base');
      fixture.write('insert-work.txt', 'unstaged work');
      const marker = path.join(fixture.root, 'editor-ran');
      fixture.env.GIT_EDITOR = `touch '${marker}'`;
      refused(fixture, args, 'child');
      expect(fs.existsSync(marker)).to.equal(false);
      expect(fixture.git(['branch', '--list', 'inserted'])).to.equal('');
    });

  it('insert refuses an indirect frozen replay before creating the branch or committing staged work', () => {
    freezeOnly(fixture, 'tip', 'child');
    fixture.stage('insert-work.txt', 'staged work');
    refused(
      fixture,
      ['c', 'inserted', '--insert', '-m', 'insert commit'],
      'tip'
    );
  });

  it('preserves linked worktree bytes and the raw local index on early mandatory refusal', () => {
    freezeOnly(fixture, 'tip', 'child');
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.stage('linked-work.txt', 'linked staged work', fixture.linked);
    const linked = fixture.snapshot(fixture.linked);
    fixture.git(['switch', 'other']);
    refused(
      fixture,
      ['move', '-s', 'base', '-o', 'other', '--no-verify'],
      'tip'
    );
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
  });

  it('rejects a known frozen source in a real terminal before rendering its destination selector', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.observe();
    const result = runCliInPty(getTestCliCommand(['move', '-s', 'base']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('ch unfreeze base');
    expect(result.output).not.to.include('Choose a new base');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('accepts cwd prefix and suffix forms and quiet retains frozen diagnostics', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.observe();
    for (const args of [
      ['--cwd', fixture.repo, 'move', '-o', 'other', '-q'],
      ['move', '-o', 'other', '--cwd', fixture.repo, '--quiet'],
    ]) {
      const result = fixture.run(args, fixture.root);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include('ch unfreeze base');
      expect(fixture.observe()).to.deep.equal(before);
    }
  });

  it('moves editable work from an explicit cwd quietly onto an unchanged frozen destination', () => {
    fixture.ok(['freeze', 'other']);
    const destination = fixture.git(['rev-parse', 'other']);
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/other']);
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const result = fixture.run(
      ['--cwd', fixture.repo, 'move', '-s', 'tip', '-o', 'other', '-q'],
      fixture.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.equal('');
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(destination);
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(fixture.git(['show', 'tip:other.txt'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/other'])).to.equal(
      metadata
    );
  });

  it('selects a frozen destination in a real terminal while retaining the raw branch name', () => {
    fixture.ok(['freeze', 'other']);
    fixture.git(['switch', 'main']);
    const destination = fixture.git(['rev-parse', 'other']);
    const result = runCliInPty(
      getTestCliCommand(['move', '-s', 'tip', '--only']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Choose a new base', input: '\u001b[A\r' }],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(destination);
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(fixture.git(['show', 'tip:other.txt'])).to.equal('other');
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.ok(['info', 'other'])).to.include('(frozen)');
  });

  it('rechecks a source frozen by another public CLI process while its destination selector is open', () => {
    const refs = fixture.refs();
    const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
    const result = runCliInPty(getTestCliCommand(['move', '-s', 'base']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        {
          prompt: 'Choose a new base',
          input: '\u001b[A\r',
          beforeInput: getTestCliCommand([
            'freeze',
            'base',
            '--no-interactive',
          ]),
        },
      ],
    });
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('ch unfreeze base');
    expect(fixture.refs()).to.equal(refs);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
    ).to.deep.equal(index);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('explains frozen structural participants and strict insert refusal in public help without writes', () => {
    fixture.ok(['freeze', 'base']);
    const before = fixture.observe();
    for (const command of ['move', 'fold', 'reorder', 'ro', 'create', 'c'])
      expect(fixture.ok([command, '--help']).toLowerCase()).to.include(
        'frozen'
      );
    expect(fixture.ok(['create', '--help'])).to.include('--insert');
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('refuses mandatory frozen replay before ordinary context repair can publish an editable source base', () => {
    freezeOnly(fixture, 'tip', 'child');
    fixture.git(['switch', 'main']);
    fixture.commit('advanced-main');
    fixture.git(['switch', 'base']);
    fixture.git(['merge', '--no-edit', 'main']);
    refused(fixture, ['move', '-o', 'other'], 'tip');
  });
});
