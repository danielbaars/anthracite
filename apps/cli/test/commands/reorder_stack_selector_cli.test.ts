import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('stack reorder selects a reachable tip through the public terminal and editor', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const chosen of ['tip', "z-deep'$()#é"]) {
    it(`selects ${chosen} and reorders its complete chain while preserving every other own range`, () => {
      fixture.branch('sibling', 'child');
      const literal = "z-deep'$()#é";
      fixture.branch(literal, 'sibling');
      fixture.branch('downstack-side', 'base');
      fixture.git(['switch', 'child']);
      const other = fixture.git(['rev-parse', 'other']);
      const main = fixture.git(['rev-parse', 'main']);
      fixture.editor(
        chosen === 'tip'
          ? 'base\ntip\nchild\n'
          : `base\n${literal}\nsibling\nchild\n`
      );
      const result = runCliInPty(
        getTestCliCommand([
          chosen === 'tip' ? 'reorder' : 'ro',
          '--stack',
          '--interactive',
        ]),
        {
          cwd: fixture.repo,
          env: fixture.env,
          timeoutMs: 60000,
          responses: [
            { prompt: 'Choose a tip', input: chosen },
            { prompt: `› ${chosen}\r\n`, input: '\r' },
          ],
        }
      );
      fixture.savePty(result);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.match(/◯\s+tip/);
      expect(result.output).to.match(/◯\s+z-deep/);
      expect(result.output).not.to.match(
        /◯\s+(?:downstack-side|other|base|child|sibling|main)\b/
      );
      expect(
        fs
          .readFileSync(fixture.offered, 'utf8')
          .split('\n')
          .filter((row) => row && !row.startsWith('#'))
      ).to.deep.equal(
        chosen === 'tip'
          ? ['tip', 'child', 'base']
          : [literal, 'sibling', 'child', 'base']
      );
      expect(fixture.git(['branch', '--show-current'])).to.equal('child');
      const expected =
        chosen === 'tip'
          ? [
              ['child', 'main', 'child'],
              ['tip', 'child', 'tip'],
              ['base', 'tip', 'base'],
              ['sibling', 'child', 'sibling'],
              [literal, 'sibling', literal.replace(/[^a-z0-9-]/gi, '_')],
              ['downstack-side', 'base', 'downstack-side'],
            ]
          : [
              ['child', 'main', 'child'],
              ['sibling', 'child', 'sibling'],
              [literal, 'sibling', literal.replace(/[^a-z0-9-]/gi, '_')],
              ['base', literal, 'base'],
              ['tip', 'child', 'tip'],
              ['downstack-side', 'base', 'downstack-side'],
            ];
      for (const [name, parent, own] of expected) {
        expect(fixture.parent(name)).to.equal(parent);
        expect(
          fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
        ).to.equal(own);
        expect(fixture.git(['merge-base', name, parent])).to.equal(
          fixture.git(['rev-parse', parent])
        );
        expect(fixture.git(['show', `${name}:${own}.txt`])).to.equal(own);
      }
      expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fixture.git(['log', '--all', '--merges', '--format=%s'])).to.equal(
        ''
      );
    });
  }

  for (const args of [
    ['reorder', '--stack'],
    ['ro', '--stack', '--quiet', '--interactive'],
  ]) {
    it(`${
      args.includes('--quiet')
        ? 'refuses quiet selection'
        : 'cancels a real prompt'
    } without opening the editor or changing either worktree: ${args.join(
      ' '
    )}`, () => {
      ambiguous();
      fixture.branch('downstack-side', 'base');
      fixture.branch('unrelated-tip', 'other');
      fixture.git(['switch', '-c', 'untracked-tip', 'child']);
      fixture.commit('untracked-tip');
      fixture.git(['switch', 'child']);
      const linked = path.join(fixture.root, 'linked');
      fixture.git(['worktree', 'add', linked, 'other']);
      fs.writeFileSync(path.join(linked, 'other.txt'), 'staged other');
      fixture.git(['add', 'other.txt'], linked);
      fs.appendFileSync(path.join(linked, 'other.txt'), ' and unstaged');
      const privateName = "private '*[é]\n.bin";
      const bytes = Buffer.from([0, 255, 10, 13, 128]);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\n*.bin\n'
      );
      for (const cwd of [fixture.repo, linked])
        fs.writeFileSync(path.join(cwd, privateName), bytes);
      const trace = path.join(fixture.root, 'mutation-trace');
      const quotedTrace = `'${trace.replace(/'/g, "'\\''")}'`;
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/post-checkout'),
        `#!/bin/sh\nprintf 'checkout\\n' >> ${quotedTrace}\n`,
        { mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/reference-transaction'),
        `#!/bin/sh\ncat > /dev/null\nprintf 'ref\\n' >> ${quotedTrace}\n`,
        { mode: 0o755 }
      );
      const oldTime = new Date('2000-01-01T00:00:00Z');
      fs.utimesSync(path.join(fixture.repo, 'child.txt'), oldTime, oldTime);
      const normalEnv = { ...fixture.env };
      delete normalEnv.GIT_OPTIONAL_LOCKS;
      const before = [fixture.snapshot(), fixture.snapshot(linked), rawRefs()];
      const result = runCliInPty(getTestCliCommand(args), {
        cwd: fixture.repo,
        env: normalEnv,
        responses: args.includes('--quiet')
          ? []
          : [{ prompt: 'Choose a tip', input: '\u0003' }],
      });
      fixture.savePty(result);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      if (args.includes('--quiet')) {
        expect(result.status).to.equal(1);
        expect(result.output).to.include('requires interactive mode');
        expect(result.output).not.to.include('Choose a tip');
        expect(result.output).not.to.include('\u001b[?25');
      } else {
        expect(result.output).to.include('Choose a tip above child');
        expect(result.output)
          .to.match(/◯\s+tip/)
          .and.match(/◯\s+deep/);
        expect(result.output).not.to.match(
          /◯\s+(?:base|child|sibling|main|other|downstack-side|unrelated-tip|untracked-tip)\b/
        );
      }
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      expect(fs.existsSync(trace)).to.equal(false);
      const after = [fixture.snapshot(), fixture.snapshot(linked), rawRefs()];
      preserveState(before, after);
      expect(after).to.deep.equal(before);
      for (const cwd of [fixture.repo, linked])
        expect(fs.readFileSync(path.join(cwd, privateName))).to.deep.equal(
          bytes
        );
      expect(fixture.parent('tip')).to.equal('child');
      expect(fixture.parent('deep')).to.equal('sibling');
    });
  }

  for (const args of [
    ['--no-interactive'],
    ['--quiet', '--no-interactive'],
    ['--interactive=false'],
    ['--interactive', '--no-interactive'],
  ]) {
    for (const useInput of [false, true]) {
      it(`refuses ambiguous noninteractive scope before selector or editor, input=${useInput}: ${args.join(
        ' '
      )}`, () => {
        ambiguous();
        const normalEnv = { ...fixture.env };
        delete normalEnv.GIT_OPTIONAL_LOCKS;
        const before = [fixture.snapshot(), rawRefs()];
        const result = runCliInPty(
          getTestCliCommand([
            'ro',
            '--stack',
            ...args,
            ...(useInput
              ? ['--input', fixture.input('base\ntip\nchild\n')]
              : []),
          ]),
          { cwd: fixture.repo, env: normalEnv }
        );
        fixture.savePty(result);
        expect(result.status, result.output).not.to.equal(0);
        expect(result.status).not.to.equal(124);
        expect(result.output).to.include(
          useInput
            ? 'unique tip in non-interactive mode'
            : 'requires interactive mode or a supported explicit input file'
        );
        expect(result.output).not.to.include('Choose a tip');
        expect(fs.existsSync(fixture.offered)).to.equal(false);
        const after = [fixture.snapshot(), rawRefs()];
        preserveState(before, after);
        expect(after).to.deep.equal(before);
        expect(fixture.parent('deep')).to.equal('sibling');
      });
    }
  }

  for (const args of [
    ['--stack='],
    ['--stack=garbage'],
    ['--stack', 'false', '--stack'],
    ['--stack=false', '--stack=true'],
    ['--force'],
    ['--', 'tip'],
  ]) {
    it(`rejects raw invalid arguments before the ambiguous prompt: ${args.join(
      ' '
    )}`, () => {
      ambiguous();
      const before = [fixture.snapshot(), rawRefs()];
      const result = runCliInPty(
        getTestCliCommand(['reorder', '--stack', ...args]),
        { cwd: fixture.repo, env: fixture.env }
      );
      fixture.savePty(result);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).not.to.include('Choose a tip');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      expect([fixture.snapshot(), rawRefs()]).to.deep.equal(before);
    });
  }

  it('keeps an explicitly interactive chosen no-op with repeated true declarations unchanged', () => {
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    ambiguous();
    fixture.git(['status', '--porcelain']);
    const before = [fixture.snapshot(), rawRefs()];
    const result = choose('deep', [
      'ro',
      '--stack',
      'true',
      '--stack=true',
      '--no-interactive',
      '--interactive',
    ]);
    expect(result.status, result.output).to.equal(0);
    expect(
      fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 4)
    ).to.deep.equal(['deep', 'sibling', 'child', 'base']);
    const after = [fixture.snapshot(), rawRefs()];
    preserveState(before, after);
    expect(after).to.deep.equal(before);
    expect(fixture.parent('deep')).to.equal('sibling');
  });

  it('refuses quiet repeated-boolean selection before the prompt or editor and preserves the no-op graph', () => {
    ambiguous();
    const normalEnv = { ...fixture.env };
    delete normalEnv.GIT_OPTIONAL_LOCKS;
    const before = [fixture.snapshot(), rawRefs()];
    const result = runCliInPty(
      getTestCliCommand([
        'ro',
        '--stack',
        'true',
        '--stack=true',
        '--quiet',
        '--no-interactive',
        '--interactive',
      ]),
      { cwd: fixture.repo, env: normalEnv }
    );
    fixture.savePty(result);
    const after = [fixture.snapshot(), rawRefs()];
    preserveState(before, after);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('requires interactive mode');
    expect(result.output).not.to.include('Choose a tip');
    expect(result.output).not.to.include('\u001b[?25');
    expect(fs.existsSync(fixture.offered)).to.equal(false);
    expect(after).to.deep.equal(before);
    expect(fixture.parent('deep')).to.equal('sibling');
  });

  for (const departure of ['child', 'tip']) {
    it(`automatically offers the unique own chain from ${departure}, excluding downstack siblings`, () => {
      fixture.branch('downstack-side', 'base');
      fixture.git(['switch', departure]);
      const before = [fixture.snapshot(), rawRefs()];
      const result = runCliInPty(
        getTestCliCommand(['reorder', '--stack', '--interactive']),
        { cwd: fixture.repo, env: fixture.env }
      );
      fixture.savePty(result);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).not.to.include('Choose a tip');
      expect(
        fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 3)
      ).to.deep.equal(['tip', 'child', 'base']);
      expect([fixture.snapshot(), rawRefs()]).to.deep.equal(before);
    });
  }

  it('refuses unique noninteractive scope without input, and executes it with input', () => {
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    fixture.git(['switch', 'child']);
    fixture.git(['status', '--porcelain']);
    const before = [fixture.snapshot(), rawRefs()];
    const result = fixture.run([
      'ro',
      '--stack',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr)
      .to.include('requires interactive mode')
      .and.include('supported explicit input file');
    expect(fs.existsSync(fixture.offered)).to.equal(false);
    const after = [fixture.snapshot(), rawRefs()];
    preserveState(before, after);
    expect(after).to.deep.equal(before);
    fixture.ok([
      'ro',
      '--stack',
      '--input',
      fixture.input('base\ntip\nchild\n'),
    ]);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.parent('base')).to.equal('tip');
    expect(fixture.parent('child')).to.equal('main');
    expect(fs.existsSync(fixture.offered)).to.equal(false);
  });

  for (const missing of ['tip', 'deep']) {
    it(`refuses missing reachable tracked ${missing} before the selector or editor`, () => {
      ambiguous();
      fixture.git(['branch', '-D', missing]);
      const before = [fixture.snapshot(), rawRefs()];
      const result = runCliInPty(getTestCliCommand(['reorder', '--stack']), {
        cwd: fixture.repo,
        env: fixture.env,
      });
      fixture.savePty(result);
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).not.to.include('Choose a tip');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      expect([fixture.snapshot(), rawRefs()]).to.deep.equal(before);
    });
  }

  it('executes a chosen chain in its own linked worktree while preserving staged and unstaged read-only trunk bytes', () => {
    ambiguous();
    fixture.git(['switch', 'main']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged trunk');
    fixture.git(['add', 'main.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'main.txt'), ' and unstaged');
    const before = fixture.snapshot();
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    fixture.editor('base\ntip\nchild\n');
    const result = runCliInPty(getTestCliCommand(['ro', '--stack']), {
      cwd: linked,
      env: fixture.env,
      responses: [
        { prompt: 'Choose a tip', input: 'tip' },
        { prompt: '› tip\r\n', input: '\r' },
      ],
    });
    fixture.savePty(result);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal('child');
    expect(fixture.git(['status', '--porcelain'], linked)).to.equal('');
    expect({ ...fixture.snapshot(), refs: '' }).to.deep.equal({
      ...before,
      refs: '',
    });
    for (const [name, parent] of [
      ['child', 'main'],
      ['tip', 'child'],
      ['base', 'tip'],
      ['sibling', 'child'],
      ['deep', 'sibling'],
    ]) {
      fixture.ok(['checkout', name], linked);
      expect(fixture.ok(['info'], linked)).to.include(`Parent: ${parent}`);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
      ).to.equal(name);
    }
    fixture.ok(['checkout', 'child'], linked);
  });

  it('uses actual arrow keys to choose a different tip than the initial terminal suggestion', () => {
    ambiguous();
    const before = [fixture.snapshot(), rawRefs()];
    const result = runCliInPty(getTestCliCommand(['reorder', '--stack']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: '› \r\n', input: '\u001b[A' },
        { prompt: '› \r\n', input: '\r' },
      ],
    });
    fixture.savePty(result);
    expect(result.status, result.output).to.equal(0);
    const initial = result.output.split('› \r\n')[1]?.split('\u001b')[0] ?? '';
    const suggestion = /❯[^\r\n]*◯\s+(tip|deep)/.exec(initial)?.[1];
    expect(suggestion, result.output).to.be.oneOf(['tip', 'deep']);
    const offered = fs
      .readFileSync(fixture.offered, 'utf8')
      .split('\n')
      .filter((row) => row && !row.startsWith('#'));
    expect(offered[0]).to.equal(suggestion === 'tip' ? 'deep' : 'tip');
    expect(offered).to.deep.equal(
      offered[0] === 'tip'
        ? ['tip', 'child', 'base']
        : ['deep', 'sibling', 'child', 'base']
    );
    expect([fixture.snapshot(), rawRefs()]).to.deep.equal(before);
  });

  function ambiguous(): void {
    fixture.branch('sibling', 'child');
    fixture.branch('deep', 'sibling');
    fixture.git(['switch', 'child']);
  }

  function rawRefs(): string {
    return fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']);
  }

  function preserveState(before: unknown, after: unknown): void {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(
          evidence,
          `${path.basename(fixture.root)}-reorder-state.jsonl`
        ),
        JSON.stringify({ before, after }) + '\n'
      );
  }

  function choose(
    tip: string,
    args: readonly string[] = ['reorder', '--stack']
  ) {
    const result = runCliInPty(getTestCliCommand(args), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Choose a tip', input: tip },
        { prompt: `› ${tip}\r\n`, input: '\r' },
      ],
    });
    fixture.savePty(result);
    return result;
  }
});
