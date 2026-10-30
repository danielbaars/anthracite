import { CommandModule } from 'yargs';

import * as absorb from './commands/absorb';
import * as auth from './commands/auth';
import * as bottom from './commands/bottom';
import * as checkout from './commands/checkout';
import * as children from './commands/children';
import * as continueCmd from './commands/continue';
import * as create from './commands/create';
import * as deleteCmd from './commands/delete';
import * as demo from './commands/demo';
import * as dev from './commands/dev';
import * as down from './commands/down';
import * as edit from './commands/edit';
import * as feedback from './commands/feedback';
import * as fish from './commands/fish';
import * as fold from './commands/fold';
import * as freeze from './commands/freeze';
import * as unfreeze from './commands/unfreeze';
import * as get from './commands/get';
import * as info from './commands/info';
import * as init from './commands/init';
import * as internalCommitGuard from './commands/internal_commit_guard';
import * as internalPushGuard from './commands/internal_push_guard';
import * as ll from './commands/ll';
import * as log from './commands/log';
import * as ls from './commands/ls';
import * as modify from './commands/modify';
import * as mcp from './commands/mcp';
import * as move from './commands/move';
import * as parent from './commands/parent';
import * as pop from './commands/pop';
import * as pr from './commands/pr';
import * as rename from './commands/rename';
import * as reorder from './commands/reorder';
import * as repo from './commands/repo';
import * as restack from './commands/restack';
import * as split from './commands/split';
import * as squash from './commands/squash';
import * as ss from './commands/ss';
import * as submit from './commands/submit';
import * as sync from './commands/sync';
import * as test from './commands/test';
import * as top from './commands/top';
import * as track from './commands/track';
import * as untrack from './commands/untrack';
import * as up from './commands/up';
import * as user from './commands/user';

// Registered explicitly (not via `.commandDir()`) so the command modules are
// bundled into the single-file binary built with `bun build --compile`.
export const commandModules = [
  absorb,
  auth,
  bottom,
  checkout,
  children,
  continueCmd,
  create,
  deleteCmd,
  demo,
  dev,
  down,
  edit,
  feedback,
  fish,
  fold,
  freeze,
  unfreeze,
  get,
  info,
  init,
  internalCommitGuard,
  internalPushGuard,
  ll,
  log,
  ls,
  modify,
  mcp,
  move,
  parent,
  pop,
  pr,
  rename,
  reorder,
  repo,
  restack,
  split,
  squash,
  ss,
  submit,
  sync,
  test,
  top,
  track,
  untrack,
  up,
  user,
] as unknown as CommandModule[];
