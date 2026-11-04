import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

function selectChild(
  fixture: SubmitCliFixture
): ReturnType<typeof runCliInPty> {
  return runCliInPty(
    getTestCliCommand([
      'submit',
      '--interactive',
      '--select',
      '--no-edit',
      '--no-confirm',
      '--draft',
    ]),
    {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Would you like to submit base?', input: 'n\r' },
        { prompt: 'Would you like to submit child?', input: 'y\r' },
      ],
    }
  );
}

// Independent public CLI scenarios, not one production operation.
// eslint-disable-next-line max-lines-per-function
describe('submit ancestor footer freshness through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('preserves fresh ancestor PR text when only its child is selected in a terminal', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        body: `Latest approved ${pr.headRefName} description${pr.body}`,
      }))
    );
    const before = fixture.prs();
    const remote = fixture.git('ls-remote', '--heads', 'origin');
    fixture.clearCalls();

    const result = selectChild(fixture);

    expect(result.status, result.output).to.equal(0);
    expect(fixture.prs()).to.deep.equal(before);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
    expect(
      fixture
        .calls()
        .filter((call) => ['create', 'edit', 'ready'].includes(call[1]))
    ).to.deep.equal([]);
  });

  for (const identity of ['missing', 'renamed']) {
    it(`refuses before pushing or editing PRs when the omitted ancestor identity is ${identity}`, () => {
      fixture.branch('base', 'main');
      fixture.succeed('submit');
      fixture.branch('child', 'base');
      fixture.succeed('submit');
      fixture.setPrs(
        identity === 'missing'
          ? fixture.prs().filter((pr) => pr.headRefName !== 'base')
          : fixture.prs().map((pr) =>
              pr.headRefName === 'base'
                ? {
                    ...pr,
                    headRefName: 'renamed-base',
                    body: 'Latest renamed PR description',
                  }
                : pr
            )
      );
      fixture.commit('unpublished-child');
      const before = fixture.prs();
      const remote = fixture.git('ls-remote', '--heads', 'origin');
      fixture.clearCalls();

      const result = selectChild(fixture);

      expect(result.status).not.to.equal(0);
      expect(result.output).to.include(
        'Cannot read fresh PR body for base (#1)'
      );
      expect(fixture.prs()).to.deep.equal(before);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
      expect(
        fixture
          .calls()
          .filter((call) => ['create', 'edit', 'ready'].includes(call[1]))
      ).to.deep.equal([]);
    });
  }

  it('repairs the omitted ancestor footer from its latest body after creating the selected child PR', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        body: `Latest approved base description${pr.body}`,
      }))
    );
    const baseBefore = fixture.prs()[0];
    const baseRemote = fixture.remoteSha('base');
    fixture.branch('child', 'base');
    fixture.clearCalls();

    const result = selectChild(fixture);

    expect(result.status, result.output).to.equal(0);
    const { body, ...metadata } = fixture.prs()[0];
    const { body: oldBody, ...oldMetadata } = baseBefore;
    expect(oldBody).to.include('Latest approved base description');
    expect(metadata).to.deep.equal(oldMetadata);
    expect(body)
      .to.include('Latest approved base description')
      .and.include('PR #2');
    expect(body.match(/#### PR Dependency Tree/g)).to.have.length(1);
    expect(
      fixture.prs().map((pr) => [pr.headRefName, pr.baseRefName])
    ).to.deep.equal([
      ['base', 'main'],
      ['child', 'base'],
    ]);
    expect(fixture.remoteSha('base')).to.equal(baseRemote);
  });

  it('refreshes the ancestor body again after confirmation without widening the push selection', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    const baseRemote = fixture.remoteSha('base');
    const childHead = fixture.commit('child-update');
    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--interactive',
        '--select',
        '--no-edit',
        '--confirm',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Would you like to submit base?', input: 'n\r' },
          { prompt: 'Would you like to submit child?', input: 'y\r' },
          {
            prompt: 'Continue with this submit operation?',
            input: 'y\r',
            beforeInput: [
              process.execPath,
              '-e',
              "const fs=require('fs');const file=process.argv[1];const prs=JSON.parse(fs.readFileSync(file));for(const pr of prs)if(pr.headRefName==='base')pr.body='Maintainer edits during confirmation';fs.writeFileSync(file,JSON.stringify(prs));",
              fixture.state,
            ],
          },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(fixture.prs()[0].body)
      .to.include('Maintainer edits during confirmation')
      .and.include('PR #2');
    expect(fixture.remoteSha('base')).to.equal(baseRemote);
    expect(fixture.remoteSha('child')).to.equal(childHead);
  });

  it('leaves a frozen ancestor unread and unchanged while inspecting its editable child', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        body: `Latest approved ${pr.headRefName} description${pr.body}`,
      }))
    );
    fixture.succeed('freeze', 'base');
    const before = fixture.prs();
    fixture.clearCalls();

    fixture.succeed('submit');

    expect(fixture.prs()).to.deep.equal(before);
    expect(
      fixture
        .calls()
        .filter(
          (call) =>
            ['create', 'edit', 'ready'].includes(call[1]) ||
            (call[1] === 'view' && ['base', '1'].includes(call[2]))
        )
    ).to.deep.equal([]);
  });

  it('keeps an explicit selected PR body edit while preserving fresh unselected ancestor text', () => {
    fixture.branch('base', 'main');
    fixture.succeed('submit');
    fixture.branch('child', 'base');
    fixture.succeed('submit');
    fixture.setPrs(
      fixture.prs().map((pr) => ({
        ...pr,
        body: `Latest approved ${pr.headRefName} description${pr.body}`,
      }))
    );
    const baseBefore = fixture.prs()[0];
    const editor = path.join(fixture.root, 'body-editor');
    fs.writeFileSync(
      editor,
      `#!${process.execPath}\nrequire('fs').writeFileSync(process.argv[2], 'Explicitly edited child description\\n');\n`
    );
    fs.chmodSync(editor, 0o755);
    fixture.env.CH_EDITOR = editor;

    const result = runCliInPty(
      getTestCliCommand([
        'submit',
        '--interactive',
        '--select',
        '--edit',
        '--no-confirm',
        '--draft',
      ]),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [
          { prompt: 'Would you like to submit base?', input: 'n\r' },
          { prompt: 'Would you like to submit child?', input: 'y\r' },
          { prompt: 'Title', input: 'child\r' },
        ],
      }
    );

    expect(result.status, result.output).to.equal(0);
    expect(fixture.prs()[0]).to.deep.equal(baseBefore);
    expect(fixture.prs()[1].body)
      .to.include('Explicitly edited child description')
      .and.include('PR #2');
  });
});
