import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('create --onto --insert Unicode path protection through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const all of [false, true]) {
    it(`preserves ignored Unicode aliases before insertion effects with all ${all}`, function () {
      fixture.git(['switch', 'child']);
      fixture.stage('É.txt', 'descendant work');
      fixture.git(['commit', '-m', 'descendant Unicode path']);
      fixture.ok(['restack', '--upstack']);
      fixture.git(['switch', 'other']);
      fixture.git(['config', 'core.ignorecase', 'true']);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\n*.txt\n'
      );
      const bytes = Buffer.from([0, 255, 13, 10, 71]);
      fs.writeFileSync(path.join(fixture.repo, 'é.txt'), bytes);
      if (!fs.existsSync(path.join(fixture.repo, 'É.txt'))) this.skip();
      if (all) fixture.write('inserted.md', 'selected work');
      else fixture.stage('inserted.md', 'selected work');
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
      expect(result.status).not.to.equal(0);
      expect(fs.readFileSync(path.join(fixture.repo, 'é.txt'))).to.deep.equal(
        bytes
      );
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.ok(['log', 'short'])).to.equal(topology);
      expect(result.stdout + result.stderr)
        .to.include('ignored')
        .and.include('é.txt');
    });
  }
});
