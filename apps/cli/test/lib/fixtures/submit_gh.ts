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
  reviewRequests: {
    login?: string;
    slug?: string;
    organization?: { login: string };
  }[];
  assignees?: { login: string }[];
  reviews?: { id: string; author: { login: string } }[];
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
        isRecord(request) &&
        (typeof request.login === 'string' ||
          typeof request.slug === 'string') &&
        (request.organization === undefined ||
          (isRecord(request.organization) &&
            typeof request.organization.login === 'string'))
    ) &&
    (value.assignees === undefined ||
      (Array.isArray(value.assignees) &&
        value.assignees.every(
          (assignee: unknown) =>
            isRecord(assignee) && typeof assignee.login === 'string'
        )))
  );
}

// Keep the supported external gh commands together in this small test fixture.
// eslint-disable-next-line max-lines-per-function
function main(): void {
  const args = process.argv.slice(2);
  const statePath = process.env.ANTHRACITE_TEST_GH_STATE;
  const logPath = process.env.ANTHRACITE_TEST_GH_LOG;
  if (!statePath || !logPath) throw new Error('Missing submit fixture paths');
  fs.appendFileSync(logPath, `${JSON.stringify(args)}\n`);
  if (args[0] === '--version') {
    process.stdout.write('gh version 2.80.0\n');
    return;
  }
  if (args[0] === 'auth' && args[1] === 'status') return;
  if (args[0] === 'api' && args[1] === 'user') {
    if (process.env.ANTHRACITE_TEST_GH_ACCOUNT_MODE === 'reject') {
      process.stderr.write('GitHub authentication required\n');
      process.exitCode = 1;
      return;
    }
    if (process.env.ANTHRACITE_TEST_GH_ACCOUNT_MODE === 'malformed') {
      process.stdout.write('{invalid JSON');
      return;
    }
    process.stdout.write(
      JSON.stringify({
        login:
          process.env.ANTHRACITE_TEST_GH_ACCOUNT_MODE === 'invalid'
            ? null
            : 'fixture-user',
      })
    );
    return;
  }
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
    const response: Record<string, unknown> = {
      ...pr,
      reviews: pr.reviews ?? [],
      assignees: pr.assignees ?? [],
      headRefOid,
    };
    if (
      process.env.ANTHRACITE_TEST_GH_REVIEW_MODE === 'invalid' &&
      option('--json')?.includes('reviews') &&
      pr.reviewRequests.length
    )
      response.number = 999;
    if (
      process.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE === 'invalid' &&
      option('--json')?.includes('assignees') &&
      pr.assignees?.length
    )
      response.headRefName = 'wrong-head';
    const fields = option('--json')?.split(',');
    if (!fields) throw new Error('Fixture PR view requires --json');
    if (
      fields.length === 3 &&
      fields.includes('isDraft') &&
      process.env.ANTHRACITE_TEST_GH_STATUS_HEAD === pr.headRefName &&
      process.env.ANTHRACITE_TEST_GH_STATUS_MODE === 'read-missing'
    ) {
      process.stderr.write('no pull requests found during status readback\n');
      process.exitCode = 1;
      return;
    }
    if (
      fields.length === 3 &&
      fields.includes('isDraft') &&
      process.env.ANTHRACITE_TEST_GH_STATUS_HEAD === pr.headRefName &&
      process.env.ANTHRACITE_TEST_GH_STATUS_MODE === 'read-invalid'
    ) {
      process.stdout.write('{not valid JSON');
      return;
    }
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
      reviewRequests:
        process.env.ANTHRACITE_TEST_GH_REVIEW_MODE === 'ignore'
          ? []
          : args.flatMap((arg, index) =>
              arg === '--reviewer' ? [{ login: args[index + 1] }] : []
            ),
    };
    prs.push(created);
    fs.writeFileSync(statePath, JSON.stringify(prs));
    process.stdout.write(`${created.url}\n`);
    return;
  }
  if (args[1] === 'ready' && pr) {
    const requestedDraft = args.includes('--undo');
    if (pr.isDraft === requestedDraft)
      throw new Error('PR already has the requested status');
    if (process.env.ANTHRACITE_TEST_GH_STATUS_HEAD === pr.headRefName) {
      if (process.env.ANTHRACITE_TEST_GH_STATUS_MODE === 'reject') {
        process.stderr.write(
          `GitHub refused ${requestedDraft ? 'draft' : 'ready'} transition\n`
        );
        process.exitCode = 1;
        return;
      }
    }
    if (
      process.env.ANTHRACITE_TEST_GH_STATUS_HEAD === pr.headRefName &&
      process.env.ANTHRACITE_TEST_GH_STATUS_MODE === 'unchanged'
    )
      return;
    pr.isDraft = requestedDraft;
    fs.writeFileSync(statePath, JSON.stringify(prs));
    return;
  }
  if (args[1] === 'edit' && pr) {
    if (option('--base')) pr.baseRefName = option('--base') ?? pr.baseRefName;
    if (option('--body') !== undefined) pr.body = option('--body') ?? '';
    const reviewMode = process.env.ANTHRACITE_TEST_GH_REVIEW_MODE;
    const assigneeMode = process.env.ANTHRACITE_TEST_GH_ASSIGNEE_MODE;
    if (args.includes('--add-assignee') && assigneeMode === 'reject') {
      process.stderr.write(
        'assignment rejected: unknown or unauthorized user\n'
      );
      process.exitCode = 1;
      return;
    }
    if (args.includes('--add-reviewer') && reviewMode === 'reject') {
      process.stderr.write(
        'review request rejected: unknown or unauthorized reviewer\n'
      );
      process.exitCode = 1;
      return;
    }
    for (const [index, arg] of args.entries()) {
      if (
        arg === '--add-assignee' &&
        assigneeMode !== 'ignore' &&
        (!['partial', 'partial-reject'].includes(assigneeMode ?? '') ||
          args[index + 1] === 'bob')
      ) {
        pr.assignees = [...(pr.assignees ?? []), { login: args[index + 1] }];
      }
      if (arg === '--add-reviewer' && reviewMode === 'reviewed') {
        pr.reviews = [
          ...(pr.reviews ?? []),
          { id: 'new-review', author: { login: args[index + 1] } },
        ];
        continue;
      }
      if (
        arg === '--add-reviewer' &&
        reviewMode !== 'ignore' &&
        (!['partial', 'partial-reject'].includes(reviewMode ?? '') ||
          args[index + 1] === 'alice') &&
        !pr.reviewRequests.some((request) => request.login === args[index + 1])
      ) {
        const name = args[index + 1];
        pr.reviewRequests.push(
          name.includes('/')
            ? {
                slug: name.split('/')[1],
                organization: { login: name.split('/')[0] },
              }
            : { login: name }
        );
      }
    }
    if (
      !args.includes('--base') &&
      !args.includes('--body') &&
      !args.includes('--add-reviewer') &&
      !args.includes('--add-assignee')
    )
      throw new Error('Unsupported PR edit');
    fs.writeFileSync(statePath, JSON.stringify(prs));
    if (args.includes('--add-reviewer') && reviewMode === 'partial-reject') {
      process.stderr.write('review request partially rejected\n');
      process.exitCode = 1;
    }
    if (args.includes('--add-assignee') && assigneeMode === 'partial-reject') {
      process.stderr.write('assignment partially rejected\n');
      process.exitCode = 1;
    }
    return;
  }
  throw new Error(`Unsupported gh command: ${args.join(' ')}`);
}

if (require.main === module) main();
