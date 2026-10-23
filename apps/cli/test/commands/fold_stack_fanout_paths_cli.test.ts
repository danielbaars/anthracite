import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

for (const keep of [false, true]) {
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold off-chain replay paths through the public CLI (keep=${keep})`, function () {
    this.timeout(60000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());
    function ignore(): void {
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
    }
    function replayPath(name: string): void {
      fixture.branch('sibling', 'base');
      fixture.stage(name, 'temporary replay content');
      fixture.git(['commit', '-m', 'own add']);
      fixture.git(['rm', name]);
      fixture.git(['commit', '-m', 'own delete']);
      fixture.git(['switch', 'tip']);
    }
    function refuse(): void {
      const before = fixture.snapshot();
      const index = fs.readFileSync(path.join(fixture.repo, '.git/index'));
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('Cannot fold');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, '.git/index'))
      ).to.deep.equal(index);
      expect(fixture.ok(['info'])).to.include('Parent: child');
    }
    for (const ignored of [false, true]) {
      for (const name of [
        'transient.bin',
        'literal[ab]*?.txt',
        'line\nbreak.txt',
        ' leading.txt',
      ]) {
        it(`protects intermediate own add/delete ${JSON.stringify(
          name
        )} ignored=${ignored}`, () => {
          replayPath(name);
          if (ignored) ignore();
          const bytes = Buffer.from([0, 255, 128, 10, 13]);
          fs.writeFileSync(path.join(fixture.repo, name), bytes);
          refuse();
          expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
            bytes
          );
        });
      }
    }
    for (const kind of ['directory', 'symlink', 'case', 'unicode']) {
      it(`protects an intermediate replay ${kind} obstruction`, () => {
        const name =
          kind === 'unicode'
            ? 'café.txt'
            : kind === 'case'
            ? 'CASE.txt'
            : kind === 'symlink'
            ? 'nested/work.txt'
            : 'directory.txt';
        if (kind === 'symlink') {
          fixture.branch('sibling', 'base');
          fs.mkdirSync(path.join(fixture.repo, 'nested'));
          fixture.stage(name, 'own');
          fixture.git(['commit', '-m', 'own nested']);
          fixture.git(['rm', '-r', 'nested']);
          fixture.git(['commit', '-m', 'own nested delete']);
          fixture.git(['switch', 'tip']);
        } else replayPath(name);
        ignore();
        const bytes = Buffer.from([0, 111, 255, 13]);
        let actual = name;
        if (kind === 'case') {
          fixture.git(['config', 'core.ignorecase', 'true']);
          actual = 'case.txt';
        }
        if (kind === 'unicode') actual = 'cafe\u0301.txt';
        if (kind === 'directory') {
          fs.mkdirSync(path.join(fixture.repo, name));
          actual = `${name}/private`;
        }
        if (kind === 'symlink') {
          const external = path.join(fixture.root, 'external');
          fs.mkdirSync(external);
          fs.writeFileSync(path.join(external, 'work.txt'), bytes);
          fs.symlinkSync(external, path.join(fixture.repo, 'nested'));
        } else fs.writeFileSync(path.join(fixture.repo, actual), bytes);
        refuse();
        expect(fs.readFileSync(path.join(fixture.repo, actual))).to.deep.equal(
          bytes
        );
      });
    }
    it('allows ignored historical paths before the actual own replay base and unrelated bytes', () => {
      fixture.git(['switch', 'base']);
      fixture.stage('old.bin', 'old content');
      fixture.git(['commit', '-m', 'old selected add']);
      fixture.git(['rm', 'old.bin']);
      fixture.git(['commit', '-m', 'old selected delete']);
      fixture.ok(['restack', '--branch', 'child', '--upstack']);
      fixture.branch('sibling', 'base');
      fixture.git(['switch', 'tip']);
      ignore();
      const bytes = Buffer.from([0, 255, 200]);
      fixture.write('unrelated', 'unchanged');
      fs.writeFileSync(path.join(fixture.repo, 'old.bin'), bytes);
      fixture.ok(['fold', '--stack', `--keep=${keep}`]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        keep ? 'tip' : 'base'
      );
      expect(fs.readFileSync(path.join(fixture.repo, 'old.bin'))).to.deep.equal(
        bytes
      );
      expect(
        fs.readFileSync(path.join(fixture.repo, 'unrelated'), 'utf8')
      ).to.equal('unchanged');
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(
        fixture.git([
          'log',
          '--reverse',
          '--format=%s',
          `${keep ? 'tip' : 'base'}..sibling`,
        ])
      ).to.equal('sibling');
    });
  });
}
