// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auto-grant `organization_admin` to org owners/admins.
 *
 * For every `sys_member` row whose `role` contains `owner` or `admin`,
 * ensure a `sys_user_permission_set` row exists that links the user to
 * the `organization_admin` permission set scoped to that organization.
 * For members whose role no longer qualifies (demotion or membership
 * removal), revoke the matching scoped grant.
 *
 * Lifecycle hookup (wired from `security-plugin.ts`):
 *
 *   - after `sys_member` insert  → reconcile (user_id, organization_id)
 *   - after `sys_member` update  → reconcile both old and new owner pair
 *   - after `sys_member` delete  → reconcile to revoke
 *   - on  `kernel:ready`          → backfill across every existing member
 *
 * All operations are idempotent and failure-isolated so a missing
 * permission-set row, schema drift, or a stale row never blocks the
 * underlying `sys_member` mutation.
 *
 * **Why this isn't done by the better-auth org plugin directly:**
 * better-auth does not know about ObjectStack permission sets — it
 * only stores membership roles. Translating "owner/admin role on this
 * org" into "owns the `organization_admin` permission set scoped to
 * this org" is platform metadata policy and belongs here, alongside
 * `bootstrapPlatformAdmin` (which does the analogous thing for
 * platform admins).
 *
 * **Anti-escalation:** `organization_admin` itself (declared in
 * `platform-objects/src/security/default-permission-sets.ts`) is
 * deliberately read-only on the global RBAC tables
 * (`sys_permission_set`, `sys_user_permission_set`, `sys_position`, …),
 * so a freshly-granted org admin cannot rebind themselves to
 * `admin_full_access`.
 */

import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';

const SYSTEM_CTX = { isSystem: true } as const;

/**
 * [ADR-0105 D4] Which org-admin capability set this posture may auto-grant.
 *
 * `organization_admin` carries wildcard `viewAllRecords`/`modifyAllRecords`.
 * That is safe ONLY because Layer 0 bounds it to the caller's organization
 * scope. Under a wall-less posture nothing bounds it, and a deployment that
 * accumulates organizations turns every owner/admin into an environment-wide
 * superuser (finding F2) — so the auto-grant hands out the de-VAMA'd variant
 * there instead. Deliberate blanket visibility remains available through
 * `admin_full_access` or an explicitly authored set; it just stops being a side
 * effect of a better-auth membership role.
 *
 * [#12699] `suppressUnbounded` is the deployment's own veto on the walled
 * branch (`OrgScopingEntitlement.suppressUnboundedOrgAdminGrant`): D4's "Layer
 * 0 bounds it" rationale stops holding on a deployment that carves
 * platform-global objects OUT of the wall, so such a deployment declares that
 * arming a walled posture must NOT auto-grant the unbounded superbits — the
 * de-VAMA'd variant is granted on walled postures too. Fail closed: `false`/
 * absent keeps today's posture-keyed behaviour exactly.
 */
export function orgAdminSetNameForPosture(
  posture: TenancyPosture,
  suppressUnbounded = false,
): string {
  return postureEnforcesWall(posture) && !suppressUnbounded
    ? ORGANIZATION_ADMIN
    : ORGANIZATION_ADMIN_NO_BYPASS;
}

/**
 * The variant NOT granted under `posture` — reconciled away so a posture (or
 * [#12699] suppression) change converges on exactly one org-admin grant.
 */
function supersededOrgAdminSetName(posture: TenancyPosture, suppressUnbounded = false): string {
  return orgAdminSetNameForPosture(posture, suppressUnbounded) === ORGANIZATION_ADMIN
    ? ORGANIZATION_ADMIN_NO_BYPASS
    : ORGANIZATION_ADMIN;
}

interface MaybeLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn?: (message: string, meta?: Record<string, any>) => void;
  debug?: (message: string, meta?: Record<string, any>) => void;
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

