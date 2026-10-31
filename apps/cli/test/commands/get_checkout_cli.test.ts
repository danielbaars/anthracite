import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

describe('get CLI final checkout policy', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('restores another starting branch after incoming updates with no-checkout', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const original = fixture.commit(
      fixture.consumer,
      'inspection.txt',
      'inspection bytes'
    );
    const child = fixture.advanceChild();
    fixture.ok('get', 'child', '--no-checkout');
    fixture.assertTip('child', child);
    fixture.assertTip('HEAD', original);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'inspection'
    );
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'inspection.txt'), 'utf8')
    ).to.equal('inspection bytes');
    expect(fs.existsSync(path.join(fixture.consumer, 'child.txt'))).to.equal(
      false
    );
    expect(
      fixture.git(fixture.consumer, 'diff', '--cached', '--name-only')
    ).to.equal('');
    expect(fixture.git(fixture.consumer, 'diff', '--name-only')).to.equal('');
  });
  it('reports the actual reached checkout when the original branch disappears', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const child = fixture.advanceChild();
    const hook = path.join(fixture.consumer, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif [ "$(git branch --show-current)" = child ]; then git update-ref -d refs/heads/inspection; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child', '--no-checkout']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Final checkout of inspection failed');
    expect(result.output).to.include('Actual checkout: child');
    expect(result.output).to.include('Updated child');
    fixture.assertTip('child', child);
    fixture.assertTip('HEAD', child);
    expect(
      fixture.git(fixture.consumer, 'branch', '--list', 'inspection')
    ).to.equal('');
  });

  for (const command of ['get', 'g']) {
    it(`${command} defaults to the target and accepts checkout=true`, () => {
      fixture.git(fixture.consumer, 'switch', 'main');
      const child = fixture.advanceChild();
      fixture.ok(command, 'child');
      fixture.assertTip('HEAD', child);
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('child');
      fixture.git(fixture.consumer, 'switch', 'main');
      fixture.ok(command, 'parent', '--checkout=true');
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('parent');
    });

    it(`${command} restores the exact detached OID with checkout=false`, () => {
      fixture.git(fixture.consumer, 'switch', '--detach', fixture.oldParent);
      const original = fixture.commit(
        fixture.consumer,
        'inspection.txt',
        'detached inspection'
      );
      const child = fixture.advanceChild();
      fixture.ok(command, '2', '--checkout=false');
      fixture.assertTip('child', child);
      fixture.assertTip('HEAD', original);
      expect(
        fixture.git(fixture.consumer, 'branch', '--show-current')
      ).to.equal('');
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'inspection.txt'), 'utf8')
      ).to.equal('detached inspection');
      expect(
        fixture.git(fixture.consumer, 'diff', '--cached', '--name-only')
      ).to.equal('');
      expect(fixture.git(fixture.consumer, 'diff', '--name-only')).to.equal('');
    });

    it(`${command} help explains the default and negative checkout flag`, () => {
      const help = fixture.ok(command, '--help').output;
      expect(help).to.include('--checkout');
      expect(help).to.include('--no-checkout');
      expect(help).to.match(/checkout[\s\S]*default: true/);
    });
  }

  it('restores the branch identity at its updated head rather than resetting its old OID', () => {
    const child = fixture.advanceChild();
    fixture.ok('get', 'parent', '--no-checkout');
    fixture.assertTip('HEAD', child);
    fixture.assertTip('child', child);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'child'
    );
    expect(
      fs.readFileSync(path.join(fixture.consumer, 'child.txt'), 'utf8')
    ).to.equal('child-new');
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
  });

  it('uses the effective explicit cwd and restores physical checkout from a subdirectory', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    const child = fixture.advanceChild();
    const subdirectory = path.join(fixture.consumer, 'nested');
    fs.ensureDirSync(subdirectory);
    fixture.cwd = fixture.root;
    fixture.ok('get', 'child', '--no-checkout', '--cwd', subdirectory);
    fixture.assertTip('child', child);
    fixture.assertTip('HEAD', original);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      'inspection'
    );
  });

  it('does not report success when a post-checkout hook changes the final physical identity', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    const child = fixture.advanceChild();
    const hook = path.join(fixture.consumer, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif [ "$(git branch --show-current)" = inspection ]; then git switch --detach HEAD; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child', '--no-checkout', '--quiet']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Final checkout of inspection failed');
    expect(result.output).to.include('Actual checkout: detached HEAD');
    expect(result.output).to.include('Updated child');
    fixture.assertTip('child', child);
    fixture.assertTip('HEAD', original);
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
  });

  for (const ignored of [false, true]) {
    it(`preserves a late ${
      ignored ? 'ignored' : 'untracked'
    } collision during final restoration`, () => {
      fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
      fixture.commit(
        fixture.consumer,
        'inspection.txt',
        'original tracked bytes'
      );
      const child = fixture.advanceChild();
      if (ignored)
        fs.appendFileSync(
          path.join(fixture.consumer, '.git', 'info', 'exclude'),
          '\ninspection.txt\n'
        );
      const hook = path.join(
        fixture.consumer,
        '.git',
        'hooks',
        'post-checkout'
      );
      fs.writeFileSync(
        hook,
        '#!/bin/sh\nif [ "$(git branch --show-current)" = child ]; then printf "protected local bytes" > inspection.txt; fi\n',
        { mode: 0o755 }
      );
      const result = fixture.run(['get', 'child', '--no-checkout']);
      expect(result.status, result.output).to.equal(1);
      expect(result.output).to.include('Final checkout of inspection failed');
      expect(result.output).to.include('Actual checkout: child');
      fixture.assertTip('HEAD', child);
      expect(
        fs.readFileSync(path.join(fixture.consumer, 'inspection.txt'), 'utf8')
      ).to.equal('protected local bytes');
      expect(
        fixture.git(fixture.consumer, 'diff', '--cached', '--name-only')
      ).to.equal('');
      expect(fixture.git(fixture.consumer, 'diff', '--name-only')).to.equal('');
    });
  }

  it('refuses a late occupied original branch and leaves the reached update intact', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    const child = fixture.advanceChild();
    const other = path.join(fixture.root, 'other');
    const hook = path.join(fixture.consumer, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nif [ "$(git branch --show-current)" = child ] && [ ! -d "${other}" ]; then git worktree add "${other}" inspection; fi\n`,
      { mode: 0o755 }
    );
    const result = fixture.run(['get', 'child', '--no-checkout']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Final checkout of inspection failed');
    expect(result.output).to.include('Actual checkout: child');
    expect(result.output).to.include(other);
    fixture.assertTip('HEAD', child);
    expect(fixture.git(other, 'rev-parse', 'HEAD')).to.equal(original);
    expect(fixture.git(other, 'status', '--porcelain')).to.equal('');
  });

  it('leaves a real reconciliation conflict in its reached recovery checkout', () => {
    fixture.ok('unfreeze', 'parent');
    fixture.git(fixture.consumer, 'switch', 'parent');
    fixture.commit(fixture.consumer, 'parent.txt', 'local conflicting parent');
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'remote conflicting parent');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.run(
      ['get', 'parent', '--downstack', '--no-checkout'],
      true,
      [{ prompt: 'How would you like to handle', input: '\r' }]
    );
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Hit conflict');
    expect(result.output).not.to.include('Final checkout');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    expect(
      fixture.git(fixture.consumer, 'diff', '--name-only', '--diff-filter=U')
    ).to.equal('parent.txt');
    expect(
      fixture.git(fixture.consumer, 'ls-files', '--unmerged')
    ).not.to.equal('');
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', 'rebase-merge'))
    ).to.equal(true);
    expect(
      fs.existsSync(path.join(fixture.consumer, '.git', '.gtcontinue'))
    ).to.equal(true);
  });
  it('refuses a known occupied original branch before applying incoming updates', () => {
    fixture.git(fixture.consumer, 'switch', '-c', 'inspection', 'main');
    const original = fixture.git(fixture.consumer, 'rev-parse', 'HEAD');
    const other = path.join(fixture.root, 'other');
    fixture.git(
      fixture.consumer,
      'worktree',
      'add',
      '--force',
      other,
      'inspection'
    );
    fixture.advanceChild();
    const result = fixture.run(['get', 'child', '--no-checkout']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(other);
    fixture.assertTip('child', fixture.oldChild);
    fixture.assertTip('HEAD', original);
    expect(fixture.git(fixture.consumer, 'status', '--porcelain')).to.equal('');
    expect(fixture.git(other, 'status', '--porcelain')).to.equal('');
  });
});
