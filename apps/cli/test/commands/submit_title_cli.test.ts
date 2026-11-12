import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI scenarios share only disposable fixture setup.
// eslint-disable-next-line max-lines-per-function
describe('submit explicit PR titles', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());
  it('creates with the literal approved title and updates without new commits', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--title', '  Approved ü $(literal)  ');
    expect(fixture.prs()[0].title).to.equal('Approved ü $(literal)');
    fixture.setPrs(
      fixture.prs().map((pr) => ({ ...pr, body: 'Fresh description' }))
    );
    fixture.succeed('submit', '--title', 'Corrected title');
    expect(fixture.prs()[0].title).to.equal('Corrected title');
    expect(fixture.prs()[0].body).to.include('Fresh description');
  });
  it('treats a flag-looking title as literal metadata', () => {
    fixture.branch('target', 'main');
    fixture.succeed('submit', '--title=--edit', '--no-edit');
    expect(fixture.prs()[0].title).to.equal('--edit');
  });

  for (const field of ['title', 'body']) {
    it(`rejects grouped edit with explicit ${field} before publication`, () => {
      fixture.branch('target', 'main');
      const file = path.join(fixture.root, 'body.md');
      fs.writeFileSync(file, 'Approved description');
      const metadata =
        field === 'title' ? ['--title', 'Approved'] : ['--body-file', file];
      const refs = fixture.git('ls-remote', '--heads', 'origin');
      const result = fixture.cli('submit', '-se', '--no-edit', ...metadata);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('--edit cannot be combined');
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
      expect(
        fixture.calls().some((call) => ['create', 'edit'].includes(call[1]))
      ).to.equal(false);
    });
  }
  it('limits a title to the explicit starting branch in a stack', () => {
    fixture.branch('parent', 'main');
    fixture.branch('target', 'parent');
    fixture.branch('child', 'target');
    fixture.succeed(
      'submit',
      '--branch',
      'target',
      '--stack',
      '--title',
      'Target only',
      '--no-edit'
    );
    expect(fixture.prs().map((pr) => [pr.headRefName, pr.title])).to.deep.equal(
      [
        ['parent', 'parent'],
        ['target', 'Target only'],
        ['child', 'child'],
      ]
    );
    const create = fixture
      .calls()
      .find(
        (args) =>
          args[1] === 'create' && args[args.indexOf('--head') + 1] === 'target'
      );
    expect(create).to.include('Target only');
  });

  it('previews a metadata-only change and leaves matching titles untouched', () => {
    fixture.branch('target', 'main');
    fixture.succeed('s', '--title', 'Original');
    fixture.clearCalls();
    const before = fixture.prs();
    const refs = fixture.git('ls-remote', '--heads', 'origin');
    const preview = fixture.succeed(
      'submit',
      '--title',
      'New title',
      '--dry-run'
    );
    expect(preview)
      .to.include('PR title for target: "New title"')
      .and.include('target (Update)');
    expect(fixture.prs()).to.deep.equal(before);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    fixture.succeed('submit', '--title', 'Original');
    expect(
      fixture.calls().filter((args) => ['create', 'edit'].includes(args[1]))
    ).to.deep.equal([]);
  });

  for (const title of ['', '   ', 'first\nsecond', 'first\rsecond']) {
    it(`rejects invalid title ${JSON.stringify(
      title
    )} before external writes`, () => {
      fixture.branch('target', 'main');
      const refs = fixture.git('ls-remote', '--heads', 'origin');
      const result = fixture.cli('submit', '--title', title);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('single-line title');
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    });
  }

  for (const blocker of [
    'trunk',
    'frozen',
    'update-only',
    'edit',
    'integration',
  ]) {
    it(`refuses metadata for ${blocker} before pushing other branches`, () => {
      fixture.branch('parent', 'main');
      fixture.branch('target', 'parent');
      const args = ['submit', '--title', 'Approved'];
      if (blocker === 'trunk') args.push('--branch', 'main');
      if (blocker === 'frozen') fixture.succeed('freeze', 'target');
      if (blocker === 'update-only') args.push('--update-only');
      if (blocker === 'edit') args.push('--edit', '--no-edit');
      if (blocker === 'integration') {
        fs.writeFileSync(
          path.join(fixture.repo, '.git', '.graphite_repo_config'),
          JSON.stringify({
            trunk: 'main',
            owner: 'fixture',
            name: 'submit',
            host: 'github.com',
            isGithubIntegrationEnabled: false,
          })
        );
      }
      const refs = fixture.git('ls-remote', '--heads', 'origin');
      expect(fixture.cli(...args).status).to.equal(1);
      expect(fixture.prs()).to.deep.equal([]);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(refs);
    });
  }
});
