import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

// eslint-disable-next-line max-lines-per-function
describe('move source-aware selection through a real PTY', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  function selectOther(args: readonly string[]) {
    delete fixture.env.FORCE_COLOR;
    return runCliInPty(getTestCliCommand(args), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        { prompt: 'Choose a new base', input: 'other' },
        { prompt: '› other\r\n❯', input: '\r' },
      ],
    });
  }

  it('cancels from a different departure while prompting for the selected source without checkout', () => {
    fixture.git(['switch', 'other']);
    const trace = path.join(fixture.root, 'checkout-trace');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-checkout'),
      `#!/bin/sh\ngit branch --show-current >> '${trace}'\n`,
      { mode: 0o755 }
    );
    const before = fixture.snapshot();
    const result = runCliInPty(
      getTestCliCommand(['move', '--source', 'base']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Choose a new base', input: '\u0003' }],
      }
    );
    expect(result.status).not.to.equal(0);
    expect(result.status).not.to.equal(124);
    expect(result.output).to.match(/Choose a new base for base/);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.existsSync(trace)).to.equal(false);
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });
  it('selects an explicit source target while omitting that source and its descendants', () => {
    fixture.git(['switch', 'main']);
    const result = selectOther(['move', '--source', 'base']);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(result.output).not.to.match(/◯\s+(child|tip)/);
    expect(fixture.git(['rev-parse', 'base^'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    expect(fixture.git(['show', 'tip:other.txt'])).to.equal('other');
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('shows descendants as only candidates while omitting the selected source itself on cancellation', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    const result = runCliInPty(
      getTestCliCommand(['move', '--source', 'base', '--only']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        responses: [{ prompt: 'Choose a new base', input: '\u0003' }],
      }
    );
    expect(result.status).not.to.equal(0);
    expect(result.status).not.to.equal(124);
    expect(result.output)
      .to.match(/◯\s+child/)
      .and.match(/◯\s+tip/);
    expect(result.output).not.to.match(/◯\s+base/);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('selects a leaf-only target from a different departure in a real terminal', () => {
    const baseDate = Number(
      fixture.git(['show', '-s', '--format=%ct', 'base'])
    );
    const originalDate = fixture.env.GIT_COMMITTER_DATE;
    try {
      // Date ties can place main, rather than other, before the selected source parent.
      fixture.git(['switch', 'main']);
      fixture.env.GIT_COMMITTER_DATE = `${baseDate + 1} +0000`;
      fixture.git(['commit', '--allow-empty', '-m', 'updated trunk']);
      fixture.git(['switch', 'other']);
      fixture.env.GIT_COMMITTER_DATE = `${baseDate} +0000`;
      fixture.git(['commit', '--amend', '--no-edit']);
      fixture.ok(['restack', '--branch', 'other']);
    } finally {
      if (originalDate === undefined) delete fixture.env.GIT_COMMITTER_DATE;
      else fixture.env.GIT_COMMITTER_DATE = originalDate;
    }
    fixture.git(['switch', 'main']);
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    const result = selectOther(['move', '--source', 'tip', '--only']);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['log', '--format=%s', 'other..tip'])).to.equal('tip');
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('uses the current source without an explicit source option during selection', () => {
    fixture.git(['switch', 'base']);
    const result = selectOther(['move']);
    expect(result.status, result.output).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['log', '--format=%s', 'other..base'])).to.equal('base');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });
  for (const args of [
    ['move', 'main', '--onto', 'other', '--source', 'base'],
    ['move', '--onto', '', '--source', 'base'],
    ['move', '--source', 'base', '--source', 'tip'],
    ['move', '--source', 'missing'],
  ]) {
    it(`rejects interactive invalid input before a selector can open: ${JSON.stringify(
      args
    )}`, () => {
      fixture.git(['switch', 'other']);
      const before = fixture.snapshot();
      const result = runCliInPty(getTestCliCommand(args), {
        cwd: fixture.repo,
        env: fixture.env,
      });
      expect(result.status).not.to.equal(0);
      expect(result.status).not.to.equal(124);
      expect(result.output).not.to.include('Choose a new base');
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }
});
