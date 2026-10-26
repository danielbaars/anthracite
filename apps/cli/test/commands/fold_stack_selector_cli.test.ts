import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('stack fold tip selection through a real PTY', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('chooses tip from a linked middle departure and preserves the unchosen subtree above the bottom survivor', () => {
    fixture.branch('sibling', 'child');
    fixture.branch('deep', 'sibling');
    const tip = fixture.git(['rev-parse', 'tip']);
    const tree = fixture.git(['rev-parse', 'tip^{tree}']);
    const history = fixture.git(['rev-list', 'tip']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.stage('other.txt', 'staged other');
    fixture.write('other.txt', 'unfinished other');
    const before = fixture.snapshot();
    const index = fs.readFileSync(path.join(fixture.repo, '.git/index'));
    const result = runCliInPty(getTestCliCommand(['fold', '--stack']), {
      cwd: fixture.linked,
      env: fixture.env,
      responses: [
        { prompt: 'Choose a tip', input: 'tip' },
        { prompt: '› tip', input: '\r' },
      ],
    });
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'base'
    );
    expect(fixture.git(['rev-parse', 'base']), result.output).to.equal(tip);
    expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(tree);
    expect(fixture.git(['rev-list', 'base'])).to.equal(history);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['branch', '--format=%(refname:short)'])).to.equal(
      'base\ndeep\nmain\nother\nsibling'
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'base..sibling'])
    ).to.equal('sibling');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'sibling..deep'])
    ).to.equal('deep');
    expect(fixture.git(['show', 'deep:tip.txt'])).to.equal('tip');
    expect(fixture.git(['status', '--porcelain'], fixture.linked)).to.equal('');
    const after = fixture.snapshot();
    expect({ ...after, refs: before.refs }).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, '.git/index'))
    ).to.deep.equal(index);
    for (const [name, parent] of [
      ['base', 'main'],
      ['sibling', 'base'],
      ['deep', 'sibling'],
    ]) {
      fixture.ok(['checkout', name], fixture.linked);
      fixture.ok(['down'], fixture.linked);
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal(parent);
    }
  });

  for (const keep of [false, true]) {
    it(`chooses a literal deep tip with the full chain and preserved siblings (keep=${keep})`, () => {
      const literal = "z-tip'$()#é";
      fixture.branch('sibling', 'child');
      fixture.branch(literal, 'sibling');
      fixture.branch('downstack-sibling', 'base');
      fixture.branch('unrelated-tip', 'other');
      const tip = fixture.git(['rev-parse', literal]);
      const tree = fixture.git(['rev-parse', `${literal}^{tree}`]);
      const history = fixture.git(['rev-list', literal]);
      const unrelated = fixture.git(['rev-parse', 'unrelated-tip']);
      const trunk = fixture.git(['rev-parse', 'main']);
      fixture.git(['switch', 'child']);
      const result = runCliInPty(
        getTestCliCommand([
          'fold',
          '--stack',
          ...(keep ? ['-k'] : ['--keep=false']),
        ]),
        {
          cwd: fixture.repo,
          env: fixture.env,
          responses: [
            { prompt: 'Choose a tip', input: literal },
            { prompt: `› ${literal}`, input: '\r' },
          ],
        }
      );
      expect(result.status, result.output).to.equal(0);
      const survivor = keep ? literal : 'base';
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.git(['rev-parse', `${survivor}^{tree}`])).to.equal(tree);
      expect(fixture.git(['rev-list', survivor])).to.equal(history);
      expect(fixture.git(['rev-parse', 'unrelated-tip'])).to.equal(unrelated);
      expect(fixture.git(['rev-parse', 'main'])).to.equal(trunk);
      expect(fixture.git(['branch', '--format=%(refname:short)'])).to.equal(
        [survivor, 'downstack-sibling', 'tip', 'main', 'other', 'unrelated-tip']
          .sort()
          .join('\n')
      );
      for (const name of ['tip', 'downstack-sibling']) {
        expect(
          fixture.git([
            'log',
            '--reverse',
            '--format=%s',
            `${survivor}..${name}`,
          ])
        ).to.equal(name);
        expect(fixture.git(['show', `${name}:${literal}.txt`])).to.equal(
          literal
        );
      }
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      for (const [name, parent] of [
        [survivor, 'main'],
        ['tip', survivor],
        ['downstack-sibling', survivor],
        ['unrelated-tip', 'other'],
      ]) {
        fixture.ok(['checkout', name]);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
      }
    });
  }

  it('cancels with only eligible leaves displayed and preserves both worktrees, indexes and literal bytes', () => {
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    fixture.branch('sibling', 'child');
    fixture.branch('deep', 'sibling');
    fixture.branch('downstack-sibling', 'base');
    fixture.branch('unrelated-tip', 'other');
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.stage('other.txt', 'staged other work');
    fixture.write('other.txt', 'partially staged other work');
    const privateName = "private '*[é]\n.bin";
    const bytes = Buffer.from([0, 255, 10, 13, 128, 42]);
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\n*.bin\n'
    );
    for (const cwd of [fixture.repo, fixture.linked]) {
      fs.writeFileSync(path.join(cwd, privateName), bytes);
    }
    const trace = installTrace();
    const before = observeBoth();
    const result = runCliInPty(getTestCliCommand(['fold', '--stack']), {
      cwd: fixture.linked,
      env: fixture.env,
      responses: [{ prompt: 'Choose a tip', input: '\u0003' }],
    });
    expect(result.status, result.output).not.to.equal(0);
    expect(result.status).not.to.equal(124);
    expect(result.output).to.include('Choose a tip above child');
    expect(result.output)
      .to.match(/◯\s+tip/)
      .and.match(/◯\s+deep/);
    expect(result.output, result.output).not.to.match(
      /◯\s+(?:base|child|sibling|main|other|unrelated-tip)\b/
    );
    const after = observeBoth();
    preserveState(before, after);
    expect(after).to.deep.equal(before);
    expect(fs.existsSync(trace)).to.equal(false);
    for (const cwd of [fixture.repo, fixture.linked]) {
      expect(fs.readFileSync(path.join(cwd, privateName))).to.deep.equal(bytes);
    }
    for (const [name, parent] of [
      ['child', 'base'],
      ['tip', 'child'],
      ['sibling', 'child'],
      ['deep', 'sibling'],
      ['downstack-sibling', 'base'],
    ]) {
      fixture.ok(['checkout', name], fixture.linked);
      expect(fixture.ok(['info'], fixture.linked)).to.include(
        `Parent: ${parent}`
      );
    }
  });

  it('automatically uses the unique own tip despite a sibling beside downstack', () => {
    fixture.branch('downstack-sibling', 'base');
    const tip = fixture.git(['rev-parse', 'tip']);
    fixture.git(['switch', 'child']);
    const result = runCliInPty(getTestCliCommand(['fold', '--stack']), {
      cwd: fixture.repo,
      env: fixture.env,
    });
    expect(result.status, result.output).to.equal(0);
    expect(result.output).not.to.include('Choose a tip');
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(tip);
    expect(
      fixture.git([
        'log',
        '--reverse',
        '--format=%s',
        'base..downstack-sibling',
      ])
    ).to.equal('downstack-sibling');
    fixture.ok(['checkout', 'downstack-sibling']);
    expect(fixture.ok(['info'])).to.include('Parent: base');
  });

  for (const args of [
    ['--no-interactive'],
    ['--quiet', '--no-interactive'],
    ['--stack='],
    ['--stack=false', '--stack'],
    ['--keep='],
    ['--keep', '--keep=false'],
    ['--keep=false', '-qk'],
    ['--keep=true', '-qk=false'],
    ['-kk=false'],
    ['-qk=garbage'],
    ['--', 'tip'],
    ['--', '--force'],
    ['--force'],
    ['tip'],
  ]) {
    it(`refuses ambiguous or invalid input without effects before selection: ${JSON.stringify(
      args
    )}`, () => {
      prepareAmbiguous();
      const trace = installTrace();
      const before = observeBoth();
      const result = runCliInPty(
        getTestCliCommand(['fold', '--stack', ...args]),
        {
          cwd: fixture.repo,
          env: fixture.env,
        }
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).not.to.include('Choose a tip');
      expect(observeBoth()).to.deep.equal(before);
      expect(fs.existsSync(trace)).to.equal(false);
      expectParents();
    });
  }

  it('refuses quiet ambiguous selection without prompting or silently selecting', () => {
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    prepareAmbiguous();
    const trace = installTrace();
    const before = observeBoth();
    for (const flags of [['--quiet'], ['--quiet', '--interactive']]) {
      const result = runCliInPty(
        getTestCliCommand(['fold', '--stack', ...flags]),
        {
          cwd: fixture.repo,
          env: fixture.env,
        }
      );
      const after = observeBoth();
      preserveState(before, after);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('unique tip in non-interactive mode');
      expect(result.output).not.to.include('Choose a tip');
      expect(result.output).not.to.include('\u001b[?25');
      expect(after).to.deep.equal(before);
    }
    expect(fs.existsSync(trace)).to.equal(false);
    expectParents();
  });

  for (const guard of [
    'stale-chain',
    'partial-staging',
    'selected-worktree',
    'deep-worktree',
    'selected-path',
    'deep-replay-path',
  ]) {
    it(`applies ${guard} to the chosen graph before checkout or ref effects`, () => {
      fixture.branch('sibling', 'child');
      if (guard === 'deep-replay-path') {
        fixture.stage('transient.bin', 'temporary sibling work');
        fixture.git(['commit', '-m', 'temporary add']);
        fixture.git(['rm', 'transient.bin']);
        fixture.git(['commit', '-m', 'temporary delete']);
      }
      fixture.branch('deep', 'sibling');
      fixture.git(['switch', 'child']);
      if (guard === 'stale-chain') fixture.commit('new-child');
      const occupied =
        guard === 'selected-worktree'
          ? 'tip'
          : guard === 'deep-worktree'
          ? 'deep'
          : 'other';
      fixture.git(['worktree', 'add', fixture.linked, occupied]);
      fixture.stage('main.txt', 'linked staged', fixture.linked);
      fixture.write('main.txt', 'linked unfinished', fixture.linked);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\n*.bin\n/tip.txt\n'
      );
      const hidden = guard === 'selected-path' ? 'tip.txt' : 'transient.bin';
      const bytes = Buffer.from([0, 255, 128, 10, 13]);
      fs.writeFileSync(path.join(fixture.repo, hidden), bytes);
      if (guard === 'partial-staging') {
        fixture.stage('main.txt', 'staged');
        fixture.write('main.txt', 'unfinished');
      }
      const trace = installTrace();
      const before = observeBoth();
      const result = runCliInPty(
        getTestCliCommand(['fold', '--stack', '--keep']),
        {
          cwd: fixture.repo,
          env: fixture.env,
          responses: [
            { prompt: 'Choose a tip', input: 'tip' },
            { prompt: '› tip', input: '\r' },
          ],
        }
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      if (guard === 'partial-staging')
        expect(result.output).not.to.include('Choose a tip');
      else expect(result.output).to.include('Choose a tip');
      expect(result.output).to.include(
        guard === 'stale-chain'
          ? 'needs restack'
          : guard === 'partial-staging'
          ? 'tracked changes'
          : guard === 'selected-worktree'
          ? 'tip'
          : guard === 'deep-worktree'
          ? 'deep'
          : hidden
      );
      expect(observeBoth()).to.deep.equal(before);
      expect(fs.readFileSync(path.join(fixture.repo, hidden))).to.deep.equal(
        bytes
      );
      expect(fs.existsSync(trace)).to.equal(false);
      if (guard === 'selected-path')
        fs.renameSync(
          path.join(fixture.repo, hidden),
          path.join(fixture.root, 'preserved-private-bytes')
        );
      if (guard === 'partial-staging')
        fixture.git(['restore', '--staged', '--worktree', 'main.txt']);
      fixture.git(['switch', '--detach'], fixture.linked);
      expectParents();
    });
  }

  function prepareAmbiguous(): void {
    fixture.branch('sibling', 'child');
    fixture.branch('deep', 'sibling');
    fixture.git(['switch', 'child']);
    fixture.git(['worktree', 'add', fixture.linked, 'other']);
    fixture.stage('other.txt', 'staged linked', fixture.linked);
    fixture.write('other.txt', 'unfinished linked', fixture.linked);
  }

  function expectParents(): void {
    for (const [name, parent] of [
      ['base', 'main'],
      ['child', 'base'],
      ['tip', 'child'],
      ['sibling', 'child'],
      ['deep', 'sibling'],
    ]) {
      fixture.ok(['checkout', name]);
      expect(fixture.ok(['info'])).to.include(`Parent: ${parent}`);
    }
  }

  function installTrace(): string {
    const trace = path.join(fixture.root, 'mutation-trace');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-checkout'),
      `#!/bin/sh\nprintf 'checkout\\n' >> '${trace}'\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nwhile read old new ref; do\ncase "$ref" in refs/heads/*) printf 'ref\\n' >> '${trace}';; esac\ndone\n`,
      { mode: 0o755 }
    );
    return trace;
  }

  function observeBoth() {
    return [fixture.repo, fixture.linked].map((cwd) => {
      const snapshot = fixture.snapshot(cwd);
      const index = fs.readFileSync(
        path.resolve(
          cwd,
          fixture.git(['rev-parse', '--git-path', 'index'], cwd)
        )
      );
      return { snapshot, index };
    });
  }

  function preserveState(before: unknown, after: unknown): void {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, `${path.basename(fixture.root)}-fold-state.jsonl`),
        JSON.stringify({ before, after }) + '\n'
      );
  }
});
