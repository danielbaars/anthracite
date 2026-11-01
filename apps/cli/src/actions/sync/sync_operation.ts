import { z } from 'zod';
import { getOperationSchema } from './get_operation';
import { pullRequestSchema } from './remote_update_graph';

const oid = z.string().regex(/^[a-f0-9]{40,64}$/);
const refState = getOperationSchema.shape.expected.element;
const prInfo = z
  .object({
    number: z.number().int().positive().optional(),
    url: z.string().optional(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']).optional(),
    base: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    isDraft: z.boolean().optional(),
    reviewDecision: z
      .enum(['APPROVED', 'REVIEW_REQUIRED', 'CHANGES_REQUESTED'])
      .optional(),
  })
  .strict();
const cleanup = z
  .object({
    branches: z.array(
      z
        .object({
          branchName: z.string(),
          previousHead: oid,
          previousMetadata: oid,
          parent: z.string(),
          head: oid.optional(),
          base: oid,
          frozen: z.boolean(),
          prNumber: z.number().int().positive().optional(),
          prInfo: prInfo.optional(),
          state: z.string().optional(),
        })
        .strict()
    ),
    untouched: z.array(refState),
    trunkHead: oid,
    accepted: z.array(z.string()),
    deletions: z.array(z.string()),
    declined: z.array(z.string()),
    excluded: z.array(z.string()),
    parents: z.array(
      z.object({ branchName: z.string(), parent: z.string() }).strict()
    ),
    mandatory: z.array(z.string()),
    replay: z.array(z.string()),
    restack: z.boolean(),
  })
  .strict();
const source = z
  .object({
    sourceRef: getOperationSchema.shape.trunk.shape.sourceRef,
    head: oid,
  })
  .strict();
export const syncOperationSchema = z
  .object({
    kind: z.literal('sync'),
    version: z.literal(1),
    root: z.string(),
    commonDirectory: z.string(),
    gitDirectory: z.string(),
    repository: z.string(),
    remote: z.string(),
    remoteUrl: z.string(),
    trunkName: z.string(),
    refresh: z
      .object({
        trunkHead: oid,
        originalHead: oid,
        original: getOperationSchema.shape.checkout.shape.original,
        trunk: getOperationSchema.shape.trunk
          .extend({ reset: z.boolean().optional() })
          .optional(),
        nodes: getOperationSchema.shape.nodes,
        prs: z.array(pullRequestSchema.strict()),
      })
      .strict(),
    cleanup,
    maintenance: getOperationSchema.shape.maintenance,
    phase: z.enum([
      'trunk',
      'remote',
      'prs',
      'cleanup',
      'maintenance',
      'checkout',
    ]),
    trunkCompleted: z.boolean(),
    completedRemote: z.array(z.string()),
    completedPrs: z.array(z.string()),
    completedMaintenance: z.array(z.string()),
    cleanupCompleted: z.boolean(),
    progress: z
      .object({
        changed: z.array(z.string()),
        deleted: z.array(z.string()),
        incomplete: z.array(z.string()),
      })
      .strict(),
    updated: z.array(z.string()),
    expected: z.array(refState),
    completion: z
      .object({
        checkout: getOperationSchema.shape.checkout,
        untouched: z.array(z.string()),
        expected: z.array(refState),
        sources: z.array(source),
      })
      .strict()
      .optional(),
    active: getOperationSchema.shape.active,
  })
  .strict();
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export function isSyncOperation(value: unknown): value is SyncOperation {
  return syncOperationSchema.safeParse(value).success;
}