/**
 * [#4640] The engine call shapes this module speaks, spelled out because
 * getting one wrong here is silent: every wrapper below swallows the throw,
 * so a call that no longer matches `ObjectQL`'s signature degrades into a
 * no-op that still reports "nothing to do".
 *
 * `packages/objectql/src/engine.ts` — the only signatures that exist:
 *
 *   find(object, query: EngineQueryOptions, options?: EngineReadOptions)
 *   insert(object, data, options?: DataEngineInsertOptions)
 *   delete(object, options?: EngineDeleteOptions)   ← TWO args; the row is
 *                                                     named by `where`, and
 *                                                     the context rides in
 *                                                     the same bag
 *
 * `delete` is the odd one out: reads and inserts take their execution context
 * in a THIRD argument, deletes take it in the second. A `delete(object, id,
 * ctx)` call therefore hands the id in as the option bag, where
 * `rejectUnknownEngineOptions` reads its character indices as unknown option
 * keys and throws — and drops the system context on the floor along the way.
 * That was this module's only revoke channel for its whole life (#4640).
 */

async function tryFind(ql: any, object: string, where: any, limit = 50, logger?: MaybeLogger): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : [];
  } catch (e) {
    // Reads legitimately fail before the tables exist (boot ordering), so this
    // is debug rather than warn — but it is no longer nothing (#4640).
    logger?.debug?.('[security] org-admin reconcile read failed — treated as no rows', {
      object,
      error: (e as Error)?.message,
    });
    return [];
  }
}

async function tryInsert(ql: any, object: string, data: any, logger?: MaybeLogger): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: SYSTEM_CTX });
  } catch (e) {
    logger?.warn?.('[security] org-admin grant insert failed — capability NOT granted', {
      object,
      error: (e as Error)?.message,
    });
    return null;
  }
}

async function tryDelete(ql: any, object: string, id: string, logger?: MaybeLogger): Promise<boolean> {
  try {
    await ql.delete(object, { where: { id }, context: SYSTEM_CTX });
    return true;
  } catch (e) {
    // [#4640] A failed revoke means a capability the platform decided to take
    // away is still in force — the one failure in this module that must never
    // be silent, whatever the caller does with the `false`.
    logger?.warn?.('[security] org-admin grant revoke FAILED — capability still in force', {
      object,
      id,
      error: (e as Error)?.message,
    });
    return false;
  }
}

/**
 * Parse a better-auth `sys_member.role` value into a lower-cased role
 * list. better-auth stores either a single role (`"owner"`) or a
 * comma-separated list (`"owner,admin"`).
 */
