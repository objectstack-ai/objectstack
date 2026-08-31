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
 * [#11670] The `organization_admin` row a grant points at is resolved PER
 * ORGANIZATION under a walled posture — see {@link resolvePermissionSetId} for
 * why an unscoped, name-only, process-cached resolution answered with a row
 * nobody chose, and for the no-own-row decision that scoping forces.
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
// [#11670] The per-organization catalog's own vocabulary — the governed
// spelling of "which row is THIS organization's", the context a scoped
// catalog read runs under, and the posture split that decides whether the
// question applies at all. Same package, so this adds no dependency edge; a
// second local spelling of that question is exactly the shape that produced the
// defect this repair closes.
import {
  catalogIsPerOrganization,
  resolveOwnOrganizationRow,
  seedCtx,
  SEED_ORGANIZATION_SCAN_LIMIT,
} from './per-organization-catalog.js';

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

async function tryFind(
  ql: any,
  object: string,
  where: any,
  limit = 50,
  logger?: MaybeLogger,
  /**
   * [#11670] The execution context the read runs under. Defaults to
   * {@link SYSTEM_CTX} — the installation-wide question every read in this
   * module used to ask. A catalog read passes `seedCtx(organizationId)` instead,
   * which routes it through `SqlDriver.applyTenantScope` (the governed
   * chokepoint) rather than re-implementing a wall predicate here.
   */
  context: { isSystem: true; tenantId?: string } = SYSTEM_CTX,
): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context });
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
 * Per-ObjectQL-instance memo for {@link resolvePermissionSetId}.
 *
 * [#11670] `ids` is keyed on `(organizationId, name)`, not on `name`. A cache
 * keyed on the name alone made the first organization reconciled in a process
 * decide the row every later organization got — the property no per-call
 * scoping can repair, because the second organization never reaches the read.
 *
 * `refusalReported` keeps the no-own-row warning to once per key per instance:
 * the backfill walks every membership pair, and a per-pair warning would bury
 * the line it exists to surface.
 */
interface PermissionSetIdCacheEntry {
  ids: Map<string, string>;
  refusalReported: Set<string>;
}

const permissionSetIdCache = new WeakMap<object, PermissionSetIdCacheEntry>();

/**
 * `(organizationId, name)` as one string, spelled so no organization id can
 * collide with a name boundary (`JSON.stringify` of the pair is injective over
 * `[string | null, string]`; a delimiter is not).
 */
function permissionSetCacheKey(name: string, organizationId?: string): string {
  return JSON.stringify([organizationId ?? null, name]);
}

/**
 * Resolve the `sys_permission_set.id` an org-admin grant points at: THIS
 * organization's own row under a walled posture, the installation's single row
 * under `single`.
 *
 * ## [#11670] Why the read is threaded with the organization
 *
 * Post-#10103 the RBAC catalog is materialized PER ORGANIZATION, and
 * `sys_permission_set.name` is unique per organization (ADR-0120 D3,
 * `COALESCE(organization_id, '__global__')`). One name therefore carries a row
 * per organization PLUS the organization-less platform-bucket row
 * `bootstrapPlatformAdmin` mints on every boot — measured on a fresh walled rig
 * as 8 rows written 1.3 s BEFORE the first `sys_organization` exists (#11532),
 * which makes the organization-less row the OLDEST one bearing the name.
 *
 * This read used to be name-only, `limit: 1`, and cached on the name alone.
 * Each looks defensible; together they answer with a row nobody chose. An
 * unscoped `limit: 1` read has no reason to prefer any particular row, and the
 * grant target is a FOREIGN KEY — so a walled deployment ends up with
 * `sys_user_permission_set` rows pointing at a permission set that belongs to
 * no organization, or to a different one. It stays invisible because
 * `resolve-authz-context` resolves permission sets BY ID without tenant
 * scoping, so the grant still evaluates.
 *
 * The repair is to ask the governed question instead: thread the organization
 * (the read routes through `SqlDriver.applyTenantScope`, the chokepoint) and
 * let {@link resolveOwnOrganizationRow} — "the one read that distinguishes
 * 'this organization has its row' from 'somebody's organization-less row is
 * visible here'" — pick the row. The cache key moves with it.
 *
 * Under `single` nothing is threaded, the read is the unscoped `limit: 1` it
 * always was, and `resolveOwnOrganizationRow` returns the first row: the
 * carve-out is byte-identical, which is what the posture-invariance pin
 * measures.
 *
 * ## The no-own-row decision — a refusal, not a fallback
 *
 * Routing through the governed read forces an answer to: what does a walled rig
 * do when the granting organization has no own row of that name? This returns
 * `null` — the module's existing "not seeded yet" no-op — and never falls back
 * to the organization-less row it can see. In order:
 *
 *  1. a fallback keeps MINTING grants that point at the platform bucket. The
 *     reap of that bucket is gated on this repair precisely because a live
 *     producer makes its census unclosable — falling back would leave the
 *     producer producing;
 *  2. a fallback row is never repaired afterwards. Once the organization's own
 *     row appears, the reconciler looks for a grant carrying THAT id, finds
 *     none, and inserts a second one — the dedup in the caller only collapses
 *     duplicates sharing a `permission_set_id`. So a fallback manufactures
 *     permanent duplicate grants across two set ids;
 *  3. the state it declines to act in is one where the organization has no
 *     catalog AT ALL — its own positions, permission sets and sharing rules are
 *     equally missing — which the catalog seeding already warns about and
 *     retries, on organization creation and on every boot sweep.
 *
 * ⚠️ The refusal is confined to the GRANT direction, and that is what keeps it
 * from being a loosening. Revocation does not consult this resolver: it matches
 * every copy of the name ({@link resolvePermissionSetIdsForName}), so a pair
 * that must lose the capability still loses it in exactly this state. Both
 * directions fail closed — nothing new is granted against a row that belongs to
 * no organization, and nothing standing escapes a revoke.
 *
 * ⚠️ And it is LOUD. The organization-less row is visible to the scoped read,
 * so an operator would otherwise see a plausible row and a missing grant at the
 * same time with nothing connecting them. The caller returns
 * `{ action: 'skipped', reason: 'permission_set_missing' }` — the value it
 * already returned for the boot-ordering case, so no consumer has to learn a
 * new one — and the next `sys_member` write and the `kernel:ready` backfill
 * retry it.
 *
 * ⛔ Grants that ALREADY point at an organization-less row are not repaired
 * here and nothing in this module claims they are: this makes new resolutions
 * correct. Counting and repairing the existing ones is the reap card's census.
 */
async function resolvePermissionSetId(
  ql: any,
  name: string,
  /**
   * The granting organization, under a posture whose catalog is materialized
   * per organization. `undefined` is the `single`-posture carve-out — the one
   * deployment shape where an organization-less row IS the row — and never a
   * fallback for "we could not work out the organization".
   */
  organizationId: string | undefined,
  logger?: MaybeLogger,
): Promise<string | null> {
  let perQl = permissionSetIdCache.get(ql);
  if (!perQl) {
    perQl = { ids: new Map<string, string>(), refusalReported: new Set<string>() };
    permissionSetIdCache.set(ql, perQl);
  }
  const key = permissionSetCacheKey(name, organizationId);
  const cached = perQl.ids.get(key);
  if (cached) return cached;
  // Limit 5, not 1, when scoped: a scoped read returns this organization's own
  // rows AND organization-less ones through the driver's compatibility arm, so
  // one row would be whichever the driver ordered first — the same spelling
  // `seed-name-lookup.ts` and `bootstrap-declared-permissions.ts` use (#10103).
  const rows = await tryFind(
    ql,
    'sys_permission_set',
    { name },
    organizationId ? 5 : 1,
    logger,
    seedCtx(organizationId),
  );
  const { own, organizationLessResidue } = resolveOwnOrganizationRow(rows, organizationId);
  const id = own?.id;
  if (typeof id === 'string' && id.length > 0) {
    // Only an OWN row is memoized. A miss is re-asked on the next reconcile
    // because it is a state the catalog seeding is actively repairing, and a
    // process-lifetime cache over a transient answer is the third of the three
    // properties this repair exists to remove.
    perQl.ids.set(key, id);
    return id;
  }
  if (organizationId && organizationLessResidue && !perQl.refusalReported.has(key)) {
    perQl.refusalReported.add(key);
    logger?.warn?.(
      `[security] no org-admin capability can be GRANTED for this organization: it has no own ` +
        `${name} permission set. The organization-less row that IS visible here is deliberately not ` +
        `used as a grant target — a grant pointing at it belongs to no organization, and under a ` +
        `walled posture that is invalid state rather than a platform-wide default. Revocation is ` +
        `unaffected and still matches every copy of the name, so nobody keeps a capability the ` +
        `platform decided to take away; standing grants are otherwise left exactly as they are. ` +
        `Remedy: seed this organization's RBAC catalog — it is created on organization creation and ` +
        `on every boot sweep, so a missing copy means that pass failed or has not run yet, and its ` +
        `own warning names why.`,
      {
        object: 'sys_permission_set',
        name,
        organization: organizationId,
        organizationLessRowId: organizationLessResidue?.id ?? null,
      },
    );
  }
  return null;
}

/**
 * [#11670] Rows a REVOKE is willing to hold for ONE org-admin set name under a
 * walled posture: one per organization the catalog sweep covers, plus the
 * organization-less platform-bucket row.
 *
 * A BUDGET rather than a bound — nothing caps rows-per-name, since the name is
 * unique per organization (ADR-0120 D3). Exceeding it is therefore DETECTED and
 * reported rather than silently truncated: a grant pointing at a row past the
 * budget is a grant no revoke here can reach.
 */
const ORG_ADMIN_SET_COPY_SCAN_LIMIT = SEED_ORGANIZATION_SCAN_LIMIT + 1;

/**
 * EVERY `sys_permission_set.id` bearing `name`, across the installation.
 *
 * ## [#11670] Resolve NARROW to grant, WIDE to revoke
 *
 * The scoped resolution above answers "which row may a NEW grant point at",
 * and it must be narrow: exactly this organization's own row. This one answers
 * a different question — "which rows does a standing grant of that name point
 * at" — and it must be WIDE, because the platform does not get to choose which
 * copy an already-written foreign key names.
 *
 * Making the grant target narrower without widening the revoke reach is a
 * PERMISSION LOOSENING, which is why the two ship together:
 *
 *  - a demoted admin whose grant was written before this repair points at the
 *    organization-less row. A demotion matched only against this
 *    organization's own id would not find it, and the capability the platform
 *    just decided to take away would stay in force;
 *  - the ADR-0105 D4 F2 close-out — a deployment that drops its wall must not
 *    leave the unbounded `organization_admin` grant standing — converges by
 *    revoking the SUPERSEDED variant for the pair. Across a posture flip the
 *    standing grant and the newly-resolved id are copies from different
 *    postures, so a narrow match converges on nothing;
 *  - the backfill's orphan sweep asks the installation-wide question by
 *    construction (it scans every membership and every org-admin grant), so a
 *    single id would match no per-organization grant at all.
 *
 * ⛔ Wide to REVOKE only. Nothing here re-points, adopts or deletes a
 * mis-targeted grant row belonging to someone who still qualifies — that census
 * is the reap card's, not this one's.
 *
 * ## Why this one is NOT posture-keyed, when everything else here is
 *
 * The `single` carve-out governs the grant TARGET — under `single` the
 * organization-less row is the row, and nothing is threaded. It cannot govern
 * the revoke reach, because the rows a revoke has to reach were written by the
 * OTHER posture: the F2 close-out is precisely the deployment that DROPS its
 * wall, and every grant standing at that moment names a per-organization copy
 * the wall-less resolution can no longer see. A revoke narrowed to `single`'s
 * own row converges on nothing and leaves the unbounded `organization_admin`
 * bits in force on a deployment with nothing left to bound them — F2 exactly.
 *
 * So the rule is uniform and easy to state: the grant target is posture-scoped,
 * the revoke reach never is. The cost is measured and small: under `single` the
 * revoke legs read `limit: {@link ORG_ADMIN_SET_COPY_SCAN_LIMIT}` with an `$in`
 * where they used to read `limit: 1` with a scalar. The unscoped ANSWER — which
 * row a `single` deployment grants — is untouched, and no read on any `single`
 * path carries a `tenantId`.
 */
async function resolvePermissionSetIdsForName(
  ql: any,
  name: string,
  logger?: MaybeLogger,
): Promise<string[]> {
  const limit = ORG_ADMIN_SET_COPY_SCAN_LIMIT;
  const rows = await tryFind(ql, 'sys_permission_set', { name }, limit, logger);
  if (rows.length >= limit) {
    logger?.warn?.(
      '[security] the org-admin permission-set scan hit its bound — a grant pointing at a row past ' +
        'it is NOT reached by this revoke; the next boot sweep asks again',
      { object: 'sys_permission_set', name, limit },
    );
  }
  const ids: string[] = [];
  for (const row of rows) {
    const id = row?.id;
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
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

  // [#11670] WHICH organization's copy of the set this grant points at. The
  // posture decides whether the question exists at all, in the catalog's own
  // spelling: under `single` there is one organization-less row and threading
  // an organization would ask a question that deployment shape cannot answer,
  // so the carve-out is `undefined` — the same split `catalogIsPerOrganization`
  // makes for the seeders, never a second local one.
  const catalogOrganizationId = catalogIsPerOrganization(posture) ? orgId : undefined;

  const permSetId = await resolvePermissionSetId(ql, grantSetName, catalogOrganizationId, logger);
  if (!permSetId && !catalogOrganizationId) {
    // The permission set isn't seeded yet (boot ordering) — caller can retry
    // later (e.g. via kernel:ready backfill).
    //
    // [#11670] `single` keeps returning HERE: with one organization-less row per
    // name, "no row" also means no standing grant can point at one, so there is
    // nothing to revoke either and the early return is the whole answer —
    // byte-identical to before this repair.
    //
    // A walled posture does NOT return here, because the two halves come apart:
    // "this organization has no own row to point a NEW grant at" says nothing
    // about the grants already standing for this pair. Returning here would
    // make a demotion a no-op for exactly the rows this repair is about — a
    // capability the platform decided to take away, left in force. So the
    // revoke legs below run on their own ids, and the grant leg is the one that
    // declines (see `resolvePermissionSetId`).
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
  //
  // [#11670] Matched against EVERY copy of the superseded name, not just this
  // organization's own. The standing grant this leg exists to remove was
  // written under the OTHER posture (or before this repair), so it points at
  // whichever copy that posture resolved — a narrow match would converge on
  // nothing and leave the superseded bits in force, which is the F2 outcome
  // this leg is the close-out for.
  const supersededSetIds = await resolvePermissionSetIdsForName(ql, supersededSetName, logger);
  if (supersededSetIds.length > 0) {
    const stale = await tryFind(
      ql,
      'sys_user_permission_set',
      {
        user_id: userId,
        organization_id: orgId,
        permission_set_id: { $in: supersededSetIds },
      },
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
  //
  // [#11670] The two branches ask DIFFERENT questions of the same table, and
  // the read moved inside them because of it. Granting asks "does a grant
  // already point at the row I would create" — narrow, this organization's own
  // id. Revoking asks "does this pair hold ANY grant of that name" — wide,
  // every copy. Under `single` both spell the same scalar predicate against the
  // same single id, in the same position, so the carve-out issues exactly the
  // reads it issued before.
  if (shouldGrant) {
    if (!permSetId) {
      // Walled only (the `single` early return above already fired). The
      // organization has no own row to point a NEW grant at, and the
      // organization-less row that IS visible is deliberately not a grant
      // target — `resolvePermissionSetId` has already said so loudly. Nothing
      // is granted; the superseded leg above still ran, so nothing that should
      // lose the capability keeps it.
      return { action: 'skipped', reason: 'permission_set_missing' };
    }
    const existingGrants = await tryFind(
      ql,
      'sys_user_permission_set',
      { user_id: userId, organization_id: orgId, permission_set_id: permSetId },
      5,
      logger,
    );
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
  //
  // [#11670] Every copy of the granted name, not just this organization's own:
  // a grant written before this repair points at the organization-less row, and
  // a demotion that could not see it would leave the capability in force. ⛔ It
  // revokes; it never re-points or adopts a row for someone who still
  // qualifies.
  const revocableSetIds = await resolvePermissionSetIdsForName(ql, grantSetName, logger);
  const existingGrants =
    revocableSetIds.length > 0
      ? await tryFind(
          ql,
          'sys_user_permission_set',
          {
            user_id: userId,
            organization_id: orgId,
            permission_set_id: { $in: revocableSetIds },
          },
          5,
          logger,
        )
      : [];
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

  // [#11670] The sweep is installation-wide by construction — it scans every
  // `sys_member` row and every org-admin grant, across organizations — so its
  // set ids are resolved installation-wide too, one per organization holding a
  // copy. The PER-PAIR answer is not taken from here: `reconcileOrgAdminGrant`
  // resolves its own organization's row below, which is the scoping this repair
  // is about. The gate is unchanged: no row anywhere for the GRANTED name means
  // the catalog has not been seeded at all yet.
  const permSetIds = await resolvePermissionSetIdsForName(
    ql,
    orgAdminSetNameForPosture(posture, suppressUnbounded),
    logger,
  );
  if (permSetIds.length === 0) {
    logger?.debug?.('[security] org-admin backfill skipped — permission set missing');
    return summary;
  }
  // [ADR-0105 D4] The orphan sweep below must see BOTH variants: a boot that
  // changed posture leaves grants of the superseded set behind, and those are
  // exactly the rows whose bits must stop applying.
  const supersededIds = await resolvePermissionSetIdsForName(
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
  const grantSetIds = [...permSetIds, ...supersededIds];
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
