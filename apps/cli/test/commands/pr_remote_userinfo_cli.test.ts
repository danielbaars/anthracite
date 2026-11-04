import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { preparePrInspection } from '../lib/fixtures/pr_gh';
import { prepareLand } from '../lib/fixtures/land_gh';

const supportedRemotes: readonly string[] = [
  'https://github.com/fixture/inspection.git',
  'https://synthetic-user:synthetic-pass@github.com/fixture/inspection.git',
  'ssh://git@github.com/fixture/inspection.git',
  'ssh://synthetic-user@github.com/fixture/inspection.git',
  'git+ssh://git@github.com/fixture/inspection.git',
  'git@github.com:fixture/inspection.git',
  'github.com:fixture/inspection.git',
  'github.com/fixture/inspection.git',
  'ssh:git@github.com:fixture/inspection.git',
  'git+ssh:git@github.com:fixture/inspection.git',
];

const unsupportedRemotes: readonly string[] = [
  'https://github.com@foreign.example/fixture/inspection.git',
  'https://github.com.foreign.example/fixture/inspection.git',
  'ssh://git@foreign.example/fixture/inspection.git',
  'https://foreign.example/github.com/fixture/inspection.git',
  'file://github.com/fixture/inspection.git',
  'https://github.com/fixture/inspection.git?host=github.com',
];

describe('PR inspection with remote userinfo', function () {
  this.timeout(120000);
  it('inspects a GitHub HTTPS remote with an embedded username without changing the repository', () => {
    const fixture = new RelationCliFixture();
    try {
      const github = preparePrInspection(fixture);
      fs.writeFileSync(github.state, JSON.stringify([github.pr('base')]));
      fixture.git([
        'remote',
        'set-url',
        'origin',
        'https://synthetic-user@github.com/fixture/inspection.git',
      ]);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run(['pr', 'base', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include('Repository: fixture/inspection')
        .and.include('PR #17');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    } finally {
      fixture.cleanup();
    }
  });

  it('preserves the separate credential-free landing remote restriction', () => {
    const fixture = new RelationCliFixture();
    try {
      const github = prepareLand(fixture);
      const remote = 'https://synthetic-user@github.com/fixture/inspection.git';
      fixture.git(['config', `url.${github.remote}.insteadOf`, remote]);
      fixture.git(['remote', 'set-url', 'origin', remote]);
      fixture.git(['remote', 'set-url', '--push', 'origin', remote]);
      const configFile = path.join(
        fixture.repo,
        '.git',
        '.graphite_repo_config'
      );
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      delete config.host;
      fs.writeFileSync(configFile, JSON.stringify(config));
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'land',
        'base',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stderr).to.include(
        'Landing requires a supported declared GitHub remote'
      );
      expect(result.stderr).not.to.include(
        'PR workflows support github.com repositories only'
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
    } finally {
      fixture.cleanup();
    }
  });

  for (const remote of supportedRemotes) {
    it(`infers repository and host from ${remote}`, () => {
      const fixture = new RelationCliFixture();
      try {
        const github = preparePrInspection(fixture);
        fs.writeFileSync(github.state, JSON.stringify([github.pr('base')]));
        const configFile = path.join(
          fixture.repo,
          '.git',
          '.graphite_repo_config'
        );
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        delete config.owner;
        delete config.name;
        fs.writeFileSync(configFile, JSON.stringify(config));
        fixture.git(['remote', 'set-url', 'origin', remote]);
        const before = fixture.inspectionSnapshot();
        const result = fixture.run(['pr', 'base', '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        expect(result.stdout)
          .to.include('Repository: fixture/inspection')
          .and.include('PR #17');
        expect(result.stdout + result.stderr).not.to.include('synthetic-pass');
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      } finally {
        fixture.cleanup();
      }
    });
  }

  for (const remote of unsupportedRemotes) {
    it(`refuses ${remote} without service calls or local mutation`, () => {
      const fixture = new RelationCliFixture();
      try {
        const github = preparePrInspection(fixture);
        fixture.git(['remote', 'set-url', 'origin', remote]);
        const before = fixture.inspectionSnapshot();
        const result = fixture.run(['pr', 'base', '--no-interactive']);
        expect(result.status, result.stdout + result.stderr).to.equal(1);
        expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      } finally {
        fixture.cleanup();
      }
    });
  }
});