function parseRoles(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function isAdminRole(raw: unknown): boolean {
  const roles = parseRoles(raw);
  return roles.includes('owner') || roles.includes('admin');
}

/**
 * [#4586] Machine-provenance marker for rows this module writes.
 *
 * The auto-grant is the second hop of the elevation chain
 * (`sys_member.role` → here → `sys_user_permission_set` → `isTenantAdmin()`),
 * and it is the hop with no human in it: no operator ever asked for THIS row,
 * a membership grade did. Stamping that fact in a stable, greppable prefix is
 * what lets "why is X a tenant admin" be answered from the data — the row says
 * which writer minted it and which membership triggered it, so the chain is
 * followable instead of inferred.
 */
export const AUTO_ORG_ADMIN_GRANT_REASON_PREFIX = 'auto-org-admin-grant';

/**
 * The `reason` text for an auto-granted org-admin row: the machine marker, the
 * `sys_member` row that triggered it, and the grade that qualified.
 *
 * Deliberately NOT in `granted_by`: that column is a `sys_user` lookup, and
 * ADR-0118 D1 admits exactly two values there — a real user id, or `null` for
 * "the system did this". A marker string in a lookup column is the sentinel
 * that ADR forbids (it breaks the join and forces every reader to special-case
 * it). The repo's own vocabulary already splits these roles —
 * `validate-security-posture` states it as "granted_by = writer,
 * delegated_from = authority source, reason = why" — so the human goes to
 * `granted_by` and the why goes here.
 */
export function autoOrgAdminGrantReason(
  member: { id?: unknown; role?: unknown } | undefined,
  setName: string,
): string {
  const memberId = typeof member?.id === 'string' || typeof member?.id === 'number'
    ? String(member.id)
    : '';
  const role = parseRoles(member?.role).join(',');
  return (
    `${AUTO_ORG_ADMIN_GRANT_REASON_PREFIX}: granted from membership grade` +
    (role ? ` '${role}'` : '') +
    (memberId ? ` (sys_member ${memberId})` : '') +
    ` → ${setName}`
  );
}

/**
 * Resolve the `sys_permission_set.id` for `organization_admin`. Cached
 * across calls per ObjectQL instance via a WeakMap so repeated
 * reconciliations do not re-query.
 */
const permissionSetIdCache = new WeakMap<object, Map<string, string>>();

async function resolvePermissionSetId(
  ql: any,
  name: string,
  logger?: MaybeLogger,
): Promise<string | null> {
  let perQl = permissionSetIdCache.get(ql);
  if (!perQl) {
    perQl = new Map<string, string>();
    permissionSetIdCache.set(ql, perQl);
  }
  const cached = perQl.get(name);
  if (cached) return cached;
  const rows = await tryFind(ql, 'sys_permission_set', { name }, 1, logger);
  const id = rows[0]?.id;
  if (typeof id === 'string' && id.length > 0) {
    perQl.set(name, id);
    return id;
  }
  return null;
}

/**
 * Ensure (or revoke) the org-scoped `organization_admin` grant for
 * `(userId, orgId)` based on the current `sys_member` rows.
 *
 * - If ANY membership row for the pair carries an owner/admin role,
 *   ensure exactly one `sys_user_permission_set` row exists.
 * - Else, remove every `sys_user_permission_set` row that links the
 *   pair to `organization_admin` (handles demotion and membership
 *   removal symmetrically).
 *
 * Returns a structured report for observability. Never throws.
 */
export async function reconcileOrgAdminGrant(
  ql: any,
  userId: string,
  orgId: string,
  options: {
    logger?: MaybeLogger;
    posture?: TenancyPosture;
    /**
     * [#4586] The human the TRIGGERING `sys_member` write was attributed to
     * (`ExecutionContext.attributedUserId`), stamped into `granted_by` so the
     * grant names the admin who caused it rather than nobody. Attribution
     * only: this reconciler's own writes stay `SYSTEM_CTX`, and nothing here
     * authorizes against this value. Absent — the kernel:ready backfill, a
     * boot-time bind, any machine-originated grade change — leaves
     * `granted_by: null`, the platform's one representation for "the system
     * did this" (ADR-0118 D1).
     */
    attributedUserId?: string;
    /**
     * [#12699] The deployment's `OrgScopingEntitlement.suppressUnboundedOrgAdminGrant`
     * declaration, threaded by the caller (SecurityPlugin reads it live off the
     * `org-scoping` service). Default `false` — today's behaviour exactly.
     */
    suppressUnboundedOrgAdminGrant?: boolean;
  } = {},
): Promise<{
  action: 'granted' | 'revoked' | 'noop' | 'skipped';
  reason?: string;
}> {
  const logger = options.logger;
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { action: 'skipped', reason: 'objectql_unavailable' };
  }
  if (!userId || !orgId) {
    return { action: 'skipped', reason: 'missing_keys' };
  }

  // [ADR-0105 D4] The posture decides WHICH org-admin set is granted. Default
  // `single` (the wall-less, conservative choice) when a caller does not supply
  // one: an unknown posture must not hand out unbounded superuser bits.
  const posture: TenancyPosture = options.posture ?? 'single';
  const suppressUnbounded = options.suppressUnboundedOrgAdminGrant === true;
  const grantSetName = orgAdminSetNameForPosture(posture, suppressUnbounded);
  const supersededSetName = supersededOrgAdminSetName(posture, suppressUnbounded);

  const permSetId = await resolvePermissionSetId(ql, grantSetName, logger);
  if (!permSetId) {
    // The permission set isn't seeded yet (boot ordering) — caller can retry
    // later (e.g. via kernel:ready backfill).
    return { action: 'skipped', reason: 'permission_set_missing' };
  }

  // 1. Determine whether the user currently holds an admin-grade role
  //    in this org. Better-auth allows multiple membership rows per
  //    pair under some edge cases (legacy data) — any qualifying row
  //    is enough.
  const memberships = await tryFind(
    ql,
    'sys_member',
    { user_id: userId, organization_id: orgId },
    10,
    logger,
  );
  // The row that QUALIFIES is also the row the grant is provenance-linked to
  // (#4586) — "this capability exists because of that membership".
  const qualifyingMembership = memberships.find((m: any) => isAdminRole(m?.role));
  const shouldGrant = qualifyingMembership !== undefined;

  // 1b. [ADR-0105 D4] Revoke the OTHER variant for this pair, always. A posture
  //     change (or a downgrade after F2) must converge on exactly one org-admin
  //     grant; leaving the superseded row would keep the old bits in force.
  const supersededSetId = await resolvePermissionSetId(ql, supersededSetName, logger);
  if (supersededSetId) {
    const stale = await tryFind(
      ql,
      'sys_user_permission_set',
      { user_id: userId, organization_id: orgId, permission_set_id: supersededSetId },
      5,
      logger,
    );
    for (const row of stale) {
      if (row?.id && (await tryDelete(ql, 'sys_user_permission_set', String(row.id), logger))) {
        logger?.info?.('[security] revoked superseded org-admin grant', {
          userId,
          orgId,
          set: supersededSetName,
          posture,
        });
      }
    }
  }

  // 2. Look at existing grants for this exact pair.
  const existingGrants = await tryFind(
    ql,
    'sys_user_permission_set',
    { user_id: userId, organization_id: orgId, permission_set_id: permSetId },
    5,
    logger,
  );

  if (shouldGrant) {
    if (existingGrants.length > 0) {
      // Deduplicate stale duplicates if any slipped through.
      for (const extra of existingGrants.slice(1)) {
        if (extra?.id) await tryDelete(ql, 'sys_user_permission_set', String(extra.id), logger);
      }
      return { action: 'noop' };
    }
    const created = await tryInsert(
      ql,
      'sys_user_permission_set',
      {
        id: genId('ups'),
        user_id: userId,
        permission_set_id: permSetId,
        organization_id: orgId,
        // [#4586] The provenance the row already had a column for. `granted_by`
        // is a `sys_user` lookup: the human whose better-auth call triggered the
        // grade change when one was in scope, else `null` = the system (ADR-0118
        // D1 — an id or null, never a sentinel). The machine marker and the
        // triggering membership row live in `reason`, where free text belongs.
        granted_by: options.attributedUserId ?? null,
        reason: autoOrgAdminGrantReason(qualifyingMembership, grantSetName),
      },
      logger,
    );
    if (created) {
      logger?.info?.('[security] granted org-admin capability', {
        userId,
        orgId,
        set: grantSetName,
        posture,
        grantedBy: options.attributedUserId ?? null,
      });
      return { action: 'granted' };
    }
    return { action: 'skipped', reason: 'insert_failed' };
  }

  // shouldGrant === false → revoke any pre-existing scoped grant.
  if (existingGrants.length === 0) {
    return { action: 'noop' };
  }
  let removed = 0;
  for (const row of existingGrants) {
    if (row?.id && (await tryDelete(ql, 'sys_user_permission_set', String(row.id), logger))) {
      removed += 1;
    }
  }
  if (removed > 0) {
    logger?.info?.('[security] revoked org-admin capability', {
      userId,
      orgId,
      set: grantSetName,
      removed,
    });
    return { action: 'revoked' };
  }
  // [#4640] Rows were found and none could be removed: the user keeps an
  // org-admin capability the platform just decided they should not have. The
  // `skipped` return already said so; nothing was reading it, which is how the
  // broken call shape survived — so say it out loud as well.
  logger?.warn?.('[security] org-admin capability could NOT be revoked — grant rows remain', {
    userId,
    orgId,
    set: grantSetName,
    remaining: existingGrants.length,
  });
  return { action: 'skipped', reason: 'delete_failed' };
}

