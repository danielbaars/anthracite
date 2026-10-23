import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

for (const keep of [false, true]) {
  const survivor = keep ? 'tip' : 'base';
  const keepArgs = keep ? ['--keep'] : [];
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold checkout path protection through the public CLI (keep ${keep})`, function () {
    this.timeout(60000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());

    function ignore(name: string): void {
      const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
      fs.appendFileSync(path.resolve(fixture.repo, exclude), `\n${name}\n`);
    }
    function refuse(): void {
      const before = fixture.snapshot();
      const index = path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'index'])
      );
      const bytes = fs.readFileSync(index);
      const result = fixture.run(['fold', '--stack', ...keepArgs]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('Cannot fold');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(index)).to.deep.equal(bytes);
      expect(fixture.ok(['info'])).to.include('Parent: main');
    }

    for (const ignored of [false, true]) {
      for (const name of ['child.txt', 'tip.txt']) {
        it(`protects ${name} in the prepared future survivor, ignored ${ignored}`, () => {
          if (ignored) ignore(name);
          const bytes = Buffer.from([0, 255, 10, 13, 222]);
          fs.writeFileSync(path.join(fixture.repo, name), bytes);
          refuse();
          expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
            bytes
          );
        });
      }
    }
    for (const name of [
      'literal[ab]*?.txt',
      'line\nbreak.txt',
      ' leading.txt',
      'café.txt',
    ]) {
      it(`protects literal ignored checkout path ${JSON.stringify(
        name
      )}`, () => {
        fixture.git(['switch', 'tip']);
        fixture.stage(name, 'tip content');
        fixture.git(['commit', '-m', 'literal tip path']);
        fixture.git(['switch', 'base']);
        ignore('*');
        const bytes = Buffer.from([22, 0, 255, 11]);
        fs.writeFileSync(path.join(fixture.repo, name), bytes);
        refuse();
        expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
          bytes
        );
      });
    }

    it('protects an ignored directory obstructing a future survivor file', () => {
      fs.mkdirSync(path.join(fixture.repo, 'tip.txt'));
      ignore('tip.txt/');
      fixture.write('tip.txt/private.bin', 'directory bytes');
      refuse();
      expect(
        fs.readFileSync(path.join(fixture.repo, 'tip.txt/private.bin'), 'utf8')
      ).to.equal('directory bytes');
    });

    for (const symlink of [false, true]) {
      it(`protects a ${
        symlink ? 'symlink' : 'file'
      } ancestor obstruction`, () => {
        fixture.git(['switch', 'tip']);
        fs.mkdirSync(path.join(fixture.repo, 'nested'));
        fixture.stage('nested/work.txt', 'committed nested work');
        fixture.git(['commit', '-m', 'nested tip work']);
        fixture.git(['switch', 'base']);
        ignore('nested');
        const bytes = Buffer.from([0, 128, 255, 11]);
        const external = path.join(fixture.root, 'external');
        fs.mkdirSync(external);
        fs.writeFileSync(path.join(external, 'work.txt'), bytes);
        if (symlink)
          fs.symlinkSync(external, path.join(fixture.repo, 'nested'));
        else fs.writeFileSync(path.join(fixture.repo, 'nested'), bytes);
        refuse();
        expect(fs.readFileSync(path.join(external, 'work.txt'))).to.deep.equal(
          bytes
        );
        if (symlink)
          expect(fs.readlinkSync(path.join(fixture.repo, 'nested'))).to.equal(
            external
          );
        else
          expect(
            fs.readFileSync(path.join(fixture.repo, 'nested'))
          ).to.deep.equal(bytes);
      });
    }

    it('protects a relevant case alias on case-insensitive checkout configuration', () => {
      fixture.git(['config', 'core.ignorecase', 'true']);
      ignore('TIP.TXT');
      fixture.write('TIP.TXT', 'case-private');
      refuse();
      expect(
        fs.readFileSync(path.join(fixture.repo, 'TIP.TXT'), 'utf8')
      ).to.equal('case-private');
    });

    it('protects an existing decomposed Unicode alias when the host aliases it', function () {
      fixture.git(['switch', 'tip']);
      fixture.stage('café.txt', 'committed unicode');
      fixture.git(['commit', '-m', 'unicode tip']);
      fixture.git(['switch', 'base']);
      ignore('*');
      const alias = 'cafe\u0301.txt';
      fixture.write(alias, 'unicode-private');
      if (!fs.existsSync(path.join(fixture.repo, 'café.txt'))) this.skip();
      refuse();
      expect(fs.readFileSync(path.join(fixture.repo, alias), 'utf8')).to.equal(
        'unicode-private'
      );
    });

    it('preserves noncolliding bytes and historical add/delete paths that are never replayed', () => {
      fixture.git(['switch', 'tip']);
      fixture.stage('transient.bin', 'historical selected work');
      fixture.git(['commit', '-m', 'add historical path']);
      fixture.git(['rm', 'transient.bin']);
      fixture.git(['commit', '-m', 'remove historical path']);
      const tip = fixture.git(['rev-parse', 'tip']);
      fixture.git(['switch', 'base']);
      ignore('*.bin');
      const bytes = Buffer.from([0, 255, 34, 13, 10]);
      fs.writeFileSync(path.join(fixture.repo, 'transient.bin'), bytes);
      fs.writeFileSync(path.join(fixture.repo, 'private.bin'), bytes);
      fixture.write('loose.txt', 'unfinished independent work');
      fixture.ok(['fold', '--stack', ...keepArgs]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      for (const name of ['transient.bin', 'private.bin'])
        expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
          bytes
        );
      expect(
        fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
      ).to.equal('unfinished independent work');
    });
  });
}
