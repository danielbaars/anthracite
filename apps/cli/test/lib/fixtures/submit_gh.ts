// A deliberately small external gh replacement for submit CLI regressions.
import { execFileSync } from 'child_process';
import fs from 'fs';

export type SubmitPr = {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string;
  reviewRequests: { login: string }[];
};

export function readSubmitPrs(path: string): SubmitPr[] {
  const value: unknown = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(value) || !value.every(isSubmitPr)) {
    throw new Error('Invalid submit fixture PR state');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSubmitPr(value: unknown): value is SubmitPr {
  return (
    isRecord(value) &&
    'number' in value &&
    typeof value.number === 'number' &&
    'url' in value &&
    typeof value.url === 'string' &&
    'headRefName' in value &&
    typeof value.headRefName === 'string' &&
    'baseRefName' in value &&
    typeof value.baseRefName === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'body' in value &&
    typeof value.body === 'string' &&
    'state' in value &&
    typeof value.state === 'string' &&
    'isDraft' in value &&
    typeof value.isDraft === 'boolean' &&
    'reviewDecision' in value &&
    typeof value.reviewDecision === 'string' &&
    'reviewRequests' in value &&
    Array.isArray(value.reviewRequests) &&
    value.reviewRequests.every(
      (request: unknown) =>
        isRecord(request) && typeof request.login === 'string'
    )
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const statePath = process.env.CHARCOAL_TEST_GH_STATE;
  const logPath = process.env.CHARCOAL_TEST_GH_LOG;
  if (!statePath || !logPath) throw new Error('Missing submit fixture paths');
  fs.appendFileSync(logPath, `${JSON.stringify(args)}\n`);
  if (args[0] === '--version') {
    process.stdout.write('gh version 2.80.0\n');
    return;
  }
  if (args[0] === 'auth' && args[1] === 'status') return;
  if (args[0] !== 'pr')
    throw new Error(`Unsupported gh command: ${args.join(' ')}`);
  const option = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  if (option('--repo') !== 'fixture/submit')
    throw new Error('Unexpected repository');
  const prs = readSubmitPrs(statePath);
  const pr = prs.find(
    (candidate) =>
      candidate.headRefName === args[2] || String(candidate.number) === args[2]
  );
  if (args[1] === 'view') {
    if (!pr) {
      process.stderr.write('no pull requests found\n');
      process.exitCode = 1;
      return;
    }
    const headRefOid = execFileSync(
      'git',
      ['ls-remote', 'origin', `refs/heads/${pr.headRefName}`],
      { encoding: 'utf8' }
    ).split(/\s/)[0];
    const response: Record<string, unknown> = { ...pr, headRefOid };
    const fields = option('--json')?.split(',');
    if (!fields) throw new Error('Fixture PR view requires --json');
    const selected: Record<string, unknown> = {};
    for (const field of fields) {
      if (!(field in response))
        throw new Error(`Unsupported PR field: ${field}`);
      selected[field] = response[field];
    }
    process.stdout.write(`${JSON.stringify(selected)}\n`);
    return;
  }
  if (args[1] === 'create') {
    const head = option('--head');
    const base = option('--base');
    if (
      !head ||
      !base ||
      prs.some((candidate) => candidate.headRefName === head)
    )
      throw new Error('Invalid or duplicate PR creation');
    const number = Math.max(0, ...prs.map((candidate) => candidate.number)) + 1;
    const created: SubmitPr = {
      number,
      url: `https://github.com/fixture/submit/pull/${number}`,
      headRefName: head,
      baseRefName: base,
      title: option('--title') ?? '',
      body: option('--body') ?? '',
      state: 'OPEN',
      isDraft: args.includes('--draft'),
      reviewDecision: 'REVIEW_REQUIRED',
      reviewRequests: [],
    };
    prs.push(created);
    fs.writeFileSync(statePath, JSON.stringify(prs));
    process.stdout.write(`${created.url}\n`);
    return;
  }
  if (args[1] === 'edit' && pr) {
    if (option('--base')) pr.baseRefName = option('--base') ?? pr.baseRefName;
    if (option('--body') !== undefined) pr.body = option('--body') ?? '';
    if (!args.includes('--base') && !args.includes('--body'))
      throw new Error('Unsupported PR edit');
    fs.writeFileSync(statePath, JSON.stringify(prs));
    return;
  }
  throw new Error(`Unsupported gh command: ${args.join(' ')}`);
}

if (require.main === module) main();
