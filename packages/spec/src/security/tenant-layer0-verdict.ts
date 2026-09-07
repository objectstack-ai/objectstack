// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0095 D1 / ADR-0131 D8 / #15813] The Layer 0 tenant wall's VERDICT for
 * one operation — what the wall DECIDED, recorded by the enforcement layer at
 * the moment it applies the wall, so a downstream reader consumes the decision
 * instead of re-deriving it.
 *
 * ## Why this is a contract and not a private note
 *
 * `plugin-security` computes the Layer 0 predicate once per operation
 * (`computeTenantLayer0Filter`, `tenant-layer.ts`) from inputs that only IT
 * can see in full: the posture in force, the caller's organization scope, the
 * object's own tenancy declaration — and the DEPLOYMENT's carve-out
 * ({@link OrgScopingEntitlement.platformGlobalObjects}, #12699), which no
 * object schema carries. A producer in another package that needs to know what
 * the wall decided — the bulk data-event publisher in `@objectstack/objectql`,
 * which stamps `BulkDataEvent.organizationId` only when the wall named exactly
 * one organization — cannot re-derive it: every re-derivation is a MIRROR of
 * the predicate, and a mirror structurally sees only the clauses it was taught.
 * The #15706 finding measured exactly that: a deployment-exempted object under
 * an armed wall was stamped with the caller's organization while Layer 0 had
 * composed no wall at all — a wrong key, the #13566 leak shape. ADR-0131 D8 —
 * 「一道谓词，算一次」 — is the rule; this schema is how the one computation
 * travels to its readers. The 2026-09-05 ruling on #15706 chose this seam
 * over a second per-object provider: (i) records a value that already exists
 * at the moment the wall is applied.
 *
 * ## The four verdicts
 *
 * | `kind`          | what the wall composed                          | when |
 * |-----------------|-------------------------------------------------|------|
 * | `none`          | nothing — Layer 0 contributed no predicate      | `single` posture; a non-tenant object (no `organization_id` column, `tenancy.enabled: false`, `systemFields.tenant: false`, or the deployment's #12699 carve-out); an exempt `PLATFORM_ADMIN` on a posture-permitting object; the #12974 verified-owner READ bypass |
 * | `organization`  | `organization_id = organizationId`              | `isolated` — the hard wall names exactly one organization |
 * | `organizations` | `organization_id IN organizationIds`            | `group` — the caller's membership set (ADR-0105 D2); a SET: distinct, non-empty |
 * | `deny`          | the fail-closed sentinel (zero rows / refused)  | a walled posture on a tenant object with no organization scope to enforce with |
 *
 * ## Reading rules
 *
 * - A reader answers from the verdict ALONE. If the answer could be derived
 *   from anything else on the context, the mirror has not been deleted — it
 *   has been moved (the #15706 ruling, verbatim).
 * - The shape is `.strict()`. A recorded value that does not parse is JUNK; a
 *   reader treats junk as "no verdict", never as any organization — the
 *   failure direction that matters is a WRONG key, not a missing one.
 * - ABSENCE of a recorded verdict is a third state, distinct from `none`: the
 *   enforcement layer composed no wall on this operation at all (a system
 *   context, no security plugin mounted, an operation carrying no predicate).
 *   `none` is a wall that RAN and contributed nothing; absence is "nothing to
 *   vouch for". Both read as "not asserted" to a reader that needs one
 *   organization.
 * - `organizations` with exactly one member IS a wall that named exactly one
 *   organization. The set is deduplicated at the source and the schema refuses
 *   duplicates, so a reader may test `length === 1` and read no further.
 */

import { z } from 'zod';

/** One organization id as the wall spells it — never the empty string. */
const WallOrganizationIdSchema = z.string().min(1);

export const TenantLayer0VerdictSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('organization'),
      organizationId: WallOrganizationIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('organizations'),
      organizationIds: z
        .array(WallOrganizationIdSchema)
        .min(1)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: 'organizationIds is a SET: an organization the wall named appears once',
        })
        .readonly(),
    })
    .strict(),
  z.object({ kind: z.literal('deny') }).strict(),
]);
export type TenantLayer0Verdict = z.infer<typeof TenantLayer0VerdictSchema>;
