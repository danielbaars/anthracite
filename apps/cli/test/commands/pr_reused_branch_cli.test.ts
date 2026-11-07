import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { preparePrInspection, PrFixture } from '../lib/fixtures/pr_gh';

// eslint-disable-next-line max-lines-per-function
describe('public reused-branch PR discovery', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: PrFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = preparePrInspection(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('prefers the unique open PR over exact-head terminal history and unrelated old generations', () => {
    const open = { ...github.pr('base', 31), headRefOid: 'a'.repeat(40) };
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        { ...github.pr('base', 17), state: 'CLOSED' },
        {
          ...github.pr('base', 18),
          state: 'MERGED',
          headRefOid: 'b'.repeat(40),
        },
        open,
      ])
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('PR #31:').and.not.include('PR #17:');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('validates a stale stored terminal PR before discovering the current open generation', () => {
    const number = github.associate();
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        {
          ...github.pr('base', number),
          state: 'MERGED',
          headRefOid: 'b'.repeat(40),
        },
        github.pr('base', 31),
      ])
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('PR #31:')
      .and.not.include(`PR #${number}:`);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses a bounded discovery result that cannot prove uniqueness or absence', () => {
    const pr = github.pr('base');
    const history = Array.from({ length: 100 }, (_, index) => ({
      ...pr,
      number: 100 + index,
      url: `https://github.com/fixture/inspection/pull/${100 + index}`,
      state: index === 0 ? 'OPEN' : 'MERGED',
      headRefOid: index === 0 ? pr.headRefOid : 'b'.repeat(40),
    }));
    fs.writeFileSync(github.state, JSON.stringify(history));
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('incomplete');
    expect(result.stdout).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses when local work changes while discovery is in flight without undoing the external change', () => {
    fs.writeFileSync(github.state, JSON.stringify([github.pr('base')]));
    const script = path.join(github.bin, 'gh');
    const lines = fs.readFileSync(script, 'utf8').split('\n');
    const changedHead = fixture.git(['rev-parse', 'child']);
    fs.writeFileSync(
      script,
      [
        lines[0],
        `require('child_process').execFileSync('/usr/bin/git', ['update-ref', 'refs/heads/base', '${changedHead}']);`,
        ...lines.slice(1),
      ].join('\n'),
      { mode: 0o755 }
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('changed during');
    expect(result.stdout).to.equal('');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(changedHead);
    const after = fixture.inspectionSnapshot();
    expect(after.persistent).to.deep.equal(before.persistent);
    expect(after.index).to.equal(before.index);
    expect(after.files).to.deep.equal(before.files);
  });

  for (const state of ['CLOSED', 'MERGED']) {
    it(`shows exact-head ${state} history after excluding unrelated old generations`, () => {
      const exact = { ...github.pr('base', 30), state };
      fs.writeFileSync(
        github.state,
        JSON.stringify([
          {
            ...github.pr('base', 18),
            state: 'MERGED',
            headRefOid: 'a'.repeat(40),
          },
          exact,
          {
            ...github.pr('base', 19),
            state: 'CLOSED',
            headRefOid: 'b'.repeat(40),
          },
        ])
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['pr', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('PR #30:')
        .and.include(`State: ${state}`);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  for (const state of ['OPEN', 'MERGED']) {
    it(`refuses multiple eligible ${state} candidates without choosing a result order`, () => {
      fs.writeFileSync(
        github.state,
        JSON.stringify([
          { ...github.pr('base', 30), state },
          { ...github.pr('base', 31), state },
        ])
      );
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['pr', '--web', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include('Ambiguous');
      expect(result.stdout).to.equal('');
      expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  it('ignores multiple obsolete stored and discovered generations while preserving dirty work and recovery', () => {
    const number = github.associate();
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        {
          ...github.pr('base', number),
          state: 'MERGED',
          headRefOid: 'a'.repeat(40),
        },
        {
          ...github.pr('base', 31),
          state: 'CLOSED',
          headRefOid: 'b'.repeat(40),
        },
      ])
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'staged correction\n'
    );
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(
      path.join(fixture.repo, 'base.txt'),
      'unstaged correction\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.bin'),
      Buffer.from([0, 255])
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      JSON.stringify({
        branchesToSync: [],
        branchesToRestack: [],
        currentBranchOverride: 'other',
      })
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', 'base', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('No pull request.');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses multiple open candidates even when one has a valid stored association', () => {
    const number = github.associate();
    fs.writeFileSync(
      github.state,
      JSON.stringify([github.pr('base', number), github.pr('base', 31)])
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('Ambiguous');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses malformed or foreign obsolete history before claiming absence or selecting an open PR', () => {
    const old = {
      ...github.pr('base', 18),
      state: 'MERGED',
      headRefOid: 'b'.repeat(40),
    };
    const cases = [
      { ...old, headRepositoryOwner: { login: 'foreign' } },
      { ...old, headRefOid: 'missing' },
      { ...old, url: 'https://github.com/foreign/inspection/pull/18' },
    ];
    const before = fixture.inspectionSnapshot();
    for (const invalid of cases) {
      fs.writeFileSync(
        github.state,
        JSON.stringify([invalid, github.pr('base', 31)])
      );
      const result = fixture.run(['pr', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).not.to.include('No pull request');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('does not ignore an unreadable stored historical PR when another open match exists', () => {
    github.associate();
    fs.writeFileSync(github.state, JSON.stringify([github.pr('base', 31)]));
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('unavailable');
    expect(result.stdout).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses missing discovery evidence instead of treating a stored open PR as absent', () => {
    const number = github.associate();
    const pr = github.pr('base', number);
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const script = path.join(github.bin, 'gh');
    const original = fs.readFileSync(script, 'utf8').split('\n');
    const before = fixture.inspectionSnapshot();
    fs.writeFileSync(
      script,
      [
        original[0],
        "if (process.argv[3] === 'list') { process.stdout.write('[]'); process.exit(0); }",
        ...original.slice(1),
      ].join('\n'),
      { mode: 0o755 }
    );
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('changed during');
    expect(result.stdout).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('uses refreshed detail state when a stored identity has an older list snapshot', () => {
    const number = github.associate();
    const pr = { ...github.pr('base', number), title: 'Fresh detail title' };
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const script = path.join(github.bin, 'gh');
    const original = fs.readFileSync(script, 'utf8').split('\n');
    const stale = [
      {
        ...pr,
        title: 'Stale list title',
        state: 'CLOSED',
        headRefOid: 'b'.repeat(40),
      },
    ];
    fs.writeFileSync(
      script,
      [
        original[0],
        `if(process.argv[3]==='list'){process.stdout.write(${JSON.stringify(
          JSON.stringify(stale)
        )});process.exit(0);}`,
        ...original.slice(1),
      ].join('\n'),
      { mode: 0o755 }
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('State: OPEN')
      .and.include('Title: Fresh detail title')
      .and.include(`Head: ${fixture.git(['rev-parse', 'base'])}`);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses a stored URL without a usable PR number instead of silently relinking', () => {
    const metadata = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/base'])
    );
    const seed = path.join(fixture.root, 'stored-association.json');
    fs.writeFileSync(
      seed,
      JSON.stringify({
        ...metadata,
        prInfo: { url: 'https://github.com/foreign/repository/pull/17' },
      })
    );
    fixture.git([
      'update-ref',
      'refs/branch-metadata/base',
      fixture.git(['hash-object', '-w', seed]),
    ]);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('base', 31)]));
    fs.writeFileSync(github.calls, '');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stderr).to.include('Stored pull request association');
    expect(result.stdout).to.equal('');
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('ignores terminal history at an ancestor of new local work without adopting an association', () => {
    const historical = { ...github.pr('base'), state: 'MERGED' };
    fs.writeFileSync(github.state, JSON.stringify([historical]));
    fs.writeFileSync(
      path.join(fixture.repo, 'new-work.txt'),
      'unpublished work\n'
    );
    fixture.git(['add', 'new-work.txt']);
    fixture.git(['commit', '-m', 'New generation of base']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['pr', 'base', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('No pull request.')
      .and.not.include('PR #17');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
});
