import {
  current,
  landingSurvivors,
  loadLandingProgress,
  owned,
  saveLandingProgress,
  landingGit as git,
} from '../lib/landing_progress';
import { writeFrozenMetadata } from '../lib/engine/metadata_ref';
import { ExitFailedError } from '../lib/errors';

/** Pending descendants may be temporarily invalid while their parent is replayed. */
export function setLandingFrozen(target: string, frozen: boolean): boolean {
  const record = loadLandingProgress();
  if (!record) return false;
  const members = [current(record), ...landingSurvivors(record)];
  if (!members.some((member) => member.branch === target)) return false;
  const branches = new Set([target]);
  if (frozen) {
    let next = members.find((member) => member.branch === target);
    while (next && owned(next).parent !== record.trunk) {
      branches.add(owned(next).parent);
      const parent = owned(next).parent;
      next = members.find((member) => member.branch === parent);
    }
  } else {
    for (const member of members)
      if (branches.has(owned(member).parent)) branches.add(member.branch);
  }
  for (const branch of branches) {
    const member = members.find((item) => item.branch === branch);
    if (
      !member ||
      git(['rev-parse', `refs/branch-metadata/${branch}`]) !==
        owned(member).metadata
    )
      throw new ExitFailedError(
        'Landing metadata changed; freeze/unfreeze recovery preserved for inspection.'
      );
  }
  writeFrozenMetadata([...branches], frozen);
  const update = (member: (typeof record.merges)[number]): typeof member =>
    branches.has(member.branch)
      ? {
          ...member,
          reached: {
            ...owned(member),
            metadata: git([
              'rev-parse',
              `refs/branch-metadata/${member.branch}`,
            ]),
          },
        }
      : member;
  saveLandingProgress(
    {
      ...record,
      merges: record.merges.map(update),
      maintenance: record.maintenance.map(update),
    },
    record
  );
  return true;
}
