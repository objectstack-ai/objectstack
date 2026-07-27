// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D8] Scoped-invitation placement — issuance authorization + accept-time application.
 *
 * An invitation may carry PLACEMENT INTENT: the business unit the invitee
 * lands in and the positions they are assigned on acceptance. Two halves,
 * and they must ship together:
 *
 *   1. **Issuance is authorized** against the issuer's `adminScope`
 *      (ADR-0090 D12) — a delegated admin may only invite into their own
 *      subtree and only attach positions whose permission sets are in their
 *      allowlist. Without this the feature would be a privilege-escalation
 *      hole: `organization_admin` is deliberately READ-ONLY on the RBAC
 *      tables (`auto-org-admin-grant.ts`) precisely so a fresh org admin
 *      cannot rebind themselves, and a platform that applied an unchecked
 *      invitation payload under system context would hand that authority
 *      straight back through the invitation surface.
 *   2. **Acceptance applies it** — the `sys_user_position` rows land with the
 *      better-auth membership, so a plant admin's invitee arrives already in
 *      the right unit and role instead of waiting on a platform admin.
 *
 * The authorization check REUSES `DelegatedAdminGate` verbatim rather than
 * re-deriving subtree/allowlist logic: the issuance check is literally
 * "would this actor be allowed to write these `sys_user_position` rows?", so
 * it builds exactly that operation context and dry-runs the gate. Any future
 * tightening of the gate tightens invitations in the same commit — the two
 * can never drift, which is what ADR-0105 D8 means by "the existing
 * anti-escalation gate, reused verbatim".
 *
 * Registered by `SecurityPlugin` as the `invitation-placement` service.
 * plugin-auth's invitation hooks consume it and REFUSE placement intent when
 * it is absent (an embedding without plugin-security has no gate, so it gets
 * no placement — fail closed, never a silently unchecked assignment).
 */

import { resolveUserAuthzGrants } from '@objectstack/core';

const SYSTEM_CTX = { isSystem: true } as const;

/** The kernel service name plugin-auth probes. */
export const INVITATION_PLACEMENT_SERVICE = 'invitation-placement';

/** Placement intent carried on a `sys_invitation` row (ADR-0092 extension fields). */
export interface InvitationPlacementIntent {
  /** Target `sys_business_unit.id` the invitee is placed under. */
  businessUnitId: string;
  /** `sys_position.name` values assigned on acceptance. */
  positions: string[];
}

export interface InvitationPlacementService {
  /**
   * Authorize ISSUANCE. Throws (the gate's `PermissionDeniedError`) when the
   * actor may not place into this unit / with these positions.
   */
  assertIssuable(args: {
    intent: InvitationPlacementIntent;
    /**
     * The ISSUER's user id — authority is judged at issuance time, and the
     * grants behind it are resolved HERE (see below). A caller-supplied
     * context is deliberately not accepted: an invitation hook has no request
     * to resolve one from, and a hand-built one silently carries no grants.
     */
    actorUserId?: string | null;
    organizationId?: string | null;
  }): Promise<void>;

  /**
   * Apply placement for an accepted invitation. Idempotent: an assignment that
   * already exists is left alone, so a retried/replayed acceptance converges
   * instead of duplicating rows.
   */
  apply(args: {
    intent: InvitationPlacementIntent;
    userId: string;
    organizationId?: string | null;
    /** Issuer id, stamped as `granted_by` for the audit trail. */
    grantedBy?: string | null;
  }): Promise<{ created: number; skipped: number }>;
}

/**
 * Normalize placement intent off a raw `sys_invitation` row.
 *
 * `positions` round-trips as JSON through some drivers, so a string payload is
 * parsed. Returns `null` when the row carries no usable intent — an invitation
 * without placement is the ordinary case, not an error.
 */
