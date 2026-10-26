import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('explicit editor policy through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.env.CH_PAGER = '';
    fixture.env.GIT_SEQUENCE_EDITOR = fixture.env.GIT_EDITOR;
    fixture.git(['status', '--porcelain']);
  });
  afterEach(() => {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(
        path.join(evidence, `${path.basename(fixture.root)}-tools.json`),
        JSON.stringify(
          {
            cwd: fixture.repo,
            environment: Object.fromEntries(
              [
                'CH_EDITOR',
                'GIT_EDITOR',
                'GIT_SEQUENCE_EDITOR',
                'GRAPHITE_INTERACTIVE',
                'GIT_OPTIONAL_LOCKS',
                'GRAPHITE_USER_CONFIG_PATH',
                'HOME',
                'CODEX_HOME',
              ].map((name) => [name, fixture.env[name] ?? null])
            ),
            files: Object.fromEntries(
              [
                'unexpected-tool',
                'hook-called',
                'editor-call.json',
                'sequence-call.json',
                'offered',
              ].map((name) => {
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
        )
      );
    }
    fixture?.cleanup();
  });

  function history(): Record<string, unknown> {
    const snapshot = fixture.inspectionSnapshot();
    return {
      head: snapshot.head,
      branch: snapshot.branch,
      refs: snapshot.refs,
      index: snapshot.index,
      files: snapshot.files,
      operation: snapshot.operation,
    };
  }

  for (const args of [
    ['edit', '--no-interactive'],
    ['e', '--quiet'],
    ['dev', 'meta', 'base', '--edit', '--no-interactive'],
    ['reorder', '--no-interactive'],
    ['ro', '--stack', '--quiet'],
  ])
    it(`refuses forbidden editor before own writes: ${args.join(' ')}`, () => {
      const before = history();
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.match(/interactive|editor/i);
      expect(history()).to.deep.equal(before);
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    });
  for (const stack of [false, true]) {
    const args = ['reorder', ...(stack ? ['--stack'] : [])];
    it(`uses supported preformatted input without an editor: ${args.join(
      ' '
    )}`, () => {
      fixture.git(['switch', 'tip']);
      const input = fixture.input('base\nchild\ntip\n');
      const result = fixture.run([...args, '--input', input, '--quiet']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.parent('tip')).to.equal('main');
      expect(fixture.parent('child')).to.equal('tip');
      expect(fixture.parent('base')).to.equal('child');
      expect(fixture.git(['show', 'base:base.txt'])).to.equal('base');
      expect(fixture.git(['show', 'base:child.txt'])).to.equal('child');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    });

    it(`applies a configured editor under explicit interactive pipes: ${args.join(
      ' '
    )}`, () => {
      fixture.git(['switch', 'tip']);
      const marker = path.join(fixture.root, 'editor-call.json');
      fixture.editor(
        'base\nchild\ntip\n',
        `fs.writeFileSync(${JSON.stringify(
          marker
        )}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));`
      );
      const result = fixture.run([...args, '--interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fs.readFileSync(fixture.offered, 'utf8')).to.include(
        'tip\nchild\nbase\n'
      );
      const call: unknown = JSON.parse(fs.readFileSync(marker, 'utf8'));
      expect(call).to.have.property('cwd', fs.realpathSync(fixture.repo));
      expect(fixture.parent('tip')).to.equal('main');
      expect(fixture.parent('base')).to.equal('child');
      expect(fixture.git(['show', 'base:tip.txt'])).to.equal('tip');
    });
  }

  it('retains repository state when a permitted reorder editor fails', () => {
    fixture.editor(undefined, '', 17);
    const before = history();
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.match(/error|failed/i);
    expect(fs.existsSync(fixture.offered)).to.equal(true);
    expect(history()).to.deep.equal(before);
  });
  it('applies a permitted Git sequence editor and restacks descendants under pipes', () => {
    fixture.commit('second');
    fixture.ok(['restack', '--upstack']);
    const script = path.join(fixture.root, 'sequence-editor');
    const marker = path.join(fixture.root, 'sequence-call.json');
    fs.writeFileSync(
      script,
      `#!${
        process.execPath
      }\nconst fs = require('fs'); const file = process.argv[2]; const text = fs.readFileSync(file, 'utf8'); fs.writeFileSync(${JSON.stringify(
        marker
      )}, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(), text})); const rows = text.split('\\n'); rows[1] = rows[1].replace(/^pick /, 'drop '); fs.writeFileSync(file, rows.join('\\n'));`,
      { mode: 0o755 }
    );
    fixture.env.GIT_SEQUENCE_EDITOR = script;
    const result = fixture.run(['edit', '--interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['log', '--format=%s', 'main..base'])).to.equal('base');
    expect(fixture.git(['ls-tree', '--name-only', 'child'])).not.to.include(
      'second.txt'
    );
    expect(fixture.git(['show', 'child:child.txt'])).to.equal('child');
    expect(fixture.git(['merge-base', 'base', 'child'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(JSON.parse(fs.readFileSync(marker, 'utf8'))).to.have.property(
      'cwd',
      fs.realpathSync(fixture.repo)
    );
  });

  it('applies a configured dev-meta editor when explicitly permitted', () => {
    fixture.editor(
      undefined,
      `const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); value.prInfo = {title: 'edited local title', body: 'edited local body'}; fs.writeFileSync(process.argv[2], JSON.stringify(value));`
    );
    const result = fixture.run([
      'dev',
      'meta',
      'base',
      '--edit',
      '--interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fs.existsSync(fixture.offered)).to.equal(true);
    const displayed = fixture.run(['dev', 'meta', 'base']);
    expect(displayed.status, displayed.stdout + displayed.stderr).to.equal(0);
    expect(displayed.stdout)
      .to.include('edited local title')
      .and.include('edited local body');
    expect(fixture.run(['parent']).stdout).to.equal('main\n');
  });

  it('lets quiet and the legacy disable override an explicit editor permission', () => {
    const before = history();
    for (const legacy of [false, true]) {
      fixture.env.GRAPHITE_INTERACTIVE = legacy ? '1' : '';
      const result = fixture.run([
        'reorder',
        '--interactive',
        ...(legacy ? [] : ['--quiet']),
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(history()).to.deep.equal(before);
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    }
  });

  it('preserves history when the user cancels an allowed reorder editor', () => {
    fixture.editor(
      undefined,
      `process.stdout.write('Controlled editor ready'); setInterval(() => {}, 1000);`
    );
    const before = history();
    const result = runCliInPty(
      getTestCliCommand(['reorder', '--stack', '--interactive']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Controlled editor ready', input: '\x03' }],
      }
    );
    fixture.savePty(result);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.match(/error|failed/i);
    expect(fs.existsSync(fixture.offered)).to.equal(true);
    expect(history()).to.deep.equal(before);
  });
});