/**
 * Reconcile every `(user_id, organization_id)` pair that has at least
 * one `sys_member` row. Used by `kernel:ready` to backfill grants for
 * memberships that pre-date this feature, and as a safety net after
 * the platform admin bootstrap auto-creates the default organization.
 */
export async function backfillOrgAdminGrants(
  ql: any,
  options: {
    logger?: MaybeLogger;
    limit?: number;
    posture?: TenancyPosture;
    /** [#12699] See {@link reconcileOrgAdminGrant}'s option of the same name. */
    suppressUnboundedOrgAdminGrant?: boolean;
  } = {},
): Promise<{ scanned: number; granted: number; revoked: number; skipped: number }> {
  const logger = options.logger;
  const limit = options.limit ?? 5000;
  const posture: TenancyPosture = options.posture ?? 'single';
  const suppressUnbounded = options.suppressUnboundedOrgAdminGrant === true;
  const summary = { scanned: 0, granted: 0, revoked: 0, skipped: 0 };
  if (!ql || typeof ql.find !== 'function') return summary;

  const permSetId = await resolvePermissionSetId(
    ql,
    orgAdminSetNameForPosture(posture, suppressUnbounded),
    logger,
  );
  if (!permSetId) {
    logger?.debug?.('[security] org-admin backfill skipped — permission set missing');
    return summary;
  }
  // [ADR-0105 D4] The orphan sweep below must see BOTH variants: a boot that
  // changed posture leaves grants of the superseded set behind, and those are
  // exactly the rows whose bits must stop applying.
  const supersededId = await resolvePermissionSetId(
    ql,
    supersededOrgAdminSetName(posture, suppressUnbounded),
    logger,
  );

  const members = await tryFind(ql, 'sys_member', {}, limit, logger);
  // De-duplicate by (user_id, organization_id) pair — a user with two
  // membership rows (e.g. legacy duplicates) only needs one reconcile.
  const seen = new Set<string>();
  for (const m of members) {
    const userId = String(m?.user_id ?? '');
    const orgId = String(m?.organization_id ?? '');
    if (!userId || !orgId) continue;
    const key = `${userId}|${orgId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    summary.scanned += 1;
    const res = await reconcileOrgAdminGrant(ql, userId, orgId, {
      logger,
      posture,
      suppressUnboundedOrgAdminGrant: suppressUnbounded,
    });
    if (res.action === 'granted') summary.granted += 1;
    else if (res.action === 'revoked') summary.revoked += 1;
    else if (res.action === 'skipped') summary.skipped += 1;
  }

  // Also revoke any organization_admin grant pointing at a (user, org)
  // pair with NO membership row left (orphaned grants from deletes
  // that fired before this hook existed).
  const grantSetIds = [permSetId, supersededId].filter(Boolean) as string[];
  const allGrants = await tryFind(
    ql,
    'sys_user_permission_set',
    { permission_set_id: { $in: grantSetIds } },
    limit,
    logger,
  );
  for (const g of allGrants) {
    const userId = String(g?.user_id ?? '');
    const orgId = String(g?.organization_id ?? '');
    if (!userId || !orgId) continue;
    const key = `${userId}|${orgId}`;
    if (seen.has(key)) continue;
    const res = await reconcileOrgAdminGrant(ql, userId, orgId, {
      logger,
      posture,
      suppressUnboundedOrgAdminGrant: suppressUnbounded,
    });
    if (res.action === 'revoked') summary.revoked += 1;
  }

  logger?.info?.('[security] org-admin grant backfill complete', { ...summary, posture });
  return summary;
}

/**
 * Extract (user_id, organization_id) candidate pairs from a
 * `sys_member` ObjectQL middleware context. Returns both the
 * pre-change and post-change pair so callers can reconcile each.
 */
export function extractMemberPairs(opCtx: any): Array<{ userId: string; orgId: string }> {
  const out = new Map<string, { userId: string; orgId: string }>();
  const add = (userId: unknown, orgId: unknown) => {
    if (typeof userId === 'string' && typeof orgId === 'string' && userId && orgId) {
      out.set(`${userId}|${orgId}`, { userId, orgId });
    }
  };
  // Post-write payload — most common case.
  add(opCtx?.result?.user_id, opCtx?.result?.organization_id);
  // Update payloads carry the new values in `data` and the prior row
  // in `before` (driver-dependent). We reconcile BOTH so a member
  // moved from org A to org B (or user changed) is handled.
  add(opCtx?.data?.user_id, opCtx?.data?.organization_id);
  add(opCtx?.before?.user_id, opCtx?.before?.organization_id);
  // For deletes the affected row is sometimes only in `existing`.
  add(opCtx?.existing?.user_id, opCtx?.existing?.organization_id);
  return Array.from(out.values());
}
