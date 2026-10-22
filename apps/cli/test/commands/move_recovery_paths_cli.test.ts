import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// eslint-disable-next-line max-lines-per-function
describe('move hidden-return path preservation through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const variant of [
    { kind: 'literal', ignoreCase: true },
    { kind: 'unicode-file', ignoreCase: true },
    { kind: 'unicode-file', ignoreCase: false },
    { kind: 'unicode-directory', ignoreCase: true },
    { kind: 'unicode-directory', ignoreCase: false },
    { kind: 'symlink', ignoreCase: true },
  ]) {
    it(`preserves late ignored ${variant.kind} work with ignorecase ${variant.ignoreCase}`, function () {
      fixture.git(['switch', '-c', 'departure', 'main']);
      const directory = variant.kind === 'unicode-directory' ? 'É-dir' : 'dir';
      const destination =
        variant.kind === 'literal'
          ? 'literal[ab]*?.txt'
          : variant.kind === 'unicode-file'
          ? 'É.txt'
          : `${directory}/inside.txt`;
      const local =
        variant.kind === 'unicode-file'
          ? 'é.txt'
          : variant.kind === 'unicode-directory'
          ? 'é-dir/inside.txt'
          : destination;
      if (destination.includes('/'))
        fs.mkdirSync(path.join(fixture.repo, directory));
      fixture.stage(destination, 'departure tracked work');
      fixture.git(['commit', '-m', 'departure work']);
      if (
        variant.kind.startsWith('unicode') &&
        !fs.existsSync(path.join(fixture.repo, local))
      )
        this.skip();
      fixture.git(['config', 'core.ignorecase', String(variant.ignoreCase)]);
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
      const outside = path.join(fixture.root, 'outside');
      if (variant.kind === 'symlink') {
        fs.mkdirSync(outside);
        fs.writeFileSync(
          path.join(outside, 'inside.txt'),
          'precious late work'
        );
      }
      const script =
        variant.kind === 'symlink'
          ? `ln -s ${quote(outside)} dir`
          : `${
              variant.kind === 'unicode-directory' ? 'mkdir é-dir\n' : ''
            }printf 'precious late work' > ${quote(local)}`;
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/post-rewrite'),
        `#!/bin/sh\n${script}\n`,
        { mode: 0o755 }
      );
      const result = fixture.run(['move', 'other', '-s', 'tip', '--only']);
      expect(
        fs.readFileSync(path.join(fixture.repo, local), 'utf8'),
        result.stdout + result.stderr
      ).to.equal('precious late work');
      expect(result.status).not.to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
      ).to.equal('tip');
      expect(result.stdout + result.stderr)
        .to.match(/rewrite[^\n]*tip[^\n]*completed/i)
        .and.match(/return[^\n]*departure[^\n]*failed/i);
      if (variant.kind === 'symlink') {
        expect(
          fs.lstatSync(path.join(fixture.repo, 'dir')).isSymbolicLink()
        ).to.equal(true);
        expect(fs.readlinkSync(path.join(fixture.repo, 'dir'))).to.equal(
          outside
        );
        expect(
          fs.readFileSync(path.join(outside, 'inside.txt'), 'utf8')
        ).to.equal('precious late work');
      }
    });
  }
  it('allows unrelated ignored work beside an indexed Unicode alias during ordinary upstack move', function () {
    fixture.git(['switch', 'other']);
    fs.mkdirSync(path.join(fixture.repo, 'É-dir'));
    fixture.stage('É-dir/new.txt', 'target contents');
    fixture.git(['commit', '-m', 'target Unicode directory']);
    fixture.git(['switch', 'base']);
    fs.mkdirSync(path.join(fixture.repo, 'é-dir'));
    fixture.write('é-dir/private.bin', 'precious unrelated work');
    fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
    if (!fs.existsSync(path.join(fixture.repo, 'É-dir'))) this.skip();
    fixture.ok(['move', 'other']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'é-dir/private.bin'), 'utf8')
    ).to.equal('precious unrelated work');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
    ).to.equal('base\nchild\ntip');
    expect(fixture.git(['show', 'tip:É-dir/new.txt'])).to.equal(
      'target contents'
    );
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });

  for (const ignoreCase of [true, false]) {
    it(`preserves late tracked Unicode work before the next replay with ignorecase ${ignoreCase}`, function () {
      fixture.git(['switch', 'other']);
      fs.mkdirSync(path.join(fixture.repo, 'É-dir'));
      fixture.stage('É-dir/new.txt', 'target contents');
      fixture.git(['commit', '-m', 'target Unicode directory']);
      fixture.git(['switch', 'base']);
      fs.mkdirSync(path.join(fixture.repo, 'é-dir'));
      fixture.write('é-dir/private.bin', 'precious unrelated work');
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
      if (!fs.existsSync(path.join(fixture.repo, 'É-dir'))) this.skip();
      fixture.git(['config', 'core.ignorecase', String(ignoreCase)]);
      const child = fixture.git(['rev-parse', 'child']);
      const tip = fixture.git(['rev-parse', 'tip']);
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/post-rewrite'),
        "#!/bin/sh\nprintf 'late tracked work' > é-dir/new.txt\n",
        { mode: 0o755 }
      );
      const result = fixture.run(['move', 'other']);
      expect(result.status).not.to.equal(0);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'é-dir/new.txt'), 'utf8')
      ).to.equal('late tracked work');
      expect(
        fs.readFileSync(path.join(fixture.repo, 'é-dir/private.bin'), 'utf8')
      ).to.equal('precious unrelated work');
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
      expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
      ).to.equal('base');
      expect(result.stdout + result.stderr)
        .to.include('Completed branches: base')
        .and.include('Remaining branches: child, tip');
      const saved = path.join(fixture.root, 'saved-tracked-work');
      fs.copyFileSync(path.join(fixture.repo, 'é-dir/new.txt'), saved);
      fs.unlinkSync(path.join(fixture.repo, '.git/hooks/post-rewrite'));
      fixture.git(['restore', 'É-dir/new.txt']);
      fixture.ok(['restack', '--branch', 'child', '--only']);
      fixture.ok(['restack', '--branch', 'tip', '--only']);
      fixture.ok(['checkout', 'base']);
      expect(fs.readFileSync(saved, 'utf8')).to.equal('late tracked work');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
      ).to.equal('base\nchild\ntip');
    });
    it(`preserves unstaged tracked Unicode bytes and staged resolution on continue with ignorecase ${ignoreCase}`, function () {
      fixture.stage('main.txt', 'source edit');
      fixture.git(['commit', '-m', 'source edit']);
      fixture.ok(['restack', '--upstack']);
      fixture.git(['switch', 'other']);
      fs.mkdirSync(path.join(fixture.repo, 'É-dir'));
      fixture.stage('É-dir/new.txt', 'target contents');
      fixture.stage('main.txt', 'target edit');
      fixture.git(['commit', '-m', 'target conflict and Unicode directory']);
      fixture.git(['switch', 'base']);
      fs.mkdirSync(path.join(fixture.repo, 'é-dir'));
      fixture.write('é-dir/private.bin', 'precious unrelated work');
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
      if (!fs.existsSync(path.join(fixture.repo, 'É-dir'))) this.skip();
      fixture.git(['config', 'core.ignorecase', String(ignoreCase)]);
      expect(fixture.run(['move', 'other']).status).not.to.equal(0);
      expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
        'main.txt'
      );
      fixture.stage('main.txt', 'resolved source');
      fixture.write('é-dir/new.txt', 'unstaged tracked work');
      const refs = fixture.refs();
      const staged = fixture.git(['diff', '--cached', '--binary']);
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      const result = fixture.run(['continue']);
      expect(result.status).not.to.equal(0);
      expect(fixture.refs()).to.equal(refs);
      expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(staged);
      expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
        ''
      );
      expect(
        fs.existsSync(
          path.resolve(
            fixture.repo,
            fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
          )
        )
      ).to.equal(true);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'é-dir/new.txt'), 'utf8')
      ).to.equal('unstaged tracked work');
      expect(result.stdout + result.stderr).to.include('source phase (base)');
      const saved = path.join(fixture.root, 'saved-unstaged-work');
      fs.copyFileSync(path.join(fixture.repo, 'é-dir/new.txt'), saved);
      fixture.git(['restore', 'É-dir/new.txt']);
      fixture.ok(['continue']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(fs.readFileSync(saved, 'utf8')).to.equal('unstaged tracked work');
      expect(
        fs.readFileSync(path.join(fixture.repo, 'é-dir/private.bin'), 'utf8')
      ).to.equal('precious unrelated work');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
      ).to.equal('base\nsource edit\nchild\ntip');
      fixture.ok(['checkout', 'tip']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    });
  }
  for (const next of ['aligned no-op', 'only detach', 'fresh move']) {
    it(`allows ${next} after a completed Unicode move with unrelated ignored work`, function () {
      fixture.git(['switch', 'other']);
      fs.mkdirSync(path.join(fixture.repo, 'É-dir'));
      fixture.stage('É-dir/new.txt', 'target contents');
      fixture.git(['commit', '-m', 'target Unicode directory']);
      fixture.git(['switch', 'base']);
      fs.mkdirSync(path.join(fixture.repo, 'é-dir'));
      fixture.write('é-dir/private.bin', 'precious unrelated work');
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
      if (!fs.existsSync(path.join(fixture.repo, 'É-dir'))) this.skip();
      fixture.ok(['move', 'other']);
      const refs = fixture.refs();
      const source = fixture.git(['rev-parse', 'base']);
      const other = fixture.git(['rev-parse', 'other']);
      const result = fixture.run(
        next === 'fresh move'
          ? ['move', 'main']
          : ['move', 'other', ...(next === 'only detach' ? ['--only'] : [])]
      );
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(
        fs.readFileSync(path.join(fixture.repo, 'é-dir/private.bin'), 'utf8')
      ).to.equal('precious unrelated work');
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      if (next === 'aligned no-op') expect(fixture.refs()).to.equal(refs);
      if (next === 'only detach') {
        expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
        expect(
          fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
        ).to.equal('child\ntip');
        fixture.ok(['checkout', 'child']);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal('other');
      } else {
        expect(
          fixture.git([
            'log',
            '--reverse',
            '--format=%s',
            `${next === 'fresh move' ? 'main' : 'other'}..tip`,
          ])
        ).to.equal('base\nchild\ntip');
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(
          next === 'fresh move' ? 'main' : 'other'
        );
      }
    });
  }
});
