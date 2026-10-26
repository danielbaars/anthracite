import fs from 'fs';
import path from 'path';
import { FrozenSubmitCliFixture } from './frozen_submit_cli';

/** Observe public recovery files independently of the operation's engine. */
export class FrozenSyncCliFixture extends FrozenSubmitCliFixture {
  observe(): ReturnType<FrozenSubmitCliFixture['observe']> & {
    readonly recovery: Record<string, string>;
  } {
    const recovery: Record<string, string> = {};
    const gitDir = this.git('rev-parse', '--absolute-git-dir');
    const visit = (name: string): void => {
      const location = path.join(gitDir, name);
      if (!fs.existsSync(location)) return;
      if (fs.statSync(location).isDirectory()) {
        for (const entry of fs.readdirSync(location))
          visit(path.join(name, entry));
      } else recovery[name] = fs.readFileSync(location).toString('base64');
    };
    for (const name of ['.gtcontinue', 'rebase-merge', 'rebase-apply'])
      visit(name);
    return { ...super.observe(), recovery };
  }
}
