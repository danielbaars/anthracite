import { expect } from 'chai';
import { CreateCliFixture } from '../fixtures/create_cli';

export function expectParent(
  fixture: CreateCliFixture,
  branch: string,
  parent: string
): void {
  fixture.ok(['checkout', branch]);
  fixture.ok(['down']);
  expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
}
