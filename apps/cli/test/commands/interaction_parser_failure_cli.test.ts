import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('parser failure boundaries through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
    delete fixture.env.GRAPHITE_INTERACTIVE;
    fixture.git(['status', '--porcelain']);
  });
  afterEach(() => fixture?.cleanup());

  for (const [command, args, diagnostic] of [
    [
      'children',
      ['children', '--', 'other'],
      'does not accept a branch argument',
    ],
    ['parent', ['parent', '--', 'other'], 'does not accept a branch argument'],
    [
      'info',
      ['info', 'base', '--branch', 'child'],
      'selectors must name the same branch',
    ],
  ] as const) {
    it(`stops ${command} argument checks before command context or tools`, () => {
      const before = fixture.inspectionSnapshot();
      for (const flags of [[], ['--quiet']]) {
        const restore = fixture.refuseExternalTools();
        let refused: ReturnType<CwdCliFixture['run']>;
        try {
          refused = fixture.run([...flags, ...args]);
        } finally {
          restore();
        }
        const after = fixture.inspectionSnapshot();
        const marker = path.join(fixture.root, 'unexpected-tool');
        const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
        if (evidence && fs.existsSync(marker))
          fs.copyFileSync(
            marker,
            path.join(
              evidence,
              `${path.basename(fixture.root)}-unexpected-tool`
            )
          );
        expect(refused.status, refused.stderr).to.equal(1);
        expect(refused.stdout).to.equal('');
        expect(refused.stderr).to.include(diagnostic);
        expect(fs.existsSync(marker)).to.equal(false);
        expect(after).to.deep.equal(before);
      }
    });
  }

  for (const [label, args] of [
    [
      'create unknown option',
      ['create', 'never-created', '--message', 'literal', '--not-an-option'],
    ],
    [
      'create extra positional',
      ['create', 'never-created', 'extra', '--message', 'literal'],
    ],
    [
      'nested config unknown option',
      ['repo', 'name', '--set', 'never-written', '--not-an-option'],
    ],
    [
      'nested config extra positional',
      ['repo', 'name', '--set', 'never-written', 'extra'],
    ],
  ] as const) {
    it(`rejects ${label} before mutation, hooks or command tools`, () => {
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged base');
      fixture.git(['add', 'base.txt']);
      fs.appendFileSync(path.join(fixture.repo, 'base.txt'), '\nworking base');
      const hook = path.join(fixture.root, 'unexpected-hook');
      fs.writeFileSync(
        path.join(fixture.repo, '.git', 'hooks', 'pre-commit'),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(
          hook
        )}, 'invoked');`,
        { mode: 0o755 }
      );
      fixture.git(['status', '--porcelain']);
      const before = fixture.inspectionSnapshot();
      for (const flags of [[], ['--quiet']]) {
        const rejected = fixture.run([...args, ...flags]);
        const after = fixture.inspectionSnapshot();
        expect(rejected.status, rejected.stderr).to.equal(1);
        expect(rejected.stdout).to.equal('');
        expect(rejected.stderr).to.include('Unknown argument');
        expect(after).to.deep.equal(before);
        expect(fs.existsSync(hook)).to.equal(false);

        const restore = fixture.refuseExternalTools();
        let guarded: ReturnType<CwdCliFixture['run']>;
        try {
          guarded = fixture.run([...args, ...flags]);
        } finally {
          restore();
        }
        expect(guarded.status, guarded.stderr).to.equal(1);
        expect(guarded.stdout).to.equal('');
        expect(guarded.stderr).to.include('Unknown argument');
        expect(
          fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
        ).to.equal(false);
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      }
    });
  }

  it('retains explicit quiet help, version and completion data without command tools or mutation', () => {
    const before = fixture.inspectionSnapshot();
    const restore = fixture.refuseExternalTools();
    try {
      for (const [args, content] of [
        [['--help', '--quiet'], /Charcoal is a command line tool/],
        [
          ['children', '--help', '--quiet'],
          /Print the direct tracked children/,
        ],
        [['info', '--help', '--quiet'], /Display information/],
        [['repo', 'name', '--help', '--quiet'], /ch repo name/],
        [['--version', '--quiet'], /^\d+\.\d+\.\d+\n$/],
        [['completion', '--quiet'], /ch-completions/],
      ] as const) {
        const result = fixture.run(args);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.match(content);
        expect(result.stderr).to.equal('');
      }
    } finally {
      restore();
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
