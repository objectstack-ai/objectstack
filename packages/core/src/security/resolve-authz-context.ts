// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * resolveAuthzContext — the SINGLE source of truth for resolving an inbound
 * request's identity + authorization context (positions, permissions, RLS scoping).
 *
 * Every HTTP entry point (REST server, runtime dispatcher, MCP, any future
 * transport) MUST resolve authorization through this function — never by
 * re-reading `sys_member` / `sys_user_position` / `sys_*_permission_set` itself.
 *
 * Why this exists: authorization resolution used to be DUPLICATED across the
 * REST server (`@objectstack/rest`) and the runtime dispatcher
 * (`@objectstack/runtime`). On a security path, duplicated logic drifts and the
 * drift is silent: the REST copy had quietly omitted `sys_user_position` (so custom
 * roles granted via the ADR-0057 D4 platform-RBAC path didn't apply over REST),
 * `sys_position_permission_set`, `mapMembershipRole` normalization, the
 * platform-admin derivation, and the `ai_seat` synthesis. The API-key half was
 * already shared here (`resolveApiKeyPrincipal`); this completes the extraction
 * by bringing session + role/permission aggregation home too. There is now ONE
 * implementation; both entry points are thin adapters that supply `ql` /
 * `getSession` their own way and delegate here.
 *
 * Fail-closed: every read is defensive. Missing services / tables yield a
 * partial context (even `{ positions: [], permissions: [] }`) — enforcement is the
 * SecurityPlugin's job, never this resolver's.
 */

import {
  mapMembershipRole,
  BUILTIN_IDENTITY_PLATFORM_ADMIN,
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN_GRANTS,
} from '@objectstack/spec';
import type { AuthzPosture, TenancyPosture } from '@objectstack/spec/security';
import { postureEnforcesWall } from '@objectstack/spec/security';

import { resolveApiKeyAdmission } from './api-key.js';
import type { ApiKeyRefusalReason } from './api-key.js';
import { isGrantActive } from './grant-validity.js';
import { derivePosture } from './posture-ladder.js';
import { isRowActive } from './row-active.js';

/** The transport-agnostic authorization envelope produced from a request. */
export interface ResolvedAuthzContext {
  userId?: string;
  tenantId?: string;
  email?: string;
  accessToken?: string;
  positions: string[];
  permissions: string[];
  systemPermissions: string[];
  tabPermissions?: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'>;
  /** Fellow-org user IDs for RLS scoping of identity tables (`id IN (...)`). */
  org_user_ids: string[];
  /**
   * [ADR-0105 D2] Every organization this principal currently holds a VALID
   * membership in — the caller's org access set, and the read reach of the
   * `group` tenancy posture (Layer 0 becomes `organization_id IN (...)`).
   * Resolved here, once, so no surface re-derives it; empty for an anonymous or
   * membership-less principal, which fails the group wall closed.
   */
  accessible_org_ids: string[];
  /**
   * [ADR-0095 D2/D3] The monotonic posture rung this principal resolves to,
   * DERIVED once here from held capability grants (never a better-auth role):
   * `PLATFORM_ADMIN` (unscoped `admin_full_access`) > `TENANT_ADMIN`
   * (`organization_admin`) > `MEMBER` (the authenticated floor). `EXTERNAL` is
   * defined/test-locked but never resolved yet (no external principal type —
   * see `posture-ladder.ts`). Present only for an authenticated principal;
   * anonymous requests carry no rung.
   */
  posture?: AuthzPosture;
  /**
   * [#8287] Set when an inbound API key was REFUSED — a real, intact
   * credential this deployment's tenancy posture cannot admit. The context is
   * otherwise EMPTY (no `userId`), so every transport already fails it closed
   * to 401 with no change; this field only lets a transport that wants to say
   * WHY do so, instead of answering the operator with a bare "unauthenticated"
   * for a key they can see is neither revoked nor expired.
   *
   * ⚠️ `reason` is NOT an `error.code`. The wire vocabulary is closed
   * (ADR-0112: `StandardErrorCode ∪ ERROR_CODE_LEDGER`, both in `packages/spec`)
   * and a refused credential's standard member is `UNAUTHENTICATED`. This is a
   * diagnostic discriminator for the message, deliberately lowercase so it can
   * never be mistaken for one.
   */
  authRefusal?: { reason: ApiKeyRefusalReason; message: string };
}

export interface ResolveAuthzInput {
  /** Data engine (ObjectQL) exposing `find(object, { where, limit, context })`. */
  ql: any;
  /** Inbound request headers (Web `Headers` or a plain record). */
  headers: any;
  /**
   * Resolve a better-auth session from `headers`, returning `{ user?, session? }`
   * (or undefined). Optional — when omitted or throwing, only the API-key path
   * runs and anonymous requests resolve to an empty context.
   */
  getSession?: (headers: any) => Promise<any> | any;
  /** Clock injection for API-key expiry (tests). */
  nowMs?: number;
  /**
   * [#8287] The deployment's EFFECTIVE tenancy posture, as resolved from the
   * kernel's `tenancy` service (`effectiveTenancyPosture`) — never from
   * `OS_TENANCY_POSTURE`, which reports what was requested rather than what is
   * enforced (ADR-0093 D4/D5).
   *
   * Supplied by the transport because this resolver is deliberately
   * kernel-agnostic. OMITTING it disables the two posture-conditional API-key
   * refusals and leaves behaviour exactly as it was — so an unwired caller is
   * never made WORSE, only less strict.
   */
  tenancyPosture?: TenancyPosture;
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

async function tryFind(ql: any, object: string, where: any, limit = 100): Promise<any[]> {
  if (!ql || typeof ql.find !== 'function') return [];
  try {
    let rows = await ql.find(object, { where, limit, context: { isSystem: true } } as any);
    if (rows && (rows as any).value) rows = (rows as any).value;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the authorization context for an inbound request. Always resolves —
 * never throws. Anonymous requests yield `{ positions: [], permissions: [], ... }`.
 */
export async function resolveAuthzContext(input: ResolveAuthzInput): Promise<ResolvedAuthzContext> {
  const { ql, headers } = input;
  const ctx: ResolvedAuthzContext = {
    positions: [],
    permissions: [],
    systemPermissions: [],
    org_user_ids: [],
    accessible_org_ids: [],
  };

  let userId: string | undefined;
  let tenantId: string | undefined;

  // 1. API key (explicit opt-in via header) takes precedence over session.
  const admission = await resolveApiKeyAdmission(ql, headers, input.nowMs, input.tenancyPosture);
  // [#8287] A REFUSED key stops here and does NOT fall through to the session
  // path. Falling through would be more permissive than the behaviour this
  // replaced (an API key already outranks a session), and a refusal that
  // quietly becomes a session login is not a refusal.
  if (admission.outcome === 'refused') {
    ctx.authRefusal = { reason: admission.reason, message: admission.message };
    return ctx;
  }
  const keyPrincipal = admission.outcome === 'admitted' ? admission.principal : undefined;
  if (keyPrincipal) {
    userId = keyPrincipal.userId;
    tenantId = keyPrincipal.tenantId;
    for (const scope of keyPrincipal.scopes) {
      if (!ctx.permissions.includes(scope)) ctx.permissions.push(scope);
    }
  }

  // 2. Session / Bearer path — fall back when no API key resolved a user.
  if (!userId && typeof input.getSession === 'function') {
    try {
      const sessionData = await input.getSession(headers);
      userId = sessionData?.user?.id ?? sessionData?.session?.userId;
      tenantId = tenantId ?? sessionData?.session?.activeOrganizationId;
      ctx.accessToken = sessionData?.session?.token ?? ctx.accessToken;
      if (sessionData?.user?.email) ctx.email = String(sessionData.user.email);
    } catch {
      // no auth configured / bad session → anonymous
    }
  }

  if (!userId) return ctx;
  ctx.userId = userId;
  if (tenantId) ctx.tenantId = tenantId;
  if (!ql || typeof ql.find !== 'function') return ctx;

  // The principal is now known — delegate ALL position/permission/RLS
  // aggregation to the shared userId-driven resolver. Seed it with the API-key
  // scopes already collected (step 1) and any session-supplied email so the
  // resulting order + email fallback are byte-identical to the logic this
  // replaced. `resolveUserAuthzGrants` is the single place that reads
  // `sys_member` / `sys_user_position` / `sys_*_permission_set`, so a non-HTTP
  // surface that already knows the user id (a `runAs:'user'` automation run,
  // #3356) can build the SAME envelope without re-implementing any of it.
  const grants = await resolveUserAuthzGrants(ql, userId, {
    tenantId,
    nowMs: input.nowMs,
    seedPermissions: ctx.permissions,
    seedEmail: ctx.email,
  });
  // [#8287] An API key stamped with an organization is only as good as its
  // owner's CURRENT membership in that organization. Checked here, at VERIFY
  // time, rather than by revoking keys when a membership ends: membership can
  // end through better-auth's org endpoints, SCIM deprovisioning, a direct
  // `sys_member` delete, or an ADR-0091 validity window simply lapsing — a
  // revoke-on-removal hook has to catch EVERY one of those or it silently
  // misses, while a verify-time check cannot be bypassed by an unhooked path.
  //
  // It is also free: `resolveUserAuthzGrants` has just read `sys_member` for
  // this very user to build `accessible_org_ids`, so this is a set membership
  // test on data already in hand — zero additional queries.
  //
  // Scoped to the walled postures on purpose. Under `single` there is no
  // organization boundary to cross, and a deployment with no membership rows
  // at all would otherwise refuse every stamped key it has.
  //
  // The result is NO PRINCIPAL, not a degrade to a user-only principal.
  // Degrading would hand back exactly the `200 + total 0` silent-empty this
  // card exists to kill — an ex-member's automation would keep answering
  // success while reading nothing.
  if (keyPrincipal?.tenantId && input.tenancyPosture) {
    const posture = input.tenancyPosture;
    if (postureEnforcesWall(posture) && !grants.accessible_org_ids.includes(keyPrincipal.tenantId)) {
      return {
        positions: [],
        permissions: [],
        systemPermissions: [],
        org_user_ids: [],
        accessible_org_ids: [],
        authRefusal: {
          reason: 'organization_membership_ended',
          message:
            'This API key authenticates into an organization its owner is no longer a member of. '
            + 'The key was not revoked — the membership that backed it ended.',
        },
      };
    }
  }

  ctx.positions = grants.positions;
  ctx.permissions = grants.permissions;
  ctx.systemPermissions = grants.systemPermissions;
  ctx.org_user_ids = grants.org_user_ids;
  ctx.accessible_org_ids = grants.accessible_org_ids;
  if (grants.tabPermissions) ctx.tabPermissions = grants.tabPermissions;
  if (grants.posture) ctx.posture = grants.posture;
  if (grants.email && !ctx.email) ctx.email = grants.email;

  return ctx;
}

/** The authorization grants a KNOWN user holds — a subset of {@link ResolvedAuthzContext}. */
export interface UserAuthzGrants {
  positions: string[];
  permissions: string[];
  systemPermissions: string[];
  /** Fellow-org user IDs for RLS scoping of identity tables (`id IN (...)`). */
  org_user_ids: string[];
  /** [ADR-0105 D2] Organizations this user holds a currently-valid membership in. */
  accessible_org_ids: string[];
  tabPermissions?: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'>;
  posture?: AuthzPosture;
  /** The user's unique email (`sys_user`), for `current_user.email` owner RLS. */
  email?: string;
}

export interface ResolveUserAuthzGrantsOptions {
  /** Active org/tenant id — scopes org-bound grants (a null-org row is global). */
  tenantId?: string;
  /** Clock injection for grant validity windows (tests). */
  nowMs?: number;
  /**
   * Permission names the CALLER already resolved (e.g. API-key scopes) to seed
   * `permissions` BEFORE permission-set names are appended, so a mixed
   * API-key+session principal keeps every scope and the ordering is preserved.
   * Copied, never mutated.
   */
  seedPermissions?: string[];
  /** A caller-supplied email (e.g. from the session) that wins over the `sys_user` read. */
  seedEmail?: string;
}

/**
 * resolveUserAuthzGrants — the userId-driven core of {@link resolveAuthzContext}.
 *
 * Given a KNOWN user id, aggregate the authorization grants that user holds:
 * org-admin positions (`sys_member`), platform-RBAC positions
 * (`sys_user_position`), user- and position-bound permission sets
 * (`sys_user_permission_set` / `sys_position_permission_set` →
 * `sys_permission_set`), the derived `platform_admin` built-in + posture rung,
 * fellow-org peers for identity-table RLS, and the env-side `ai_seat`.
 *
 * Factored out of `resolveAuthzContext` so a surface that already knows WHO the
 * principal is — with no HTTP request to resolve it from — can build the SAME
 * envelope through the ONE resolver, instead of re-reading `sys_member` /
 * `sys_user_position` / `sys_*_permission_set` itself. The motivating consumer
 * is a `runAs:'user'` automation run resolving the triggering user's grants
 * (#3356): the record-change hook session carries only a `userId`, so the
 * automation engine calls this to run the flow's data ops exactly as that user
 * — not the bare member/everyone fallback the missing grants used to leave it.
 *
 * Fail-closed like its parent: every read is defensive, a missing engine/table
 * yields an empty-but-valid envelope, and it never throws.
 */
export async function resolveUserAuthzGrants(
  ql: any,
  userId: string,
  opts: ResolveUserAuthzGrantsOptions = {},
): Promise<UserAuthzGrants> {
  const { tenantId } = opts;
  const grants: UserAuthzGrants = {
    positions: [],
    permissions: Array.isArray(opts.seedPermissions) ? [...opts.seedPermissions] : [],
    systemPermissions: [],
    org_user_ids: [userId],
    accessible_org_ids: [],
  };
  if (opts.seedEmail) grants.email = opts.seedEmail;
  if (!ql || typeof ql.find !== 'function') return grants;

  // sys_user is needed for both the `current_user.email` fallback (API-key auth,
  // where the session didn't supply an email) and the ai_seat synthesis below.
  // Read the row at most once per resolution — the two reads were a duplicate
  // query on the API-key path.
  let userRowLoaded = false;
  let userRow: any;
  const getUserRow = async (): Promise<any> => {
    if (!userRowLoaded) {
      userRowLoaded = true;
      const rows = await tryFind(ql, 'sys_user', { id: userId }, 1);
      userRow = rows[0];
    }
    return userRow;
  };

  // Resolve the caller's unique email for `current_user.email` RLS owner
  // policies when the caller didn't supply it (e.g. API-key auth).
  if (!grants.email) {
    const u = await getUserRow();
    if (u?.email) grants.email = String(u.email);
  }

  // Single clock for every validity-window check in this resolution
  // (ADR-0091 D2 — a grant row outside [valid_from, valid_until) does not
  // resolve, fail-closed, with no background job involved).
  const nowMs = opts.nowMs ?? Date.now();

  // 3. Memberships via sys_member (better-auth). ONE read serves two purposes,
  //    so the two facts can never disagree about what the user belongs to:
  //
  //    (a) [ADR-0095 D3] Org-administration roles for the ACTIVE organization,
  //        normalized to the canonical built-in names (owner→org_owner,
  //        admin→org_admin, …). This is the ONE PROVISIONING boundary where a
  //        better-auth role is read: it is projected into `positions` here, and
  //        separately drives the `organization_admin` capability grant
  //        (auto-org-admin-grant.ts). No enforcement code path reads the raw
  //        role — posture/adjudication run off the resulting capability grants,
  //        so the #2836 dual-track cannot recur.
  //
  //    (b) [ADR-0105 D2] `accessible_org_ids` — EVERY organization the user
  //        currently belongs to, regardless of which one is active. This is the
  //        `group` posture's read reach (Layer 0 becomes `organization_id IN
  //        (...)`), so it must span the whole membership set, not the active
  //        org. Rows outside their ADR-0091 validity window do not resolve; the
  //        columns are absent on `sys_member` today, and `isGrantActive` treats
  //        an absent bound as unbounded, so this is a no-op until they exist and
  //        correct the moment they do.
  const members = await tryFind(ql, 'sys_member', { user_id: userId }, 200);
  const accessibleOrgIds = new Set<string>();
  for (const m of members) {
    if (!isGrantActive(m, nowMs)) continue;
    const org = m.organization_id ?? m.organizationId;
    if (typeof org === 'string' && org) accessibleOrgIds.add(org);
  }
  grants.accessible_org_ids = Array.from(accessibleOrgIds);

  // Positions come from the ACTIVE org's membership only (unchanged): a role
  // held in one organization must not grant its capabilities while the caller
  // operates in another. With no active org, every membership contributes —
  // exactly the pre-D2 behavior of the org-less read.
  const activeMembers = tenantId
    ? members.filter((m) => (m.organization_id ?? m.organizationId) === tenantId)
    : members;
  for (const m of activeMembers) {
    if (m.role && typeof m.role === 'string') {
      for (const raw of m.role.split(',').map((s: string) => s.trim()).filter(Boolean)) {
        const r = mapMembershipRole(raw);
        if (!grants.positions.includes(r)) grants.positions.push(r);
      }
    }
  }

  // 4. [ADR-0057 D4] Platform-owned RBAC role assignments (sys_user_position) — the
  //    source of truth for custom roles, decoupled from sys_member.role.
  //    `organization_id = null` = global (cross-tenant); else match active org.
  const userPositionRows = await tryFind(ql, 'sys_user_position', { user_id: userId }, 200);
  for (const ur of userPositionRows) {
    const org = ur.organization_id ?? null;
    if (org && tenantId && org !== tenantId) continue;
    if (!isGrantActive(ur, nowMs)) continue;
    const r = ur.position;
    if (typeof r === 'string' && r && !grants.positions.includes(r)) grants.positions.push(r);
  }

  // 5. Fellow-org user IDs so RLS can scope identity tables to collaborators.
  if (tenantId) {
    const orgMembers = await tryFind(ql, 'sys_member', { organization_id: tenantId }, 1000);
    const ids = new Set<string>(
      orgMembers
        .map((m) => m.user_id ?? m.userId)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    );
    ids.add(userId);
    grants.org_user_ids = Array.from(ids);
  }

  // 6. Permission sets — user-scoped grants (null org = global, else active org).
  //    Rows outside their validity window are dropped BEFORE any derivation, so
  //    an expired admin_full_access grant cannot yield platform_admin either.
  const upsRowsAll = await tryFind(ql, 'sys_user_permission_set', { user_id: userId }, 100);
  const upsRows = upsRowsAll.filter((r) => isGrantActive(r, nowMs));
  const psIds = new Set<string>(
    upsRows
      .filter((r) => {
        const org = (r.organization_id ?? r.organizationId) ?? null;
        return !(org && tenantId && org !== tenantId);
      })
      .map((r) => r.permission_set_id ?? r.permissionSetId)
      .filter(Boolean),
  );
  // platform_admin (ADR-0068 D2) is DERIVED from an UNSCOPED admin_full_access
  // USER grant — the single source of truth (no trusted stored boolean).
  const unscopedUserPsIds = new Set<string>(
    upsRows
      .filter((r) => ((r.organization_id ?? r.organizationId) ?? null) === null)
      .map((r) => r.permission_set_id ?? r.permissionSetId)
      .filter(Boolean),
  );
  let hasPlatformAdminGrant = false;

  // 5b. [ADR-0090 D5] Audience anchor: every AUTHENTICATED member implicitly
  //     holds the built-in `everyone` position, so sets bound to it resolve
  //     below exactly like any other position-bound grant — ADDITIVE, with no
  //     "only when the user has nothing else" cliff.
  if (!grants.positions.includes('everyone')) grants.positions.push('everyone');

  // 6a. Position-bound permission sets (sys_position_permission_set): a position
  //     carries its permission sets.
  //
  //     [ADR-0049] A DEACTIVATED position grants nothing — the `deactivate_position`
  //     dialog's promise ("users keep their assignment but the position stops
  //     granting permissions"), enforced at the ONE place it is enforceable.
  //     Downstream in plugin-security the position→set linkage is already
  //     collapsed into a flat `permissions` list, so a set held via a
  //     deactivated position is indistinguishable there from one granted
  //     directly and filtering there would over-revoke.
  //
  //     The name is dropped from `positions` too, not merely from the junction
  //     read: `resolvePermissionSetsForContext` requests `positions` as
  //     permission-set NAMES (position names are commonly reused as set names),
  //     so a name left standing would resolve the same grant one layer down.
  //     Only a name whose row is explicitly deactivated is dropped — a name
  //     with no `sys_position` row at all (`org_owner`, a membership-derived
  //     role) has no flag to read and is untouched.
  if (grants.positions.length > 0) {
    const positionRows = await tryFind(ql, 'sys_position', { name: { $in: grants.positions } }, 100);
    const deactivatedNames = new Set<string>(
      positionRows.filter((r) => !isRowActive(r)).map((r) => r.name).filter(Boolean),
    );
    if (deactivatedNames.size > 0) {
      grants.positions = grants.positions.filter((n) => !deactivatedNames.has(n));
    }
    const positionIds = positionRows.filter((r) => isRowActive(r)).map((r) => r.id).filter(Boolean);
    if (positionIds.length > 0) {
      const rpsRows = await tryFind(ql, 'sys_position_permission_set', { position_id: { $in: positionIds } }, 500);
      for (const r of rpsRows) {
        const id = r.permission_set_id ?? r.permissionSetId;
        if (id) psIds.add(id);
      }
    }
  }

  // 6b. Resolve permission-set details (names → grants.permissions; system_permissions;
  //     tab_permissions merged by highest visibility).
  if (psIds.size > 0) {
    const psRowsAll = await tryFind(ql, 'sys_permission_set', { id: { $in: Array.from(psIds) } }, 500);
    // [ADR-0049] A DEACTIVATED permission set grants nothing — the
    // `deactivate_permission_set` dialog's promise ("existing assignments stay
    // in place but stop granting access"). Dropped BEFORE any derivation, the
    // same discipline the validity window gets at §6, so `hasPlatformAdminGrant`
    // cannot be derived from a set that no longer grants either: a deactivated
    // `admin_full_access` must not keep conferring PLATFORM_ADMIN.
    const psRows = psRowsAll.filter((r) => isRowActive(r));
    const tabRank: Record<string, number> = { hidden: 0, default_off: 1, default_on: 2, visible: 3 };
    const mergedTabs: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'> = {};
    for (const ps of psRows) {
      if (ps.name && !grants.permissions.includes(ps.name)) grants.permissions.push(ps.name);
      if (ps.name === ADMIN_FULL_ACCESS && unscopedUserPsIds.has(ps.id)) hasPlatformAdminGrant = true;
      const sysPerms = typeof ps.system_permissions === 'string'
        ? safeJsonParse(ps.system_permissions, [])
        : (ps.system_permissions ?? ps.systemPermissions);
      if (Array.isArray(sysPerms)) {
        for (const p of sysPerms) {
          if (typeof p === 'string' && !grants.systemPermissions.includes(p)) grants.systemPermissions.push(p);
        }
      }
      const tabs = typeof ps.tab_permissions === 'string'
        ? safeJsonParse(ps.tab_permissions, {})
        : (ps.tab_permissions ?? ps.tabPermissions);
      if (tabs && typeof tabs === 'object') {
        for (const [app, val] of Object.entries(tabs as Record<string, unknown>)) {
          if (typeof val !== 'string' || !(val in tabRank)) continue;
          const cur = mergedTabs[app];
          if (!cur || tabRank[val] > tabRank[cur]) {
            mergedTabs[app] = val as 'visible' | 'hidden' | 'default_on' | 'default_off';
          }
        }
      }
    }
    if (Object.keys(mergedTabs).length > 0) grants.tabPermissions = mergedTabs;
  }

  // 6c. Project the derived platform_admin built-in role (leads the list).
  if (hasPlatformAdminGrant && !grants.positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)) {
    grants.positions.unshift(BUILTIN_IDENTITY_PLATFORM_ADMIN);
  }

  // 6d. [ADR-0095 D2/D3] Resolve the posture rung ONCE, from held CAPABILITY
  //     grants — never from a better-auth role. `PLATFORM_ADMIN` from the
  //     unscoped `admin_full_access` grant (the same `viewAllRecords`/
  //     `modifyAllRecords` evidence the superuser bypass trusts); `TENANT_ADMIN`
  //     from the `organization_admin` grant (auto-provisioned from the better-
  //     auth owner/admin role at §3 above — a provisioning source, not an
  //     enforcement input, closing the #2836 dual-track class). Enforcement
  //     behavior is unchanged: the per-object Layer 0 exemption + per-side
  //     superuser bypass still gate access; posture is the carried, explainable
  //     tier. `EXTERNAL` is never derived (no external principal type yet).
  grants.posture = derivePosture({
    isPlatformAdmin: hasPlatformAdminGrant,
    // [ADR-0105 D4] Either org-admin capability set resolves the rung — the
    // wall-less variant differs only by withholding the superuser bits.
    isTenantAdmin: ORGANIZATION_ADMIN_GRANTS.some((n: string) => grants.permissions.includes(n)),
  });

  // 7. [ADR-0024] Env-side AI seat: synthesize the `ai_seat` capability from the
  //    boolean sys_user.ai_access (sqlite returns 1/0; memory returns boolean).
  if (!grants.permissions.includes('ai_seat')) {
    const aiAccess = ((await getUserRow()) as { ai_access?: unknown } | undefined)?.ai_access;
    if (aiAccess === true || aiAccess === 1 || aiAccess === '1') grants.permissions.push('ai_seat');
  }

  return grants;
}

// ── Localization (ADR-0053 Phase 2) ─────────────────────────────────────────

function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function coerceTimeZone(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
  return s && isValidTimeZone(s) ? s : undefined;
}
function coerceLocale(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
  return s || undefined;
}
function coerceCurrency(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(s) ? s : undefined;
}

export interface ResolveLocalizationInput {
  ql: any;
  /** Settings service exposing `get(namespace, key, { tenantId, userId })`. */
  settings?: any;
  tenantId?: string;
  userId?: string;
}

type LocalizationResult = { timezone: string; locale: string; currency?: string };

/**
 * Process-local TTL cache for the FAILED-READ outcome of
 * {@link resolveLocalizationContext} only (#10221; narrowed after a patch
 * round — see below).
 *
 * `resolveAuthzContext`'s #2409 de-dup already collapsed the THREE per-key
 * reads a request used to issue into one batched `sys_setting` query; what it
 * did not address is the SAME query repeating on EVERY request. On a fresh
 * environment (`sys_setting` not yet migrated / never written) that one query
 * fails every time, and `packages/drivers/driver-sql`'s
 * `backendStatementFault` — deliberately generic; see its doc — logs a
 * `[sql-driver] DATABASE_ERROR` line for EVERY failed read, so the identical
 * "no such table: sys_setting" warning repeats once per request and buries
 * real errors in between.
 *
 * `tryFind`-style catches already guaranteed the FUNCTIONAL fallback (catch →
 * `[]` → built-in `UTC` / `en-US` defaults) — this cache only stops the
 * FAILING query (and therefore the log line) from re-running every request.
 *
 * ## Why only the failure, not every result (patch round, CI red)
 *
 * The first version of this cache memoized every outcome — including a
 * SUCCESSFUL read — for 30s, mirroring `packages/plugins/plugin-audit/src/audit-writers.ts`
 * (`resolveWriteLocale`)'s existing TTL cache of this same read. That is safe
 * for audit-writer's use: audit trail enrichment is explicitly best-effort,
 * so a stale locale in a log line for up to 30s costs nothing observable.
 * It is NOT safe for `@objectstack/rest`'s use of this same function: analytics
 * date-bucketing reads the org timezone on every query, and
 * `packages/qa/dogfood/test/analytics-timezone.dogfood.test.ts` (the golden
 * regression for #1982/#2018) writes a NEW org timezone via the real settings
 * route and asserts the VERY NEXT analytics read buckets under it — a 30s-old
 * cached value broke that test (CI: `expected undefined to be 3`, the bucket
 * stayed on the previous timezone). Analytics bucketing is declared, tested
 * behavior, not best-effort enrichment — it cannot tolerate the same
 * staleness plugin-audit's cache is allowed to.
 *
 * So this cache is narrowed to memoize ONLY the case the underlying read
 * itself THREW (a backend fault — e.g. "no such table" — not a legitimate
 * empty/no-rows-yet result, which is a normal, cheap, un-failing read and
 * stays uncached so a fresh write is visible on the next request same as
 * before). That fully addresses #10221 — the log spam only exists on an env
 * where the read is actively failing — while never caching a value a caller
 * could observe going stale.
 *
 * Keyed on the `ql` instance (one entry-set per environment engine, so two
 * environments/tenants sharing a process never see each other's cached
 * outcome) and then `tenantId|userId` beneath it, matching the audit writer's
 * key shape. A `ql` that isn't cacheable (missing/non-object) skips the cache
 * entirely — there is no query to dedupe in that case.
 */
const LOCALIZATION_FAILURE_CACHE_TTL_MS = 30_000;
const localizationFailureCache = new WeakMap<object, Map<string, { value: LocalizationResult; expiresAt: number }>>();

/**
 * Resolve workspace localization defaults (reference `timezone` / `locale` /
 * `currency`). Canonical path is the `localization` SettingsManifest (cascade:
 * platform default → global → tenant); falls back to direct tenant-scoped
 * `sys_setting` rows, then the built-ins `UTC` / `en-US`. Never throws.
 *
 * A read that fails outright (backend fault — table missing, connection
 * refused, etc.) is memoized for {@link LOCALIZATION_FAILURE_CACHE_TTL_MS}
 * per `(ql, tenantId, userId)` so the failing query — and the driver's log
 * line for it — does not repeat every request (#10221). A successful read,
 * including a legitimate "no settings configured yet" empty result, is NEVER
 * cached: the next call always re-reads, so a settings write takes effect
 * immediately (see the cache doc above for why — the dogfood analytics
 * bucketing test pins this).
 */
export async function resolveLocalizationContext(input: ResolveLocalizationInput): Promise<LocalizationResult> {
  const { ql, tenantId, userId } = input;
  const cacheKey = `${tenantId ?? ''}|${userId ?? ''}`;
  if (ql && typeof ql === 'object') {
    const hit = localizationFailureCache.get(ql)?.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const { value, failed } = await resolveLocalizationContextUncached(input);
  if (failed && ql && typeof ql === 'object') {
    const bucket = localizationFailureCache.get(ql) ?? new Map<string, { value: LocalizationResult; expiresAt: number }>();
    bucket.set(cacheKey, { value, expiresAt: Date.now() + LOCALIZATION_FAILURE_CACHE_TTL_MS });
    localizationFailureCache.set(ql, bucket);
  }
  return value;
}

async function resolveLocalizationContextUncached(
  input: ResolveLocalizationInput,
): Promise<{ value: LocalizationResult; failed: boolean }> {
  const { ql, settings, tenantId, userId } = input;
  let failed = false;
  try {
    if (settings && typeof settings.get === 'function') {
      const sctx = { tenantId, userId } as any;
      const [tzRes, localeRes, currencyRes] = await Promise.all([
        settings.get('localization', 'timezone', sctx).catch(() => {
          failed = true;
          return undefined;
        }),
        settings.get('localization', 'locale', sctx).catch(() => {
          failed = true;
          return undefined;
        }),
        settings.get('localization', 'currency', sctx).catch(() => {
          failed = true;
          return undefined;
        }),
      ]);
      const tz = coerceTimeZone(tzRes?.value);
      const locale = coerceLocale(localeRes?.value);
      const currency = coerceCurrency(currencyRes?.value);
      if (tz || locale || currency) {
        return { value: { timezone: tz ?? 'UTC', locale: locale ?? 'en-US', currency }, failed: false };
      }
    }
  } catch {
    // settings service unavailable → direct read
    failed = true;
  }
  // One read for all three keys instead of a query per key (`$in` on `key`).
  // Inlined (rather than the shared `tryFind`) so a genuine backend fault —
  // as opposed to a legitimate empty result — is visible to the caller above,
  // which is the signal the failure-only cache keys off.
  let rows: any[] = [];
  if (ql && typeof ql.find === 'function') {
    try {
      let result = await ql.find('sys_setting', {
        where: { namespace: 'localization', key: { $in: ['timezone', 'locale', 'currency'] }, scope: 'tenant' },
        limit: 10,
        context: { isSystem: true },
      } as any);
      if (result && (result as any).value) result = (result as any).value;
      rows = Array.isArray(result) ? result : [];
    } catch {
      failed = true;
    }
  }
  const valueOf = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    value: {
      timezone: coerceTimeZone(valueOf('timezone')) ?? 'UTC',
      locale: coerceLocale(valueOf('locale')) ?? 'en-US',
      currency: coerceCurrency(valueOf('currency')),
    },
    failed,
  };
}
