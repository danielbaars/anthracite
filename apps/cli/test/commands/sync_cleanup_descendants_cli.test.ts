import { expect } from 'chai';
import { FrozenSyncCliFixture } from '../lib/fixtures/frozen_sync_cli';

describe('sync cleanup of descendants through the public CLI', function () {
  this.timeout(120000);
  let fixture: FrozenSyncCliFixture;

  beforeEach(() => {
    fixture = new FrozenSyncCliFixture();
  });

  afterEach(function () {
    fixture.saveEvidence(this.currentTest?.fullTitle());
    fixture.cleanup();
  });

  it('deletes a known closed leaf below an open parent without changing that parent', () => {
    fixture.branch('open-parent', 'main');
    fixture.branch('closed-leaf', 'open-parent');
    fixture.succeed('submit', '--draft');
    fixture.succeed('sync', '--no-pull', '--no-delete');
    fixture.succeed('checkout', 'main');
    const parent = fixture.git('rev-parse', 'open-parent');
    const parentMetadata = fixture.git(
      'rev-parse',
      'refs/branch-metadata/open-parent'
    );
    const remote = fixture.observe().remote;
    fixture.setPrs(
      fixture
        .prs()
        .map((pr) =>
          pr.headRefName === 'closed-leaf' ? { ...pr, state: 'CLOSED' } : pr
        )
    );

    for (const flags of [[], ['--force', '--no-delete']]) {
      fixture.succeed('sync', '--no-pull', '--no-restack', ...flags);
      expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
        'closed-leaf\nmain\nopen-parent'
      );
    }

    fixture.succeed('sync', '--no-pull', '--force', '--no-restack');

    expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
      'main\nopen-parent'
    );
    expect(fixture.git('rev-parse', 'open-parent')).to.equal(parent);
    expect(
      fixture.git('rev-parse', 'refs/branch-metadata/open-parent')
    ).to.equal(parentMetadata);
    expect(fixture.git('branch', '--show-current')).to.equal('main');
    expect(fixture.observe().remote).to.equal(remote);
    expect(
      fixture.prs().find((pr) => pr.headRefName === 'open-parent')?.state
    ).to.equal('OPEN');
  });

  for (const frozenChild of [false, true]) {
    it(`cleans separated closed branches once with frozen child ${frozenChild}`, () => {
      fixture.branch('closed-base', 'main');
      fixture.branch('open-middle', 'closed-base');
      fixture.branch('closed-child', 'open-middle');
      fixture.branch('open-tip', 'closed-child');
      fixture.succeed('submit', '--draft');
      if (frozenChild) {
        fixture.succeed('track', 'closed-child', '--parent', 'main');
        fixture.succeed('freeze', 'closed-child');
        fixture.succeed('track', 'closed-child', '--parent', 'open-middle');
      }
      fixture.succeed('checkout', 'main');
      fixture.setPrs(
        fixture
          .prs()
          .map((pr) =>
            ['closed-base', 'closed-child'].includes(pr.headRefName)
              ? { ...pr, state: 'CLOSED' }
              : pr
          )
      );
      const survivors = ['main', 'open-middle', 'open-tip'];
      const heads = survivors.map((branch) => fixture.git('rev-parse', branch));

      fixture.succeed('sync', '--no-pull', '--force', '--no-restack');

      expect(fixture.git('branch', '--format=%(refname:short)')).to.equal(
        'main\nopen-middle\nopen-tip'
      );
      expect(
        survivors.map((branch) => fixture.git('rev-parse', branch))
      ).to.deep.equal(heads);
      expect(fixture.succeed('info', 'open-middle')).to.include('Parent: main');
      expect(fixture.succeed('info', 'open-tip')).to.include(
        'Parent: open-middle'
      );
      expect(fixture.observe().rebase).to.equal(false);
    });
  }
});
