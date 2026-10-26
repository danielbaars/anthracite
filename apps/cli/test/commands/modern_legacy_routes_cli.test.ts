import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

// Registered old routes remain public workflows, without certifying every setter.
// eslint-disable-next-line max-lines-per-function
describe('modern preserved routes through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(function () {
    fixture = new CwdCliFixture();
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.appendFileSync(
        path.join(evidence, 'modern-legacy-cases.jsonl'),
        JSON.stringify({
          fullTitle: this.currentTest?.fullTitle(),
          root: fixture.root,
        }) + '\n'
      );
    }
  });
  afterEach(() => {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence && fixture) {
      const files = Object.fromEntries(
        ['sequence', 'message', 'sentinel-bin/gh'].map((name) => {
          const file = path.join(fixture.root, name);
          return [
            name,
            fs.existsSync(file)
              ? fs.readFileSync(file).toString('base64')
              : null,
          ];
        })
      );
      fs.writeFileSync(
        path.join(
          evidence,
          `${path.basename(fixture.root)}-external-tools.json`
        ),
        JSON.stringify(files, null, 2) + '\n'
      );
    }
    fixture?.cleanup();
  });

  it('i inspects a selected branch while retaining staged and unstaged work', () => {
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged');
    fixture.git(['add', 'main.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'main.txt'), ' unstaged');
    fixture.git(['status', '--porcelain']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'i',
      'child',
      '--diff',
      '--stat',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('child.txt');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const command of ['edit', 'e'])
    it(`${command} applies a real reword and restacks descendants`, () => {
      const sequence = path.join(fixture.root, 'sequence');
      const message = path.join(fixture.root, 'message');
      fs.writeFileSync(
        sequence,
        `#!${process.execPath}\nconst fs=require('fs');const p=process.argv[2];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^pick /m,'reword '));`,
        { mode: 0o755 }
      );
      fs.writeFileSync(
        message,
        `#!${process.execPath}\nrequire('fs').writeFileSync(process.argv[2],'legacy reword\\n');`,
        { mode: 0o755 }
      );
      fixture.env.GIT_SEQUENCE_EDITOR = sequence;
      fixture.env.GIT_EDITOR = message;
      const tree = fixture.git(['rev-parse', 'base^{tree}']);
      const result = fixture.run([command, '--interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['log', '-1', '--format=%s', 'base'])).to.equal(
        'legacy reword'
      );
      expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-parse', 'child^'])).to.equal(
        fixture.git(['rev-parse', 'base'])
      );
      expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
        fixture.git(['rev-parse', 'child'])
      );
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });

  it('ro reorders the selected stack through its existing input-file route', () => {
    fixture.ok([
      'ro',
      '--stack',
      '--input',
      fixture.input('tip\nbase\nchild\n'),
    ]);
    expect(fixture.parent('child')).to.equal('main');
    expect(fixture.parent('base')).to.equal('child');
    expect(fixture.parent('tip')).to.equal('base');
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('ut untracks its selected leaf while retaining all Git refs', () => {
    const refs = fixture.refs();
    fixture.ok(['ut', 'tip']);
    expect(fixture.run(['info', 'tip']).status).not.to.equal(0);
    expect(fixture.run(['info', 'child']).status).to.equal(0);
    expect(fixture.refs()).to.equal(refs);
  });

  it('repo i retains init semantics and user tips remains a real configuration workflow', () => {
    fixture.ok(['repo', 'i', '--trunk', 'main']);
    expect(fixture.parent('base')).to.equal('main');
    fixture.ok(['user', 'tips', '--enable']);
    expect(fixture.run(['user', 'tips']).stdout).to.include('tips enabled');
    fixture.ok(['user', 'tips', '--disable']);
    expect(fixture.run(['user', 'tips']).stdout).to.include('tips disabled');
  });

  it('repo s retains sync restack semantics independently of root submit s', () => {
    fixture.ok(['repo', 'github', '--enable=false']);
    fixture.git(['commit', '--amend', '-m', 'sync base']);
    const base = fixture.git(['rev-parse', 'base']);
    const result = fixture.run([
      'repo',
      's',
      '--no-pull',
      '--no-delete',
      '--restack',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('log s and log l keep their nested rendering meanings', () => {
    const before = fixture.inspectionSnapshot();
    for (const [alias, canonical] of [
      ['s', 'short'],
      ['l', 'long'],
    ]) {
      const short = fixture.run(['log', alias, '--no-interactive']);
      const long = fixture.run(['log', canonical, '--no-interactive']);
      expect(short.status, short.stdout + short.stderr).to.equal(0);
      expect(long.status, long.stdout + long.stderr).to.equal(0);
      const stable = (output: string): string =>
        output.replace(/(\b[0-9a-f]+ - )\([^)]*\)/g, '$1(commit age)');
      expect(stable(short.stdout)).to.equal(stable(long.stdout));
      for (const branch of ['main', 'base', 'child', 'tip', 'other']) {
        expect(short.stdout).to.include(branch);
        if (canonical === 'long')
          expect(short.stdout).to.include(
            fixture.git(['rev-parse', '--short', branch])
          );
      }
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  for (const command of ['get', 'g'])
    it(`${command} fast-forwards from a real local remote through the existing PR boundary`, () => {
      const remote = path.join(fixture.root, 'remote.git');
      const producer = path.join(fixture.root, 'producer');
      fixture.git(['init', '--bare', remote]);
      fixture.git(['remote', 'add', 'origin', remote]);
      fixture.git(['push', 'origin', 'main', 'base']);
      fixture.git(['clone', '--branch', 'base', remote, producer]);
      fixture.git(['config', 'user.name', 'Producer'], producer);
      fixture.git(['config', 'user.email', 'producer@example.test'], producer);
      fixture.git(
        ['commit', '--allow-empty', '-m', 'remote advance'],
        producer
      );
      fixture.git(['push', 'origin', 'base'], producer);
      const target = fixture.git(['rev-parse', 'HEAD'], producer);
      const child = fixture.git(['rev-parse', 'child']);
      fixture.ok(['repo', 'owner', '--set', 'fixture']);
      fixture.ok(['repo', 'name', '--set', 'compatibility']);
      fs.writeFileSync(
        path.join(fixture.root, 'sentinel-bin', 'gh'),
        `#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]!=='pr'||a[1]!=='view'||a[2]!=='base')process.exit(2);console.log(JSON.stringify({headRefName:'base',baseRefName:'main'}));`,
        { mode: 0o755 }
      );
      fixture.ok([command, 'base']);
      expect(fixture.git(['rev-parse', 'base'])).to.equal(target);
      expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(fixture.git(['log', '-1', '--format=%s'])).to.equal(
        'remote advance'
      );
      expect(fixture.parent('base')).to.equal('main');
    });

  it('known unsupported names and modes fail before tools without successful stubs', () => {
    const before = fixture.inspectionSnapshot();
    const restore = fixture.refuseExternalTools();
    try {
      for (const args of [
        ['config'],
        ['mg'],
        ['absorb'],
        ['create', '--into', 'tip'],
        ['modify', '--reset-author'],
      ]) {
        const result = fixture.run([...args, '--no-interactive']);
        expect(result.status, args.join(' ')).not.to.equal(0);
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
      }
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
