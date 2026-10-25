import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// The public CLI and independent Git observations are the approved seam.
// eslint-disable-next-line max-lines-per-function
describe('modern short options through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.git(['status', '--porcelain']);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-short-options-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          root: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence && fixture) {
      fs.writeFileSync(
        path.join(evidence, `${path.basename(fixture.root)}-editor.json`),
        JSON.stringify(
          {
            environment: Object.fromEntries(
              [
                'GIT_EDITOR',
                'CH_EDITOR',
                'GRAPHITE_USER_CONFIG_PATH',
                'GRAPHITE_INTERACTIVE',
                'GIT_OPTIONAL_LOCKS',
              ].map((key) => [key, fixture.env[key] ?? null])
            ),
            files: Object.fromEntries(
              ['message-editor', 'message-editor.json'].map((name) => {
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
        ) + '\n'
      );
    }
    fixture?.cleanup();
  });

  function preserved(): Record<string, unknown> {
    const snapshot = fixture.inspectionSnapshot();
    return Object.fromEntries(
      [
        'head',
        'branch',
        'refs',
        'index',
        'staging',
        'status',
        'files',
        'operation',
      ].map((key) => [key, snapshot[key]])
    );
  }

  function stageWork(): void {
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected work');
    fixture.git(['add', 'selected.txt']);
  }

  function forbidEditor(): void {
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  }

  it('untracks a leaf with utr and proves the public inspection outcome', () => {
    const refs = fixture.git(['show-ref', '--heads']);
    expect(fixture.run(['info', 'tip']).status).to.equal(0);
    const result = fixture.run(['utr', 'tip', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.run(['info', 'tip']).status).to.equal(1);
    expect(fixture.run(['info', 'child']).status).to.equal(0);
    expect(fixture.git(['show-ref', '--heads'])).to.equal(refs);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('creates through c -o on the selected parent with staged content', () => {
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected work');
    fixture.git(['add', 'selected.txt']);
    const other = fixture.git(['rev-parse', 'other']);
    const refs = fixture.git(['show-ref', '--heads']);
    const result = fixture.run([
      'c',
      'created',
      '-o',
      'other',
      '-m',
      'selected message',
      '--quiet',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('created');
    expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(other);
    expect(fixture.run(['parent']).stdout).to.equal('other\n');
    expect(fixture.git(['show', 'HEAD:selected.txt'])).to.equal(
      'selected work'
    );
    expect(fixture.git(['show', 'HEAD:other.txt'])).to.equal('other');
    expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
      'selected message'
    );
    for (const ref of refs.split('\n'))
      expect(fixture.git(['show-ref', '--heads'])).to.include(ref);
  });

  it('amends through m -e with a real permitted message editor and restacks children', () => {
    const editor = path.join(fixture.root, 'message-editor');
    const marker = path.join(fixture.root, 'message-editor.json');
    fs.writeFileSync(
      editor,
      `#!${
        process.execPath
      }\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(
        marker
      )},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),input:fs.readFileSync(process.argv[2],'utf8')}));fs.writeFileSync(process.argv[2],'edited short message\\n');`,
      { mode: 0o755 }
    );
    fixture.env.GIT_EDITOR = editor;
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'selected amend');
    fixture.git(['add', 'selected.txt']);
    const old = fixture.git(['rev-parse', 'base']);
    const other = fixture.git(['rev-parse', 'other']);
    const result = fixture.run(['m', '-e', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fs.existsSync(marker)).to.equal(true);
    expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
      'edited short message'
    );
    expect(fixture.git(['show', 'HEAD:selected.txt'])).to.equal(
      'selected amend'
    );
    expect(fixture.git(['rev-parse', 'base'])).not.to.equal(old);
    expect(fixture.git(['merge-base', 'base', 'child'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(fixture.git(['show', 'tip:selected.txt'])).to.equal(
      'selected amend'
    );
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('completes utr branches through the public query and includes it in fish branch rules', () => {
    const before = fixture.inspectionSnapshot();
    const args = ['--get-yargs-completions', 'ch'];
    const canonical = fixture.run([...args, 'untrack', '']);
    const short = fixture.run([...args, 'utr', '']);
    expect(canonical.status, canonical.stdout + canonical.stderr).to.equal(0);
    expect(short.status, short.stdout + short.stderr).to.equal(0);
    expect(short.stdout.split('\n').filter(Boolean)).to.have.members([
      'main',
      'base',
      'child',
      'tip',
      'other',
    ]);
    expect(short.stdout).to.equal(canonical.stdout);
    const fish = fixture.run(['fish', '--quiet']);
    expect(fish.status, fish.stdout + fish.stderr).to.equal(0);
    expect(fish.stdout).to.match(
      /__fish_seen_subcommand_from[^\n]*untrack[^\n]*utr[^\n]*ut[^\n]*move/
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const command of ['untrack', 'ut'])
    it(`preserves the existing ${command} leaf outcome alongside utr`, () => {
      const heads = fixture.git(['show-ref', '--heads']);
      const result = fixture.run([command, 'tip', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.run(['info', 'tip']).status).to.equal(1);
      expect(fixture.run(['info', 'child']).status).to.equal(0);
      expect(fixture.git(['show-ref', '--heads'])).to.equal(heads);
    });

  it('keeps utr with children a noninteractive no-op until force is explicit', () => {
    const before = preserved();
    const refused = fixture.run(['utr', 'base', '--no-interactive']);
    expect(refused.status, refused.stdout + refused.stderr).to.equal(0);
    expect(preserved()).to.deep.equal(before);
    expect(fixture.run(['info', 'base']).status).to.equal(0);
    const heads = fixture.git(['show-ref', '--heads']);
    const forced = fixture.run(['utr', 'base', '--force', '--no-interactive']);
    expect(forced.status, forced.stdout + forced.stderr).to.equal(0);
    for (const name of ['base', 'child', 'tip'])
      expect(fixture.run(['info', name]).status).to.equal(1);
    expect(fixture.run(['info', 'other']).status).to.equal(0);
    expect(fixture.git(['show-ref', '--heads'])).to.equal(heads);
  });

  it('refuses utr of trunk and leaves its history and work intact', () => {
    stageWork();
    const before = preserved();
    const result = fixture.run(['utr', 'main', '--force', '--quiet']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.match(/untrack trunk/i);
    expect(preserved()).to.deep.equal(before);
  });

  for (const command of ['create', 'c'])
    it(`creates with ${command} -o while preserving unstaged and untracked work`, () => {
      stageWork();
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged base');
      fs.writeFileSync(path.join(fixture.repo, 'loose.txt'), 'untracked work');
      const parent = fixture.git(['rev-parse', 'base']);
      const result = fixture.run([
        command,
        'made',
        '-o',
        'base',
        '-m',
        'literal utr --cwd value',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['rev-parse', 'HEAD^'])).to.equal(parent);
      expect(fixture.run(['parent']).stdout).to.equal('base\n');
      expect(fixture.git(['show', 'HEAD:selected.txt'])).to.equal(
        'selected work'
      );
      expect(fixture.git(['show', 'HEAD:base.txt'])).to.equal('base');
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
        'literal utr --cwd value'
      );
      expect(
        fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
      ).to.equal('unstaged base');
      expect(
        fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
      ).to.equal('untracked work');
      expect(fixture.git(['status', '--porcelain']))
        .to.include('M base.txt')
        .and.include('?? loose.txt');
    });

  it('inserts c -o beneath the explicitly selected parent and restacks children', () => {
    fixture.git(['switch', 'other']);
    stageWork();
    const other = fixture.git(['rev-parse', 'other']);
    const result = fixture.run([
      'c',
      'inserted',
      '-o',
      'base',
      '--insert',
      '-m',
      'inserted message',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.run(['parent']).stdout).to.equal('base\n');
    expect(fixture.git(['merge-base', 'inserted', 'child'])).to.equal(
      fixture.git(['rev-parse', 'inserted'])
    );
    expect(fixture.git(['show', 'tip:selected.txt'])).to.equal('selected work');
    expect(fixture.parent('child')).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });

  it('rejects invalid -o targets, names and conflicting selectors before work changes', () => {
    fixture.git(['branch', 'untracked', 'main']);
    stageWork();
    fs.writeFileSync(path.join(fixture.repo, 'loose.txt'), 'keep loose');
    const before = preserved();
    for (const args of [
      ['c', 'made', '-o', 'missing', '-m', 'message'],
      ['create', 'made', '-o', 'untracked', '-m', 'message'],
      ['c', 'child', '-o', 'other', '-m', 'message'],
      ['c', 'made', '-o', 'base', '--onto', 'other', '-m', 'message'],
    ]) {
      const result = fixture.run([...args, '--no-interactive']);
      expect(result.status, JSON.stringify(args)).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.equal('');
      expect(preserved()).to.deep.equal(before);
    }
  });

  it('refuses a short onto insert with a busy descendant before any ref or index changes', () => {
    const linked = path.join(fixture.root, 'busy child');
    fixture.git(['worktree', 'add', linked, 'child']);
    stageWork();
    fs.writeFileSync(path.join(linked, 'child.txt'), 'linked unstaged');
    fs.writeFileSync(path.join(linked, 'loose.txt'), 'linked untracked');
    fixture.git(['status', '--porcelain'], linked);
    const before = preserved();
    const linkedBefore = fixture.inspectionSnapshot(linked);
    const result = fixture.run([
      'c',
      'inserted',
      '-o',
      'base',
      '--insert',
      '-m',
      'message',
      '--quiet',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('child').and.include(linked);
    expect(preserved()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(linkedBefore);
  });

  it('keeps -o create message and patch preflight ahead of checkout or staging', () => {
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged work');
    fixture.git(['status', '--porcelain']);
    const before = preserved();
    for (const args of [
      ['c', 'made', '-o', 'other', '--all', '--quiet'],
      [
        'c',
        'made',
        '-o',
        'other',
        '--patch',
        '-m',
        'message',
        '--no-interactive',
      ],
    ]) {
      const result = fixture.run(args);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.match(/commit message|patch|interactive/i);
      expect(preserved()).to.deep.equal(before);
      forbidEditor();
    }
  });

  for (const command of ['modify', 'm'])
    for (const flags of [
      ['-e', '--no-edit'],
      ['-e', '-m', 'replacement message'],
      ['-e=false'],
    ])
      it(`preserves message precedence without an editor: ${command} ${flags.join(
        ' '
      )}`, () => {
        stageWork();
        const result = fixture.run([command, ...flags, '--quiet']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
          flags.includes('-m') ? 'replacement message' : 'base'
        );
        expect(fixture.git(['show', 'tip:selected.txt'])).to.equal(
          'selected work'
        );
        forbidEditor();
      });

  it('refuses explicit -e without permission before staging or editor execution', () => {
    fs.writeFileSync(path.join(fixture.repo, 'selected.txt'), 'unstaged work');
    fixture.git(['status', '--porcelain']);
    const before = preserved();
    for (const flags of [['--quiet'], ['--no-interactive']]) {
      const result = fixture.run(['m', '-e', '--all', ...flags]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.match(/explicit editor.*interactive/i);
      expect(preserved()).to.deep.equal(before);
      forbidEditor();
    }
  });

  it('preserves modify -e worktree safeguards without rewriting the current branch', () => {
    const linked = path.join(fixture.root, 'busy descendant');
    fixture.git(['worktree', 'add', linked, 'child']);
    stageWork();
    const before = preserved();
    const linkedBefore = fixture.inspectionSnapshot(linked);
    const result = fixture.run(['modify', '-e', '-m', 'message', '--quiet']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('child').and.include(linked);
    expect(preserved()).to.deep.equal(before);
    expect(fixture.inspectionSnapshot(linked)).to.deep.equal(linkedBefore);
    forbidEditor();
  });

  it('creates via relative suffix cwd while preserving departure and a dirty parent worktree', () => {
    const target = new CwdCliFixture();
    try {
      const linked = path.join(target.root, 'parent δ worktree');
      target.git(['worktree', 'add', linked, 'other']);
      fs.writeFileSync(path.join(linked, 'other.txt'), 'linked staged');
      target.git(['add', 'other.txt'], linked);
      fs.appendFileSync(path.join(linked, 'other.txt'), ' unstaged');
      fs.writeFileSync(path.join(linked, 'loose.txt'), 'linked untracked');
      target.git(['status', '--porcelain'], linked);
      fs.writeFileSync(path.join(target.repo, 'selected.txt'), 'cwd selected');
      target.git(['add', 'selected.txt']);
      const beforeA = preserved();
      const beforeParent = target.inspectionSnapshot(linked);
      const originalRefs = target.refs();
      const parent = target.git(['rev-parse', 'other']);
      const result = fixture.run([
        'c',
        'cwd-made',
        '-o',
        'other',
        '-m',
        'literal --cwd utr',
        '--quiet',
        '--cwd',
        path.relative(fixture.repo, target.repo),
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(target.git(['branch', '--show-current'])).to.equal('cwd-made');
      expect(target.git(['rev-parse', 'HEAD^'])).to.equal(parent);
      expect(target.git(['show', 'HEAD:selected.txt'])).to.equal(
        'cwd selected'
      );
      expect(target.git(['show', 'HEAD:other.txt'])).to.equal('other');
      expect(target.run(['parent']).stdout).to.equal('other\n');
      const afterParent = target.inspectionSnapshot(linked);
      for (const key of [
        'head',
        'branch',
        'index',
        'staging',
        'status',
        'files',
        'operation',
        'userConfig',
      ])
        expect(afterParent[key], key).to.deep.equal(beforeParent[key]);
      for (const ref of originalRefs.split('\n'))
        expect(target.refs()).to.include(ref);
      expect(preserved()).to.deep.equal(beforeA);
    } finally {
      target.cleanup();
    }
  });

  it('runs canonical modify -e in a selected spaced worktree with a real editor', () => {
    const target = new CwdCliFixture();
    try {
      const linked = path.join(target.root, 'selected γ worktree');
      target.git(['worktree', 'add', linked, 'other']);
      fs.writeFileSync(path.join(linked, 'selected.txt'), 'cwd amend');
      target.git(['add', 'selected.txt'], linked);
      target.editor(
        'cwd edited message\n',
        `fs.writeFileSync(${JSON.stringify(
          path.join(fixture.root, 'message-editor.json')
        )},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));`
      );
      fixture.env.GIT_EDITOR = target.env.CH_EDITOR;
      const beforeA = preserved();
      const beforePrimary = target.inspectionSnapshot();
      const oldOther = target.git(['rev-parse', 'other']);
      const result = fixture.run([
        '--cwd',
        linked,
        'modify',
        '-e',
        '--interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(target.git(['log', '-1', '--format=%s'], linked)).to.equal(
        'cwd edited message'
      );
      expect(target.git(['show', 'HEAD:selected.txt'], linked)).to.equal(
        'cwd amend'
      );
      expect(target.git(['rev-parse', 'other'])).not.to.equal(oldOther);
      expect(target.git(['branch', '--show-current'], linked)).to.equal(
        'other'
      );
      const marker: unknown = JSON.parse(
        fs.readFileSync(path.join(fixture.root, 'message-editor.json'), 'utf8')
      );
      expect(marker).to.have.property('cwd', fs.realpathSync(linked));
      const afterPrimary = target.inspectionSnapshot();
      for (const key of [
        'head',
        'branch',
        'index',
        'staging',
        'status',
        'files',
      ])
        expect(afterPrimary[key], key).to.deep.equal(beforePrimary[key]);
      expect(preserved()).to.deep.equal(beforeA);
    } finally {
      target.cleanup();
    }
  });

  it('rejects invalid cwd and policy input for new spellings before external tools', () => {
    const before = preserved();
    const restore = fixture.refuseExternalTools();
    try {
      for (const args of [
        ['utr', 'tip', '--cwd', path.join(fixture.root, 'missing')],
        ['c', 'made', '-o', 'other', '-m', 'message', '--quiet=invalid'],
        ['m', '-e', '-m', 'message', '--interactive=invalid'],
      ]) {
        const result = fixture.run(args);
        expect(result.status).to.equal(1);
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
        forbidEditor();
      }
    } finally {
      restore();
    }
    expect(preserved()).to.deep.equal(before);
  });

  it('offers command-specific help and option queries outside Git without tools or UI', () => {
    const before = preserved();
    const restore = fixture.refuseExternalTools();
    try {
      for (const [command, pattern] of [
        ['utr', /ch untrack/],
        ['ut', /ch untrack/],
        ['c', /-o, --onto/],
        ['m', /-e, --edit/],
      ] as const) {
        const result = fixture.run(
          [command, '--help', '--quiet'],
          fixture.root
        );
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(result.stdout).to.match(pattern);
        expect(result.stderr).to.equal('');
      }
      for (const [command, option] of [
        ['c', '--onto'],
        ['m', '--edit'],
      ] as const) {
        const result = fixture.run(
          ['--get-yargs-completions', 'ch', command, '--'],
          fixture.root
        );
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(result.stdout).to.include(option);
      }
      forbidEditor();
    } finally {
      restore();
    }
    expect(preserved()).to.deep.equal(before);
  });
});
