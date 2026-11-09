import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';

import { FrozenGetFixture } from '../lib/fixtures/frozen_get_cli';

// Public CLI processes with real Git conflicts; only gh is a boundary fixture.
// eslint-disable-next-line max-lines-per-function
describe('pending sync log inspection through the public CLI', function () {
  this.timeout(120000);
  let fixture: FrozenGetFixture;
  beforeEach(() => {
    fixture = new FrozenGetFixture();
    fixture.commandTimeoutMs = 30000;
  });
  afterEach(() => fixture.cleanup());

  function conflict(): void {
    fixture.ok('unfreeze', 'child');
    fixture.ok('create', 'local-work');
    fixture.commit(fixture.consumer, 'parent.txt', 'local conflict');
    fixture.git(fixture.consumer, 'switch', 'main');
    fixture.git(fixture.producer, 'switch', 'parent');
    fixture.commit(fixture.producer, 'parent.txt', 'incoming conflict');
    fixture.git(fixture.producer, 'push', 'origin', 'parent');
    const result = fixture.run(['sync', '--no-delete']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('Hit conflict restacking local-work');
    expect(fixture.git(fixture.consumer, 'branch', '--show-current')).to.equal(
      ''
    );
    fs.writeFileSync(fixture.ghCalls, '');
  }

  function state(): unknown {
    return {
      work: fixture.observe(),
      pins: fixture.git(
        fixture.consumer,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/gt-metadata/get'
      ),
    };
  }

  it('inspects a genuine detached conflict without claiming a checked-out branch and still continues', () => {
    conflict();
    const before = state();
    for (const route of [['log'], ['ls']]) {
      const result = fixture.run(route);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include(
        'Pending sync: local-work (detached HEAD; selection anchor only)'
      );
      expect(result.output).not.to.include('(current)').and.not.to.include('◉');
      expect(result.output).to.include('local-work');
      expect(state()).to.deep.equal(before);
    }
    expect(fs.readFileSync(fixture.ghCalls, 'utf8')).to.equal('');
    fs.writeFileSync(
      path.join(fixture.consumer, 'parent.txt'),
      'resolved both'
    );
    fixture.ok('continue', '--all');
    expect(
      fixture.git(fixture.consumer, 'show', 'local-work:parent.txt')
    ).to.equal('resolved both');
  });

  it('uses the pending participant only for bounded detached selection and keeps zero-depth refusal', () => {
    conflict();
    const before = state();
    for (const route of [['l', 's'], ['log', 's'], ['ls'], ['log']]) {
      const result = fixture.run([...route, '--stack', '--steps', '1']);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include('local-work').and.to.include('child');
      expect(result.output).not.to.include('(current)').and.not.to.include('◉');
      const refused = fixture.run([...route, '--steps', '0']);
      expect(refused.status, refused.output).to.equal(1);
      expect(refused.output).to.include('without a branch checked out');
      expect(state()).to.deep.equal(before);
    }
    const mutating = fixture.run(['delete', 'local-work', '--force']);
    expect(mutating.status, mutating.output).to.equal(1);
    expect(mutating.output).to.include('Finish the pending sync');
    expect(state()).to.deep.equal(before);
  });

  it('uses physical attached checkout after a raw abort through full, short and classic aliases', () => {
    conflict();
    fixture.git(fixture.consumer, 'rebase', '--abort');
    fixture.git(fixture.consumer, 'switch', 'main');
    fs.writeFileSync(path.join(fixture.consumer, 'main.txt'), 'staged local');
    fixture.git(fixture.consumer, 'add', 'main.txt');
    fs.writeFileSync(path.join(fixture.consumer, 'main.txt'), 'unstaged local');
    fs.writeFileSync(
      path.join(fixture.consumer, 'untracked.bin'),
      Buffer.from([0, 255, 10])
    );
    const before = state();
    for (const route of [
      ['log'],
      ['l'],
      ['log', 'short'],
      ['log', 's'],
      ['l', 'short'],
      ['l', 's'],
      ['ls'],
    ]) {
      const result = fixture.run([...route, '--steps', '0']);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include('Pending sync; checked out: main.');
      expect(result.output).to.match(/◉[^\n]*main/);
      expect(result.output).not.to.include('local-work');
      expect(state()).to.deep.equal(before);
    }
    for (const route of [
      ['log', '--classic'],
      ['ls', '-c'],
    ]) {
      const result = fixture.run(route);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include('Pending sync; checked out: main.');
      expect(result.output).to.include('↱ $ main');
      expect(state()).to.deep.equal(before);
    }
  });

  it('falls back to trunk when the detached pending participant changed or disappeared without repairing it', () => {
    conflict();
    fixture.git(fixture.consumer, 'rebase', '--abort');
    fixture.commit(
      fixture.consumer,
      'later.txt',
      'external participant change'
    );
    fixture.git(fixture.consumer, 'switch', '--detach', 'main');
    const changed = state();
    const changedResult = fixture.run(['ls', '--stack', '--steps', '1']);
    expect(changedResult.status, changedResult.output).to.equal(0);
    expect(changedResult.output).to.include(
      'selection anchor: main (pending participant unavailable)'
    );
    expect(state()).to.deep.equal(changed);
    fixture.git(fixture.consumer, 'branch', '-D', 'local-work');
    const before = state();
    for (const route of [['log'], ['ls']]) {
      const result = fixture.run([...route, '--stack', '--steps', '1']);
      expect(result.status, result.output).to.equal(0);
      expect(result.output).to.include(
        'selection anchor: main (pending participant unavailable)'
      );
      expect(result.output).not.to.include('(current)').and.not.to.include('◉');
      expect(state()).to.deep.equal(before);
    }
  });

  it('keeps existing explicit branch inspections preserving during a pending conflict', () => {
    conflict();
    const before = state();
    for (const route of [
      ['info', '--branch', 'local-work'],
      ['children'],
      ['pr', 'local-work'],
    ]) {
      const result = fixture.run(route);
      expect(result.status, result.output).to.equal(0);
      expect(state()).to.deep.equal(before);
    }
  });

  it('refuses malformed, mixed, changed-digest and foreign identity records without consuming them', () => {
    conflict();
    const file = path.join(fixture.consumer, '.git', '.gtcontinue');
    const original = fs.readFileSync(file, 'utf8');
    for (const invalid of [
      '{',
      original.replace('"sync":', '"get": {}, "sync":'),
      original.replace('"version": 1', '"version": 999'),
      original.replace('local-work', 'foreign-work'),
    ]) {
      expect(invalid).not.to.equal(original);
      fs.writeFileSync(file, invalid);
      const before = state();
      for (const route of [['log'], ['ls']]) {
        const result = fixture.run(route);
        expect(result.status, result.output).to.equal(1);
        expect(state()).to.deep.equal(before);
      }
    }
    fs.writeFileSync(file, original);
    fixture.git(
      fixture.consumer,
      'remote',
      'set-url',
      'origin',
      path.join(fixture.root, 'foreign.git')
    );
    const before = state();
    const result = fixture.run(['ls']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include(
      'original worktree and configured repository'
    );
    expect(state()).to.deep.equal(before);
  });
});
