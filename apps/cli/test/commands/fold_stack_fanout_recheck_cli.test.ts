import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { unicodeObstructionPath } from '../lib/utils/unicode_path';

for (const keep of [false, true]) {
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold phase path rechecks through the public CLI (keep=${keep})`, function () {
    this.timeout(60000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());
    function setup(conflict: boolean): void {
      fixture.branch('a-root', 'base');
      if (conflict) {
        fixture.stage('child.txt', 'conflicting root work');
        fixture.git(['commit', '-m', 'own conflict']);
      }
      fixture.branch('z-root', 'base');
      fixture.stage('transient.bin', 'temporary own work');
      fixture.git(['commit', '-m', 'own transient add']);
      fixture.git(['rm', 'transient.bin']);
      fixture.git(['commit', '-m', 'own transient delete']);
      fixture.branch('deep', 'z-root');
      fixture.git(['switch', 'child']);
      fs.appendFileSync(
        path.join(fixture.repo, '.git/info/exclude'),
        '\ntransient.bin\n'
      );
    }
    it('preserves late ignored bytes before the next replay and reports confirmed progress', () => {
      setup(false);
      const hook = path.join(fixture.repo, '.git/hooks/pre-rebase');
      fs.writeFileSync(
        hook,
        '#!/bin/sh\nif [ "$2" = a-root ]; then printf private-late-bytes > transient.bin; fi\n',
        { mode: 0o755 }
      );
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        'Completed branches: a-root'
      );
      expect(result.stdout + result.stderr).to.include(
        'Remaining branches: z-root, deep'
      );
      expect(result.stdout + result.stderr).to.include(
        'Current checkout: ' + (keep ? 'tip' : 'base')
      );
      expect(result.stdout + result.stderr).to.include(
        'ignored file transient.bin'
      );
      expect(
        fs.readFileSync(path.join(fixture.repo, 'transient.bin'), 'utf8')
      ).to.equal('private-late-bytes');
      expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
      expect(
        fixture.git([
          'log',
          '--reverse',
          '--format=%s',
          `${keep ? 'tip' : 'base'}..a-root`,
        ])
      ).to.equal('a-root');
      const completed = fixture.git(['rev-parse', 'a-root']);
      const saved = path.join(fixture.root, 'saved-private');
      fs.renameSync(path.join(fixture.repo, 'transient.bin'), saved);
      fs.unlinkSync(hook);
      fixture.ok(['restack', '--branch', 'z-root', '--only']);
      fixture.ok(['restack', '--branch', 'deep', '--only']);
      fixture.ok(['checkout', keep ? 'tip' : 'base']);
      expect(fixture.git(['rev-parse', 'a-root'])).to.equal(completed);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fs.readFileSync(saved, 'utf8')).to.equal('private-late-bytes');
    });
    it('rechecks queued replay paths in a fresh continue before changing the active conflict', () => {
      setup(true);
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      expect(result.status).not.to.equal(0);
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      fixture.stage('child.txt', 'resolved root work');
      const bytes = Buffer.from([0, 255, 128, 11]);
      fs.writeFileSync(path.join(fixture.repo, 'transient.bin'), bytes);
      const before = fixture.snapshot();
      const index = fs.readFileSync(path.join(fixture.repo, '.git/index'));
      const blocked = fixture.run(['continue']);
      expect(blocked.status).not.to.equal(0);
      expect(blocked.stdout + blocked.stderr).to.include(
        'ignored file transient.bin'
      );
      expect(blocked.stdout + blocked.stderr).to.include(
        'Current checkout: detached HEAD'
      );
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, '.git/index'))
      ).to.deep.equal(index);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'transient.bin'))
      ).to.deep.equal(bytes);
      const saved = path.join(fixture.root, 'saved-private');
      fs.renameSync(path.join(fixture.repo, 'transient.bin'), saved);
      fixture.ok(['continue']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        keep ? 'tip' : 'base'
      );
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'z-root..deep'])
      ).to.equal('deep');
      expect(fs.readFileSync(saved)).to.deep.equal(bytes);
    });
    it('distinguishes completed replay from blocked return and preserves late Unicode obstruction bytes', () => {
      const unicodePath = unicodeObstructionPath(fixture.root);
      fixture.git(['switch', 'base']);
      fixture.stage('café.txt', 'selected Unicode content');
      fixture.git(['commit', '-m', 'selected Unicode path']);
      fixture.ok(['restack', '--branch', 'child', '--upstack']);
      fixture.branch('a-root', 'base');
      fixture.git(['rm', 'café.txt']);
      fixture.git(['commit', '-m', 'own Unicode removal']);
      fixture.branch('z-root', 'base');
      fixture.git(['switch', 'child']);
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
      const hook = path.join(fixture.repo, '.git/hooks/post-rewrite');
      fs.writeFileSync(
        hook,
        `#!/bin/sh\nprintf private-Unicode-bytes > '${unicodePath}'\n`,
        { mode: 0o755 }
      );
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        'Completed branches: a-root'
      );
      expect(result.stdout + result.stderr).to.include(
        'Remaining branches: z-root'
      );
      expect(result.stdout + result.stderr).to.include(
        'Current checkout: a-root'
      );
      expect(result.stdout + result.stderr).to.include('return');
      expect(fixture.git(['branch', '--show-current'])).to.equal('a-root');
      expect(
        fs.readFileSync(path.join(fixture.repo, unicodePath), 'utf8')
      ).to.equal('private-Unicode-bytes');
      expect(
        fixture.git([
          'log',
          '--reverse',
          '--format=%s',
          `${keep ? 'tip' : 'base'}..a-root`,
        ])
      ).to.equal('a-root\nown Unicode removal');
      const completed = fixture.git(['rev-parse', 'a-root']);
      const saved = path.join(fixture.root, 'saved-private');
      fs.renameSync(path.join(fixture.repo, unicodePath), saved);
      fs.unlinkSync(hook);
      fixture.ok(['restack', '--branch', 'z-root', '--only']);
      fixture.ok(['checkout', keep ? 'tip' : 'base']);
      expect(fixture.git(['rev-parse', 'a-root'])).to.equal(completed);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fs.readFileSync(saved, 'utf8')).to.equal('private-Unicode-bytes');
    });
  });
}
