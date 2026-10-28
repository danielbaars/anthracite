import fs from 'fs';
import path from 'path';

import { expect } from 'chai';

import { version as packageVersion } from '../../package.json';
import { CwdCliFixture } from '../lib/fixtures/cwd_cli';

describe('Anthracite release identity through the public CLI', function () {
  this.timeout(120000);
  let fixture: CwdCliFixture;
  beforeEach(() => {
    fixture = new CwdCliFixture();
  });
  afterEach(() => fixture.cleanup());

  it('reports the release version and Anthracite help outside Git without tools', () => {
    const restore = fixture.refuseExternalTools();
    try {
      const version = fixture.run(['--version'], fixture.root);
      expect(version.status, version.stderr).to.equal(0);
      expect(version.stdout).to.equal(`${packageVersion}\n`);
      const help = fixture.run(['--help'], fixture.root);
      expect(help.status, help.stderr).to.equal(0);
      expect(help.stdout).to.include('Anthracite').and.include('an create');
      expect(help.stdout).not.to.include('Charcoal');
      expect(
        fs.existsSync(path.join(fixture.root, 'unexpected-tool'))
      ).to.equal(false);
    } finally {
      restore();
    }
  });

  it('writes its own user preferences while preserving legacy preferences', () => {
    fixture.env.HOME = fixture.root;
    delete fixture.env.GRAPHITE_USER_CONFIG_PATH;
    const legacy = path.join(fixture.root, '.graphite_user_config');
    const sentinel = 'Legacy preferences must not be read or rewritten';
    fs.writeFileSync(legacy, sentinel);
    const result = fixture.run(
      ['user', 'pager', '--set', 'cat', '--no-interactive'],
      fixture.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(fs.readFileSync(legacy, 'utf8')).to.equal(sentinel);
    const preferences: unknown = JSON.parse(
      fs.readFileSync(
        path.join(fixture.root, '.anthracite_user_config'),
        'utf8'
      )
    );
    expect(preferences).to.deep.equal({ pager: 'cat' });
  });
});
