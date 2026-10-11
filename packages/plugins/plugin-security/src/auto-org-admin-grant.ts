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
 * [ADR-0131 D4] A grant names `organization_admin` (or its no-bypass
 * variant) by NAME, and the set is the security catalog's definition of it
 * (D3): no `sys_permission_set` row is read to write a grant, and none needs
 * to exist. The legacy row ids are read only to REVOKE a grant written before
 * the name column existed ({@link resolvePermissionSetIdsForName}).
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
import { securityCatalogReaderOf } from '@objectstack/core';
// [#11670] The per-organization catalog's scan budget, which the legacy
// revoke reach below sizes itself by.
import { SEED_ORGANIZATION_SCAN_LIMIT } from './organization-scope.js';
import { GRANT_SET_ID_FIELD, GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-permission-set-name.js';

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
 * 0 bounds it" rationale stops holding on a deployment that declares objects
 * platform-global (ADR-0131 D7: they carry no organization column there, so no
 * wall bounds them), so such a deployment declares that
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
  /**
   * [#9754] NON-optional, and it is the `error?` member below that makes it so.
   * An optional `error` with no declared alternative is a contract that permits
   * silence: a value of this type could carry no channel at all, and the
   * durability report this module owes — a standing capability withdrawn, or a
   * revoke that did not land — would have nowhere to go. `warn` is the level a
   * durability degradation degrades TO and no further (AGENTS.md, "Degradation
   * log levels"), so it is the one that must exist in every value of the type.
   * ⛔ Not solved by requiring `error` instead (hosts legitimately inject
   * reduced sinks), and ⛔ not by requiring `info`: a lost write reported at
   * `info` reads as normal operation.
   */
  warn: (message: string, meta?: Record<string, any>) => void;
  debug?: (message: string, meta?: Record<string, any>) => void;
  /**
   * [#15840] The level the ruling names for the one read whose un-answered
   * value would otherwise DESTROY standing state. Optional like its siblings:
   * this is an input the caller supplies, not a channel this module publishes.
   *
   * ⚠️ Three parameters, not two: the platform `Logger` contract
   * (`packages/spec/src/contracts/logger.ts`) takes the `Error` in its OWN
   * second argument at this level and only this level. Declaring the sibling
   * `(message, meta)` shape here would make the real `ctx.logger` unassignable
   * — measured, as three TS2322s in `security-plugin.ts`.
   */
  error?: (message: string, error?: Error, meta?: Record<string, any>) => void;
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
   * module asks.
   */
  context: { isSystem: true; tenantId?: string } = SYSTEM_CTX,
): Promise<any[]> {
  const answer = await readRows(ql, object, where, limit, context);
  if (answer.answered) return answer.rows;
  if (answer.why === 'threw') {
    // Reads legitimately fail before the tables exist (boot ordering), so this
    // is debug rather than warn — but it is no longer nothing (#4640).
    logger?.debug?.('[security] org-admin reconcile read failed — treated as no rows', {
      object,
      error: (answer.error as Error)?.message,
    });
  }
  return [];
}

/**
 * [#15840] What `tryFind` above throws away: WHETHER THE READ ANSWERED.
 *
 * `tryFind` maps both "the store answered nothing" and "the store did not
 * answer" onto the same `[]`. For most of this module's reads that is a
 * defensible best-effort contract — a missing answer means a grant is not
 * created, and the next boot sweep asks again. For exactly one read it is not:
 * the `sys_member` read that decides {@link reconcileOrgAdminGrant}'s
 * `shouldGrant`. There, `[]` means "this user is not an admin of this org",
 * which is the input to a DELETE — so an un-answered read withdraws a standing
 * capability, and the store keeps it withdrawn after the fault clears.
 *
 * This is the read-seam invention rule in AGENTS.md, and #15840's ruling
 * (decision batch #105 item 5, option A) is per-site, ⛔ NOT a uniform sweep:
 * only the caller that turns the value into a revoke asks this question. Every
 * other caller keeps going through `tryFind` and behaves exactly as it did.
 *
 * A non-array answer is reported as "did not answer" rather than as an empty
 * page for the same reason: an engine that handed back `{ records: [...] }`
 * would be carrying the memberships, and reading that envelope as "not a
 * member" is the same wrongful revoke by another route. It is unreached on the
 * shipped engine (#15598 drove every seam), and it stays unreachable-by-value
 * rather than being silently re-invented here.
 */
type ReadAnswer =
  | { answered: true; rows: any[] }
  | { answered: false; why: 'threw'; error: unknown }
  | { answered: false; why: 'not_an_array'; error?: undefined };

