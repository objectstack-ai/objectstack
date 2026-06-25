// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * resolveExecutionContext — REST entry-point identity resolver.
 *
 * Builds an {@link ExecutionContext} from an incoming HTTP request by combining:
 *  - better-auth Bearer/Session cookies (`authService.api.getSession`)
 *  - API Key headers (`X-API-Key` / `Authorization: ApiKey <token>`) — a
 *    hand-rolled check that hashes the inbound key and looks it up against the
 *    `sys_api_key` system object by its at-rest hash, rejecting revoked or
 *    expired keys. (better-auth 1.6.x ships no apiKey plugin.)
 *  - `sys_member` lookup for `(userId, activeOrganizationId)` to populate
 *    organization-scoped roles, plus any extra permission sets bound through
 *    the `sys_user_permission_set` / `sys_role_permission_set` link tables.
 *
 * The resolver is intentionally non-fatal: when auth is not wired up or any
 * of the dependent services are unavailable, it returns the partial context
 * that can be reconstructed (even an empty `{ isSystem: false, roles: [],
 * permissions: [] }`). Permission enforcement is the SecurityPlugin's job.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';

import { resolveApiKeyPrincipal } from './api-key.js';
import {
  mapMembershipRole,
  BUILTIN_ROLE_PLATFORM_ADMIN,
  ADMIN_FULL_ACCESS,
} from '@objectstack/spec';

interface ResolveOptions {
  /** Function returning a service from the active kernel (or undefined). */
  getService: (name: string) => Promise<any> | any;
  /** Function returning the data engine (ObjectQL) for the active scope. */
  getQl: () => Promise<any> | any;
  /** The raw incoming HTTP request (Fetch Request, Node IncomingMessage, …). */
  request: any;
}

/**
 * Convert the dispatcher's plain `Record<string,string>` headers map into
 * a Web `Headers` instance so libraries like better-auth (which reads via
 * `headers.get('cookie')`) work uniformly.
 */
