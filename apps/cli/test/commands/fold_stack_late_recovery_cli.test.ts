import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { expectParent } from '../lib/utils/expect_parent';

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function index(fixture: CreateCliFixture, cwd = fixture.repo): Buffer {
  return fs.readFileSync(
    path.resolve(cwd, fixture.git(['rev-parse', '--git-path', 'index'], cwd))
  );
}
function expectRebase(fixture: CreateCliFixture, active: boolean): void {
  expect(
    ['rebase-merge', 'rebase-apply'].some((name) =>
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', name])
        )
      )
    )
  ).to.equal(active);
}
function executeRecovery(
  fixture: CreateCliFixture,
  output: string,
  expected: readonly string[]
): void {
  const commands = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^an (restack --branch|checkout) /.test(line));
  expect(commands).to.deep.equal(expected);
  const cli = getTestCliCommand([]).map(quote).join(' ');
  fs.writeFileSync(
    path.join(fixture.root, 'bin/an'),
    `#!/bin/sh\nexec ${cli} "$@" --no-interactive\n`,
    { mode: 0o755 }
  );
  for (const command of commands) {
    const result = spawnSync('/bin/sh', ['-c', command], {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stdout + result.stderr).to.equal(0);
  }
}
function hook(fixture: CreateCliFixture, name: string, script: string): string {
  const file = path.join(fixture.repo, '.git/hooks', name);
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return file;
}
function linkedWork(fixture: CreateCliFixture): {
  readonly snapshot: ReturnType<typeof fixture.snapshot>;
  readonly bytes: Buffer;
} {
  fixture.git(['worktree', 'add', fixture.linked, 'other']);
  fixture.stage('main.txt', 'linked staged bytes', fixture.linked);
  fixture.write('main.txt', 'linked unfinished bytes', fixture.linked);
  fixture.write('untracked.bin', 'linked private bytes', fixture.linked);
  return {
    snapshot: fixture.snapshot(fixture.linked),
    bytes: index(fixture, fixture.linked),
  };
}
function expectLinked(
  fixture: CreateCliFixture,
  saved: ReturnType<typeof linkedWork>
): void {
  expect({
    ...fixture.snapshot(fixture.linked),
    refs: saved.snapshot.refs,
  }).to.deep.equal(saved.snapshot);
  expect(index(fixture, fixture.linked)).to.deep.equal(saved.bytes);
}
for (const keep of [false, true]) {
  const survivor = keep ? 'tip' : 'base';
  const fold = ['fold', '--stack', `--keep=${keep}`];
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold controlled late public recovery (keep=${keep})`, function () {
    this.timeout(90000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());

    it('keeps all selected refs and both indexes when the bounded ref transaction is refused', () => {
      fixture.branch("a'root", 'base');
      fixture.branch('deep', "a'root");
      fixture.git(['switch', 'child']);
      const linked = linkedWork(fixture);
      const before = fixture.snapshot();
      const bytes = index(fixture);
      const refusal = hook(
        fixture,
        'reference-transaction',
        'if [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/heads/child) echo selected-ref-refused >&2; exit 1;; esac\ndone\nfi'
      );
      const result = fixture.run(fold);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr)
        .to.include('Selected refs were not published')
        .and.include('selected-ref-refused');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(index(fixture)).to.deep.equal(bytes);
      expectLinked(fixture, linked);
      fs.unlinkSync(refusal);
      expectParent(fixture, "a'root", 'base');
      expectParent(fixture, 'deep', "a'root");
      expectParent(fixture, 'child', 'base');
      expectParent(fixture, 'tip', 'child');
    });

    it('reports a later real hook refusal after a completed prefix and executes all named recovery', () => {
      fixture.branch('a-completed', 'base');
      fixture.branch("z'root", 'base');
      fixture.branch('deep', "z'root");
      fixture.git(['switch', 'child']);
      const original = fixture.git(['rev-parse', "z'root"]);
      const tip = fixture.git(['rev-parse', 'tip']);
      const linked = linkedWork(fixture);
      const refusal = hook(
        fixture,
        'pre-rebase',
        `if [ "$2" = ${quote(
          "z'root"
        )} ]; then echo late-hook-refused >&2; exit 1; fi`
      );
      const result = fixture.run(fold);
      const output = result.stdout + result.stderr;
      expect(result.status).not.to.equal(0);
      expect(output)
        .to.include('Completed branches: a-completed')
        .and.include('late-hook-refused')
        .and.include(`Current checkout: ${survivor}`)
        .and.include("Remaining branches: z'root, deep");
      expectRebase(fixture, false);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
      expect(fixture.git(['rev-parse', "z'root"])).to.equal(original);
      expectLinked(fixture, linked);
      const completed = fixture.git(['rev-parse', 'a-completed']);
      fs.unlinkSync(refusal);
      executeRecovery(fixture, output, [
        `an restack --branch ${quote("z'root")} --only`,
        "an restack --branch 'deep' --only",
        `an checkout '${survivor}'`,
      ]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', 'a-completed'])).to.equal(completed);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..z'root`])
      ).to.equal("z'root");
      expect(
        fixture.git(['log', '--reverse', '--format=%s', "z'root..deep"])
      ).to.equal('deep');
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expectLinked(fixture, linked);
      expectParent(fixture, "z'root", survivor);
      expectParent(fixture, 'deep', "z'root");
    });

    for (const ignored of [false, true]) {
      it(`protects hook-created literal intermediate replay bytes before the next branch (ignored=${ignored})`, () => {
        const literal = '[private] line\npath.bin';
        fixture.branch('a-completed', 'base');
        fixture.branch("z'root", 'base');
        fixture.stage(literal, 'temporary tracked bytes');
        fixture.git(['commit', '-m', 'own transient add']);
        fixture.git(['rm', '--', literal]);
        fixture.git(['commit', '-m', 'own transient delete']);
        fixture.git(['switch', 'child']);
        if (ignored)
          fs.appendFileSync(
            path.join(fixture.repo, '.git/info/exclude'),
            '\n*\n'
          );
        const bytes = Buffer.from([0, 255, 128, 11]);
        const blocker = hook(
          fixture,
          'pre-rebase',
          `if [ "$2" = a-completed ]; then printf '\\000\\377\\200\\013' > ${quote(
            literal
          )}; fi`
        );
        const result = fixture.run(fold);
        const output = result.stdout + result.stderr;
        expect(result.status).not.to.equal(0);
        expect(output)
          .to.include('Completed branches: a-completed')
          .and.include("Remaining branches: z'root");
        expect(output).to.include(ignored ? 'ignored file' : 'untracked file');
        expect(fs.readFileSync(path.join(fixture.repo, literal))).to.deep.equal(
          bytes
        );
        expectRebase(fixture, false);
        const completed = fixture.git(['rev-parse', 'a-completed']);
        const saved = path.join(fixture.root, 'saved-private');
        fs.renameSync(path.join(fixture.repo, literal), saved);
        fs.unlinkSync(blocker);
        executeRecovery(fixture, output, [
          `an restack --branch ${quote("z'root")} --only`,
          `an checkout '${survivor}'`,
        ]);
        expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
        expect(fixture.git(['rev-parse', 'a-completed'])).to.equal(completed);
        expect(
          fixture.git([
            'log',
            '--reverse',
            '--format=%s',
            `${survivor}..z'root`,
          ])
        ).to.equal("z'root\nown transient add\nown transient delete");
        expect(fs.readFileSync(saved)).to.deep.equal(bytes);
        expect(fixture.git(['status', '--porcelain'])).to.equal('');
        expectRebase(fixture, false);
      });

      it(`protects hook-created active replay bytes in fresh continue without changing the staged resolution (ignored=${ignored})`, () => {
        const literal = '[private] active\npath.bin';
        fixture.branch('a-completed', 'base');
        fixture.branch("b'root", 'base');
        fixture.stage('child.txt', 'conflicting own content');
        fixture.git(['commit', '-m', 'own conflict']);
        fixture.stage(literal, 'transient bytes');
        fixture.git(['commit', '-m', 'own transient add']);
        fixture.git(['rm', '--', literal]);
        fixture.git(['commit', '-m', 'own transient delete']);
        fixture.git(['switch', 'child']);
        if (ignored)
          fs.appendFileSync(
            path.join(fixture.repo, '.git/info/exclude'),
            '\n*\n'
          );
        expect(fixture.run(fold).status).not.to.equal(0);
        expectRebase(fixture, true);
        expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
        const blocker = hook(
          fixture,
          'post-index-change',
          `printf '\\000\\377\\200\\013' > ${quote(literal)}`
        );
        fixture.stage('child.txt', 'staged public resolution');
        fs.unlinkSync(blocker);
        fixture.ok(['info']);
        fixture.ok(['log', 'short']);
        const before = fixture.snapshot();
        const stagedIndex = index(fixture);
        const result = fixture.run(['continue']);
        const output = result.stdout + result.stderr;
        expect(result.status).not.to.equal(0);
        expect(output)
          .to.include(ignored ? 'ignored file' : 'untracked file')
          .and.include('Current checkout: detached HEAD');
        expect(fixture.snapshot()).to.deep.equal(before);
        expect(index(fixture)).to.deep.equal(stagedIndex);
        expectRebase(fixture, true);
        expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
        const bytes = Buffer.from([0, 255, 128, 11]);
        expect(fs.readFileSync(path.join(fixture.repo, literal))).to.deep.equal(
          bytes
        );
        const saved = path.join(fixture.root, 'saved-private');
        fs.renameSync(path.join(fixture.repo, literal), saved);
        fixture.ok(['continue']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
        expectRebase(fixture, false);
        expect(
          fixture.git([
            'log',
            '--reverse',
            '--format=%s',
            `${survivor}..b'root`,
          ])
        ).to.equal(
          "b'root\nown conflict\nown transient add\nown transient delete"
        );
        expect(fixture.git(['show', "b'root:child.txt"])).to.equal(
          'staged public resolution'
        );
        expect(fixture.git(['status', '--porcelain'])).to.equal('');
        expect(fs.readFileSync(saved)).to.deep.equal(bytes);
      });
    }

    it('distinguishes a completed fresh-continue rewrite from its failed Unicode-alias return', () => {
      fixture.git(['switch', 'base']);
      fixture.stage('café.txt', 'selected Unicode content');
      fixture.git(['commit', '-m', 'selected Unicode path']);
      fixture.ok(['restack', '--branch', 'child', '--upstack']);
      fixture.branch("b'root", 'base');
      fixture.stage('child.txt', 'conflicting own content');
      fixture.git(['commit', '-m', 'own conflict']);
      fixture.git(['rm', 'café.txt']);
      fixture.git(['commit', '-m', 'own Unicode removal']);
      fixture.git(['switch', 'child']);
      const tip = fixture.git(['rev-parse', 'tip']);
      const linked = linkedWork(fixture);
      expect(fixture.run(fold).status).not.to.equal(0);
      expectRebase(fixture, true);
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      fixture.stage('child.txt', 'continued own resolution');
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\ncafé.txt\ncafe\u0301.txt\n'
      );
      const blocker = hook(
        fixture,
        'post-rewrite',
        `printf '\\000\\377\\200\\013' > ${quote('cafe\u0301.txt')}`
      );
      const result = fixture.run(['continue']);
      const output = result.stdout + result.stderr;
      expect(result.status).not.to.equal(0);
      expect(output)
        .to.match(/rewrite[^\n]*completed/i)
        .and.include("Completed branches: b'root")
        .and.include('Remaining branches: none')
        .and.include("Current checkout: b'root");
      expect(fixture.git(['branch', '--show-current'])).to.equal("b'root");
      expectRebase(fixture, false);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..b'root`])
      ).to.equal("b'root\nown conflict\nown Unicode removal");
      expect(fixture.git(['show', "b'root:child.txt"])).to.equal(
        'continued own resolution'
      );
      expectLinked(fixture, linked);
      const bytes = Buffer.from([0, 255, 128, 11]);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'cafe\u0301.txt'))
      ).to.deep.equal(bytes);
      const completed = fixture.git(['rev-parse', "b'root"]);
      const before = fixture.snapshot();
      const stagedIndex = index(fixture);
      expect(fixture.run(['continue']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(index(fixture)).to.deep.equal(stagedIndex);
      const saved = path.join(fixture.root, 'saved-private');
      fs.renameSync(path.join(fixture.repo, 'cafe\u0301.txt'), saved);
      fs.unlinkSync(blocker);
      executeRecovery(fixture, output, [`an checkout '${survivor}'`]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', "b'root"])).to.equal(completed);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fs.readFileSync(saved)).to.deep.equal(bytes);
      expectLinked(fixture, linked);
      expectParent(fixture, "b'root", survivor);
    });
  });
}
