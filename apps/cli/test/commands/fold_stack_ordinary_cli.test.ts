import { expect } from 'chai';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('ordinary fold compatibility through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  for (const keep of [false, true]) {
    for (const explicitFalse of [false, true]) {
      it(`${
        explicitFalse ? 'explicit stack=false' : 'ordinary baseline'
      } preserves one-level fold with keep ${keep}`, () => {
        fixture.git(['switch', 'child']);
        const original = fixture.git(['rev-parse', 'child']);
        const tip = fixture.git(['rev-parse', 'tip']);
        fixture.ok([
          'fold',
          ...(explicitFalse ? ['--stack=false'] : []),
          ...(keep ? ['--keep'] : []),
        ]);
        const survivor = keep ? 'child' : 'base';
        expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
        expect(fixture.git(['rev-parse', survivor])).to.equal(original);
        expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
        expect(
          fixture.git(['branch', '--list', keep ? 'base' : 'child'])
        ).to.equal('');
        expect(fixture.ok(['info'])).to.include('Parent: main');
        fixture.ok(['checkout', 'tip']);
        expect(fixture.ok(['info'])).to.include(`Parent: ${survivor}`);
      });
    }
  }
});
