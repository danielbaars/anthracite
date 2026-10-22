import { runGitCommand } from './runner';

export function addPatch(): void {
  runGitCommand({
    args: ['add', '--patch'],
    options: { stdio: 'inherit' },
    onError: 'throw',
    resource: 'addPatch',
  });
}
