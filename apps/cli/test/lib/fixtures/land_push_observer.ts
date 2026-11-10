import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { RelationCliFixture } from './relation_cli';

const transaction = z.object({
  ref: z.string(),
  old: z.string(),
  next: z.string(),
});
const event = z.object({ refs: z.array(transaction) });

/** Observe real client push intent and independent bare-remote acknowledgements. */
export function observeLandingPushes(
  fixture: RelationCliFixture,
  remote: string
): {
  readonly client: () => z.infer<typeof event>[];
  readonly received: () => z.infer<typeof event>[];
} {
  const client = path.join(fixture.root, 'client-pushes.jsonl');
  const received = path.join(fixture.root, 'remote-receives.jsonl');
  const hook = (file: string, fields: string): string =>
    `#!${
      process.execPath
    }\nconst fs=require('fs');const input=fs.readFileSync(0,'utf8').trim();const refs=input.split('\\n').filter(Boolean).map(line=>{${fields};return {ref,old,next};});fs.appendFileSync(${JSON.stringify(
      file
    )},JSON.stringify({refs})+'\\n');\n`;
  fs.writeFileSync(
    path.join(fixture.repo, '.git/hooks/pre-push'),
    hook(client, 'const [,next,ref,old]=line.split(/\\s+/)'),
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(remote, 'hooks/post-receive'),
    hook(received, 'const [old,next,ref]=line.split(/\\s+/)'),
    { mode: 0o755 }
  );
  const read = (file: string): z.infer<typeof event>[] =>
    fs.existsSync(file)
      ? fs
          .readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => event.parse(JSON.parse(line)))
      : [];
  return { client: () => read(client), received: () => read(received) };
}