async function readRows(
  ql: any,
  object: string,
  where: any,
  limit: number,
  context: { isSystem: true; tenantId?: string },
): Promise<ReadAnswer> {
  let rows: any;
  try {
    rows = await ql.find(object, { where, limit }, { context });
  } catch (e) {
    return { answered: false, why: 'threw', error: e };
  }
  // Bare array, driven — see `engine-find-bare-array.pin.test.ts`, which boots
  // a real engine over a real `SqlDriver` and pins this seam. The `{ records }`
  // limb removed from here was dead code that read as a contract.
  if (Array.isArray(rows)) return { answered: true, rows };
  return { answered: false, why: 'not_an_array' };
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
 * EVERY legacy `sys_permission_set.id` bearing `name`, across the installation
 * — the REVOKE reach of {@link grantsHoldingName} for a grant written before
 * the name column existed (ADR-0131 D4), which names nothing until the
 * one-time backfill names it.
 *
 * Wide, and never posture-keyed (#11670): the grant a revoke has to reach may
 * point at any organization's copy, written under either posture, and a narrow
 * match would leave a capability the platform decided to take away in force
 * (ADR-0105 D4 F2). ⛔ Wide to REVOKE only — nothing is granted through it. A
 * database with no such row answers `[]`, and the revoke then reads by name
 * alone. The leg goes when ADR-0131 D10 drops the id column.
 */
async function resolvePermissionSetIdsForName(
  ql: any,
  name: string,
  logger?: MaybeLogger,
  /**
   * Keep only the rows a grant of this organization may name — organization-
   * less, or this organization's own — the rule the one-time backfill names a
   * legacy grant by. Absent: every copy (the revoke reach).
   */
  appliesToOrganization?: string,
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
    if (appliesToOrganization !== undefined && row?.organization_id && row.organization_id !== appliesToOrganization) continue;
    const id = row?.id;
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * [ADR-0131 D3] Why an org-admin grant of `name` cannot be written, or
 * `undefined` when it can: the security catalog — the one place the resolver
 * grants a held set from — must hold the set. A composition with no catalog
 * bound to the engine is not judged (nothing grants through a catalog there
 * either). A read that fails is not "missing": nothing is granted this round,
 * and the next reconcile asks again.
 */
async function orgAdminSetMissingFromCatalog(
  ql: any,
  name: string,
  logger?: MaybeLogger,
): Promise<string | undefined> {
  const catalog = securityCatalogReaderOf(ql);
  if (!catalog) return undefined;
  try {
    return (await catalog.resolve('permission', name)) ? undefined : 'permission_set_missing';
  } catch (e) {
    logger?.warn?.('[security] org-admin grant deferred — the security catalog could not be read', {
      set: name,
      error: (e as Error)?.message ?? String(e),
    });
    return 'catalog_unreadable';
  }
}

/**
 * [ADR-0131 D4] The grant rows of `where` that hold the set `name` — read BY
 * NAME (`sys_user_permission_set.permission_set`), which reaches every copy of
 * the set at once: a name is the reference, whichever organization's row the
 * grant's id was written against.
 *
 * Plus — to RESTRICT only — the rows of `where` that name nothing yet
 * (`grantSetNameOf` is empty) and whose id is one of `unnamedIds`: a grant
 * written before the name column existed, on an upgraded deployment's first
 * boot before the backfill names it (`kernel:ready` runs ahead of the
 * backfill's `kernel:bootstrapped`), or one the backfill could not name (an
 * id on another organization's row). A revocation reaches it, and so does
 * the duplicate check a grant insert makes; nothing is ever GRANTED through
 * it. The id leg goes when ADR-0131 C8 counts the unnamed grants and drops
 * the column.
 *
 * Rows come back once each, named ones first.
 */
async function grantsHoldingName(
  ql: any,
  where: Record<string, unknown>,
  name: string,
  unnamedIds: readonly string[],
  limit: number,
  logger?: MaybeLogger,
): Promise<any[]> {
  const named = await tryFind(ql, 'sys_user_permission_set', { ...where, [GRANT_SET_NAME_FIELD]: name }, limit, logger);
  const unnamed = unnamedIds.length > 0
    ? (await tryFind(
      ql,
      'sys_user_permission_set',
      { ...where, [GRANT_SET_ID_FIELD]: { $in: [...unnamedIds] } },
      limit,
      logger,
    )).filter((row) => grantSetNameOf(row) === undefined)
    : [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of [...named, ...unnamed]) {
    const key = row?.id === undefined || row?.id === null ? undefined : String(row.id);
    if (key !== undefined) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
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
 *
 * [#15840] One `skipped` reason is load-bearing rather than diagnostic:
 * `membership_unreadable` means the `sys_member` read did not answer, so this
 * call declined to decide at all. It is NOT `noop` and NOT `revoked` — the pair
 * is left exactly as it was found, and the caller's next round asks again.
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

  // 1. Determine whether the user currently holds an admin-grade role
  //    in this org. Better-auth allows multiple membership rows per
  //    pair under some edge cases (legacy data) — any qualifying row
  //    is enough.
  //
  // [#15840] This is the read the ruling names, and it is the only read in this
  // module asked through {@link readRows} instead of `tryFind`. `[]` here does
  // not mean "nothing to do": it means `shouldGrant === false`, which is the
  // input to the revoke branch below. So an un-answered read must NOT be spelled
  // `[]` — that is the difference between "this user is not an admin" and "the
  // store would not tell me", and the first of those DELETES a standing grant.
  //
  // ⛔ The skip lands HERE, before the superseded-revoke leg and before either
  // branch: the ruling's disposition is that a read fault "skips that user for
  // the round" and "never enters the revoke branch". A round that could not read
  // performs no write at all — nothing is granted, so nothing widens, and
  // nothing is revoked, so nothing standing is destroyed by a transient fault.
  // The next `sys_member` write and the `kernel:ready` backfill ask again.
  const membershipRead = await readRows(
    ql,
    'sys_member',
    { user_id: userId, organization_id: orgId },
    10,
    SYSTEM_CTX,
  );
  if (!membershipRead.answered) {
    logger?.error?.(
      '[security] org-admin reconcile SKIPPED — the sys_member read did not answer, so this ' +
        'round cannot tell "not a member" from "could not ask"; NOTHING was granted or revoked ' +
        'for this pair, and any standing grant is left exactly as it was',
      membershipRead.error instanceof Error ? membershipRead.error : undefined,
      { object: 'sys_member', userId, orgId, why: membershipRead.why },
    );
    return { action: 'skipped', reason: 'membership_unreadable' };
  }
  const memberships = membershipRead.rows;
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
  //
  // [ADR-0131 D4] Matched BY NAME, which is every copy at once; the copies'
  // ids still reach a grant that names nothing yet ({@link grantsHoldingName}).
  const supersededSetIds = await resolvePermissionSetIdsForName(ql, supersededSetName, logger);
  {
    const stale = await grantsHoldingName(
      ql,
      { user_id: userId, organization_id: orgId },
      supersededSetName,
      supersededSetIds,
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
  // [ADR-0131 D4] Granting asks "does the pair already hold the set" BY NAME:
  // a grant holds its set by name, and the new grant names it alone — no
  // `sys_permission_set` row is read to write it, and none needs to exist.
  // Revoking asks "does the pair hold ANY grant of that name", by name plus the
  // legacy id reach of {@link grantsHoldingName}, which only ever restricts.
  // The existence check reaches a legacy unnamed grant too — a duplicate it
  // must not insert — but only one the backfill will name (its set row is
  // organization-less or this organization's own): a grant it cannot name
  // confers nothing, and must not stand in for the one written here.
  if (shouldGrant) {
    const missing = await orgAdminSetMissingFromCatalog(ql, grantSetName, logger);
    if (missing) return { action: 'skipped', reason: missing };
    const existingGrants = await grantsHoldingName(
      ql,
      { user_id: userId, organization_id: orgId },
      grantSetName,
      await resolvePermissionSetIdsForName(ql, grantSetName, logger, orgId),
      5,
      logger,
    );
    if (existingGrants.length > 0) {
      // Deduplicate stale duplicates if any slipped through — rows repeating
      // an earlier row's own legacy id (a grant written by name carries none).
      // A grant against another legacy copy is a different row and is never
      // deleted here (#11670).
      const kept = new Set<string>();
      for (const row of existingGrants) {
        const rowSetId = String(row?.[GRANT_SET_ID_FIELD] ?? '');
        if (!kept.has(rowSetId)) {
          kept.add(rowSetId);
          continue;
        }
        if (row?.id) await tryDelete(ql, 'sys_user_permission_set', String(row.id), logger);
      }
      return { action: 'noop' };
    }
    const created = await tryInsert(
      ql,
      'sys_user_permission_set',
      {
        id: genId('ups'),
        user_id: userId,
        // [ADR-0131 D4] The grant names its set; no id is written (D10).
        permission_set: grantSetName,
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
  //
  // [ADR-0131 D4] By NAME, every copy at once; the copies' ids still reach a
  // grant that names nothing yet, so no demotion leaves one standing
  // ({@link grantsHoldingName}).
  const revocableSetIds = await resolvePermissionSetIdsForName(ql, grantSetName, logger);
  const existingGrants = await grantsHoldingName(
    ql,
    { user_id: userId, organization_id: orgId },
    grantSetName,
    revocableSetIds,
    5,
    logger,
  );
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
  // `sys_member` row and every org-admin grant, across organizations. [ADR-0131
  // D4] Grants are read by name; the legacy row ids resolved here only extend
  // the orphan sweep's reach to grants that name nothing yet (restrict-only),
  // so a database with no `sys_permission_set` row is swept all the same.
  const permSetIds = await resolvePermissionSetIdsForName(
    ql,
    orgAdminSetNameForPosture(posture, suppressUnbounded),
    logger,
  );
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
  //
  // [ADR-0131 D4] The grants of either variant, by NAME — plus, through the
  // copies' ids, the ones that name nothing yet (this sweep runs at
  // `kernel:ready`, ahead of the name backfill), so an orphan is reached
  // either way ({@link grantsHoldingName}).
  const allGrants = [
    ...(await grantsHoldingName(
      ql, {}, orgAdminSetNameForPosture(posture, suppressUnbounded), permSetIds, limit, logger,
    )),
    ...(await grantsHoldingName(
      ql, {}, supersededOrgAdminSetName(posture, suppressUnbounded), supersededIds, limit, logger,
    )),
  ];
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
