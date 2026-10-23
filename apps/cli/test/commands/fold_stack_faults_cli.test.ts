import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack fold bounded late failures through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  function hook(name: string, content: string): void {
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', name),
      `#!/bin/sh\n${content}\n`,
      { mode: 0o755 }
    );
  }
  it('reports a preparation failure and preserves all original refs', () => {
    hook(
      'post-checkout',
      'if ! git symbolic-ref -q HEAD >/dev/null; then echo "preparation refused" >&2; exit 1; fi'
    );
    const before = fixture.snapshot();
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Selected refs were not published'
    );
    expect(result.stdout + result.stderr).to.include('preparation refused');
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('reports completed refs and an actual checkout when the final checkout hook fails', () => {
    hook(
      'post-checkout',
      'if [ "$(git symbolic-ref --short -q HEAD)" = base ]; then echo "return hook refused" >&2; exit 1; fi'
    );
    const tip = fixture.git(['rev-parse', 'tip']);
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Selected refs were folded into base'
    );
    expect(result.stdout + result.stderr).to.include('Current checkout: base');
    expect(result.stdout + result.stderr).to.include("ch checkout 'base'");
    expect(result.stdout + result.stderr).to.include('return hook refused');
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(tip);
    expect(fixture.git(['branch', '--list', 'child', 'tip'])).to.equal('');
    fs.unlinkSync(path.join(fixture.repo, '.git', 'hooks', 'post-checkout'));
    fixture.ok(['checkout', 'base']);
    expect(fixture.ok(['info'])).to.include('Parent: main');
  });

  it('reports confirmed collapse honestly when subsequent metadata publication is refused', () => {
    hook(
      'reference-transaction',
      'if [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/branch-metadata/base) echo "tracking refused" >&2; exit 1;; esac\ndone\nfi'
    );
    const tip = fixture.git(['rev-parse', 'tip']);
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Selected refs were folded into base'
    );
    expect(result.stdout + result.stderr).to.include('tracking refused');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(tip);
    expect(fixture.git(['branch', '--list', 'child', 'tip'])).to.equal('');
    fs.unlinkSync(
      path.join(fixture.repo, '.git', 'hooks', 'reference-transaction')
    );
    fixture.ok(['track', 'base', '--parent', 'main']);
    fixture.ok(['checkout', 'base']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.ok(['info'])).to.include('Parent: main');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(tip);
  });
  it('keeps truthful progress even when cleanup of a deleted name is repeatedly refused', () => {
    hook(
      'reference-transaction',
      'if [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/branch-metadata/child) echo "deleted tracking cleanup refused" >&2; exit 1;; esac\ndone\nfi'
    );
    const tip = fixture.git(['rev-parse', 'tip']);
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Selected refs were folded into base'
    );
    expect(result.stdout + result.stderr).to.include(
      'deleted tracking cleanup refused'
    );
    expect(fixture.git(['rev-parse', 'base'])).to.equal(tip);
    expect(fixture.git(['branch', '--list', 'child', 'tip'])).to.equal('');
    fs.unlinkSync(
      path.join(fixture.repo, '.git', 'hooks', 'reference-transaction')
    );
    fixture.ok(['checkout', 'base']);
    expect(fixture.ok(['info'])).to.include('Parent: main');
  });
  it('preserves late ignored bytes when preparation fails and a safe return is obstructed', () => {
    fixture.git(['switch', 'tip']);
    fixture.git(['rm', 'base.txt']);
    fixture.git(['commit', '-m', 'tip removes the old bottom path']);
    fixture.git(['switch', 'base']);
    fs.appendFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      '\nbase.txt\n'
    );
    hook(
      'post-checkout',
      'if ! git symbolic-ref -q HEAD >/dev/null; then printf "private-bytes" > base.txt; echo "preparation hook refused" >&2; exit 1; fi'
    );
    const refs = fixture.refs();
    const result = fixture.run(['fold', '--stack']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include(
      'Selected refs were not published'
    );
    expect(result.stdout + result.stderr).to.include(
      'Current checkout: detached HEAD'
    );
    expect(result.stdout + result.stderr).to.include(
      'Move obstructing local work aside'
    );
    expect(fixture.refs()).to.equal(refs);
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('private-bytes');
    const saved = path.join(fixture.root, 'saved-private');
    fs.renameSync(path.join(fixture.repo, 'base.txt'), saved);
    fs.unlinkSync(path.join(fixture.repo, '.git', 'hooks', 'post-checkout'));
    fixture.ok(['checkout', 'base']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.ok(['info'])).to.include('Parent: main');
    expect(fs.readFileSync(saved, 'utf8')).to.equal('private-bytes');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'base.txt'), 'utf8')
    ).to.equal('base');
  });
});
