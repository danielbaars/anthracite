import { expect } from 'chai';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// Independent public CLI scenarios with real local repositories.
// eslint-disable-next-line max-lines-per-function
describe('delete verifies known PR state through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture.cleanup());

  function knownPr(cachedState: string, liveState: string): void {
    fixture.branch('target', 'main');
    const ref = 'refs/branch-metadata/target';
    const meta = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(fixture.git('cat-file', '-p', ref)));
    meta.prInfo = {
      number: 481,
      url: 'https://github.com/fixture/submit/pull/481',
      base: 'main',
      state: cachedState,
    };
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: fixture.repo,
      env: fixture.env,
      input: JSON.stringify(meta),
      encoding: 'utf8',
    }).trim();
    fixture.git('update-ref', ref, oid);
    const response = {
      number: 481,
      url: 'https://github.com/fixture/submit/pull/481',
      title: 'Synthetic PR',
      body: '',
      author: { login: 'fixture' },
      state: liveState,
      isDraft: false,
      headRefName: 'target',
      headRefOid: fixture.git('rev-parse', 'target'),
      baseRefName: 'main',
      baseRefOid: fixture.git('rev-parse', 'main'),
      headRepositoryOwner: { login: 'fixture' },
      headRepository: { name: 'submit' },
      isCrossRepository: false,
    };
    fs.writeFileSync(
      path.join(fixture.root, 'response.json'),
      JSON.stringify(response)
    );
    githubScript(
      `process.stdout.write(fs.readFileSync(${JSON.stringify(
        path.join(fixture.root, 'response.json')
      )}, 'utf8'));`
    );
    fixture.clearCalls();
  }

  function githubScript(body: string): void {
    fs.writeFileSync(
      path.join(fixture.root, 'bin/gh'),
      `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.ANTHRACITE_TEST_GH_LOG,JSON.stringify(process.argv.slice(2))+'\\n');${body}\n`
    );
  }
  function response(changes: Record<string, unknown>): void {
    const file = path.join(fixture.root, 'response.json');
    const value = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    fs.writeFileSync(file, JSON.stringify({ ...value, ...changes }));
  }
  function refs(): string {
    return fixture.git(
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/branch-metadata'
    );
  }

  it('deletes a nonempty branch after its known PR closes outside Anthracite', () => {
    knownPr('OPEN', 'CLOSED');
    fixture.succeed('delete', 'target');
    expect(fixture.git('branch', '--list', 'target')).to.equal('');
    expect(fixture.calls()).to.have.length(1);
    expect(fixture.calls()[0]).to.include.members(['pr', 'view', '481']);
  });
  it('accepts a freshly merged known PR through the delete alias', () => {
    knownPr('OPEN', 'MERGED');
    fixture.succeed('dl', 'target');
    expect(fixture.git('branch', '--list', 'target')).to.equal('');
    expect(fixture.calls()).to.have.length(1);
  });

  it('npm reuse: retains unpublished work not covered by a terminal PR head', () => {
    knownPr('CLOSED', 'CLOSED');
    response({ headRefOid: fixture.git('rev-parse', 'main') });
    const before = refs();
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('does not cover the current local head');
    expect(refs()).to.equal(before);
  });

  it('retains commits added by a post-checkout hook after PR verification', () => {
    knownPr('OPEN', 'CLOSED');
    const approved = fixture.git('rev-parse', 'target');
    const correction = fixture.commit('late-correction');
    fixture.git('reset', '--hard', approved);
    const hook = path.join(fixture.repo, '.git/hooks/post-checkout');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\ngit update-ref refs/heads/target ${correction} ${approved}\n`,
      { mode: 0o755 }
    );
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('does not cover the current local head');
    expect(fixture.git('rev-parse', 'target')).to.equal(correction);
    expect(fixture.git('show', 'target:late-correction.txt')).to.equal(
      'late-correction'
    );
  });

  for (const cached of ['OPEN', 'CLOSED']) {
    it(`refuses a freshly open PR with cached ${cached} and retains the verified state`, () => {
      knownPr(cached, 'OPEN');
      const head = fixture.git('rev-parse', 'target');
      const result = fixture.cli('delete', 'target');
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('neither merged nor closed');
      expect(fixture.git('rev-parse', 'target')).to.equal(head);
      expect(
        z
          .object({ prInfo: z.object({ state: z.string() }) })
          .parse(
            JSON.parse(
              fixture.git('cat-file', '-p', 'refs/branch-metadata/target')
            )
          ).prInfo.state
      ).to.equal('OPEN');
      expect(fixture.calls()).to.have.length(1);
    });
    it(`does not trust cached ${cached} when GitHub is unavailable`, () => {
      knownPr(cached, 'CLOSED');
      githubScript("console.error('network unavailable');process.exitCode=1;");
      const before = refs();
      const result = fixture.cli('delete', 'target');
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include(
        `last known ${cached} (cached; age unknown)`
      );
      expect(result.stderr).to.include('Could not verify');
      expect(result.stderr).not.to.include('Use the `--force`');
      expect(refs()).to.equal(before);
    });
  }

  it('honors disabled GitHub integration without trusting cached closed state', () => {
    knownPr('CLOSED', 'CLOSED');
    fixture.succeed('repo', 'github', '--no-enable');
    const before = refs();
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('GitHub integration is disabled');
    expect(refs()).to.equal(before);
    expect(fixture.calls()).to.deep.equal([]);
  });

  it('retains explicit force authority without a GitHub lookup', () => {
    knownPr('OPEN', 'OPEN');
    githubScript("throw Error('GitHub must not be called');");
    fixture.succeed('delete', 'target', '--force');
    expect(fixture.git('branch', '--list', 'target')).to.equal('');
    expect(fixture.calls()).to.deep.equal([]);
  });

  for (const mode of ['merged', 'empty']) {
    it(`retains local ${mode} proof without GitHub access`, () => {
      knownPr('OPEN', 'OPEN');
      fixture.git('checkout', 'main');
      if (mode === 'merged') fixture.git('merge', '--ff-only', 'target');
      else fixture.git('branch', '-f', 'target', 'main');
      githubScript("throw Error('GitHub must not be called');");
      fixture.succeed('delete', 'target');
      expect(fixture.git('branch', '--list', 'target')).to.equal('');
      expect(fixture.calls()).to.deep.equal([]);
    });
  }

  for (const mismatch of [
    { number: 482 },
    { headRefName: 'foreign' },
    { headRepositoryOwner: { login: 'foreign' } },
  ]) {
    it(`preserves refs on a foreign PR identity ${JSON.stringify(
      mismatch
    )}`, () => {
      knownPr('CLOSED', 'CLOSED');
      response(mismatch);
      const before = refs();
      const result = fixture.cli('delete', 'target');
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('Could not verify');
      expect(refs()).to.equal(before);
    });
  }

  it('refuses a local ref change while the PR lookup is in flight', () => {
    knownPr('OPEN', 'CLOSED');
    const before = fixture.git('cat-file', '-p', 'refs/branch-metadata/target');
    githubScript(
      `require('node:child_process').execFileSync('git',['branch','independent','main']);process.stdout.write(fs.readFileSync(${JSON.stringify(
        path.join(fixture.root, 'response.json')
      )},'utf8'));`
    );
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(result.stderr).to.include('changed while verifying PR state');
    expect(fixture.git('branch', '--list', 'target')).to.include('target');
    expect(
      fixture.git('cat-file', '-p', 'refs/branch-metadata/target')
    ).to.equal(before);
  });

  it('refuses frozen survivors before fetching or updating cached status', () => {
    knownPr('OPEN', 'CLOSED');
    fixture.branch('child', 'target');
    fixture.succeed('freeze', 'child');
    const before = refs();
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(result.stderr.toLowerCase()).to.include('frozen');
    expect(refs()).to.equal(before);
    expect(fixture.calls()).to.deep.equal([]);
  });
  it('accepts an empty legacy full repository name with matching owner and name', () => {
    knownPr('OPEN', 'CLOSED');
    response({ headRepository: { name: 'submit', nameWithOwner: '' } });
    fixture.succeed('delete', 'target');
    expect(fixture.git('branch', '--list', 'target')).to.equal('');
  });

  it('rejects a contradictory populated full repository name', () => {
    knownPr('CLOSED', 'CLOSED');
    response({
      headRepository: { name: 'submit', nameWithOwner: 'foreign/submit' },
    });
    const before = refs();
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(refs()).to.equal(before);
  });

  it('can delete a frozen closed leaf without changing its protection first', () => {
    knownPr('OPEN', 'CLOSED');
    fixture.succeed('freeze', 'target');
    fixture.succeed('delete', 'target');
    expect(fixture.git('branch', '--list', 'target')).to.equal('');
  });

  it('reparents and restacks an editable child after verified closed-parent deletion', () => {
    knownPr('OPEN', 'CLOSED');
    fixture.branch('child', 'target');
    fixture.succeed('delete', 'target');
    expect(fixture.git('branch', '--list', 'target')).to.equal('');
    expect(fixture.git('log', '--format=%s', 'main..child')).to.equal('child');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'child.txt'), 'utf8')
    ).to.equal('child');
    expect(fixture.calls()).to.have.length(1);
  });

  it('refuses an occupied target before fetching or changing its cached status', () => {
    knownPr('OPEN', 'CLOSED');
    fixture.git('checkout', 'main');
    fixture.git(
      'worktree',
      'add',
      path.join(fixture.root, 'occupied'),
      'target'
    );
    const before = refs();
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(result.stderr.toLowerCase()).to.include('worktree');
    expect(refs()).to.equal(before);
    expect(fixture.calls()).to.deep.equal([]);
  });
  it('preserves staged, unstaged and untracked bytes when verification fails', () => {
    knownPr('CLOSED', 'CLOSED');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'staged main');
    fixture.git('add', 'main.txt');
    fs.appendFileSync(path.join(fixture.repo, 'main.txt'), '\nunstaged main');
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.txt'),
      'untracked bytes'
    );
    githubScript(
      "console.error('authentication required');process.exitCode=1;"
    );
    const before = {
      refs: refs(),
      index: fixture.git('ls-files', '--stage'),
      status: fixture.git('status', '--porcelain'),
      head: fixture.git('rev-parse', 'HEAD'),
    };
    const result = fixture.cli('delete', 'target');
    expect(result.status).not.to.equal(0);
    expect(refs()).to.equal(before.refs);
    expect(fixture.git('ls-files', '--stage')).to.equal(before.index);
    expect(fixture.git('status', '--porcelain')).to.equal(before.status);
    expect(fixture.git('rev-parse', 'HEAD')).to.equal(before.head);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'main.txt'), 'utf8')
    ).to.equal('staged main\nunstaged main');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')
    ).to.equal('untracked bytes');
  });
  for (const cached of ['CLOSED', 'MERGED']) {
    it(`does not use cached ${cached} without a PR number as deletion authority`, () => {
      knownPr(cached, 'CLOSED');
      const ref = 'refs/branch-metadata/target';
      const meta = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(fixture.git('cat-file', '-p', ref)));
      meta.prInfo = { state: cached };
      const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: fixture.repo,
        env: fixture.env,
        input: JSON.stringify(meta),
        encoding: 'utf8',
      }).trim();
      fixture.git('update-ref', ref, oid);
      const before = refs();
      const result = fixture.cli('delete', 'target');
      expect(result.status).not.to.equal(0);
      expect(result.stderr).to.include('no associated PR number');
      expect(refs()).to.equal(before);
      expect(fixture.calls()).to.deep.equal([]);
    });
  }
});
