import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('create --onto --insert replay path protection through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const all of [false, true]) {
    it(`protects ignored work absent from descendant tips but materialized during replay with all ${all}`, () => {
      fixture.git(['switch', 'child']);
      fixture.stage('transient.txt', 'committed transient work');
      fixture.git(['commit', '-m', 'add transient']);
      fixture.git(['rm', 'transient.txt']);
      fixture.git(['commit', '-m', 'remove transient']);
      fixture.git(['switch', 'other']);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\ntransient.txt\n'
      );
      fixture.write('transient.txt', 'precious ignored work');
      fixture.stage('inserted.txt', 'selected work');
      const before = fixture.snapshot();
      const topology = fixture.ok(['log', 'short']);

      const result = fixture.run([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        ...(all ? ['--all'] : []),
        '-m',
        'selected',
      ]);

      expect(
        fs.readFileSync(path.join(fixture.repo, 'transient.txt'), 'utf8')
      ).to.equal('precious ignored work');
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr)
        .to.include('ignored')
        .and.include('transient.txt');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.ok(['log', 'short'])).to.equal(topology);
    });
  }

  for (const ignored of [true, false]) {
    it(`protects late hook ${
      ignored ? 'ignored' : 'untracked'
    } intermediate work after all selection and permits retry`, () => {
      fixture.git(['switch', 'child']);
      fixture.stage('transient.txt', 'committed transient work');
      fixture.git(['commit', '-m', 'add transient']);
      fixture.git(['rm', 'transient.txt']);
      fixture.git(['commit', '-m', 'remove transient']);
      fixture.git(['switch', 'other']);
      fixture.stage('inserted.txt', 'selected work');
      const before = fixture.refs();
      const parent = fixture.git(['rev-parse', 'base']);
      if (ignored)
        fs.appendFileSync(
          path.join(fixture.repo, '.git/info/exclude'),
          '\ntransient.txt\n'
        );
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/pre-commit'),
        "#!/bin/sh\nprintf 'precious hook work' > transient.txt\nexit 0\n",
        { mode: 0o755 }
      );

      const result = fixture.run([
        'create',
        'inserted',
        '--onto',
        'base',
        '--insert',
        '--all',
        '-m',
        'selected',
      ]);

      expect(
        fs.readFileSync(path.join(fixture.repo, 'transient.txt'), 'utf8')
      ).to.equal('precious hook work');
      expect(result.status).not.to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(parent);
      expect(fixture.git(['show', 'inserted:inserted.txt'])).to.equal(
        'selected work'
      );
      expect(
        fixture
          .refs()
          .split('\n')
          .filter((line) => !line.startsWith('refs/heads/inserted '))
          .join('\n')
      ).to.equal(before);
      for (const name of ['rebase-merge', 'rebase-apply'])
        expect(
          fs.existsSync(
            path.resolve(
              fixture.repo,
              fixture.git(['rev-parse', '--git-path', name])
            )
          )
        ).to.equal(false);
      expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
        ''
      );
      expect(fixture.git(['diff', '--cached', '--name-only'])).to.equal('');
      const output = result.stdout + result.stderr;
      expect(output).to.include('transient.txt');
      expect(output).to.match(/insertion is incomplete/i);
      expect(output).to.match(/parent relationships remain/i);
      expect(output).to.include('ch restack --upstack');
      expect(output).not.to.include('ch continue');
      expect(fixture.ok(['log', 'short'])).to.match(/child[^\n]*needs restack/);
      const inserted = fixture.git(['rev-parse', 'inserted']);
      const saved = path.join(fixture.root, 'retained-hook-work.txt');
      fs.renameSync(path.join(fixture.repo, 'transient.txt'), saved);
      fs.unlinkSync(path.join(fixture.repo, '.git/hooks/pre-commit'));

      fixture.ok(['restack', '--upstack']);

      expect(fs.readFileSync(saved, 'utf8')).to.equal('precious hook work');
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
      expect(fixture.git(['rev-parse', 'inserted'])).to.equal(inserted);
      fixture.git(['merge-base', '--is-ancestor', 'inserted', 'tip']);
      expect(fixture.git(['show', 'tip:inserted.txt'])).to.equal(
        'selected work'
      );
      expect(
        fixture.git(['log', '--format=%s', 'inserted..child']).split('\n')
      ).to.deep.equal(['remove transient', 'add transient', 'child']);
      expect(fixture.git(['ls-tree', '--name-only', 'child'])).not.to.include(
        'transient.txt'
      );
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
    });
  }

  it('allows ignored work only touched before the actual descendant replay base', () => {
    fixture.branch('historical-parent', 'main');
    fixture.stage('transient.txt', 'old parent history');
    fixture.git(['commit', '-m', 'historical add transient']);
    fixture.git(['rm', 'transient.txt']);
    fixture.git(['commit', '-m', 'historical remove transient']);
    fixture.branch('historical-child', 'historical-parent');
    const parent = fixture.git(['rev-parse', 'historical-parent']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.git(['switch', 'other']);
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\ntransient.txt\n'
    );
    fixture.write('transient.txt', 'precious unrelated ignored work');
    fixture.stage('inserted.txt', 'selected work');

    fixture.ok([
      'create',
      'inserted',
      '--onto',
      'historical-parent',
      '--insert',
      '-m',
      'selected',
    ]);

    expect(
      fs.readFileSync(path.join(fixture.repo, 'transient.txt'), 'utf8')
    ).to.equal('precious unrelated ignored work');
    expect(fixture.git(['rev-parse', 'historical-parent'])).to.equal(parent);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['rev-parse', 'inserted^'])).to.equal(parent);
    expect(fixture.git(['show', 'historical-child:inserted.txt'])).to.equal(
      'selected work'
    );
    expect(
      fixture.git(['log', '--format=%s', 'inserted..historical-child'])
    ).to.equal('historical-child');
    fixture.ok(['checkout', 'historical-child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('inserted');
  });
});
