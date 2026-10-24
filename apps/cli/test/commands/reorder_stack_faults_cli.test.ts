import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function active(fixture: ReorderCliFixture, cwd = fixture.repo): boolean {
  return ['rebase-merge', 'rebase-apply'].some((name) =>
    fs.existsSync(
      path.resolve(cwd, fixture.git(['rev-parse', '--git-path', name], cwd))
    )
  );
}
function execute(
  fixture: ReorderCliFixture,
  output: string,
  options: { cwd?: string; resolveConflict?: () => void } = {}
): void {
  const cwd = options.cwd ?? fixture.repo;
  const bin = path.join(fixture.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'ch'),
    `#!/bin/sh\nexec ${getTestCliCommand([]).map(quote).join(' ')} "$@"\n`,
    { mode: 0o755 }
  );
  for (const command of commands(output)) {
    const env: NodeJS.ProcessEnv = {
      ...fixture.env,
      PATH: `${bin}:${fixture.env.PATH ?? ''}`,
    };
    delete env.GIT_OPTIONAL_LOCKS;
    const result = spawnSync('/bin/sh', ['-c', command], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 20000,
    });
    if (result.error) throw result.error;
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
      fs.appendFileSync(
        path.join(fixture.root, 'cli.jsonl'),
        JSON.stringify({
          command,
          cwd,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        }) + '\n'
      );
    if (active(fixture, cwd)) {
      expect(result.status, result.stdout + result.stderr).not.to.equal(0);
      if (!options.resolveConflict)
        throw new Error('Unexpected retry conflict');
      options.resolveConflict();
      fixture.ok(['continue'], cwd);
    } else expect(result.status, result.stdout + result.stderr).to.equal(0);
  }
}
function final(fixture: ReorderCliFixture, cwd = fixture.repo): void {
  expect(fixture.git(['branch', '--show-current'], cwd)).to.equal('child');
  expect(active(fixture, cwd)).to.equal(false);
  expect(fixture.git(['status', '--porcelain'], cwd)).to.equal('');
  for (const [name, parent] of [
    ['child', 'main'],
    ['tip', 'child'],
    ['base', 'tip'],
  ]) {
    fixture.ok(['checkout', name], cwd);
    expect(fixture.ok(['info'], cwd)).to.include(`Parent: ${parent}`);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
    ).to.equal(name);
    expect(fixture.git(['show', `${name}:${name}.txt`])).to.equal(name);
  }
  fixture.ok(['checkout', 'child'], cwd);
}
function commands(output: string): string[] {
  return output
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => /^ch (restack --branch|checkout) /.test(row));
}
function hook(
  fixture: ReorderCliFixture,
  name: string,
  content: string
): string {
  const file = path.join(fixture.repo, '.git/hooks', name);
  fs.writeFileSync(file, `#!/bin/sh\n${content}\n`, { mode: 0o755 });
  return file;
}
function run(
  fixture: ReorderCliFixture,
  args: readonly string[],
  cwd = fixture.repo
) {
  const env = { ...fixture.env };
  delete env.GIT_OPTIONAL_LOCKS;
  const result = spawnSync(
    getTestCliCommand(args)[0],
    getTestCliCommand(args).slice(1),
    {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 20000,
    }
  );
  if (result.error) throw result.error;
  if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
    fs.appendFileSync(
      path.join(fixture.root, 'cli.jsonl'),
      JSON.stringify({
        args,
        cwd,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      }) + '\n'
    );
  return result;
}
function savedParent(fixture: ReorderCliFixture, name: string): string {
  const meta: unknown = JSON.parse(
    fixture.git(['cat-file', '-p', `refs/branch-metadata/${name}`])
  );
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('parentBranchName' in meta)
  )
    throw new Error('Missing parent');
  const parent: unknown = Reflect.get(meta, 'parentBranchName');
  if (typeof parent !== 'string') throw new Error('Invalid parent');
  return parent;
}
// eslint-disable-next-line max-lines-per-function
describe('stack reorder bounded real Git and storage failures', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\n');
  });
  afterEach(() => fixture?.cleanup());

  it('reports actual durable parent edges and refs after a later metadata write is refused', () => {
    const refused = hook(
      fixture,
      'reference-transaction',
      'if [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/branch-metadata/base) echo "late parent storage refused" >&2; exit 1;; esac\ndone\nfi'
    );
    const before = fixture.snapshot();
    const result = run(fixture, ['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      ['child', 'tip', 'base'].map((name) => savedParent(fixture, name))
    ).to.deep.equal(['main', 'child', 'main']);
    expect(output)
      .to.include('Parent graph: incomplete')
      .and.include('Phase: parent graph installation')
      .and.include('Current checkout: child');
    for (const [name, parent] of [
      ['child', 'main'],
      ['tip', 'child'],
      ['base', 'main'],
    ])
      expect(output).to.include(
        `Saved branch: ${name} -> ${parent}; ref: ${fixture.git([
          'rev-parse',
          `refs/heads/${name}`,
        ])}`
      );
    expect(output).not.to.include('Applied parents:');
    expect(commands(output)).to.deep.equal([]);
    expect(output).not.to.match(/retry.*reorder/i);
    fs.unlinkSync(refused);
    fixture.ok(['info']);
    fixture.ok(['log']);
    expect(fixture.parent('child')).to.equal('main');
    expect(fixture.parent('base')).to.equal('main');
  });
  it('reports the published graph when a metadata hook occupies a pending branch after preflight', () => {
    const linked = path.join(fixture.root, 'late-worktree');
    const savedIndex = path.join(fixture.root, 'linked-index');
    const guard = hook(
      fixture,
      'reference-transaction',
      `found=false
while read old new ref; do
  if [ "$ref" = refs/branch-metadata/base ]; then found=true; fi
done
if [ "$1" = committed ] && $found && mkdir ${quote(
        path.join(fixture.root, 'once')
      )} 2>/dev/null; then
  git worktree add ${quote(linked)} tip || exit 1
  printf 'linked staged' > ${quote(path.join(linked, 'tip.txt'))}
  git -C ${quote(linked)} add tip.txt
  printf 'linked unfinished' > ${quote(path.join(linked, 'tip.txt'))}
  cp ${quote(
    path.join(fixture.repo, '.git/worktrees/late-worktree/index')
  )} ${quote(savedIndex)}
fi`
    );
    const before = fixture.snapshot();
    const result = run(fixture, ['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(output)
      .to.include('worktree')
      .and.include('Parent graph: applied')
      .and.include('Completed branches: none')
      .and.include('Remaining branches: child, tip, base')
      .and.include('Current checkout: child');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.index(linked)).to.equal(
      fs.readFileSync(savedIndex).toString('base64')
    );
    expect(fs.readFileSync(path.join(linked, 'tip.txt'), 'utf8')).to.equal(
      'linked unfinished'
    );
    const linkedSaved = fixture.snapshot(linked);
    fs.unlinkSync(guard);
    fixture.git(['switch', '--detach'], linked);
    const saved = fixture.snapshot();
    expect(run(fixture, ['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(saved);
    execute(fixture, output);
    final(fixture);
    expect({
      ...fixture.snapshot(linked),
      refs: linkedSaved.refs,
      branch: linkedSaved.branch,
    }).to.deep.equal(linkedSaved);
  });

  it('protects a late occupied parent-only empty branch even when every selected empty tip has the trunk SHA', () => {
    fixture.branch('empty-one', 'main', true);
    fixture.branch('empty-two', 'empty-one', true);
    fixture.ok(['move', '--source', 'base', '--onto', 'empty-two']);
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\nempty-one\nempty-two\n');
    const linked = path.join(fixture.root, 'late-empty');
    const guard = hook(
      fixture,
      'reference-transaction',
      `found=false
while read old new ref; do
  if [ "$ref" = refs/branch-metadata/base ]; then found=true; fi
done
if [ "$1" = committed ] && $found && mkdir ${quote(
        path.join(fixture.root, 'once')
      )} 2>/dev/null; then
  git worktree add ${quote(linked)} empty-one
fi`
    );
    const before = fixture.snapshot();
    const result = run(fixture, ['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(output)
      .to.include('worktree')
      .and.include('Parent graph: applied')
      .and.include('Completed branches: none')
      .and.include(
        'Remaining branches: empty-two, empty-one, child, tip, base'
      );
    expect(fixture.snapshot()).to.deep.equal(before);
    const linkedSaved = fixture.snapshot(linked);
    expect(fixture.git(['rev-parse', 'empty-one'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['rev-parse', 'empty-two'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    fs.unlinkSync(guard);
    fixture.git(['switch', '--detach'], linked);
    const saved = fixture.snapshot();
    expect(run(fixture, ['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(saved);
    execute(fixture, output);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    for (const [name, parent, subjects] of [
      ['empty-two', 'main', ''],
      ['empty-one', 'empty-two', ''],
      ['child', 'empty-one', 'child'],
      ['tip', 'child', 'tip'],
      ['base', 'tip', 'base'],
    ]) {
      expect(fixture.parent(name)).to.equal(parent);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
      ).to.equal(subjects);
    }
    expect({
      ...fixture.snapshot(linked),
      refs: linkedSaved.refs,
      branch: linkedSaved.branch,
    }).to.deep.equal(linkedSaved);
  });
  for (const denied of ['child', 'base']) {
    it(`reports a real pre-rebase hook refusal on ${denied} and executes the remaining named commands`, () => {
      const refused = hook(
        fixture,
        'pre-rebase',
        `if [ "$2" = ${quote(
          denied
        )} ]; then echo 'real replay hook refused' >&2; exit 1; fi`
      );
      const unchanged = ['main', 'other'].map((name) =>
        fixture.git(['rev-parse', name])
      );
      const result = run(fixture, ['reorder', '--stack', '--interactive']);
      const output = result.stdout + result.stderr;
      expect(result.status).not.to.equal(0);
      expect(active(fixture)).to.equal(false);
      expect(output)
        .to.include('real replay hook refused')
        .and.include('Parent graph: applied')
        .and.include('Conflict branch: none');
      expect(output)
        .to.include(
          `Completed branches: ${denied === 'child' ? 'none' : 'child, tip'}`
        )
        .and.include(
          `Remaining branches: ${
            denied === 'child' ? 'child, tip, base' : 'base'
          }`
        );
      const completed = ['child', 'tip'].map((name) =>
        fixture.git(['rev-parse', name])
      );
      const before = fixture.snapshot();
      expect(run(fixture, ['continue']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fs.unlinkSync(refused);
      execute(fixture, output);
      final(fixture);
      if (denied === 'base')
        expect(
          ['child', 'tip'].map((name) => fixture.git(['rev-parse', name]))
        ).to.deep.equal(completed);
      expect(
        ['main', 'other'].map((name) => fixture.git(['rev-parse', name]))
      ).to.deep.equal(unchanged);
    });
  }
  it('counts the final committed rewrite when a return hook fails after Git actually reaches C', () => {
    const marker = path.join(fixture.root, 'base-rewritten');
    const rewritten = hook(
      fixture,
      'post-rewrite',
      `if [ "$(git symbolic-ref --short -q HEAD)" = base ]; then touch ${quote(
        marker
      )}; fi`
    );
    const refused = hook(
      fixture,
      'post-checkout',
      `if [ -f ${quote(
        marker
      )} ] && [ "$(git symbolic-ref --short -q HEAD)" = child ]; then echo 'final return hook refused' >&2; exit 1; fi`
    );
    const result = run(fixture, ['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(active(fixture)).to.equal(false);
    expect(output)
      .to.include('final return hook refused')
      .and.include('Completed branches: child, tip, base')
      .and.include('Remaining branches: none')
      .and.include('Current checkout: child')
      .and.include('Conflict branch: none');
    expect(commands(output)).to.deep.equal(["ch checkout 'child'"]);
    const completed = fixture.refs();
    const before = fixture.snapshot();
    expect(run(fixture, ['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fs.unlinkSync(refused);
    fs.unlinkSync(rewritten);
    execute(fixture, output);
    final(fixture);
    expect(fixture.refs()).to.equal(completed);
  });
  for (const kind of ['ignored', 'untracked', 'dirty']) {
    it(`preserves late ${kind} bytes after an earlier replay and stops before the next one`, () => {
      const file = kind === 'dirty' ? 'main.txt' : 'base.txt';
      if (kind === 'ignored')
        fs.appendFileSync(
          path.join(fixture.repo, '.git/info/exclude'),
          '\nbase.txt\n'
        );
      const marker = path.join(fixture.root, 'once');
      const wrote = hook(
        fixture,
        'post-rewrite',
        `if mkdir ${quote(
          marker
        )} 2>/dev/null; then printf '\\000\\377\\200\\013' > ${quote(file)}; fi`
      );
      const result = run(fixture, ['reorder', '--stack', '--interactive']);
      const output = result.stdout + result.stderr;
      expect(result.status).not.to.equal(0);
      expect(active(fixture)).to.equal(false);
      expect(output)
        .to.include('Completed branches: child')
        .and.include('Remaining branches: tip, base')
        .and.include('Current checkout: child');
      expect(fs.readFileSync(path.join(fixture.repo, file))).to.deep.equal(
        Buffer.from([0, 255, 128, 11])
      );
      const completed = fixture.git(['rev-parse', 'child']);
      const before = fixture.snapshot();
      expect(run(fixture, ['continue']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      const saved = path.join(fixture.root, 'saved-bytes');
      fs.renameSync(path.join(fixture.repo, file), saved);
      if (kind === 'dirty') fixture.git(['checkout', '--', file]);
      fs.unlinkSync(wrote);
      execute(fixture, output);
      final(fixture);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(completed);
      expect(fs.readFileSync(saved)).to.deep.equal(
        Buffer.from([0, 255, 128, 11])
      );
    });
  }

  it('preserves a late occupied pending worktree and both raw indexes after the first replay', () => {
    const linked = path.join(fixture.root, 'late-worktree');
    const savedIndex = path.join(fixture.root, 'linked-index');
    const wrote = hook(
      fixture,
      'post-rewrite',
      `if mkdir ${quote(path.join(fixture.root, 'once'))} 2>/dev/null; then
  git worktree add ${quote(linked)} base
  printf 'staged linked' > ${quote(path.join(linked, 'base.txt'))}
  git -C ${quote(linked)} add base.txt
  printf 'unfinished linked' > ${quote(path.join(linked, 'base.txt'))}
  cp ${quote(
    path.join(fixture.repo, '.git/worktrees/late-worktree/index')
  )} ${quote(savedIndex)}
fi`
    );
    const result = run(fixture, ['reorder', '--stack', '--interactive']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(output)
      .to.include('worktree')
      .and.include('Completed branches: child')
      .and.include('Remaining branches: tip, base');
    expect(fixture.index(linked)).to.equal(
      fs.readFileSync(savedIndex).toString('base64')
    );
    const linkedSaved = fixture.snapshot(linked);
    const before = fixture.snapshot();
    expect(run(fixture, ['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(linked)).to.deep.equal(linkedSaved);
    fixture.git(['switch', '--detach'], linked);
    fs.unlinkSync(wrote);
    execute(fixture, output);
    final(fixture);
    expect({
      ...fixture.snapshot(linked),
      refs: linkedSaved.refs,
      branch: linkedSaved.branch,
    }).to.deep.equal(linkedSaved);
  });
  for (const tip of ['tip', 'deep']) {
    it(`protects a late off-chain ignored path after real selection of ${tip} from its own linked worktree`, () => {
      fixture.branch('sibling', 'child');
      fixture.branch('deep', 'sibling');
      fixture.git(['switch', 'main']);
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged trunk');
      fixture.git(['add', 'main.txt']);
      fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'unfinished trunk');
      const primary = fixture.snapshot();
      const unchanged = ['main', 'other'].map((name) =>
        fixture.git(['rev-parse', name])
      );
      const linked = path.join(fixture.root, 'own-linked');
      fixture.git(['worktree', 'add', linked, 'child']);
      const file = tip === 'tip' ? 'deep.txt' : 'tip.txt';
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        `\n${file}\n`
      );
      fixture.editor(
        tip === 'tip' ? 'base\ntip\nchild\n' : 'base\ndeep\nsibling\nchild\n'
      );
      const wrote = hook(
        fixture,
        'reference-transaction',
        `found=false
while read old new ref; do
  if [ "$ref" = refs/branch-metadata/base ]; then found=true; fi
done
if [ "$1" = committed ] && $found && mkdir ${quote(
          path.join(fixture.root, 'once')
        )} 2>/dev/null; then
  printf '\\000\\377\\200\\013' > ${quote(file)}
fi`
      );
      const index = fixture.index(linked);
      const env = { ...fixture.env };
      delete env.GIT_OPTIONAL_LOCKS;
      const result = runCliInPty(getTestCliCommand(['reorder', '--stack']), {
        cwd: linked,
        env,
        responses: [
          { prompt: 'Choose a tip', input: tip },
          { prompt: `› ${tip}\r\n`, input: '\r' },
        ],
      });
      if (process.env.CHARCOAL_TEST_EVIDENCE_DIR)
        fs.appendFileSync(
          path.join(fixture.root, 'cli.jsonl'),
          JSON.stringify({ pty: result }) + '\n'
        );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(
        fs
          .readFileSync(fixture.offered, 'utf8')
          .split('\n')
          .slice(0, tip === 'tip' ? 3 : 4)
      ).to.deep.equal(
        tip === 'tip'
          ? ['tip', 'child', 'base']
          : ['deep', 'sibling', 'child', 'base']
      );
      expect(result.output)
        .to.include('ignored file')
        .and.include('Parent graph: applied')
        .and.include('Completed branches: none');
      expect(fixture.index(linked)).to.equal(index);
      expect(fs.readFileSync(path.join(linked, file))).to.deep.equal(
        Buffer.from([0, 255, 128, 11])
      );
      const before = fixture.snapshot(linked);
      expect(run(fixture, ['continue'], linked).status).not.to.equal(0);
      expect(fixture.snapshot(linked)).to.deep.equal(before);
      fs.renameSync(
        path.join(linked, file),
        path.join(fixture.root, 'saved-bytes')
      );
      fs.unlinkSync(wrote);
      execute(fixture, result.output, { cwd: linked });
      expect(fixture.git(['branch', '--show-current'], linked)).to.equal(
        'child'
      );
      const parents =
        tip === 'tip'
          ? [
              ['child', 'main'],
              ['tip', 'child'],
              ['base', 'tip'],
              ['sibling', 'child'],
              ['deep', 'sibling'],
            ]
          : [
              ['child', 'main'],
              ['sibling', 'child'],
              ['deep', 'sibling'],
              ['base', 'deep'],
              ['tip', 'child'],
            ];
      for (const [name, parent] of parents) {
        fixture.ok(['checkout', name], linked);
        expect(fixture.ok(['info'], linked)).to.include(`Parent: ${parent}`);
        expect(
          fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
        ).to.equal(name);
        expect(fixture.git(['show', `${name}:${name}.txt`])).to.equal(name);
      }
      fixture.ok(['checkout', 'child'], linked);
      expect(active(fixture, linked)).to.equal(false);
      expect(fixture.git(['status', '--porcelain'], linked)).to.equal('');
      expect(
        ['main', 'other'].map((name) => fixture.git(['rev-parse', name]))
      ).to.deep.equal(unchanged);
      expect({ ...fixture.snapshot(), refs: primary.refs }).to.deep.equal(
        primary
      );
      expect(
        fs.readFileSync(path.join(fixture.root, 'saved-bytes'))
      ).to.deep.equal(Buffer.from([0, 255, 128, 11]));
    });
  }

  it('reports a confirmed fresh-continue replay when only its metadata publication fails', () => {
    fixture.git(['switch', 'base']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base own edit');
    fixture.git(['add', 'main.txt']);
    fixture.git(['commit', '-m', 'base edit']);
    fixture.ok(['restack', '--branch', 'child', '--upstack']);
    fixture.git(['switch', 'child']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child own edit');
    fixture.git(['add', 'main.txt']);
    fixture.git(['commit', '-m', 'child edit']);
    fixture.ok(['restack', '--branch', 'tip']);
    fixture.git(['switch', 'child']);
    const first = run(fixture, ['reorder', '--stack', '--interactive']);
    expect(first.status).not.to.equal(0);
    expect(active(fixture)).to.equal(true);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child recovered');
    fixture.git(['add', 'main.txt']);
    const old = fixture.git(['rev-parse', 'child']);
    const metadata = fixture.git(['rev-parse', 'refs/branch-metadata/child']);
    const refused = hook(
      fixture,
      'reference-transaction',
      'if [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/branch-metadata/child) echo "replay metadata refused" >&2; exit 1;; esac\ndone\nfi'
    );
    const result = run(fixture, ['continue']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    expect(active(fixture)).to.equal(false);
    expect(fixture.git(['rev-parse', 'child'])).not.to.equal(old);
    expect(fixture.git(['rev-parse', 'refs/branch-metadata/child'])).to.equal(
      metadata
    );
    expect(output)
      .to.include('replay metadata refused')
      .and.include('Completed branches: child')
      .and.include('Remaining branches: tip, base')
      .and.include('Phase: replay metadata publication')
      .and.include('Conflict branch: none')
      .and.include('Current checkout: child');
    expect(output).to.include(
      `Saved branch: child -> main; ref: ${fixture.git(['rev-parse', 'child'])}`
    );
    // A fresh reader must see the durable state and attempt its normal repair,
    // rather than silently accepting a cache published from the rejected write.
    const inspect = run(fixture, ['info']);
    expect(inspect.status, inspect.stdout + inspect.stderr).not.to.equal(0);
    expect(inspect.stdout + inspect.stderr).to.include(
      'replay metadata refused'
    );
    fs.unlinkSync(refused);
    const completed = fixture.git(['rev-parse', 'child']);
    fixture.ok(['info']);
    fixture.ok(['log']);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completed);
    const before = fixture.snapshot();
    expect(run(fixture, ['continue']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    // The base has a genuine renewed conflict; execute the printed commands
    // one by one and resolve that conflict before the final literal checkout.
    const retries = commands(output);
    expect(retries).to.deep.equal([
      "ch restack --branch 'tip' --only",
      "ch restack --branch 'base' --only",
      "ch checkout 'child'",
    ]);
    execute(fixture, output, {
      resolveConflict: () => {
        fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base recovered');
        fixture.git(['add', 'main.txt']);
      },
    });
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(completed);
    for (const [name, parent, subjects] of [
      ['child', 'main', 'child\nchild edit'],
      ['tip', 'child', 'tip'],
      ['base', 'tip', 'base\nbase edit'],
    ]) {
      expect(fixture.parent(name)).to.equal(parent);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${name}`])
      ).to.equal(subjects);
    }
    expect(fixture.git(['show', 'base:main.txt'])).to.equal('base recovered');
  });
});
