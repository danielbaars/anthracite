import fs from 'fs';
import path from 'path';

import { expect } from 'chai';
import stripAnsi from 'strip-ansi';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// eslint-disable-next-line max-lines-per-function
describe('cwd selection through the public CLI', function () {
  this.timeout(120000);
  let start: CwdCliFixture;
  let target: CwdCliFixture;
  before(() => {
    start = new CwdCliFixture();
    target = new CwdCliFixture();
    start.commit('only-start');
    target.commit('only-target');
  });
  after(() => {
    for (const fixture of [start, target]) {
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
      fixture.cleanup();
    }
  });

  it('selects the target repository instead of the same-named departure branch', () => {
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const ordinary = start.run(['info', '--no-interactive']);
    expect(ordinary.status, ordinary.stderr).to.equal(0);
    expect(stripAnsi(ordinary.stdout))
      .to.include('only-start')
      .and.not.include('only-target');
    const selected = start.run([
      '--cwd',
      target.repo,
      'info',
      '--no-interactive',
    ]);
    expect(selected.status, selected.stdout + selected.stderr).to.equal(0);
    expect(stripAnsi(selected.stdout))
      .to.match(/^base\s/)
      .and.include('only-target')
      .and.not.include('only-start');
    expect(selected.stderr).to.equal('');
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('rejects missing, empty, repeated and negated global declarations before external commands', () => {
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const restoreTools = start.refuseExternalTools();
    try {
      for (const args of [
        ['info', '--cwd'],
        ['--cwd', '--no-interactive', 'info'],
        ['--cwd=', 'info'],
        ['info', '--cwd', ''],
        ['--cwd', target.repo, 'info', '--cwd', target.repo],
        ['--cwd=' + target.repo, 'info', '--cwd=' + start.repo],
        ['--no-cwd', 'info'],
        ['info', '--no-cwd=false'],
      ]) {
        const result = start.run(args);
        expect(result.status, JSON.stringify(args)).to.equal(1);
        expect(result.stdout, JSON.stringify(args)).to.equal('');
        expect(result.stderr, JSON.stringify(args))
          .to.include('--cwd')
          .and.not.include('UNCAUGHT EXCEPTION');
        expect(
          fs.existsSync(path.join(start.root, 'unexpected-tool')),
          JSON.stringify(args)
        ).to.equal(false);
      }
    } finally {
      restoreTools();
    }
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('rejects unusable targets on stderr without creating a directory or falling back', () => {
    const missing = path.join(target.root, 'never-created');
    const file = path.join(target.root, 'ordinary-file');
    fs.writeFileSync(file, 'not a directory');
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const restoreTools = start.refuseExternalTools();
    try {
      for (const directory of [missing, file]) {
        for (const flags of [[], ['--quiet'], ['--debug']]) {
          const result = start.run([
            'info',
            '--cwd',
            directory,
            ...flags,
            '--no-interactive',
          ]);
          expect(result.status, directory).to.equal(1);
          expect(result.stdout, directory).to.equal('');
          expect(result.stderr, directory)
            .to.include('--cwd')
            .and.include(directory)
            .and.not.include('UNCAUGHT EXCEPTION');
        }
      }
    } finally {
      restoreTools();
    }
    expect(fs.existsSync(missing)).to.equal(false);
    expect(fs.readFileSync(file, 'utf8')).to.equal('not a directory');
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('documents directory selection and serves own help and version without opening the target', () => {
    const missing = path.join(target.root, 'help-must-not-create');
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const restoreTools = start.refuseExternalTools();
    const config = start.env.GRAPHITE_USER_CONFIG_PATH;
    const broken = path.join(start.root, 'help-config');
    fs.writeFileSync(broken, 'must not load malformed user configuration');
    start.env.GRAPHITE_USER_CONFIG_PATH = broken;
    try {
      for (const args of [
        ['--cwd', missing, '--help'],
        ['info', '--cwd=' + missing, '--help'],
        ['--cwd', missing, '--version'],
      ]) {
        const result = start.run(args, start.root);
        expect(result.status, JSON.stringify(args) + result.stderr).to.equal(0);
        expect(result.stderr).to.equal('');
        if (args.includes('--version'))
          expect(result.stdout).to.match(/^0\.1\.0\s*$/);
        else
          expect(result.stdout)
            .to.include('--cwd')
            .and.include('string')
            .and.match(/prefix[\s\S]*Git/i);
      }
      for (const malformed of [
        ['--cwd'],
        ['--cwd='],
        ['--cwd', ''],
        ['--cwd', missing, '--cwd', missing],
        ['--no-cwd'],
      ]) {
        for (const documentation of ['--help', '--version']) {
          const result = start.run([...malformed, documentation], start.root);
          expect(result.status, JSON.stringify(malformed)).to.equal(1);
          expect(result.stdout).to.equal('');
          expect(result.stderr).to.include('--cwd');
        }
      }
    } finally {
      start.env.GRAPHITE_USER_CONFIG_PATH = config;
      restoreTools();
    }
    expect(fs.existsSync(missing)).to.equal(false);
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('resolves absolute, relative and literal directory names from the original departure', () => {
    const links = [
      ' leading and trailing ',
      'λ-werkmap',
      'info',
      'false',
      '0',
      '$(touch cwd-sentinel)',
      '~$HOME',
    ];
    for (const name of links)
      fs.symlinkSync(target.repo, path.join(start.root, name), 'dir');
    const before = [start.inspectionSnapshot(), target.inspectionSnapshot()];
    const cases: ReadonlyArray<readonly [string, string]> = [
      [start.repo, target.repo],
      [start.repo, path.relative(start.repo, target.repo)],
      [start.root, path.relative(start.root, target.repo)],
      [target.repo, '.'],
      [
        start.repo,
        path.join(path.relative(start.repo, target.repo), '..', 'repo', '.'),
      ],
      ...links.map((name): readonly [string, string] => [start.root, name]),
    ];
    for (const [departure, directory] of cases) {
      for (const args of [
        ['--cwd', directory, 'info', '--no-interactive'],
        ['info', '--cwd=' + directory, '--no-interactive'],
      ]) {
        const result = start.run(args, departure);
        expect(
          result.status,
          JSON.stringify({ args, departure }) + result.stderr
        ).to.equal(0);
        expect(stripAnsi(result.stdout))
          .to.include('only-target')
          .and.not.include('only-start');
        expect(result.stderr).to.equal('');
      }
    }
    for (const name of links)
      expect(fs.readlinkSync(path.join(start.root, name))).to.equal(
        target.repo
      );
    expect(fs.existsSync(path.join(start.root, 'cwd-sentinel'))).to.equal(
      false
    );
    expect([
      start.inspectionSnapshot(),
      target.inspectionSnapshot(),
    ]).to.deep.equal(before);
  });

  it('retains the chosen subdirectory as the base for existing relative configuration', () => {
    const subdirectory = path.join(target.repo, 'nested');
    fs.mkdirSync(subdirectory);
    fs.writeFileSync(
      path.join(target.repo, 'relative-config'),
      'malformed root config'
    );
    fs.writeFileSync(
      path.join(subdirectory, 'relative-config'),
      JSON.stringify({ tips: false })
    );
    const config = start.env.GRAPHITE_USER_CONFIG_PATH;
    start.env.GRAPHITE_USER_CONFIG_PATH = 'relative-config';
    try {
      const result = start.run([
        'info',
        '--cwd',
        subdirectory,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(stripAnsi(result.stdout)).to.include('only-target');
      const control = start.run([
        'info',
        '--cwd',
        target.repo,
        '--no-interactive',
      ]);
      expect(control.status).to.equal(1);
      expect(control.stderr).to.include('Malformed data');
    } finally {
      start.env.GRAPHITE_USER_CONFIG_PATH = config;
    }
  });

  it('leaves repository requirements to the ordinary command after selecting a non-Git directory', () => {
    const ordinary = start.run(['info', '--no-interactive'], target.root);
    const selected = start.run([
      'info',
      '--cwd',
      target.root,
      '--no-interactive',
    ]);
    expect(selected.status).to.equal(ordinary.status).and.not.equal(0);
    expect(selected.stdout).to.equal(ordinary.stdout);
    expect(selected.stderr)
      .to.equal(ordinary.stderr)
      .and.not.include('Cannot use --cwd');
  });

  it('reports a genuinely inaccessible directory without falling back when permissions are enforced', function () {
    const inaccessible = path.join(target.root, 'inaccessible');
    fs.mkdirSync(inaccessible, { mode: 0o000 });
    try {
      let canTraverse = true;
      try {
        fs.accessSync(inaccessible, fs.constants.X_OK);
      } catch {
        canTraverse = false;
      }
      if (canTraverse) this.skip();
      const result = start.run([
        'info',
        '--cwd',
        inaccessible,
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr)
        .to.include('--cwd')
        .and.not.include('UNCAUGHT EXCEPTION');
    } finally {
      fs.chmodSync(inaccessible, 0o700);
    }
  });
});
