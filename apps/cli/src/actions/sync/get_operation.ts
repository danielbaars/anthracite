import { z } from 'zod';

const oid = z.string().regex(/^[a-f0-9]{40,64}$/);
const optionalOid = z.union([oid, z.literal('')]);
const sourceRef = z
  .string()
  .regex(/^refs\/gt-metadata\/get\/[a-f0-9-]{36}\/(?:\d+|trunk)$/);
const node = z
  .object({
    branchName: z.string(),
    parentBranchName: z.string(),
    expectedSourceHead: oid,
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z.string().url(),
    previousHead: optionalOid,
    previousMetadata: optionalOid,
    previousParentBranchName: z.string().optional(),
    previousBase: oid.optional(),
    head: oid,
    base: oid,
    sourceRef,
    resolution: z.enum(['REBASE', 'OVERWRITE', 'UPDATE']).optional(),
  })
  .strict();
const maintenance = z
  .object({
    branchName: z.string(),
    parentBranchName: z.string(),
    head: oid.optional(),
    base: oid,
    frozen: z.boolean(),
  })
  .strict();
export const getOperationSchema = z
  .object({
    version: z.literal(1),
    root: z.string(),
    commonDirectory: z.string(),
    gitDirectory: z.string(),
    repository: z.string(),
    remote: z.string(),
    remoteUrl: z.string(),
    checkout: z
      .object({
        target: z.string(),
        shouldCheckout: z.boolean(),
        original: z.union([
          z.object({ branchName: z.string() }).strict(),
          z.object({ detachedOid: oid }).strict(),
        ]),
      })
      .strict(),
    trunk: z
      .object({
        branchName: z.string(),
        previousHead: oid,
        head: oid,
        sourceRef,
      })
      .strict(),
    force: z.boolean(),
    shouldRestack: z.boolean(),
    nodes: z.array(node),
    maintenance: z.array(maintenance),
    imports: z.array(
      z
        .object({
          branchName: z.string(),
          wasTracked: z.boolean(),
          frozen: z.boolean(),
        })
        .strict()
    ),
    phase: z.enum(['trunk', 'remote', 'maintenance', 'checkout', 'manual']),
    trunkCompleted: z.boolean(),
    completedRemote: z.array(z.string()),
    completedMaintenance: z.array(z.string()),
    updated: z.array(z.string()),
    expected: z.array(
      z
        .object({
          branchName: z.string(),
          head: optionalOid,
          metadata: optionalOid,
        })
        .strict()
    ),
    active: z
      .object({
        branchName: z.string(),
        phase: z.enum(['remote', 'maintenance']),
        onto: oid,
        originalHead: oid,
        base: oid,
      })
      .strict()
      .optional(),
  })
  .strict();
export type GetOperation = z.infer<typeof getOperationSchema>;
export function isGetOperation(value: unknown): value is GetOperation {
  return getOperationSchema.safeParse(value).success;
}