export function readPlacementIntent(row: unknown): InvitationPlacementIntent | null {
  const r = (row ?? {}) as Record<string, unknown>;
  const buRaw = r.business_unit_id ?? r.businessUnitId;
  const businessUnitId = typeof buRaw === 'string' && buRaw !== '' ? buRaw : null;

  let posRaw: unknown = r.positions;
  if (typeof posRaw === 'string') {
    try {
      posRaw = JSON.parse(posRaw);
    } catch {
      // A bare, non-JSON string is a single position name.
      posRaw = [posRaw];
    }
  }
  const positions = Array.isArray(posRaw)
    ? posRaw.filter((p): p is string => typeof p === 'string' && p !== '')
    : [];

  if (!businessUnitId || positions.length === 0) return null;
  return { businessUnitId, positions };
}

export interface InvitationPlacementDeps {
  /** ObjectQL engine handle. */
  ql: any;
  /** The live `DelegatedAdminGate` (ADR-0090 D12). */
  gate: { assert(opCtx: unknown): Promise<void> };
  logger?: { info?: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void };
}

export function createInvitationPlacementService(
  deps: InvitationPlacementDeps,
): InvitationPlacementService {
  const { ql, gate, logger } = deps;

  /**
   * The `sys_user_position` rows this intent would create. Used BOTH as the
   * gate's dry-run payload and as the apply payload, so authorization and
   * effect are computed from one shape — an issuance check can never approve
   * something different from what acceptance writes.
   */
  const rowsFor = (
    intent: InvitationPlacementIntent,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown>[] =>
    intent.positions.map((position) => ({
      position,
      business_unit_id: intent.businessUnitId,
      ...extra,
    }));

  return {
    async assertIssuable({ intent, actorUserId, organizationId }) {
      // Resolve the issuer's REAL grants through the one authz resolver. The
      // gate judges authority from `context.positions` / `context.permissions`
      // (`resolvePermissionSetsForContext`), so a hand-built `{ userId,
      // tenantId }` resolves to the additive baseline and NOTHING else — every
      // delegate would be refused, and the feature would be fail-closed but
      // dead. There is no request here to resolve a context from, so we ask the
      // userId-driven half of the shared resolver for exactly the envelope a
      // transport would have carried.
      const userId = typeof actorUserId === 'string' && actorUserId !== '' ? actorUserId : null;
      const grants = userId
        ? await resolveUserAuthzGrants(ql, userId, {
            tenantId: organizationId ?? undefined,
          })
        : null;

      // Dry-run the REAL gate against the REAL operation shape. No user_id is
      // supplied — the invitee may not even have an account yet, and
      // `assertAssignmentWrite` judges the unit + the positions' bound sets,
      // never the target principal. A principal-less call passes an empty
      // context on purpose: the gate owns that refusal too, so there is exactly
      // one place an issuance can be denied.
      await gate.assert({
        object: 'sys_user_position',
        operation: 'insert',
        data: rowsFor(intent, organizationId ? { organization_id: organizationId } : {}),
        context: grants
          ? { ...grants, userId, ...(organizationId ? { tenantId: organizationId } : {}) }
          : {},
      });
    },

    async apply({ intent, userId, organizationId, grantedBy }) {
      let created = 0;
      let skipped = 0;
      for (const row of rowsFor(intent)) {
        const where: Record<string, unknown> = {
          user_id: userId,
          position: row.position,
          business_unit_id: row.business_unit_id,
        };
        if (organizationId) where.organization_id = organizationId;

        // Idempotence: the acceptance hook is failure-isolated and may be
        // replayed, so an already-placed invitee must converge, not duplicate.
        let existing: unknown;
        try {
          existing = await ql.findOne('sys_user_position', { where }, { context: SYSTEM_CTX });
        } catch {
          existing = undefined;
        }
        if (existing) {
          skipped++;
          continue;
        }

        await ql.insert(
          'sys_user_position',
          {
            user_id: userId,
            ...row,
            ...(organizationId ? { organization_id: organizationId } : {}),
            ...(grantedBy ? { granted_by: grantedBy } : {}),
          },
          { context: SYSTEM_CTX },
        );
        created++;
      }
      logger?.info?.('[security] invitation placement applied', {
        userId,
        businessUnitId: intent.businessUnitId,
        created,
        skipped,
      });
      return { created, skipped };
    },
  };
}
