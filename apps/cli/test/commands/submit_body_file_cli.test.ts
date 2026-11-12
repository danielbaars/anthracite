import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI workflows share disposable fixture setup.
// eslint-disable-next-line max-lines-per-function
describe('submit PR description files', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());
  it('creates with literal file contents and updates without new commits', () => {
    fixture.branch('target', 'main');
    const file = path.join(fixture.repo, 'approved body.md');
    const text = '# Approved ü\n\nLiteral $(touch nope) `text`';
    fs.writeFileSync(file, text);
    fixture.succeed(
      'submit',
      '--body-file',
      'approved body.md',
      '--title',
      'Approved'
    );
    expect(fixture.prs()[0].body).to.include(text);
    const create = fixture.calls().find((args) => args[1] === 'create');
    expect(create).to.include(text);
    fs.writeFileSync(file, 'Replacement');
    fixture.succeed('submit', '--body-file', file);
    expect(fixture.prs()[0].title).to.equal('Approved');
    expect(fixture.prs()[0].body)
      .to.include('Replacement')
      .and.not.include(text);
  });
  it('clears the description while retaining one managed footer and fresh omitted title', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--title', 'Original');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        title: 'Fresh remote title',
        body: 'Old description',
      }))
    );
    const file = path.join(fixture.repo, 'empty.md');
    fs.writeFileSync(file, '');
    fixture.succeed('submit', '--body-file', file, '--no-edit');
    expect(fixture.prs()[0].title).to.equal('Fresh remote title');
    expect(fixture.prs()[0].body).not.to.include('Old description');
    const body = fixture.prs()[0].body;
    expect(body).to.include('Dependency');
    fixture.clearCalls();
    fixture.succeed('submit', '--body-file', file);
    expect(fixture.calls().filter((args) => args[1] === 'edit')).to.deep.equal(
      []
    );
  });
  it('replaces a description even when supplied text includes the matching footer', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit');
    const footer = fixture.prs()[0].body;
    const file = path.join(fixture.repo, 'body.md');
    fs.writeFileSync(file, 'New description' + footer);
    fixture.succeed('submit', '--body-file', file);
    expect(fixture.prs()[0].body).to.equal('New description' + footer);
  });
  it('scopes body replacement to the starting PR and previews without writes', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.branch('child', 'target');
    fixture.succeed('submit', '--stack');
    fixture.setPrs(
      fixture.prs().map((pr) => ({ ...pr, body: 'Fresh ' + pr.headRefName }))
    );
    const file = path.join(fixture.repo, 'body.md');
    fs.writeFileSync(file, 'Target replacement');
    const before = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const output = fixture.succeed(
      's',
      '--branch',
      'target',
      '--stack',
      '--body-file',
      file,
      '--dry-run'
    );
    expect(output)
      .to.include('PR body for target: replace description')
      .and.include('target (Update)');
    expect(fixture.prs()).to.deep.equal(before);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    fixture.succeed('s', '--branch', 'target', '--stack', '--body-file', file);
    for (const pr of fixture.prs())
      expect(pr.body).to.include(
        pr.headRefName === 'target'
          ? 'Target replacement'
          : 'Fresh ' + pr.headRefName
      );
  });

  for (const invalid of [
    'missing',
    'directory',
    'invalid UTF-8',
    'NUL',
    'unreadable',
    'stdin',
  ]) {
    it(`refuses ${invalid} body input before any push`, () => {
      fixture.branch('target', 'main');
      const file = path.join(fixture.root, 'invalid-body');
      if (invalid === 'directory') fs.mkdirSync(file);
      else if (invalid === 'invalid UTF-8')
        fs.writeFileSync(file, Buffer.from([0xc3, 0x28]));
      else if (invalid === 'NUL') fs.writeFileSync(file, 'bad\0body');
      else if (invalid === 'unreadable') {
        fs.writeFileSync(file, 'private');
        fs.chmodSync(file, 0);
      }
      const refs = fixture.git('ls-remote', '--heads', 'origin');
      const result = fixture.cli(
        'submit',
        '--body-file',
        invalid === 'stdin' ? '-' : file
      );
      if (invalid === 'unreadable') fs.chmodSync(file, 0o600);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(
        invalid === 'stdin' ? 'Unknown argument' : 'Cannot read --body-file'
      );
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    });
  }
  for (const blocker of ['frozen', 'update-only', 'edit']) {
    it(`protects body-only metadata from ${blocker}`, () => {
      fixture.branch('target', 'main');
      const file = path.join(fixture.root, 'body.md');
      fs.writeFileSync(file, 'Approved');
      if (blocker === 'frozen') fixture.succeed('freeze', 'target');
      const flags =
        blocker === 'edit'
          ? ['--edit', '--no-edit']
          : blocker === 'update-only'
          ? ['--update-only']
          : [];
      const refs = fixture.git('ls-remote', '--heads', 'origin');
      expect(
        fixture.cli('submit', '--body-file', file, ...flags).status
      ).to.equal(1);
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    });
  }
});
