import { builder as submitBuilder } from './submit';

export { handler } from './submit';
export const command = 'ss';
export const canonical = 'submit';
export const description =
  'Submit the selected branch, its ancestors and descendants (submit --stack by default). Explicit --no-stack selects downstack only.';
export const builder = {
  ...submitBuilder,
  stack: { ...submitBuilder.stack, default: true },
};
