import { LogStepsCliFixture } from './log_steps_cli';

/** One-trunk presentation graph with deliberately different sibling tip dates. */
export class LogPresentationCliFixture extends LogStepsCliFixture {
  constructor(
    options: { alternateTrackingOrder?: boolean; equalDates?: boolean } = {}
  ) {
    super();
    this.git(['switch', 'main']);
    this.ok(['untrack', 'child', '--force']);
    this.git(['branch', '-D', 'child']);
    const branches = [
      ['base', 'main', false],
      ['search', 'base', false],
      ['ui', 'search', false],
      ['empty-tip', 'ui', true],
      ['api', 'base', false],
      ['api-followup', 'api', false],
      ['maintenance', 'main', false],
      ['feature/café-long-branch-name-for-terminal-width', 'search', false],
    ] as const;
    const trackingOrder = options.alternateTrackingOrder
      ? [6, 0, 4, 5, 1, 7, 2, 3]
      : branches.map((_, index) => index);
    for (const index of trackingOrder) {
      const [name, parent, empty] = branches[index];
      this.env.GIT_AUTHOR_DATE =
        this.env.GIT_COMMITTER_DATE = `2026-10-25T12:0${
          options.equalDates ? 0 : index
        }:00Z`;
      this.branch(name, parent, empty);
    }
    this.git(['switch', 'api']);
    this.env.GIT_AUTHOR_DATE = this.env.GIT_COMMITTER_DATE =
      '2026-10-25T12:09:00Z';
    this.commit('api-update');
    this.git(['switch', 'search']);
  }
}
