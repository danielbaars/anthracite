import fs from 'fs';
import { RelationCliFixture } from './relation_cli';
import { prepareLand } from './land_gh';

export const planRulesFailure = {
  message:
    'Upgrade to GitHub Pro or make this repository public to enable this feature.',
  documentation_url:
    'https://docs.github.com/rest/repos/rules#get-rules-for-a-branch',
  status: '403',
};

export function emptyPrivatePolicyEvidence(
  repositoryChanges: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    data: {
      repository: {
        nameWithOwner: 'fixture/inspection',
        isPrivate: true,
        viewerPermission: 'ADMIN',
        ref: { name: 'main', branchProtectionRule: null },
        rulesets: {
          totalCount: 0,
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        ...repositoryChanges,
      },
    },
  };
}

export function updatePrivatePlanPolicy(
  github: { readonly policy: string },
  changes: Readonly<Record<string, unknown>>
): void {
  fs.writeFileSync(
    github.policy,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(github.policy, 'utf8')),
      ...changes,
    })
  );
}

export function preparePrivatePlanLand(
  fixture: RelationCliFixture
): ReturnType<typeof prepareLand> {
  const github = prepareLand(fixture);
  updatePrivatePlanPolicy(github, {
    repository: { private: true, permissions: { admin: true } },
    rulesFailure: planRulesFailure,
    planAbsenceResponse: emptyPrivatePolicyEvidence(),
  });
  return github;
}
