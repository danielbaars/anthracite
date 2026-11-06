import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/** A local bare Git transport still represents the configured GitHub service. */
export function configureGithubFixtureHost(repo: string): void {
  const file = path.join(repo, '.git', '.graphite_repo_config');
  const config = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify({ ...config, host: 'github.com' }));
}
