import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';
import { readSubmitPrs } from '../lib/fixtures/submit_gh';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

// eslint-disable-next-line max-lines-per-function
describe('stack reorder local PR boundary with public submit/sync and external adapter', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  let state: string;
  let calls: string;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
    const bin = path.join(fixture.root, 'bin');
    fs.mkdirSync(bin);
    state = path.join(fixture.root, 'prs.json');
    calls = path.join(fixture.root, 'gh.jsonl');
    fs.writeFileSync(state, '[]');
    fs.writeFileSync(calls, '');
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!${process.execPath}\n${fs.readFileSync(
        path.join(__dirname, '../lib/fixtures/submit_gh.js'),
        'utf8'
      )}`,
      { mode: 0o755 }
    );
    fixture.env.PATH = `${bin}${path.delimiter}${fixture.env.PATH ?? ''}`;
    fixture.env.CHARCOAL_TEST_GH_STATE = state;
    fixture.env.CHARCOAL_TEST_GH_LOG = calls;
    const remote = path.join(fixture.root, 'remote.git');
    fixture.git(['init', '--bare', remote]);
    fixture.git(['remote', 'add', 'origin', remote]);
    fixture.git(['push', '-u', 'origin', 'main']);
    fixture.ok(['repo', 'owner', '--set', 'fixture']);
    fixture.ok(['repo', 'name', '--set', 'submit']);
  });
  afterEach(() => fixture?.cleanup());
  const identity = (output: string): string =>
    output
      .split('\n')
      .filter((line) => line.startsWith('PR #') || line.startsWith('https://'))
      .join('\n');
  for (const selected of ['pr-base', 'pr-child', 'pr-tip']) {
    for (const prState of ['OPEN', 'CLOSED', 'MERGED']) {
      it(`refuses known ${prState} identity on selected ${selected} before editor or local/remote effects`, () => {
        fixture.branch(selected, 'main');
        fixture.ok(['submit', '--publish']);
        if (selected !== 'pr-base') fixture.branch('pr-base', 'main');
        if (selected === 'pr-child')
          fixture.ok(['move', 'pr-base', '--source', 'pr-child']);
        else fixture.branch('pr-child', 'pr-base');
        if (selected === 'pr-tip')
          fixture.ok(['move', 'pr-child', '--source', 'pr-tip']);
        else fixture.branch('pr-tip', 'pr-child');
        fs.writeFileSync(
          state,
          JSON.stringify(
            readSubmitPrs(state).map((pr) => ({ ...pr, state: prState }))
          )
        );
        fixture.ok(['sync', '--no-pull', '--no-delete', '--no-restack']);
        fixture.git(['switch', selected]);
        const info = identity(fixture.ok(['info']));
        expect(info).to.include('PR #1');
        const before = fixture.snapshot();
        const remote = fixture.git(['ls-remote', '--heads', 'origin']);
        const prs = fs.readFileSync(state, 'utf8');
        fs.writeFileSync(calls, '');
        fixture.editor('pr-base\npr-tip\npr-child\n');
        const result = fixture.run(['reorder', '--stack', '--interactive']);
        expect(result.status).not.to.equal(0);
        expect(result.stdout + result.stderr).to.include(
          `Cannot reorder ${selected}`
        );
        expect(result.stdout + result.stderr).to.include('locally known PR');
        expect(fs.existsSync(fixture.offered)).to.equal(false);
        expect(fixture.snapshot()).to.deep.equal(before);
        expect(identity(fixture.ok(['info']))).to.equal(info);
        expect(fs.readFileSync(calls, 'utf8')).to.equal('');
        expect(fs.readFileSync(state, 'utf8')).to.equal(prs);
        expect(fixture.git(['ls-remote', '--heads', 'origin'])).to.equal(
          remote
        );
        expect(fixture.parent('pr-base')).to.equal('main');
        expect(fixture.parent('pr-child')).to.equal('pr-base');
        expect(fixture.parent('pr-tip')).to.equal('pr-child');
      });
    }
  }
  it('applies the same known PR guard to a standalone unchanged feature', () => {
    fixture.git(['switch', 'other']);
    fixture.ok(['submit']);
    const info = identity(fixture.ok(['info']));
    const before = fixture.snapshot();
    fs.writeFileSync(calls, '');
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('locally known PR');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(identity(fixture.ok(['info']))).to.equal(info);
    expect(fs.readFileSync(calls, 'utf8')).to.equal('');
  });
  it('retains an unrelated PR identity and every remote ref while reordering locally', () => {
    fixture.git(['switch', 'other']);
    fixture.ok(['submit']);
    const info = identity(fixture.ok(['info']));
    const other = fixture.git(['rev-parse', 'other']);
    const remote = fixture.git(['ls-remote', '--heads', 'origin']);
    const prs = fs.readFileSync(state, 'utf8');
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\n');
    fs.writeFileSync(calls, '');
    fixture.edit();
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['ls-remote', '--heads', 'origin'])).to.equal(remote);
    expect(fs.readFileSync(calls, 'utf8')).to.equal('');
    expect(fs.readFileSync(state, 'utf8')).to.equal(prs);
    fixture.ok(['checkout', 'other']);
    expect(identity(fixture.ok(['info']))).to.equal(info);
  });
  it('rejects a new public submit association installed during the editor and retains it exactly', () => {
    const submit = getTestCliCommand([
      'submit',
      '--publish',
      '--no-interactive',
    ]);
    const saved = path.join(fixture.root, 'editor-refstate');
    fixture.editor(
      'base\ntip\nchild\n',
      `const {execFileSync}=require('child_process'); execFileSync(${JSON.stringify(
        submit[0]
      )},${JSON.stringify(
        submit.slice(1)
      )},{env:process.env}); fs.writeFileSync(${JSON.stringify(
        saved
      )},execFileSync('git',['for-each-ref','--format=%(refname) %(objectname)']));`
    );
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('state changed');
    expect(
      fixture.git(['for-each-ref', '--format=%(refname) %(objectname)'])
    ).to.equal(fs.readFileSync(saved, 'utf8').trim());
    expect(fixture.ok(['info'])).to.include('PR #1');
    expect(fixture.parent('child')).to.equal('base');
    expect(fixture.parent('tip')).to.equal('child');
  });
});
