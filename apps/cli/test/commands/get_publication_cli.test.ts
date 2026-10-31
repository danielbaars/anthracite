import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('get CLI completed publication guards', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const force of [true, false])
    it(`preserves committed-hook topology and reached head after ${
      force ? 'force import' : 'fast-forward parent adoption'
    }`, () => {
      const metadata = fixture.git(
        fixture.consumer,
        'rev-parse',
        'refs/branch-metadata/child'
      );
      fs.writeJsonSync(fixture.prs, { parent: 'main', child: 'main' });
      fixture.git(fixture.producer, 'switch', 'child');
      const incoming = fixture.commit(
        fixture.producer,
        'new.txt',
        'incoming bytes'
      );
      fixture.git(fixture.producer, 'push', 'origin', 'child');
      restoreMetadataAfterPublication(fixture, 'child', metadata);
      const result = fixture.run([
        'get',
        'child',
        ...(force ? ['--force'] : []),
        '--downstack',
        '--no-restack',
        '--quiet',
      ]);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('publication');
      expect(result.output).to.include('Pending feature refresh: child');
      expect(result.output).to.include('manual');
      fixture.assertTip('child', incoming);
      fixture.assertTip('refs/branch-metadata/child', metadata);
      expect(fixture.ok('info', 'child').output).to.include('Parent: parent');
      expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal(
        ''
      );
      expect(
        fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
      ).to.equal(true);
    });
  it('retains an automatic replay with overwritten publication as pending manual work', () => {
    fixture.ok('unfreeze', 'child');
    const metadata = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/child'
    );
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent-new.txt',
      'incoming parent'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    restoreMetadataAfterPublication(fixture, 'child', metadata);
    const result = fixture.run(['get', 'parent', '--downstack', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('publication');
    expect(result.output).to.include('Pending local maintenance: child');
    expect(result.output).to.include('manual');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'child')
    ).to.equal(parent);
    fixture.assertTip('refs/branch-metadata/child', metadata);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
    const before = fixture.observe();
    expect(fixture.run(['continue', '--all']).status).to.equal(1);
    expect(fixture.observe()).to.deep.equal(before);
  });

  it('keeps a completed continued replay pending when a committed metadata hook restores its old base', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'parent.txt', 'local conflicting bytes');
    const metadata = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/local-work'
    );
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    const parent = fixture.commit(
      fixture.producer,
      'parent.txt',
      'remote conflicting bytes'
    );
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const initial = fixture.run(['get', 'parent', '--no-checkout']);
    expect(initial.status, initial.output).to.equal(1);
    expect(initial.output).to.include('Hit conflict');
    restoreMetadataAfterPublication(fixture, 'local-work', metadata);
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved both'
    );
    const result = fixture.run(['continue', '--all', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('publication');
    expect(result.output).to.include('Pending local maintenance: local-work');
    expect(result.output).to.include('manual');
    expect(
      fixture.git(fixture.consumer, 'merge-base', 'parent', 'local-work')
    ).to.equal(parent);
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved both');
    fixture.assertTip('refs/branch-metadata/local-work', metadata);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(false);
  });

  it('gives manual guidance when a hook changes the saved envelope while the old active token remains', () => {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'parent.txt', 'local conflicting bytes');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'remote conflicting bytes');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    expect(fixture.run(['get', 'parent']).status).to.equal(1);
    const file = path.join(fixture.consumer, '.git', '.gtcontinue');
    const mutate = `const fs = require('fs'); const data = JSON.parse(fs.readFileSync(${JSON.stringify(
      file
    )}, 'utf8')); data.branchesToSync = ['foreign-work']; fs.writeFileSync(${JSON.stringify(
      file
    )}, JSON.stringify(data));`;
    fs.writeFileSync(
      path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
      `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = prepared ] && printf '%s' "$updates" | grep -q ' HEAD$' && [ ! -f .git/envelope-once ]; then\n touch .git/envelope-once\n ${quote(
        process.execPath
      )} -e ${quote(mutate)}\nfi\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved both'
    );
    fixture.git(fixture.consumer, 'add', 'parent.txt');
    const stages = fixture.git(fixture.consumer, 'ls-files', '--stage');
    const result = fixture.run(['continue', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('manually');
    expect(result.output).not.to.include(
      'Resolve the conflict and run an continue'
    );
    expect(fs.readFileSync(file, 'utf8')).to.include('foreign-work');
    expect(fixture.git(fixture.consumer, 'ls-files', '--stage')).to.equal(
      stages
    );
  });
});

function restoreMetadataAfterPublication(
  fixture: FrozenGetFixture,
  branch: string,
  metadata: string
): void {
  fs.writeFileSync(
    path.join(fixture.consumer, '.git', 'hooks', 'reference-transaction'),
    `#!/bin/sh\nupdates=$(cat)\nif [ "$1" = committed ] && printf '%s' "$updates" | grep -q 'refs/branch-metadata/${branch}$' && [ ! -f .git/publication-once ]; then\n touch .git/publication-once\n git -c core.hooksPath=/dev/null update-ref refs/branch-metadata/${branch} ${metadata}\nfi\n`,
    { mode: 0o755 }
  );
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
