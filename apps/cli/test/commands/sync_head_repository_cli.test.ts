import { expect } from 'chai';
import fs from 'fs-extra';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('sync head repository identity', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const nameWithOwner of ['', undefined, 'get-fixture/repo']) {
    it(`refreshes with owner/name when nameWithOwner is ${String(
      nameWithOwner
    )}`, () => {
      const { parent, child } = fixture.advanceBoth();
      fs.writeJsonSync(fixture.identities, {
        prOverrides: Object.fromEntries(
          ['parent', 'child'].map((branch) => [
            branch,
            {
              headRepository: {
                id: 'R_SYNTHETIC',
                name: 'repo',
                nameWithOwner,
              },
              headRepositoryOwner: { login: 'get-fixture' },
            },
          ])
        ),
      });
      fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
      fixture.assertTip('parent', parent);
      fixture.assertTip('child', child);
    });
  }

  for (const [label, override] of Object.entries({
    'foreign owner': { headRepositoryOwner: { login: 'other' } },
    'foreign name': { headRepository: { name: 'other', nameWithOwner: '' } },
    'missing owner': { headRepositoryOwner: null },
    'missing repository': { headRepository: null },
    'missing repository name': {
      headRepository: { nameWithOwner: 'get-fixture/repo' },
    },
    'contradictory full name': {
      headRepository: { name: 'repo', nameWithOwner: 'other/repo' },
    },
    'wrong head': { headRefName: 'other' },
    'wrong URL': { url: 'https://github.com/other/repo/pull/2' },
  })) {
    it(`preserves local work when ${label}`, () => {
      fixture.advanceBoth();
      fs.writeJsonSync(fixture.identities, {
        prOverrides: {
          child: {
            headRepository: { name: 'repo', nameWithOwner: '' },
            headRepositoryOwner: { login: 'get-fixture' },
            ...override,
          },
        },
      });
      const before = fixture.observe();
      const result = fixture.run([
        'sync',
        '--no-pull',
        '--no-delete',
        '--no-restack',
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Invalid pull request identity');
      expect(fixture.observe()).to.deep.equal(before);
    });
  }
});
