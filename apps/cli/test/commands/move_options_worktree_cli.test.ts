import { expect } from 'chai';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move option worktree preservation through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const scenario of [
    { occupied: 'base', source: 'base', parent: 'main', only: false },
    { occupied: 'child', source: 'base', parent: 'main', only: false },
    { occupied: 'tip', source: 'base', parent: 'main', only: false },
    { occupied: 'tip', source: 'tip', parent: 'child', only: true },
  ]) {
    it(`keeps both indexes and public parents when source ${scenario.source}, only ${scenario.only} involves occupied ${scenario.occupied}`, () => {
      fixture.git(['switch', 'other']);
      fixture.git(['worktree', 'add', fixture.linked, scenario.occupied]);
      fixture.stage('main.txt', 'linked staged work', fixture.linked);
      fixture.write('main.txt', 'linked unstaged work', fixture.linked);
      fixture.write('private.txt', 'linked untracked work', fixture.linked);
      const before = fixture.snapshot();
      const linkedBefore = fixture.snapshot(fixture.linked);
      const result = fixture.run([
        'move',
        '-o',
        'other',
        '-s',
        scenario.source,
        ...(scenario.only ? ['--only'] : []),
      ]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
      const cwd =
        scenario.source === scenario.occupied ? fixture.linked : fixture.repo;
      fixture.ok(['checkout', scenario.source], cwd);
      fixture.ok(['down'], cwd);
      expect(fixture.git(['branch', '--show-current'], cwd)).to.equal(
        scenario.parent
      );
    });
  }
});
