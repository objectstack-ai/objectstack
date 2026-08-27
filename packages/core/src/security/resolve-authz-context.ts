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

async function tryFind(
  ql: any,
  object: string,
  where: any,
  limit = 100,
  /**
   * Resolve inside ONE organization. Threaded into the execution context, so
   * the read routes through `SqlDriver.applyTenantScope` — the governed
   * chokepoint — rather than being re-implemented here as a bare equality.
   * Omitted keeps the pre-existing installation-wide read, which is what the
   * user-keyed reads above want (they are already narrowed by `user_id`) and
   * what a `single`-posture deployment wants everywhere.
   */
  organizationId?: string,
): Promise<any[]> {
  if (!ql || typeof ql.find !== 'function') return [];
  try {
    const context = organizationId ? { isSystem: true, tenantId: organizationId } : { isSystem: true };
    let rows = await ql.find(object, { where, limit, context } as any);
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

  // ── [#10825] Leg 1: every read that depends only on (userId, tenantId) is
  // issued CONCURRENTLY — sys_user, both sys_member reads, sys_user_position
  // and sys_user_permission_set used to run as five sequential round trips
  // (legs 6–9 + 13 of an authenticated request; cloud#1539 measured that LEGS,
  // not queries, are the latency multiplier). Same queries, same filters, same
  // limits, same tenancy scoping — only the waiting overlaps, so the rows each
  // downstream block sees are byte-identical to the sequential version
  // (equivalence pinned in resolve-authz-context.batch-equivalence.test.ts).
  // `getUserRow` stays memoized; issuing it here is not a new read on any
  // path that reads it at all — the email fallback below and §7's ai_seat
  // synthesis consume the same memo. The CONDITION mirrors the sequential
  // implementation exactly: `sys_user` was read iff the caller seeded no
  // email OR did not seed `ai_seat` — a fully-seeded API-key principal never
  // touched the table, and the batch must not start (equivalence suite pins
  // the query multiset per fixture).
  const needsUserRow = !grants.email || !grants.permissions.includes('ai_seat');
  const [, members, userPositionRows, orgMembersLeg, upsRowsAll] = await Promise.all([
    needsUserRow ? getUserRow() : Promise.resolve(undefined),
    tryFind(ql, 'sys_member', { user_id: userId }, 200),
    tryFind(ql, 'sys_user_position', { user_id: userId }, 200),
    tenantId ? tryFind(ql, 'sys_member', { organization_id: tenantId }, 1000) : Promise.resolve([] as any[]),
    tryFind(ql, 'sys_user_permission_set', { user_id: userId }, 100),
  ]);

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
  // (read in Leg 1 above)
  const accessibleOrgIds = new Set<string>();
  for (const m of members) {
    if (!isGrantActive(m, nowMs)) continue;
    const org = m.organization_id ?? m.organizationId;
    if (typeof org === 'string' && org) accessibleOrgIds.add(org);
  }
  grants.accessible_org_ids = Array.from(accessibleOrgIds);

  // Positions come from the ACTIVE org's membership only: a role held in one
  // organization must not grant its capabilities while the caller operates in
  // another. With no active org, every membership contributes — exactly the
  // pre-D2 behavior of the org-less read.
  //
  // [ADR-0091 D2] Rows outside their validity window are dropped BEFORE the
  // role derivation — the same discipline §6 gives `sys_user_permission_set`,
  // so a lapsed membership can no more yield `org_owner` than an expired
  // `admin_full_access` can yield `platform_admin`. Maintainer ruling
  // 2026-08-22 (live session, item 2): a lapsed membership is NO MEMBERSHIP,
  // not merely no org access — so this half now answers the same question as
  // `accessible_org_ids` above, off the same rows, and (a)'s "correct the
  // moment they do" promise covers BOTH derivations rather than one. Fail
  // closed (D2). `sys_member` declares neither bound today and `isGrantActive`
  // reads an absent bound as unbounded, so no shipped row changes answer.
  const activeMembers = members.filter(
    (m) =>
      isGrantActive(m, nowMs)
      && (!tenantId || (m.organization_id ?? m.organizationId) === tenantId),
  );
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
  // (read in Leg 1 above)
  for (const ur of userPositionRows) {
    const org = ur.organization_id ?? null;
    if (org && tenantId && org !== tenantId) continue;
    if (!isGrantActive(ur, nowMs)) continue;
    const r = ur.position;
    if (typeof r === 'string' && r && !grants.positions.includes(r)) grants.positions.push(r);
  }

  // 5. Fellow-org user IDs so RLS can scope identity tables to collaborators.
  if (tenantId) {
    const orgMembers = orgMembersLeg; // (read in Leg 1 above)
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
  // (read in Leg 1 above)
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
    //     [#10103] Scoped to the CALLER's organization. `sys_position` spells
    //     its name index `unique: 'organization'` and its rows are materialized
    //     per organization, so several organizations hold a row named
    //     `everyone` (and one named after every declared position). Swept by
    //     name alone, this read returned EVERY organization's rows, and the
    //     junction read below then collected another organization's bindings —
    //     a cross-organization grant bleed, measured reachable from one tenant's
    //     resolution to another tenant's `everyone` binding. It also made the
    //     sweep O(organizations) on a table that is read on every request.
    //
    //     Scoped by threading the organization into the context rather than by
    //     adding an `organization_id` predicate here: the driver's
    //     `applyTenantScope` is the one governed spelling of this wall, and a
    //     bare equality written at this call site would be a second, ungoverned
    //     implementation of it — the exact shape that produced the defect this
    //     card repairs. Per-request cost stays O(the caller's own organization's
    //     catalog).
    //
    //     Limit raised with it: the cap has to admit this organization's rows
    //     alongside any organization-less ones the driver's compatibility arm
    //     still returns, or a caller silently loses positions. Those
    //     organization-less rows stay REACHABLE on purpose — they are not
    //     reaped, and grants point at them by row id, so dropping them here
    //     would revoke standing access silently.
    const positionRows = await tryFind(ql, 'sys_position', { name: { $in: grants.positions } }, 200, tenantId);
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

/**
 * hasPlatformAdminStanding — the ID-SHAPED platform-admin question, asked in
 * exactly one place.
 *
 * ADR-0068 D2 defines PLATFORM standing as one thing: an UNSCOPED
 * (`organization_id = null`) `sys_user_permission_set` grant on the
 * `admin_full_access` set, held **now**. A surface that only knows a user id —
 * a session-payload derivation, a platform-operator route gate, an
 * impersonation oracle — asks here, so it never has to re-read the grant tables
 * itself, which is the prohibition this module's header states.
 *
 * It is a PROJECTION of {@link resolveUserAuthzGrants}, never a second
 * derivation: the answer is the `PLATFORM_ADMIN` rung of the posture ladder,
 * and that rung is derived from the unscoped-grant evidence and nothing else.
 * Everything that governs those grants therefore applies here by construction
 * and cannot drift from it — the ADR-0091 validity window (§6), the ADR-0049
 * `active` flag on the catalogue row (§6b), the system-identity read, and the
 * resolution of `admin_full_access` BY ID rather than by scanning a page of the
 * catalogue. Each of those was missing from a hand-written copy of this
 * predicate; none of them can be missing from a projection.
 *
 * ⛔ Read the RUNG — never `positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)`.
 * The positions list is wider on purpose: an ADR-0057 D4 `sys_user_position`
 * row may spell that very name, and a platform-RBAC assignment is not the D2
 * capability grant. The two readings genuinely differ, so the narrow one is the
 * one that gets a name here.
 *
 * ⛔ The options are deliberately NOT {@link ResolveUserAuthzGrantsOptions}.
 * That type carries caller-supplied seeds (`seedEmail`, `seedPermissions`) for
 * transports that already resolved part of a principal; an authorization
 * predicate that accepted them would let a caller supply part of its own
 * verdict. Clock injection is the only thing a caller may pass, so this
 * function's answer is a function of `(ql, userId)` and the stored rows alone.
 *
 * ⚠️ This is the PER-USER predicate. The POPULATION question ("which user is
 * the platform admin?" — `ensure-default-organization.ts`) is a different kind
 * and is deliberately not expressible through it; do not widen this to serve
 * it.
 *
 * Fail-CLOSED: an empty id, a missing engine, or any unreadable lookup answers
 * `false`. This backs security gates, and an unverifiable actor never passes.
 */
export async function hasPlatformAdminStanding(
  ql: any,
  userId: string,
  opts: { nowMs?: number } = {},
): Promise<boolean> {
  if (!ql || typeof userId !== 'string' || userId.length === 0) return false;
  try {
    const grants = await resolveUserAuthzGrants(ql, userId, { nowMs: opts.nowMs });
    return grants.posture === 'PLATFORM_ADMIN';
  } catch {
    return false;
  }
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
  /**
   * Settings service occupant. Two methods are consumed, in this order:
   *
   *  - `getMany(namespace, keys, { tenantId, userId })` — PREFERRED since
   *    #10826, and what this resolver calls for all three localization keys in
   *    ONE grouped read.
   *  - `get(namespace, key, { tenantId, userId })` — the per-key fallback,
   *    taken only when the occupant does not expose `getMany` (three parallel
   *    reads; see the feature-detect below).
   *
   * `getMany` is OPTIONAL for an occupant: the branch is feature-detected, so
   * a service that predates it still resolves — at three reads instead of one.
   * Typed `any` deliberately (the occupant's shape varies by host); the
   * declaration above is the contract this resolver actually relies on, and it
   * is prose precisely because nothing type-checks it — `getService` is a cast
   * and `rest-server.ts` widens the provider's return to a bare promise.
   */
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
 * [#11877] "the underlying read itself THREW" means the DIRECT `sys_setting`
 * read, and only it. The write condition used to be a single `failed` flag
 * that five SETTINGS-SERVICE legs also set (a thrown `getMany`, each of the
 * three older per-key `get`s, and the whole-block "service unavailable"
 * handler). Those legs are reachable inside the settings engine's BIND
 * WINDOW — `SettingsService.getMany` refuses all-or-nothing for a namespace
 * whose manifest is not yet registered — so a caller that deliberately
 * re-reads AFTER the bind (the #11580 repair re-resolves at
 * `kernel:bootstrapped`) was answered from the in-window memo for up to 30s,
 * silently keeping the very value the re-read existed to replace. And a
 * settings refusal standing alongside a SUCCESSFUL direct read memoized that
 * successful value — exactly the staleness the paragraph above forbids.
 *
 * Narrowing to the backend leg costs nothing #10221 bought: those refusals
 * throw out of an in-memory registry check BEFORE any query and before any
 * log line, so memoizing them suppressed neither — while #10221's own
 * environment (table not migrated yet) still memoizes, because the direct
 * read throws there whether or not a settings refusal stands in front of it.
 *
 * Keyed on the `ql` instance (one entry-set per environment engine, so two
 * environments/tenants sharing a process never see each other's cached
 * outcome) and then `tenantId|userId` beneath it, matching the audit writer's
 * key shape. A `ql` that isn't cacheable (missing/non-object) skips the cache
 * entirely — there is no query to dedupe in that case.
 */
const LOCALIZATION_FAILURE_CACHE_TTL_MS = 30_000;

/**
 * ── Leg C of #11633: the SUCCESS side of this same cache (#11966) ───────────
 *
 * The docblock above records why a successful read was NOT cached: a 30s TTL
 * is far longer than the gap between a settings write and the next request, so
 * `analytics-timezone.dogfood.test.ts` went red. That verdict was on **TTL-only
 * caching** and it still stands, unamended. What changed is that this process
 * now has invalidation seams it did not have then, so a successful answer can
 * be bounded by a WRITE rather than by a clock:
 *
 *  1. **Primary — the settings change seam.** `SettingsService.subscribe(ns,
 *     handler)` dispatches SYNCHRONOUSLY and in-process from the write path,
 *     and it does so AFTER the row is persisted (`settings-service.ts` calls
 *     `emitChange` below its `await this.upsertRow(...)`). One subscription per
 *     settings occupant advances a generation counter; an entry resolved at an
 *     older generation is dead on arrival.
 *     ⚠️ There is **no module called a "settings change bus"** — #11633's term
 *     for this seam maps to nothing in the tree. `subscribe()` is the seam.
 *  2. **Backstop — the engine write epoch** (#11968's substrate, declared in
 *     `objectql/src/write-epoch.ts`). Needed because this resolver's own
 *     fallback reads `sys_setting` DIRECTLY, so a seeder — or any other direct
 *     engine write — emits no settings event at all. Read STRUCTURALLY, never
 *     by import: `@objectstack/objectql` depends on this package, so the edge
 *     cannot be reversed, and the substrate declared `WriteEpochLike`
 *     separately for exactly this consumer.
 *  3. **TTL** — the residual bound, covering only what neither seam can see: a
 *     peer node's write, on a deployment with no `authz.invalidated` bridge
 *     attached. With a bridge, a peer's hint bumps the LOCAL epoch
 *     (`authz-invalidation-bridge.ts` calls `epoch.bump('remote')`), so the
 *     backstop narrows cross-node convergence for free.
 *
 * ⭐ **A success is cached ONLY when the engine exposes the write epoch.** That
 * is the load-bearing rule of this change. It is a rule about the CACHE, not
 * about the caller: a `ql` with no seam is a `ql` whose writes this cache
 * cannot see, and leg C's ruled requirement is that invalidation be
 * synchronous and in-process — "a TTL alone does not satisfy it". So instead of
 * degrading to the TTL-only shape that was already reverted once here, the
 * cache declines. Every existing test double takes that path and keeps its
 * exact query multiset; only a real engine caches.
 *
 * ⛔ **Invalidation retires SUCCESS entries only.** Dropping failure entries on
 * a write would hand #10221 straight back: on the environment that memo exists
 * for, `sys_setting` is missing, so a write to ANY object would retire the memo
 * and the failing query — with the driver's log line behind it — would resume
 * repeating once per request. No write can create a missing table, so there is
 * nothing there for a write to correct; the failure memo stays purely
 * TTL-bound and behaviourally identical to what #10221/#11877 shipped.
 */
const LOCALIZATION_CACHE_TTL_ENV = 'OS_LOCALIZATION_CACHE_TTL_MS';
const LOCALIZATION_SUCCESS_CACHE_DEFAULT_TTL_MS = 30_000;

/**
 * Staleness bound for the success cache, in ms. `0` disables it — a real path
 * that restores the pre-#11966 query multiset exactly, not a degenerate TTL.
 *
 * Deployment config, never a settings row (#11633 §5): `sys_setting` is the
 * table this cache caches, so a knob living there would be served BY the cache
 * it governs.
 *
 * ⚠️ A malformed value resolves to `0` (off), which is the OPPOSITE arm from
 * `readAuthzGrantsCacheTtlMs`'s, and deliberately so. There, `0` is also the
 * default, so malformed-means-off changes nothing. Here the default is ON, so
 * the two candidate readings are "off" and "30s" — and folding `3OOO` (letter
 * O) into the default would hand the operator a LONGER staleness window than
 * the one they were trying to set. Off is the only arm whose failure mode is a
 * missed optimisation rather than an unasked-for window.
 */
function localizationSuccessCacheTtlMs(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): number {
  const raw = env[LOCALIZATION_CACHE_TTL_ENV];
  if (raw === undefined || raw.trim() === '') return LOCALIZATION_SUCCESS_CACHE_DEFAULT_TTL_MS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

/**
 * The engine's current write epoch, or `undefined` when this `ql` carries no
 * such seam. Mirrors `isWriteEpochLike` from `@objectstack/objectql` rather
 * than importing it — see point 2 of the docblock above for why the import is
 * not available in this direction.
 *
 * ⚠️ The whole surface is checked, not just `current`. A bare
 * `{ current: number }` on some unrelated double would otherwise read as a live
 * invalidation seam and license caching against a counter that nothing ever
 * bumps — precisely the state this guard exists to keep unreachable.
 */
function readWriteEpoch(ql: unknown): number | undefined {
  if (!ql || typeof ql !== 'object') return undefined;
  const epoch = (ql as { writeEpoch?: unknown }).writeEpoch;
  if (!epoch || typeof epoch !== 'object') return undefined;
  const seam = epoch as { current?: unknown; bump?: unknown; subscribe?: unknown };
  if (
    typeof seam.current !== 'number' ||
    typeof seam.bump !== 'function' ||
    typeof seam.subscribe !== 'function'
  ) {
    return undefined;
  }
  return seam.current;
}

/** Per-settings-occupant invalidation state for the localization bucket. */
interface LocalizationSettingsState {
  /** Advanced by the occupant's change seam. Compared, never interpreted. */
  gen: number;
}

const localizationSettingsStates = new WeakMap<object, LocalizationSettingsState>();

/**
 * The state every call that passes NO settings occupant shares. A distinct
 * object rather than `undefined` so entry validity stays one identity
 * comparison: an answer resolved through a settings service must not be served
 * to a call made without one, or through a different one.
 */
const localizationNoSettingsState: LocalizationSettingsState = { gen: 0 };

/**
 * Fetch — and, on first sight of an occupant, subscribe to — the invalidation
 * state for one settings service.
 *
 * #11633 §2.3: the change event is `{ namespace, key, scope, action, at }` with
 * **no tenant discriminator**, so a handler cannot know whose entry to drop and
 * the whole `localization` bucket has to go. A generation counter IS that drop,
 * in O(1), without walking a Map from inside a change handler.
 *
 * The subscription is deliberately never disposed: it holds one integer per
 * occupant, the occupant outlives this module's interest in it, and a disposer
 * would need a shutdown hook a pure resolver does not have. `subscribe` is
 * feature-detected — an occupant without the seam still gets the epoch backstop
 * and the TTL, it just loses the precise trigger.
 */
function localizationSettingsState(settings: unknown): LocalizationSettingsState {
  if (!settings || typeof settings !== 'object') return localizationNoSettingsState;
  const existing = localizationSettingsStates.get(settings as object);
  if (existing) return existing;
  const state: LocalizationSettingsState = { gen: 0 };
  localizationSettingsStates.set(settings as object, state);
  const subscribe = (settings as { subscribe?: unknown }).subscribe;
  if (typeof subscribe === 'function') {
    try {
      (subscribe as (ns: string, handler: () => void) => unknown).call(
        settings,
        'localization',
        () => {
          state.gen += 1;
        },
      );
    } catch {
      // An occupant whose seam refuses leaves the epoch backstop and the TTL.
    }
  }
  return state;
}

/**
 * One entry per `ql` → `tenantId|userId`. ONE table, two lifecycles — the two
 * docblocks above are why they must not collapse into a single rule:
 *
 *   `failure` — #10221/#11877. TTL only; no invalidation ever retires it.
 *   `success` — #11966 / #11633 leg C. Retired by the settings seam, by the
 *               engine write epoch, or by the TTL — whichever comes first.
 */
interface LocalizationCacheEntry {
  value: LocalizationResult;
  expiresAt: number;
  kind: 'failure' | 'success';
  /** `success` only: the engine write epoch this value was read at. */
  epoch?: number;
  /** `success` only: the settings occupant this value was read through. */
  settings?: LocalizationSettingsState;
  /** `success` only: that occupant's generation at read time. */
  settingsGen?: number;
}

const localizationCache = new WeakMap<object, Map<string, LocalizationCacheEntry>>();

/**
 * The invalidation half of "is this entry still the answer?" — the caller
 * checks `expiresAt` separately, because the TTL applies to both kinds and
 * these rules apply to one.
 */
function localizationEntryIsLive(
  entry: LocalizationCacheEntry,
  epoch: number | undefined,
  settings: LocalizationSettingsState,
): boolean {
  if (entry.kind === 'failure') return true;
  return entry.epoch === epoch && entry.settings === settings && entry.settingsGen === settings.gen;
}

function putLocalizationEntry(ql: object, key: string, entry: LocalizationCacheEntry): void {
  const bucket = localizationCache.get(ql) ?? new Map<string, LocalizationCacheEntry>();
  bucket.set(key, entry);
  localizationCache.set(ql, bucket);
}

/**
 * Resolve workspace localization defaults (reference `timezone` / `locale` /
 * `currency`). Canonical path is the `localization` SettingsManifest (cascade:
 * platform default → global → tenant); falls back to direct tenant-scoped
 * `sys_setting` rows, then the built-ins `UTC` / `en-US`. Never throws.
 *
 * The DIRECT `sys_setting` read failing outright (backend fault — table
 * missing, connection refused, etc.) is memoized for
 * {@link LOCALIZATION_FAILURE_CACHE_TTL_MS} per `(ql, tenantId, userId)` so
 * the failing query — and the driver's log line for it — does not repeat
 * every request (#10221). A settings-service refusal is not a backend fault
 * and never populates that memo (#11877).
 *
 * A SUCCESSFUL read is cached too, since #11966 (leg C of #11633) — but only
 * when the engine carries the write-epoch seam, and only until the first of:
 * a `localization` settings change, an engine write, or
 * `OS_LOCALIZATION_CACHE_TTL_MS`. Both invalidations are synchronous and
 * in-process, which is what lets the success cache exist at all: the
 * dogfood analytics-bucketing test writes a new org timezone and reads it back
 * on the very next request, and it is kept unweakened as this leg's acceptance
 * criterion. See the leg-C docblock above for the full contract, including why
 * a `ql` with no seam declines to cache rather than falling back to the TTL.
 */
export async function resolveLocalizationContext(input: ResolveLocalizationInput): Promise<LocalizationResult> {
  const { ql, settings, tenantId, userId } = input;
  const cacheKey = `${tenantId ?? ''}|${userId ?? ''}`;
  const cacheable = Boolean(ql) && typeof ql === 'object';

  // ⭐ Both invalidation readings are taken BEFORE the resolve, and it is these
  // pre-read values that get stored with the answer. A write landing WHILE this
  // read is in flight therefore moves the epoch (or the generation) past what
  // the entry records, so the entry is already dead when it is written — the
  // safe direction. Reading them afterwards would stamp a pre-write value with
  // a post-write epoch and make that staleness permanent: the
  // clear-then-repopulate-from-a-stale-read failure #11633 §7 pin 2 names.
  const epoch = cacheable ? readWriteEpoch(ql) : undefined;
  const settingsState = localizationSettingsState(settings);

  if (cacheable) {
    const hit = localizationCache.get(ql)?.get(cacheKey);
    if (hit && hit.expiresAt > Date.now() && localizationEntryIsLive(hit, epoch, settingsState)) {
      return hit.value;
    }
  }

  const { value, backendFailed } = await resolveLocalizationContextUncached(input);
  if (!cacheable) return value;

  if (backendFailed) {
    putLocalizationEntry(ql, cacheKey, {
      value,
      expiresAt: Date.now() + LOCALIZATION_FAILURE_CACHE_TTL_MS,
      kind: 'failure',
    });
    return value;
  }

  const ttlMs = localizationSuccessCacheTtlMs();
  if (epoch !== undefined && ttlMs > 0) {
    putLocalizationEntry(ql, cacheKey, {
      value,
      expiresAt: Date.now() + ttlMs,
      kind: 'success',
      epoch,
      settings: settingsState,
      settingsGen: settingsState.gen,
    });
  } else {
    // Nothing to store — but the entry this read just superseded must not be
    // left behind either. (Reaching here means no LIVE entry was found above,
    // so this only ever drops a dead one.)
    localizationCache.get(ql)?.delete(cacheKey);
  }
  return value;
}

async function resolveLocalizationContextUncached(
  input: ResolveLocalizationInput,
): Promise<{ value: LocalizationResult; backendFailed: boolean }> {
  const { ql, settings, tenantId, userId } = input;
  // ONLY the direct `sys_setting` read below sets this. The settings-service
  // legs deliberately do not — see the cache doc above (#11877).
  let backendFailed = false;
  try {
    if (settings && typeof settings.get === 'function') {
      const sctx = { tenantId, userId } as any;
      // [#10826] ONE grouped namespace read instead of three: `getMany`
      // resolves all three keys over at most two `loadRows` calls (queries
      // 16–18 of 24 on the measured rig collapse to one). Same per-key
      // answers by the service's own equivalence contract. Feature-detected:
      // an older service without `getMany` keeps the three parallel `get`s
      // (still 1 leg — this is a query-count fix, per the card's calibration).
      // A thrown `getMany` lands in the same place a thrown `get` did — the
      // direct `$in` fallback below, which reads the exact same three keys.
      // Neither populates the failure memo: a settings refusal is not the
      // backend fault that memo is for (#11877; see the cache doc above).
      //
      // [#11222 item 4] ONE non-equivalence, inherent to batching and recorded
      // here because it is this CALLER's degradation, not the service's:
      // `getMany` validates every requested key up front and throws for the
      // WHOLE call, so a host that registered a PARTIAL `localization`
      // manifest (missing any of the three keys) loses all three at once,
      // where the per-key path would still have resolved the declared ones.
      // The `$in` fallback below then answers from tenant-scoped rows only —
      // it has no `global` scope layer and no `OS_LOCALIZATION_*` env
      // override. Degradation, never a wrong answer, and unreachable against
      // the in-repo `localizationSettingsManifest`, which declares all three.
      // The all-or-nothing rule itself is `SettingsService.getMany`'s own
      // contract and is documented there, not here.
      let tzRes: any; let localeRes: any; let currencyRes: any;
      if (typeof settings.getMany === 'function') {
        try {
          const many = await settings.getMany('localization', ['timezone', 'locale', 'currency'], sctx);
          tzRes = many.timezone;
          localeRes = many.locale;
          currencyRes = many.currency;
        } catch {
          // Settings refusal → fall through to the direct `$in` read below.
          // Not a backend fault, so it does not populate the memo (#11877).
        }
      } else {
        // Same rule as the batched arm above: a refused key falls through to
        // the direct `$in` read and does not populate the memo (#11877).
        [tzRes, localeRes, currencyRes] = await Promise.all([
          settings.get('localization', 'timezone', sctx).catch(() => undefined),
          settings.get('localization', 'locale', sctx).catch(() => undefined),
          settings.get('localization', 'currency', sctx).catch(() => undefined),
        ]);
      }
      const tz = coerceTimeZone(tzRes?.value);
      const locale = coerceLocale(localeRes?.value);
      const currency = coerceCurrency(currencyRes?.value);
      if (tz || locale || currency) {
        return { value: { timezone: tz ?? 'UTC', locale: locale ?? 'en-US', currency }, backendFailed: false };
      }
    }
  } catch {
    // Settings service unavailable → direct read. Still not a backend fault,
    // so it does not populate the memo either (#11877).
  }
  // One read for all three keys instead of a query per key (`$in` on `key`).
  // Inlined (rather than the shared `tryFind`) so a genuine backend fault —
  // as opposed to a legitimate empty result — is visible to the caller above,
  // which is the signal the failure-only cache keys off. `ql` is already
  // typed `any` (its shape varies by caller — REST's engine, a test double,
  // …), so the options literal below needs no `as any` of its own (#4918
  // query-options-erasure guard: that cast is a distinct, counted erasure
  // site, not implied by an already-`any` receiver).
  let rows: any[] = [];
  if (ql && typeof ql.find === 'function') {
    try {
      let result = await ql.find('sys_setting', {
        where: { namespace: 'localization', key: { $in: ['timezone', 'locale', 'currency'] }, scope: 'tenant' },
        limit: 10,
        context: { isSystem: true },
      });
      if (result && (result as any).value) result = (result as any).value;
      rows = Array.isArray(result) ? result : [];
    } catch {
      // THE backend fault the failure memo exists for (#10221).
      backendFailed = true;
    }
  }
  const valueOf = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    value: {
      timezone: coerceTimeZone(valueOf('timezone')) ?? 'UTC',
      locale: coerceLocale(valueOf('locale')) ?? 'en-US',
      currency: coerceCurrency(valueOf('currency')),
    },
    backendFailed,
  };
}
