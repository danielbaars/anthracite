import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('create --insert-child through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  function metadata(): string {
    return fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/branch-metadata',
    ]);
  }

  function freezeOnly(branch: string): void {
    const meta: unknown = JSON.parse(
      fixture.git(['cat-file', '-p', `refs/branch-metadata/${branch}`])
    );
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta))
      throw new Error('Expected branch metadata');
    const file = path.join(fixture.root, 'frozen-metadata.json');
    fs.writeFileSync(file, JSON.stringify({ ...meta, frozen: true }));
    fixture.git([
      'update-ref',
      `refs/branch-metadata/${branch}`,
      fixture.git(['hash-object', '-w', file]),
    ]);
  }

  for (const flags of [
    ['--insert-child', 'child'],
    ['--no-insert', '--insert-child', 'child'],
    ['--insert', '--insert-child'],
    ['--insert', '--insert-child='],
    ['--insert', '--no-insert-child'],
    ['--insert', '--insert-child', 'missing'],
    ['--insert', '--insert-child', 'tip'],
    ['--insert', '--insert-child', 'other'],
    ['--insert', '--insert-child', 'untracked'],
    ['--insert', '--insert-child', 'child', '--insert-child', 'missing'],
    ['--insert', '--insert-child', 'chi'],
    ['--insert', '--insert-child', 'ch*'],
    ['--insert', '--insert-child', 'child,tip'],
  ]) {
    it(`refuses ${flags.join(' ')} before all staging or creation`, () => {
      fixture.git(['branch', 'untracked', 'base']);
      fixture.stage('main.txt', 'prepared');
      fixture.write('main.txt', 'prepared plus unfinished');
      fixture.write('loose.txt', 'untracked work');
      fixture.git([
        'config',
        'core.excludesfile',
        path.join(fixture.root, 'ignore'),
      ]);
      fs.writeFileSync(path.join(fixture.root, 'ignore'), 'ignored.txt\n');
      fixture.write('ignored.txt', 'ignored work');
      const before = fixture.snapshot();
      const beforeMetadata = metadata();
      const result = fixture.run([
        'create',
        'inserted',
        ...flags,
        '--all',
        '-m',
        'invalid scope',
      ]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(metadata()).to.equal(beforeMetadata);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'ignored.txt'), 'utf8')
      ).to.equal('ignored work');
    });
  }

  it('refuses a selector without insert before ordinary metadata repair', () => {
    fixture.git([
      'update-ref',
      'refs/branch-metadata/missing-branch',
      fixture.git(['rev-parse', 'refs/branch-metadata/child']),
    ]);
    const before = metadata();
    expect(
      fixture.run(['create', 'inserted', '--insert-child', 'child']).status
    ).not.to.equal(0);
    expect(metadata()).to.equal(before);
  });

  it('rejects explicit children on a childless chosen parent', () => {
    const before = fixture.snapshot();
    expect(
      fixture.run([
        'create',
        'inserted',
        '--onto',
        'other',
        '--insert',
        '--insert-child',
        'child',
      ]).status
    ).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('keeps repeated numeric, false, Unicode and comma names literal through c -i', () => {
    const names = ['001', 'false', 'één', 'comma,name'];
    for (const name of names) fixture.branch(name, 'base');
    fixture.git(['switch', 'base']);
    const untouched = fixture.git(['rev-parse', 'child']);
    fixture.stage('inserted.txt', 'literal prerequisite');
    fixture.ok([
      'c',
      'inserted',
      '-i',
      ...[...names, '001'].flatMap((name) => ['--insert-child', name]),
      '-m',
      'literal prerequisite',
    ]);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(untouched);
    for (const name of names) {
      fixture.git(['merge-base', '--is-ancestor', 'inserted', name]);
      expect(fixture.git(['log', '--format=%s', `inserted..${name}`])).to.equal(
        name
      );
      expect(
        JSON.parse(
          fixture.git(['cat-file', '-p', `refs/branch-metadata/${name}`])
        ).parentBranchName
      ).to.equal('inserted');
    }
  });

  for (const source of ['other', 'sibling']) {
    it(`resolves onto children from ${source} without rewriting the departure arm`, () => {
      fixture.branch('sibling', 'base');
      fixture.branch('sibling-tip', 'sibling');
      fixture.git(['switch', source]);
      const original = fixture.git(['rev-parse', source]);
      const siblingMetadata = fixture.git([
        'cat-file',
        '-p',
        'refs/branch-metadata/sibling',
      ]);
      const tip = fixture.git(['rev-parse', 'sibling-tip']);
      fixture.stage('inserted.txt', 'onto prerequisite');
      fixture.ok([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '--insert-child',
        'child',
        '-m',
        'onto prerequisite',
      ]);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fixture.git(['rev-parse', source])).to.equal(original);
      expect(fixture.git(['rev-parse', 'sibling-tip'])).to.equal(tip);
      expect(
        fixture.git(['cat-file', '-p', 'refs/branch-metadata/sibling'])
      ).to.equal(siblingMetadata);
      expect(fixture.git(['show', 'child:inserted.txt'])).to.equal(
        'onto prerequisite'
      );
      expect(
        fixture.git(['ls-tree', '--name-only', 'inserted'])
      ).not.to.include(`${source}.txt`);
      fixture.git(['merge-base', '--is-ancestor', 'inserted', 'tip']);
    });
  }

  for (const protection of ['frozen', 'occupied']) {
    it(`preserves a ${protection} unselected arm while replaying the chosen arm`, () => {
      fixture.branch('sibling', 'base');
      fixture.branch('sibling-tip', 'sibling');
      fixture.git(['switch', 'other']);
      if (protection === 'frozen') fixture.ok(['freeze', 'sibling']);
      else {
        fixture.git(['worktree', 'add', fixture.linked, 'sibling']);
        fixture.stage('main.txt', 'linked staged', fixture.linked);
        fixture.write('main.txt', 'linked unfinished', fixture.linked);
        fixture.write('loose.txt', 'linked loose', fixture.linked);
      }
      const before = fixture.git(['rev-parse', 'sibling', 'sibling-tip']);
      const beforeMetadata = fixture.git([
        'cat-file',
        '-p',
        'refs/branch-metadata/sibling',
      ]);
      const linked =
        protection === 'occupied'
          ? fixture.snapshot(fixture.linked)
          : undefined;
      fixture.stage('inserted.txt', 'prerequisite');
      fixture.ok([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '--insert-child',
        'child',
        '-m',
        'prerequisite',
      ]);
      fixture.git(['merge-base', '--is-ancestor', 'inserted', 'tip']);
      expect(fixture.git(['rev-parse', 'sibling', 'sibling-tip'])).to.equal(
        before
      );
      expect(
        fixture.git(['cat-file', '-p', 'refs/branch-metadata/sibling'])
      ).to.equal(beforeMetadata);
      if (linked)
        expect({
          ...fixture.snapshot(fixture.linked),
          refs: linked.refs,
        }).to.deep.equal(linked);
    });

    for (const participant of ['child', 'tip']) {
      it(`refuses a ${protection} selected ${participant} before staging`, () => {
        fixture.git(['switch', 'other']);
        if (protection === 'frozen') freezeOnly(participant);
        else fixture.git(['worktree', 'add', fixture.linked, participant]);
        fixture.write('loose.txt', 'unstaged input');
        const before = fixture.snapshot();
        const beforeMetadata = metadata();
        const result = fixture.run([
          'create',
          'inserted',
          '--onto',
          'base',
          '--insert',
          '--insert-child',
          'child',
          '--all',
          '-m',
          'prerequisite',
        ]);
        expect(result.status).not.to.equal(0);
        expect(result.stdout + result.stderr).to.include(participant);
        expect(fixture.snapshot()).to.deep.equal(before);
        expect(metadata()).to.equal(beforeMetadata);
      });
    }

    it(`refuses a ${protection} chosen child even for an empty insertion`, () => {
      fixture.git(['switch', 'other']);
      if (protection === 'frozen') fixture.ok(['freeze', 'child']);
      else fixture.git(['worktree', 'add', fixture.linked, 'child']);
      const before = fixture.snapshot();
      const beforeMetadata = metadata();
      expect(
        fixture.run([
          'create',
          'inserted',
          '--onto',
          'base',
          '--insert',
          '--insert-child',
          'child',
        ]).status
      ).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(metadata()).to.equal(beforeMetadata);
    });
  }

  it('allows frozen read-only parents and aligned descendants for empty selected insertion', () => {
    fixture.branch('sibling', 'base');
    fixture.ok(['freeze', 'base']);
    freezeOnly('tip');
    fixture.git(['switch', 'other']);
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.write('loose.txt', 'foreign work', fixture.linked);
    const before = fixture.refs();
    const linked = fixture.snapshot(fixture.linked);
    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '--insert-child',
      'child',
    ]);
    expect(fixture.git(['rev-parse', 'inserted'])).to.equal(
      fixture.git(['rev-parse', 'base'])
    );
    expect(
      fixture
        .refs()
        .split('\n')
        .filter((line) => !line.startsWith('refs/heads/inserted '))
        .join('\n')
    ).to.equal(before);
    expect({
      ...fixture.snapshot(fixture.linked),
      refs: linked.refs,
    }).to.deep.equal(linked);
  });

  for (const guard of ['dirty', 'collision', 'patch', 'message']) {
    it(`retains the ${guard} input guard on a selected insertion`, () => {
      fixture.branch('sibling', 'base');
      fixture.git(['switch', 'sibling']);
      fixture.stage('inserted.txt', 'prepared');
      if (guard === 'dirty' || guard === 'patch')
        fixture.write('main.txt', 'unfinished source work');
      if (guard === 'collision')
        fixture.write('child.txt', 'untracked obstruction');
      const before = fixture.snapshot();
      const beforeMetadata = metadata();
      const result = fixture.run([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '--insert-child',
        'child',
        ...(guard === 'patch' ? ['--patch'] : []),
        ...(guard === 'message' ? [] : ['-m', 'prerequisite']),
      ]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(metadata()).to.equal(beforeMetadata);
    });
  }

  it('retains all-over-patch input precedence for only the chosen arms', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'other']);
    const sibling = fixture.git(['rev-parse', 'sibling']);
    fixture.stage('inserted.txt', 'prepared');
    fixture.write('main.txt', 'tracked all input');
    fixture.write('loose.txt', 'untracked all input');
    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'base',
      '--insert',
      '--insert-child',
      'child',
      '--all',
      '--patch',
      '-m',
      'all prerequisite',
    ]);
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const branch of ['inserted', 'child', 'tip']) {
      expect(fixture.git(['show', `${branch}:main.txt`])).to.equal(
        'tracked all input'
      );
      expect(fixture.git(['show', `${branch}:loose.txt`])).to.equal(
        'untracked all input'
      );
    }
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
  });

  it('preserves own author, full message, order and opaque selected metadata', () => {
    const meta = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/child'])
    );
    const prInfo = {
      number: 123,
      url: 'https://example.test/pr/123',
      title: 'Child PR',
    };
    const file = path.join(fixture.root, 'child-metadata.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ ...meta, prInfo, opaque: { owner: 'retained' } })
    );
    fixture.git([
      'update-ref',
      'refs/branch-metadata/child',
      fixture.git(['hash-object', '-w', file]),
    ]);
    fixture.git(['switch', 'child']);
    fixture.stage('own.txt', 'own second change');
    fixture.git([
      '-c',
      'user.name=Original author',
      '-c',
      'user.email=original@example.test',
      'commit',
      '-m',
      'Second subject\n\nFull body',
    ]);
    const history = fixture.git([
      'log',
      '--reverse',
      '--format=%an <%ae>%n%B',
      'base..child',
    ]);
    fixture.git(['switch', 'base']);
    fixture.stage('inserted.txt', 'prerequisite');

    fixture.ok([
      'create',
      'inserted',
      '--insert',
      '--insert-child',
      'child',
      '-m',
      'prerequisite',
    ]);

    expect(
      fixture.git([
        'log',
        '--reverse',
        '--format=%an <%ae>%n%B',
        'inserted..child',
      ])
    ).to.equal(history);
    const after = JSON.parse(
      fixture.git(['cat-file', '-p', 'refs/branch-metadata/child'])
    );
    expect(after.prInfo).to.deep.equal(prInfo);
    expect(after.opaque).to.deep.equal({ owner: 'retained' });
    expect(after.parentBranchName).to.equal('inserted');
  });

  it('inserts beneath one chosen arm and preserves an independent sibling', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'base']);
    const sibling = fixture.git(['rev-parse', 'sibling']);
    fixture.stage('inserted.txt', 'prerequisite');

    fixture.ok([
      'create',
      'inserted',
      '--insert',
      '--insert-child',
      'child',
      '-m',
      'prerequisite',
    ]);

    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    for (const branch of ['child', 'tip']) {
      fixture.git(['merge-base', '--is-ancestor', 'inserted', branch]);
      expect(fixture.git(['show', `${branch}:inserted.txt`])).to.equal(
        'prerequisite'
      );
    }
    expect(fixture.git(['rev-parse', 'sibling'])).to.equal(sibling);
    fixture.ok(['checkout', 'sibling']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });
});