function toHeaders(input: any): any {
  if (!input) return new Headers();
  if (typeof Headers !== 'undefined' && input instanceof Headers) return input;
  const h = new Headers();
  if (typeof input.entries === 'function') {
    for (const [k, v] of input.entries()) h.set(String(k), String(v));
    return h;
  }
  for (const k of Object.keys(input)) {
    const v = (input as any)[k];
    if (v == null) continue;
    h.set(String(k), Array.isArray(v) ? v.join(',') : String(v));
  }
  return h;
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

/** True for a valid IANA timezone name (e.g. `America/New_York`, `UTC`). */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Coerce a stored preference/setting value to a valid IANA zone, or undefined. */
function coerceTimeZone(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
  return s && isValidTimeZone(s) ? s : undefined;
}

/** Coerce a stored locale value to a non-empty BCP-47-ish string, or undefined. */
function coerceLocale(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
  return s || undefined;
}

/** Coerce a stored currency value to an ISO 4217 (3-letter) code, or undefined. */
function coerceCurrency(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(s) ? s : undefined;
}

/**
 * Resolve the workspace localization defaults onto the ExecutionContext
 * (ADR-0053 Phase 2): reference `timezone` and `locale`.
 *
 * Canonical path is the `localization` SettingsManifest via the `settings`
 * service, whose cascade is platform default → global → tenant (ADR-0002: one
 * org per physical tenant; per-user overrides are intentionally out of scope
 * for v1). When the settings service or its namespace is unavailable (e.g. a
 * minimal deployment), fall back to a direct tenant-scoped `sys_setting` read,
 * then to the built-ins `UTC` / `en-US`.
 *
 * Every read is defensive — localization never blocks auth, and an invalid
 * zone falls through to the built-in.
 */
async function resolveLocalization(
  opts: ResolveOptions,
  ql: any,
  sctx: { tenantId?: string; userId?: string },
): Promise<{ timezone: string; locale: string; currency?: string }> {
  // 1. Canonical — the `localization` manifest via the settings service.
  try {
    const settings: any = await opts.getService('settings');
    if (settings && typeof settings.get === 'function') {
      const [tzRes, localeRes, currencyRes] = await Promise.all([
        settings.get('localization', 'timezone', sctx).catch(() => undefined),
        settings.get('localization', 'locale', sctx).catch(() => undefined),
        settings.get('localization', 'currency', sctx).catch(() => undefined),
      ]);
      const tz = coerceTimeZone(tzRes?.value);
      const locale = coerceLocale(localeRes?.value);
      const currency = coerceCurrency(currencyRes?.value);
      // A resolved value (incl. the manifest default) means the namespace is
      // live — trust it and skip the legacy direct read.
      if (tz || locale || currency) return { timezone: tz ?? 'UTC', locale: locale ?? 'en-US', currency };
    }
  } catch {
    // settings service unavailable → fall through to the direct read
  }

  // 2. Fallback — direct tenant-scoped `sys_setting` rows (no settings service
  //    registered, or namespace not loaded).
  const tzRows = await tryFind(ql, 'sys_setting', { namespace: 'localization', key: 'timezone', scope: 'tenant' }, 1);
  const localeRows = await tryFind(ql, 'sys_setting', { namespace: 'localization', key: 'locale', scope: 'tenant' }, 1);
  const currencyRows = await tryFind(ql, 'sys_setting', { namespace: 'localization', key: 'currency', scope: 'tenant' }, 1);
  return {
    timezone: coerceTimeZone(tzRows[0]?.value) ?? 'UTC',
    locale: coerceLocale(localeRows[0]?.value) ?? 'en-US',
    currency: coerceCurrency(currencyRows[0]?.value),
  };
}

/**
 * Resolve the {@link ExecutionContext} for an inbound request.
 *
 * Always resolves — never throws. Anonymous requests yield
 * `{ isSystem: false, roles: [], permissions: [] }`.
 */
export async function resolveExecutionContext(opts: ResolveOptions): Promise<ExecutionContext> {
  const headers = opts.request?.headers;
  const ctx: ExecutionContext = {
    roles: [],
    permissions: [],
    systemPermissions: [],
    isSystem: false,
  };

  let userId: string | undefined;
  let tenantId: string | undefined;

  // 1. API Key path — takes precedence over session, since callers explicitly
  //    opt in to API-key auth via the header.
  //
  //    better-auth 1.6.x ships no apiKey plugin, so this is a hand-rolled
  //    check: hash the inbound key, look it up against `sys_api_key` by the
  //    at-rest hash, and reject revoked or expired keys. The raw key is never
  //    stored or logged. Once resolved, the principal flows through the exact
  //    same role/permission/RLS resolution as the session path below.
  //    Verification is delegated to the shared `resolveApiKeyPrincipal`
  //    (@objectstack/core), the SAME verifier the REST data API uses, so the
  //    two surfaces never drift.
  const keyPrincipal = await resolveApiKeyPrincipal(await opts.getQl(), headers);
  if (keyPrincipal) {
    userId = keyPrincipal.userId;
    tenantId = keyPrincipal.tenantId;
    for (const scope of keyPrincipal.scopes) {
      if (!ctx.permissions!.includes(scope)) ctx.permissions!.push(scope);
    }
  }

  // 2. Session / Bearer path — fall back when API key did not resolve a user.
  if (!userId) {
    try {
      const authService: any = await opts.getService('auth');
      // The auth service surfaces its better-auth API either as `.api`
      // (legacy direct mount) or via `await getApi()` (lazy plugin).
      // Try both so we don't silently degrade to anonymous when the
      // shape differs across plugin versions.
      let api: any = authService?.api;
      if (!api && typeof authService?.getApi === 'function') {
        api = await authService.getApi();
      }
      const headersInstance = toHeaders(headers);
      const sessionData = await api?.getSession?.({ headers: headersInstance });
      userId = sessionData?.user?.id ?? sessionData?.session?.userId;
      tenantId = tenantId ?? sessionData?.session?.activeOrganizationId;
      ctx.accessToken = sessionData?.session?.token ?? ctx.accessToken;
      // Session carries the user's email for free → use it for RLS owner-by-email.
      if (sessionData?.user?.email) ctx.email = String(sessionData.user.email);
    } catch {
      // no auth configured — return anonymous context
    }
  }

  if (userId) ctx.userId = userId;
  if (tenantId) ctx.tenantId = tenantId;

  if (!userId) return ctx;

  // 3. Resolve organization-scoped roles via sys_member, then merge any
  //    permission sets bound via the link tables. All lookups go through
  //    ObjectQL with `isSystem: true` to avoid recursion through the
  //    SecurityPlugin middleware.
  const ql = await opts.getQl();
  if (!ql) return ctx;

  // Resolve the caller's unique email for `current_user.email` RLS policies when
  // the session path didn't supply it (e.g. API-key auth). One bounded lookup;
  // email is the auth-unique owner anchor (display name is never used — it
  // collides, and a collision on an ownership predicate leaks access).
  if (!ctx.email) {
    const userRows = await tryFind(ql, 'sys_user', { id: userId }, 1);
    if (userRows[0]?.email) ctx.email = String(userRows[0].email);
  }

  const memberWhere: any = tenantId
    ? { user_id: userId, organization_id: tenantId }
    : { user_id: userId };
  const members = await tryFind(ql, 'sys_member', memberWhere, 50);
  for (const m of members) {
    if (m.role && typeof m.role === 'string') {
      // better-auth stores comma-separated roles for multi-role membership.
      for (const raw of m.role.split(',').map((s: string) => s.trim()).filter(Boolean)) {
        // ADR-0068 D2: normalize better-auth owner/admin/member to the canonical
        // org_owner/org_admin/org_member built-in role names.
        const r = mapMembershipRole(raw);
        if (!ctx.roles!.includes(r)) ctx.roles!.push(r);
      }
    }
  }

  // [ADR-0057 D4] Platform-owned RBAC role assignments — the source of truth,
  // decoupled from better-auth's `sys_member.role` (which is being reframed to
  // org-administration: owner/admin/member). Merged alongside membership roles
  // during the transition window. `organization_id = null` = a global (cross-
  // tenant) assignment; tenant-scoped assignments match the active org.
  const userRoleRows = await tryFind(ql, 'sys_user_role', { user_id: userId }, 200);
  for (const ur of userRoleRows) {
    const org = ur.organization_id ?? null;
    if (org && tenantId && org !== tenantId) continue;
    const r = ur.role;
    if (typeof r === 'string' && r && !ctx.roles!.includes(r)) ctx.roles!.push(r);
  }

  // 3a. Resolve fellow-organization user IDs so RLS can scope identity
  //     tables (`sys_user`) to collaborators in the active org via
  //     `id IN (current_user.org_user_ids)`. Without this, the default
  //     `id = current_user.id` policy on sys_user makes @-mention pickers,
  //     owner/assignee lookups and reviewer selectors all return just the
  //     current user. Hard-capped at 1000 members per request — large
  //     enterprises should plug in a cache or directory adapter.
  if (tenantId) {
    const orgMembers = await tryFind(
      ql,
      'sys_member',
      { organization_id: tenantId },
      1000,
    );
    const orgUserIds = Array.from(
      new Set(
        orgMembers
          .map((m) => m.user_id ?? m.userId)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );
    // Always include self even if the sys_member lookup misfires (e.g.
    // API key auth where the user is recognised but not in sys_member).
    if (!orgUserIds.includes(userId)) orgUserIds.push(userId);
    (ctx as any).org_user_ids = orgUserIds;
  } else {
    // No active org → at minimum the user can see themselves.
    (ctx as any).org_user_ids = [userId];
  }

  // Resolve user-scoped permission sets.
  //
  // [ADR-0066] A platform-scoped grant (`organization_id IS NULL`) is GLOBAL and
  // must apply regardless of the caller's active org. Querying with
  // `organization_id = tenantId` dropped null-org grants the moment a user had
  // an active org — so a platform admin who also owns an org silently lost
  // `admin_full_access` (and its `systemPermissions`), which then locked them
  // out of a `requiredPermissions`-gated control-plane object (e.g. sys_license).
  // Mirror the role-binding logic above (null org = global, cross-org): fetch the
  // user's grants and keep null-org + active-org ones, dropping only grants
  // scoped to a DIFFERENT org.
  const upsRows = await tryFind(ql, 'sys_user_permission_set', { user_id: userId }, 100);
  const psIds = new Set<string>(
    upsRows
      .filter((r) => {
        const org = (r.organization_id ?? r.organizationId) ?? null;
        return !(org && tenantId && org !== tenantId);
      })
      .map((r) => r.permission_set_id ?? r.permissionSetId)
      .filter(Boolean),
  );

  // ADR-0068 D2: platform_admin is DERIVED from the UNSCOPED (org_id = null)
  // admin_full_access grant — the single source of truth. Track which permission
  // sets came from a null-org USER grant so we can project the built-in role
  // without trusting any stored boolean flag.
  const unscopedUserPsIds = new Set<string>(
    upsRows
      .filter((r) => ((r.organization_id ?? r.organizationId) ?? null) === null)
      .map((r) => r.permission_set_id ?? r.permissionSetId)
      .filter(Boolean),
  );
  let hasPlatformAdminGrant = false;

  // Resolve role-bound permission sets.
  if (ctx.roles!.length > 0) {
    const roleRows = await tryFind(ql, 'sys_role', { name: { $in: ctx.roles } }, 100);
    const roleIds = roleRows.map((r) => r.id).filter(Boolean);
    if (roleIds.length > 0) {
      const rpsRows = await tryFind(
        ql,
        'sys_role_permission_set',
        { role_id: { $in: roleIds } },
        500,
      );
      for (const r of rpsRows) {
        const id = r.permission_set_id ?? r.permissionSetId;
        if (id) psIds.add(id);
      }
    }
  }

  if (psIds.size > 0) {
    // Surface permission set names through ctx.permissions so downstream
    // SecurityPlugin can look them up. We store the canonical `name` field.
    const psRows = await tryFind(
      ql,
      'sys_permission_set',
      { id: { $in: Array.from(psIds) } },
      500,
    );
    const tabRank: Record<string, number> = {
      hidden: 0,
      default_off: 1,
      default_on: 2,
      visible: 3,
    };
    const mergedTabs: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'> = {};
    for (const ps of psRows) {
      if (ps.name && !ctx.permissions!.includes(ps.name)) {
        ctx.permissions!.push(ps.name);
      }
      // ADR-0068 D2: an UNSCOPED admin_full_access grant => platform admin.
      if (ps.name === ADMIN_FULL_ACCESS && unscopedUserPsIds.has(ps.id)) {
        hasPlatformAdminGrant = true;
      }
      // System permissions may be stored as JSON string in DB rows.
      const sysPerms = typeof ps.system_permissions === 'string'
        ? safeJsonParse(ps.system_permissions, [])
        : (ps.system_permissions ?? ps.systemPermissions);
      if (Array.isArray(sysPerms)) {
        for (const p of sysPerms) {
          if (typeof p === 'string' && !ctx.systemPermissions!.includes(p)) {
            ctx.systemPermissions!.push(p);
          }
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
    if (Object.keys(mergedTabs).length > 0) {
      ctx.tabPermissions = mergedTabs;
    }
  }

  // ADR-0068 D2: project the derived platform_admin built-in role (unshift so it
  // leads the list). roles[] is canonical; isPlatformAdmin is a derived alias.
  if (hasPlatformAdminGrant && !ctx.roles!.includes(BUILTIN_ROLE_PLATFORM_ADMIN)) {
    ctx.roles!.unshift(BUILTIN_ROLE_PLATFORM_ADMIN);
  }

  // 4. Localization (ADR-0053 Phase 2) — reference timezone + locale resolved
  //    once per request from the `localization` settings and carried on the
  //    context. Consumers: formula today()/datetime, analytics date buckets,
  //    email rendering. Absent config → UTC / en-US keeps current behavior.
  const localization = await resolveLocalization(opts, ql, { tenantId, userId });
  ctx.timezone = localization.timezone;
  ctx.locale = localization.locale;
  if (localization.currency) ctx.currency = localization.currency;

  return ctx;
}

/**
 * Typed sentinel error thrown by SecurityPlugin (and re-thrown here) when an
 * operation is denied. The dispatcher catches it and translates to HTTP 403.
 *
 * Kept structurally identical to {@link `@objectstack/plugin-security`}'s
 * `PermissionDeniedError` so `isPermissionDeniedError` matches whichever
 * class instance crosses the boundary, regardless of which package owns
 * the actual class identity at runtime. We do not add a hard dependency
 * on `plugin-security` here to keep the runtime usable in stack
 * compositions without security enforcement.
 */
export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly statusCode = 403;
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PermissionDeniedError';
    this.details = details;
  }
}

export function isPermissionDeniedError(e: unknown): e is PermissionDeniedError {
  if (!e || typeof e !== 'object') return false;
  const anyE = e as any;
  return (
    anyE.name === 'PermissionDeniedError' ||
    anyE.code === 'PERMISSION_DENIED' ||
    (typeof anyE.message === 'string' && anyE.message.startsWith('[Security] Access denied'))
  );
}
