import { expect } from 'chai';
import { FreezeCliFixture } from '../lib/fixtures/freeze_cli';

describe('ordinary fold failure progress', function () {
  this.timeout(60000);
  let fixture: FreezeCliFixture;
  beforeEach(() => {
    fixture = new FreezeCliFixture();
  });
  afterEach(() => fixture.cleanup());
  for (const keep of [false, true]) {
    it(`refuses a trunk parent without claiming writes (keep ${keep})`, () => {
      const before = fixture.observe();
      const result = fixture.run(['fold', ...(keep ? ['--keep'] : [])]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include("Cannot fold 'base' into trunk 'main'");
      expect(result.stdout + result.stderr).not.to.include(
        'completed ref and parent writes remain'
      );
      expect(fixture.observe()).to.deep.equal(before);
    });
  }
  it('does not claim writes when an occupied parent prevents checkout', () => {
    fixture.git(['switch', 'child']);
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    const before = fixture.observe();
    const result = fixture.run(['fold']);
    expect(result.status).to.equal(1);
    expect(result.stdout + result.stderr).to.include('worktree');
    expect(result.stdout + result.stderr).not.to.include(
      'completed ref and parent writes remain'
    );
    expect(fixture.observe()).to.deep.equal(before);
  });
});
