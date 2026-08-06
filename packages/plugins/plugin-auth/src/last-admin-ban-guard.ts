// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [cloud ADR-0024 D5.2] Break-glass — a write may never leave this environment
 * with ZERO administrators able to sign in.
 *
 * `sys_user.banned = true` is how EVERY deprovision lands: the better-auth
 * admin plugin's ban endpoint writes it, and `@better-auth/scim` maps a SCIM
 * `active: false` onto that same admin ban (which is why SCIM forces the admin
 * plugin on — ADR-0071). SCIM writes are driven by an EXTERNAL system: nobody
 * reads the payload before it commits, so one mis-scoped IdP group or one
 * over-broad deprovision run is enough for an organization to ban its own last
 * administrator and lock itself out of its environment permanently. There is no
 * recovery path from inside the product once that happens.
 *
 * So the invariant is enforced at the WRITE, on the one chokepoint every path
 * goes through — `beforeUpdate` on `sys_user` — rather than at any individual
 * endpoint. HTTP-level guards protect only the endpoint they are attached to;
 * this one holds for the admin ban endpoint, the SCIM adapter write, an import,
 * a script, and anything added later.
 *
 * ## What counts as an administrator
 *
 * Exactly what `AuthManager.isOrgOrPlatformAdmin` (the repo's existing
 * admin-gate answer) counts, enumerated in the opposite direction:
 *
 *  1. **platform admin** — an UNSCOPED (`organization_id = null`), in-window
 *     (ADR-0091) `sys_user_permission_set` grant of `admin_full_access`. This
 *     is the same evidence `resolveAuthzContext` derives `platform_admin` from
 *     (ADR-0068 D2 / ADR-0095 D3) — never a stored `sys_user.role` string.
 *  2. **organization owner / admin** — a `sys_member` row whose role carries
 *     the `owner` or `admin` grade (ADR-0108's closed vocabulary). Grade, not
 *     capability: it is read here only as "who administers this org", which is
 *     the standing ADR-0057 D4 leaves on that column.
 *
 * `delegated_admin` deliberately does NOT count. ADR-0105 D8 defines it as a
 * grade that can REACH an endpoint, carrying no authority of its own — counting
 * it would let the guard believe an administrator remains when nobody can
 * actually restore access. `usr_system` does not count either: the legacy
 * service account is not loginable, so it can never be the escape hatch (the
 * same exclusion the first-admin bootstrap makes).
 *
 * ## Fail-closed
 *
 * Every lookup this guard makes is part of a SAFETY proof: a ban is permitted
 * only when at least one other unbanned administrator is provably left. A
 * lookup that fails, or a population too large to enumerate, proves nothing —
 * so the ban is REFUSED, loudly, with the reason. That is the opposite of the
 * fail-OPEN posture the neighbouring last-local-credential guard takes in
 * `auth-manager.ts` (an HTTP-level convenience check whose failure mode is a
 * blocked legitimate op); here the failure mode is a permanent lockout, so the
 * two directions are chosen deliberately and are not a drift.
 *
 * ## Scope: the ENVIRONMENT, not each organization
 *
 * The invariant protects the deployment's ability to be administered at all —
 * "≥ 1 unbanned administrator remains anywhere in this environment". A stricter
 * per-organization rule ("every org keeps an owner") is a different, larger
 * policy with its own product decisions (what happens to an org whose only
 * owner leaves the company); it is deliberately not invented here.
 *
 * ## Relationship to the ADR-0092 identity write guard
 *
 * `identity-write-guard.ts` answers "may this CALLER write identity tables
 * through the generic data path" and bypasses system-context writes by design —
 * better-auth's own adapter is exactly what it must let through. This guard
 * answers a different question, "may this VALUE be written at all", and
 * therefore applies to EVERY context, `isSystem` included: the ban path that
 * actually causes lockouts is the system one. The two are registered together
 * (`auth-plugin.ts`, `kernel:ready`) and ordered so the ADR-0092 strip runs
 * first (priority 10 → 20): a user-context caller keeps getting the ADR-0092
 * message ("`banned` is not editable via the data API"), and only the writes
 * that legitimately carry `banned` reach this guard.
 */

import type { BaseEngineOptions, EngineQueryOptions } from '@objectstack/spec/data';
import {
  ADMIN_FULL_ACCESS,
  MEMBERSHIP_ROLE_ADMIN,
  MEMBERSHIP_ROLE_MEMBER,
  MEMBERSHIP_ROLE_OWNER,
} from '@objectstack/spec/identity';
import { SystemObjectName, SystemUserId } from '@objectstack/spec/system';
import { isGrantActive } from '@objectstack/core';

import { isOrgAdminGrade } from './invitation-role-cap.js';

/** `sys_user_permission_set` has no `SystemObjectName` member; it is spelled once, here. */
const USER_PERMISSION_SET = 'sys_user_permission_set';

type LoggerLike = {
  info(msg: string): void;
  warn(msg: string): void;
  debug?(msg: string): void;
};

/**
 * The engine surface this guard needs — hook registration plus system-context
 * reads. Structural rather than `IObjectQLEngine` so the guard can be driven
 * directly in tests without standing up an engine.
 */
export interface LastAdminBanGuardEngine {
  registerHook(
    event: string,
    handler: (ctx: unknown) => Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  find(
    objectName: string,
    query?: EngineQueryOptions,
    options?: BaseEngineOptions,
  ): Promise<Array<Record<string, unknown>>>;
}

export interface LastAdminBanGuardOptions {
  packageId: string;
  logger?: LoggerLike;
  /**
   * Largest row count any one enumeration read may return before the guard
   * gives up and refuses (fail-closed). The administrator population of an
   * environment is tiny; this exists so a pathological predicate ban — or a
   * `sys_member` table with tens of thousands of non-plain-member rows —
   * cannot be silently under-counted into a lockout. Default 1000.
   */
  maxScan?: number;
}

const DEFAULT_MAX_SCAN = 1000;

/** Reads run as system: this is a safety proof, never RLS-scoped to a caller. */
const SYSTEM_READ: BaseEngineOptions = { context: { isSystem: true } };

/**
 * Boolean columns arrive spelled by whichever driver / transport wrote them:
 * better-auth's adapter is configured `supportsBooleans: false` (so it hands
 * ObjectQL 1/0), sqlite stores 1/0, the memory driver keeps real booleans, and
 * a REST body can carry the string. Anything that is not one of these is NOT a
 * ban — an `undefined` / absent `banned` must never be read as "true".
 */
function isTrueFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** The refusal. `PERMISSION_DENIED` + 403 is what `mapDataError` already maps. */
function refuse(message: string): Error {
  const err = new Error(`PERMISSION_DENIED: ${message}`) as Error & {
    code?: string;
    status?: number;
    object?: string;
  };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.object = SystemObjectName.USER;
  return err;
}

/** Marker so the fail-closed wrapper re-throws a deliberate refusal unchanged. */
function isRefusal(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'PERMISSION_DENIED';
}

const BREAK_GLASS_CITATION =
  'break-glass invariant, ADR-0024 D5.2 — an environment must always keep at least one ' +
  'administrator who can sign in';

function toId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/**
 * Register the last-administrator ban guard on an ObjectQL engine.
 *
 * Idempotent per package the same way the identity write guard is: a caller
 * re-binding after a hot reload runs `engine.unregisterHooksByPackage(packageId)`
 * first.
 */
export function registerLastAdminBanGuard(
  engine: LastAdminBanGuardEngine,
  opts: LastAdminBanGuardOptions,
): void {
  const { packageId, logger } = opts;
  const maxScan = opts.maxScan ?? DEFAULT_MAX_SCAN;

  /** Enumerate `object` under a hard ceiling; overflow proves nothing → refuse. */
  const scan = async (
    object: string,
    query: EngineQueryOptions,
  ): Promise<Array<Record<string, unknown>>> => {
    const rows = await engine.find(object, { ...query, limit: maxScan + 1 }, SYSTEM_READ);
    const list = Array.isArray(rows) ? rows : [];
    if (list.length > maxScan) {
      throw refuse(
        `Refusing this ban: '${object}' returned more than ${maxScan} rows, so the remaining ` +
          `administrators could not be verified (${BREAK_GLASS_CITATION}). Ban a narrower set of ` +
          'users, or raise the guard\'s maxScan if this environment really is that large.',
      );
    }
    return list;
  };

  /** Every user this environment currently recognises as an administrator. */
  const resolveAdminUserIds = async (): Promise<Set<string>> => {
    const ids = new Set<string>();
    const now = Date.now();

    // 1) Platform admins — unscoped, in-window `admin_full_access` grants.
    const sets = await scan(SystemObjectName.PERMISSION_SET, {
      where: { name: ADMIN_FULL_ACCESS },
      fields: ['id', 'name'],
    });
    const adminSetIds = sets.map((r) => toId(r.id)).filter((v): v is string => Boolean(v));
    if (adminSetIds.length > 0) {
      const links = await scan(USER_PERMISSION_SET, {
        where: { permission_set_id: { $in: adminSetIds } },
      });
      for (const link of links) {
        // An org-SCOPED grant makes a tenant admin, not the environment's
        // break-glass admin — the same distinction `resolveAuthzContext` draws
        // when it derives `platform_admin` from the unscoped grant only.
        if (link.organization_id ?? link.organizationId) continue;
        if (!isGrantActive(link, now)) continue;
        const uid = toId(link.user_id ?? link.userId);
        if (uid) ids.add(uid);
      }
    }

    // 2) Organization owners / admins, graded by the ONE ladder that answers
    //    "does this role administer the org" (`invitation-role-cap.ts`) — a
    //    re-spelled `role === 'owner'` here would drop the comma-joined and
    //    array spellings that ladder handles, and mistake an environment's
    //    only owner for an ordinary member. Narrowed to non-plain-member rows
    //    so a large membership table is not read wholesale; the grade test
    //    itself still runs in memory, over every row that narrowing kept.
    const members = await scan(SystemObjectName.MEMBER, {
      where: { role: { $ne: MEMBERSHIP_ROLE_MEMBER } },
    });
    for (const m of members) {
      if (!isOrgAdminGrade(m.role)) continue;
      const uid = toId(m.user_id ?? m.userId);
      if (uid) ids.add(uid);
    }

    // The legacy service account is not loginable — it can never be the escape
    // hatch, so it must not be counted as one.
    ids.delete(SystemUserId.SYSTEM);
    return ids;
  };

  /** Of `adminIds`, those whose `sys_user` row is present and not banned. */
  const resolveUnbannedAdmins = async (adminIds: Set<string>): Promise<Set<string>> => {
    const rows = await scan(SystemObjectName.USER, {
      where: { id: { $in: [...adminIds] } },
      fields: ['id', 'banned'],
    });
    const out = new Set<string>();
    for (const row of rows) {
      const id = toId(row.id);
      // A row already carrying `banned` cannot sign in, so it is not one of the
      // administrators this write could be taking away.
      if (id && adminIds.has(id) && !isTrueFlag(row.banned)) out.add(id);
    }
    return out;
  };

  /** Which `sys_user` rows this one update writes to. */
  const resolveTargetIds = async (
    id: unknown,
    data: Record<string, unknown>,
    options: { where?: unknown } | undefined,
  ): Promise<Set<string>> => {
    const single = toId(id) ?? toId(data.id);
    if (single) return new Set([single]);
    // Predicate / multi update: `input.id` is unbound and the row-scoping
    // predicate rides on `input.options.where` (#5273 pinned that shape).
    const where = options?.where as EngineQueryOptions['where'];
    const rows = await scan(SystemObjectName.USER, {
      ...(where !== undefined ? { where } : {}),
      fields: ['id'],
    });
    const out = new Set<string>();
    for (const row of rows) {
      const rid = toId(row.id);
      if (rid) out.add(rid);
    }
    return out;
  };

  const guardBan = async (rawCtx: unknown): Promise<void> => {
    const ctx = (rawCtx ?? {}) as {
      object?: string;
      input?: { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown } };
    };
    if (ctx.object !== SystemObjectName.USER) return;

    const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
    // Only a write that TURNS the ban on is interesting. An unban, an
    // unrelated profile write, or a payload the ADR-0092 strip already emptied
    // of `banned` can never reduce the administrator population.
    if (!('banned' in data) || !isTrueFlag(data.banned)) return;

    try {
      const admins = await resolveAdminUserIds();
      // Nothing recognised as an administrator: there is no break-glass account
      // to protect and refusing every ban would be a guard inventing a policy
      // out of an empty measurement. (A deployment reaches this only before the
      // first admin is bootstrapped.)
      if (admins.size === 0) return;

      const unbanned = await resolveUnbannedAdmins(admins);
      const targets = await resolveTargetIds(ctx.input?.id, data, ctx.input?.options);

      const losing = [...unbanned].filter((id) => targets.has(id));
      // No administrator that could still sign in is affected → not our case.
      // This is also what makes re-banning an already-banned admin a no-op
      // rather than a refusal: nothing is being taken away.
      if (losing.length === 0) return;

      const remaining = [...unbanned].filter((id) => !targets.has(id));
      if (remaining.length > 0) return;

      logger?.warn(
        `[LastAdminBanGuard] refused a ban that would have left this environment with no ` +
          `unbanned administrator (target: ${losing.join(', ')})`,
      );
      const many = losing.length > 1;
      throw refuse(
        `Refusing to ban ${losing.map((id) => `'${id}'`).join(', ')}: ` +
          `${many ? 'those are the last administrators' : 'that is the last administrator'} this ` +
          `environment has that ${many ? 'are' : 'is'} not already banned, and banning ` +
          `${many ? 'them' : 'that account'} would leave nobody able to administer the ` +
          `environment or restore anyone's access (${BREAK_GLASS_CITATION}). Grant another user ` +
          `the '${ADMIN_FULL_ACCESS}' permission set or an organization ` +
          `'${MEMBERSHIP_ROLE_OWNER}'/'${MEMBERSHIP_ROLE_ADMIN}' membership first, then retry. ` +
          'If the ban came from an identity provider, the SCIM deprovision is too broad — fix the ' +
          'IdP group, not this guard.',
      );
    } catch (err) {
      if (isRefusal(err)) throw err;
      // Fail CLOSED: the guard could not prove another administrator survives,
      // and the cost of guessing wrong is a permanently locked-out environment.
      const reason = (err as Error)?.message ?? String(err);
      logger?.warn(`[LastAdminBanGuard] administrator lookup failed — ban refused: ${reason}`);
      throw refuse(
        'Refusing this ban: the remaining administrators could not be verified ' +
          `(${reason}). This guard fails closed — a ban is only permitted when at least one other ` +
          `unbanned administrator is provably left (${BREAK_GLASS_CITATION}). Retry once the ` +
          'identity tables are readable again.',
      );
    }
  };

  // Priority 20: AFTER the ADR-0092 identity write guard's strip (10), before
  // default-priority hooks (100) spend work on a write this may refuse.
  engine.registerHook('beforeUpdate', guardBan, {
    object: SystemObjectName.USER,
    priority: 20,
    packageId,
  });

  logger?.info('[LastAdminBanGuard] last-administrator ban guard registered (ADR-0024 D5.2)');
}
