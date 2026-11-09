import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Failures occur at actual Git/filesystem boundaries; no engine hooks are replaced.
// eslint-disable-next-line max-lines-per-function
describe('retrying preserving sync abandonment', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 30000;
  });
  afterEach(() => fixture?.cleanup());

  it('retries after a real quit with matching retained evidence without quitting twice', () => {
    startConflict(fixture);
    const record = fs.readFileSync(recovery(fixture));
    const archive = archivePath(fixture, record);
    const calls = path.join(fixture.root, 'quit-calls');
    fs.writeFileSync(
      path.join(fixture.bin, 'git'),
      `#!/bin/sh\nis_rebase=false\nis_quit=false\nfor arg do\n [ "$arg" = rebase ] && is_rebase=true\n [ "$arg" = --quit ] && is_quit=true\ndone\nif $is_rebase && $is_quit; then\n /usr/bin/git "$@" || exit $?\n printf 'quit\\n' >> ${quote(
        calls
      )}\n cp ${quote(recovery(fixture))} ${quote(
        path.join(archive, 'released.gtcontinue')
      )}\n exit 27\nfi\nexec /usr/bin/git "$@"\n`,
      { mode: 0o755 }
    );
    const first = fixture.run(['sync', '--abort']);
    expect(first.status, first.output).to.equal(1);
    expect(first.output).to.include('abandonment incomplete');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git/rebase-merge'))
    ).to.equal(false);
    const before = fixture.observe();
    const retry = fixture.run(['repo', 'sync', '--abort']);
    expect(retry.status, retry.output).to.equal(0);
    expect(retry.output).to.include('Sync abandoned');
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
    });
    expect(fs.readFileSync(path.join(archive, 'recovery.json'))).to.deep.equal(
      record
    );
    expect(
      fs.readFileSync(path.join(archive, 'released.gtcontinue'))
    ).to.deep.equal(record);
    expect(fs.readFileSync(calls, 'utf8')).to.equal('quit\n');
    const again = fixture.run(['sync', '--abort']);
    expect(again.status, again.output).to.equal(0);
    expect(again.output).to.include('No pending sync');
    expect(fs.readFileSync(calls, 'utf8')).to.equal('quit\n');
  });
  it('refuses malformed UTF-8 without normalizing the original recovery evidence', () => {
    fixture.ok('sync', '--no-pull', '--no-delete', '--no-restack');
    const old = fixture.git(
      fixture.consumer,
      'rev-parse',
      'refs/branch-metadata/parent'
    );
    fs.writeJsonSync(fixture.details, { parent: 'new planned title' });
    fs.writeFileSync(
      path.join(fixture.consumer, '.git/hooks/reference-transaction'),
      `#!/bin/sh\nif [ "$1" = committed ]; then\n while read old new ref; do\n if [ "$ref" = refs/branch-metadata/parent ]; then git -c core.hooksPath=/dev/null update-ref "$ref" ${old}; fi\n done\nfi\n`,
      { mode: 0o755 }
    );
    const start = fixture.run([
      'sync',
      '--no-pull',
      '--no-delete',
      '--no-restack',
    ]);
    expect(start.status, start.output).to.equal(1);
    expect(start.output).to.include('PR publication changed');
    const record = fs.readFileSync(recovery(fixture));
    const offset = record.indexOf(Buffer.from('new planned title'));
    expect(offset).to.be.greaterThan(-1);
    record[offset] = 255;
    fs.writeFileSync(recovery(fixture), record);
    const before = fixture.observe();
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('UTF-8');
    expect(fixture.observe()).to.deep.equal(before);
    expect(fs.existsSync(archivePath(fixture, record))).to.equal(false);
  });

  it('retries a real archive write refusal and preserves interrupted private staging', () => {
    startConflict(fixture);
    fixture.git(fixture.consumer, 'rebase', '--abort');
    const record = fs.readFileSync(recovery(fixture));
    const archive = archivePath(fixture, record);
    fs.ensureDirSync(archive, { mode: 0o700 });
    fs.chmodSync(path.dirname(archive), 0o700);
    fs.chmodSync(archive, 0o500);
    const before = fixture.observe();
    try {
      const failed = fixture.run(['sync', '--abort']);
      expect(failed.status, failed.output).to.equal(1);
      expect(failed.output).to.include('Saved sync gate: still present');
      expect(fixture.observe()).to.deep.equal(before);
    } finally {
      fs.chmodSync(archive, 0o700);
    }
    const partial = path.join(archive, '.pending-interrupted-publication');
    fs.writeFileSync(partial, '{partial evidence', { mode: 0o600 });
    const result = fixture.run(['sync', '--abort']);
    expect(result.status, result.output).to.equal(0);
    expect(fs.readFileSync(partial, 'utf8')).to.equal('{partial evidence');
    expect(fs.readFileSync(path.join(archive, 'recovery.json'))).to.deep.equal(
      record
    );
    expect(fixture.observe()).to.deep.equal({
      ...Object(before),
      recovery: null,
    });
  });

  it('refuses conflicting immutable receipts and observations without replacing evidence', () => {
    startConflict(fixture);
    const directory = path.join(fixture.consumer, '.git/rebase-merge');
    const record = fs.readFileSync(recovery(fixture));
    const archive = archivePath(fixture, record);
    fs.chmodSync(directory, 0o500);
    try {
      expect(fixture.run(['sync', '--abort']).status).to.equal(1);
    } finally {
      fs.chmodSync(directory, 0o700);
    }
    fixture.git(fixture.consumer, 'rebase', '--abort');
    const receipt = path.join(archive, 'released.gtcontinue');
    fs.writeFileSync(receipt, 'foreign retained bytes', { mode: 0o600 });
    const before = fixture.observe();
    const refused = fixture.run(['sync', '--abort']);
    expect(refused.status, refused.output).to.equal(1);
    expect(refused.output).to.include('Conflicting archive');
    expect(fs.readFileSync(receipt, 'utf8')).to.equal('foreign retained bytes');
    expect(fixture.observe()).to.deep.equal(before);
    fs.removeSync(receipt);
    const observations = path.join(archive, 'observations.json');
    const valid = fs.readFileSync(observations);
    fs.writeFileSync(observations, '{"version":1}');
    const invalid = fixture.run(['sync', '--abort']);
    expect(invalid.status, invalid.output).to.equal(1);
    expect(invalid.output).to.include('Conflicting source observations');
    expect(fs.readFileSync(observations, 'utf8')).to.equal('{"version":1}');
    expect(fixture.observe()).to.deep.equal(before);
    fs.writeFileSync(observations, valid);
    expect(fixture.run(['sync', '--abort']).status).to.equal(0);
  });

  it('preserves a foreign recovery replacement after real quit and never reports it released', () => {
    startConflict(fixture);
    const foreign = '{"branchesToSync":["foreign"],"branchesToRestack":[]}';
    fs.writeFileSync(
      path.join(fixture.bin, 'git'),
      `#!/bin/sh\nis_rebase=false\nis_quit=false\nfor arg do\n [ "$arg" = rebase ] && is_rebase=true\n [ "$arg" = --quit ] && is_quit=true\ndone\nif $is_rebase && $is_quit; then\n /usr/bin/git "$@" || exit $?\n printf '%s' ${quote(
        foreign
      )} > ${quote(recovery(fixture))}\n exit 0\nfi\nexec /usr/bin/git "$@"\n`,
      { mode: 0o755 }
    );
    const first = fixture.run(['sync', '--abort']);
    expect(first.status, first.output).to.equal(1);
    expect(first.output)
      .to.include('quit: completed')
      .and.include('competing recovery');
    expect(fs.readFileSync(recovery(fixture), 'utf8')).to.equal(foreign);
    const before = fixture.observe();
    const again = fixture.run(['sync', '--abort']);
    expect(again.status, again.output).to.equal(0);
    expect(again.output).to.include('No pending sync');
    expect(fixture.observe()).to.deep.equal(before);
  });
});

function recovery(fixture: FrozenGetFixture): string {
  return path.join(fixture.consumer, '.git', '.gtcontinue');
}
function archivePath(fixture: FrozenGetFixture, record: Buffer): string {
  return path.join(
    fixture.consumer,
    '.git/anthracite-sync-abandonment',
    createHash('sha256').update(record).digest('hex')
  );
}
function startConflict(fixture: FrozenGetFixture): void {
  fixture.ok('unfreeze', 'child');
  fixture.ok('create', 'local-work');
  fixture.commit(fixture.consumer, 'parent.txt', 'local conflict');
  fixture.git(fixture.consumer, 'switch', 'main');
  fixture.git(fixture.producer, 'switch', 'parent');
  fixture.commit(fixture.producer, 'parent.txt', 'incoming conflict');
  fixture.git(fixture.producer, 'push', 'origin', 'parent');
  const start = fixture.run(['sync', '--no-delete']);
  expect(start.status, start.output).to.equal(1);
  expect(start.output).to.include('Hit conflict');
}
function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
