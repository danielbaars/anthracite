import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move only checkout and replay protection through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const file of ['new-parent.txt', '[draft]*.txt', 'line\nbreak.txt']) {
    it(`protects an ignored literal path from the new old-parent checkout tree: ${JSON.stringify(
      file
    )}`, () => {
      fixture.git(['switch', 'main']);
      fixture.write(file, 'parent work');
      fixture.git(['--literal-pathspecs', 'add', '--', file]);
      fixture.git(['commit', '-m', 'parent work']);
      fixture.git(['switch', 'base']);
      fs.appendFileSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'info/exclude'])
        ),
        '\n*\n'
      );
      const bytes = Buffer.from([0, 255, 10, 13, 42]);
      fs.writeFileSync(path.join(fixture.repo, file), bytes);
      const before = fixture.snapshot();
      expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(path.join(fixture.repo, file))).to.deep.equal(
        bytes
      );
      fs.unlinkSync(path.join(fixture.repo, file));
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  for (const directory of [false, true]) {
    it(`protects an ignored ${
      directory ? 'directory blocking a file' : 'file blocking a directory'
    } in the child basis`, () => {
      const tracked = directory ? 'obstruction' : 'obstruction/data.txt';
      const local = directory ? 'obstruction/private.bin' : 'obstruction';
      fixture.git(['switch', 'main']);
      fs.mkdirSync(path.dirname(path.join(fixture.repo, tracked)), {
        recursive: true,
      });
      fixture.stage(tracked, 'parent work');
      fixture.git(['commit', '-m', 'parent work']);
      fixture.git(['switch', 'base']);
      fs.appendFileSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'info/exclude'])
        ),
        '\n*\n'
      );
      fs.mkdirSync(path.dirname(path.join(fixture.repo, local)), {
        recursive: true,
      });
      const bytes = Buffer.from([0, 255, 10, 13, 42]);
      fs.writeFileSync(path.join(fixture.repo, local), bytes);
      const before = fixture.snapshot();
      expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(path.join(fixture.repo, local))).to.deep.equal(
        bytes
      );
      fs.rmSync(path.join(fixture.repo, 'obstruction'), { recursive: true });
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }

  it('protects a symlink ancestor and the external bytes behind it in the new child basis', () => {
    fixture.git(['switch', 'main']);
    fs.mkdirSync(path.join(fixture.repo, 'obstruction'));
    fixture.stage('obstruction/data.txt', 'parent work');
    fixture.git(['commit', '-m', 'parent work']);
    fixture.git(['switch', 'base']);
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    const bytes = Buffer.from([0, 255, 10, 13, 42]);
    fs.writeFileSync(path.join(outside, 'data.txt'), bytes);
    fs.symlinkSync(outside, path.join(fixture.repo, 'obstruction'));
    fs.appendFileSync(
      path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'info/exclude'])
      ),
      '\n*\n'
    );
    const before = fixture.snapshot();
    expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.lstatSync(path.join(fixture.repo, 'obstruction')).isSymbolicLink()
    ).to.equal(true);
    expect(fs.readFileSync(path.join(outside, 'data.txt'))).to.deep.equal(
      bytes
    );
    fs.unlinkSync(path.join(fixture.repo, 'obstruction'));
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  it('protects a relevant ignored case variant in the new child basis', () => {
    fixture.git(['switch', 'main']);
    fixture.stage('CaseFile.txt', 'parent work');
    fixture.git(['commit', '-m', 'parent work']);
    fixture.git(['switch', 'base']);
    fixture.git(['config', 'core.ignorecase', 'true']);
    fs.appendFileSync(
      path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'info/exclude'])
      ),
      '\n*\n'
    );
    const bytes = Buffer.from([0, 255, 10, 13, 42]);
    fs.writeFileSync(path.join(fixture.repo, 'casefile.txt'), bytes);
    const before = fixture.snapshot();
    expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'casefile.txt'))
    ).to.deep.equal(bytes);
    fs.unlinkSync(path.join(fixture.repo, 'casefile.txt'));
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
  });

  for (const branch of ['base', 'child', 'tip']) {
    for (const ignored of [false, true]) {
      it(`protects ${
        ignored ? 'ignored' : 'untracked'
      } intermediate add/delete replay paths in ${branch} before any parent change`, () => {
        fixture.git(['switch', branch]);
        fixture.stage('transient.bin', 'temporary branch work');
        fixture.git(['commit', '-m', 'temporary add']);
        fixture.git(['rm', 'transient.bin']);
        fixture.git(['commit', '-m', 'temporary delete']);
        fixture.ok(['restack', '--upstack']);
        fixture.git(['switch', 'other']);
        if (ignored)
          fs.appendFileSync(
            path.resolve(
              fixture.repo,
              fixture.git(['rev-parse', '--git-path', 'info/exclude'])
            ),
            '\ntransient.bin\n'
          );
        const bytes = Buffer.from([0, 255, 10, 13, 42]);
        fs.writeFileSync(path.join(fixture.repo, 'transient.bin'), bytes);
        const before = fixture.snapshot();
        expect(
          fixture.run(['move', 'other', '-s', 'base', '--only']).status
        ).not.to.equal(0);
        expect(fixture.snapshot()).to.deep.equal(before);
        expect(
          fs.readFileSync(path.join(fixture.repo, 'transient.bin'))
        ).to.deep.equal(bytes);
        fixture.ok(['checkout', 'child']);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      });
    }
  }

  it('allows ignored work touched only before the actual original replay bases', () => {
    fixture.git(['switch', 'main']);
    fixture.stage('transient.bin', 'historical work');
    fixture.git(['commit', '-m', 'historical add']);
    fixture.git(['rm', 'transient.bin']);
    fixture.git(['commit', '-m', 'historical delete']);
    fixture.branch('guarded-source', 'main');
    fixture.branch('guarded-child', 'guarded-source');
    fixture.git(['switch', 'other']);
    fs.appendFileSync(
      path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'info/exclude'])
      ),
      '\ntransient.bin\n'
    );
    const bytes = Buffer.from([0, 255, 10, 13, 42]);
    fs.writeFileSync(path.join(fixture.repo, 'transient.bin'), bytes);
    const unaffected = ['main', 'other', 'base', 'child', 'tip'].map(
      (branch) => [branch, fixture.git(['rev-parse', branch])]
    );
    fixture.ok(['move', 'other', '-s', 'guarded-source', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'transient.bin'))
    ).to.deep.equal(bytes);
    expect(
      fixture.git(['log', '--format=%s', 'other..guarded-source'])
    ).to.equal('guarded-source');
    expect(fixture.git(['log', '--format=%s', 'main..guarded-child'])).to.equal(
      'guarded-child'
    );
    for (const [branch, sha] of unaffected)
      expect(fixture.git(['rev-parse', branch])).to.equal(sha);
    fixture.ok(['checkout', 'guarded-child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('keeps unrelated untracked and ignored bytes at an untracked departure through both only components', () => {
    fixture.git(['switch', '-c', 'departure', 'other']);
    fs.appendFileSync(
      path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'info/exclude'])
      ),
      '\nprivate.bin\n'
    );
    const bytes = Buffer.from([0, 255, 10, 13, 42]);
    fs.writeFileSync(path.join(fixture.repo, 'private.bin'), bytes);
    fs.writeFileSync(path.join(fixture.repo, 'untracked.bin'), bytes);
    const before = fixture.snapshot();
    fixture.ok(['move', 'other', '-s', 'base', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('departure');
    expect({ ...fixture.snapshot(), refs: before.refs }).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'private.bin'))
    ).to.deep.equal(bytes);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'untracked.bin'))
    ).to.deep.equal(bytes);
    expect(fixture.run(['down']).status).not.to.equal(0);
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
  });
});
