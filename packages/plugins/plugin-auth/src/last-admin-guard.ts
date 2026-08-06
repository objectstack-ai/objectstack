// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [cloud ADR-0024 D5.2] Break-glass — a write may never leave this environment
 * with ZERO administrators able to sign in.
 *
 * TWO writes can take the last administrator away, and this guard holds on
 * both — they are one invariant, not two policies:
 *
 *  1. **`sys_user.banned = true`** (#5892) — how every *disable* lands: the
 *     better-auth admin plugin's ban endpoint writes it, and
 *     `@better-auth/scim` maps a SCIM `active: false` onto that same admin ban
 *     (which is why SCIM forces the admin plugin on — ADR-0071).
 *  2. **deleting the `sys_user` row** (#5941) — how every *remove* lands: SCIM
 *     `DELETE /Users/{id}`, better-auth's `/admin/remove-user` and
 *     `/delete-user`, an import, a script.
 *
 * In the case that matters both are driven by an EXTERNAL system: nobody reads
 * the payload before it commits, so one mis-scoped IdP group or one over-broad
 * deprovision run is enough for an organization to remove its own last
 * administrator and lock itself out of its environment permanently. There is no
 * recovery path from inside the product once that happens.
 *
 * So the invariant is enforced at the WRITE, on the two chokepoints every path
 * goes through — `beforeUpdate` and `beforeDelete` on `sys_user` — rather than
 * at any individual endpoint. HTTP-level guards protect only the endpoints they
 * are attached to; these hold for the admin ban / remove endpoints, the SCIM
 * adapter writes, an import, a script, and anything added later.
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
 * The population both halves protect is the administrators who can sign in
 * TODAY — the ones whose row is not already banned. A ban that takes the last
 * of them is refused; so is a delete. Conversely a write aimed at an
 * administrator who is ALREADY banned takes nothing away (that account cannot
 * sign in either way), so it is not this guard's business.
 *
 * ## Fail-closed
 *
 * Every lookup this guard makes is part of a SAFETY proof: the write is
 * permitted only when at least one other unbanned administrator is provably
 * left. A lookup that fails, or a population too large to enumerate, proves
 * nothing — so the write is REFUSED, loudly, with the reason. That is the
 * opposite of the fail-OPEN posture the neighbouring last-local-credential
 * guard takes in `auth-manager.ts`; the two directions are chosen deliberately
 * and are not a drift.
 *
 * ## Relationship to the `auth-manager.ts` break-glass HTTP guard
 *
 * `auth-manager.ts` already guards `/delete-user`, `/admin/remove-user` and
 * `/admin/ban-user` — but it answers a DIFFERENT question: "is the target the
 * last holder of a local `credential` account", i.e. the password escape hatch
 * that survives an IdP outage. When the target holds no local credential it
 * skips entirely, which is exactly the shape #5941 reported: under enforced SSO
 * the last administrator is IdP-managed (SCIM JIT-provisioned, no password), so
 * that guard never fires and the row is removed. It is also fail-OPEN by
 * design, because its failure mode is a blocked legitimate operation rather
 * than a lockout. Both properties are right FOR IT, so it is left untouched and
 * keeps enforcing its own invariant; this hook is the fail-closed one that
 * counts *administrators*, and it covers every write path rather than three
 * endpoints.
 *
 * ## What a `beforeDelete` can see (measured on this engine, #5929 included)
 *
 *  - **by-id** (`delete(obj, { where: { id } })` — what better-auth's adapter
 *    emits, and what every cascade recursion re-enters with): `input.id`
 *    carries the scalar id.
 *  - **predicate / `multi`**: `input.id` is present-but-undefined, and the
 *    CALLER's own options bag is still on `input.options`, predicate included
 *    — `delete()` only rebuilds that slot into `DriverOptions` *after* the
 *    `before*` hooks return. That is the same slot the ban half reads, and it
 *    does not contradict the `HookContextSchema.input` contract table
 *    (#5273 / #5899): what is unreachable from `input` is the composed
 *    `ast` — the *effective* predicate, onto which the filters middleware may
 *    add RLS / sharing scoping. Middleware can only NARROW it, so treating the
 *    caller's predicate as the doomed set over-approximates it, which is the
 *    fail-closed direction: this guard may refuse a delete that would have
 *    removed fewer rows, and can never miss one that removes more.
 *  - `ctx.previous` (the engine's #5272 pre-image, and objectql's
 *    `sys_fetch_previous_delete` builtin — `object: '*'`, priority 5) is bound
 *    for the by-id shape ONLY; a batch dispatch names no single row, so it
 *    stays undefined there. The guard therefore never consumes it: it needs the
 *    target IDS, not a pre-image, and a `previous`-based implementation would
 *    be correct by-id and blind on exactly the bulk path that can sweep every
 *    administrator at once.
 *
 * ## Scope: the ENVIRONMENT, not each organization
 *
 * The invariant protects the deployment's ability to be administered at all —
 * "≥ 1 unbanned administrator remains anywhere in this environment". A stricter
 * per-organization rule ("every org keeps an owner") is a different, larger
 * policy with its own product decisions (what happens to an org whose only
 * owner leaves the company); it is deliberately not invented here.
 *
 * Scope in the other direction: this guard watches the two writes that take the
 * administrator away WITH THEIR ROW. Revoking the standing that MAKES someone
 * an administrator — deleting their `sys_member` row, downgrading its role,
 * removing the `admin_full_access` grant — leaves the user in place and writes
 * a different table, so neither hook here sees it. Same end state, third write
 * shape; filed as #5978 rather than half-guarded from this file.
 *
 * ## Relationship to the ADR-0092 identity write guard
 *
 * `identity-write-guard.ts` answers "may this CALLER write identity tables
 * through the generic data path" and bypasses system-context writes by design —
 * better-auth's own adapter is exactly what it must let through. This guard
 * answers a different question, "may this WRITE happen at all", and therefore
 * applies to EVERY context, `isSystem` included: the deprovision path that
 * actually locks organizations out is the system one. The two are registered
 * together (`auth-plugin.ts`, `kernel:ready`) and ordered so the ADR-0092
 * checks run first (priority 10 → 20): a user-context caller keeps getting the
 * ADR-0092 answer (`banned` is not editable through the data API; an identity
 * row is not deletable through it at all), and only the writes that legitimately
 * reach the identity tables reach this guard.
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
export interface LastAdminGuardEngine {
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

export interface LastAdminGuardOptions {
  packageId: string;
  logger?: LoggerLike;
  /**
   * Largest row count any one enumeration read may return before the guard
   * gives up and refuses (fail-closed). The administrator population of an
   * environment is tiny; this exists so a pathological predicate write — or a
   * `sys_member` table with tens of thousands of non-plain-member rows —
   * cannot be silently under-counted into a lockout. Default 1000.
   */
  maxScan?: number;
}

const DEFAULT_MAX_SCAN = 1000;

/** Reads run as system: this is a safety proof, never RLS-scoped to a caller. */
const SYSTEM_READ: BaseEngineOptions = { context: { isSystem: true } };

/**
 * The two writes this guard judges. Carried into every message so a refusal
 * describes the operation the caller actually attempted — an operator reading
 * "refusing this ban" after a SCIM `DELETE /Users/{id}` would go looking in the
 * wrong place.
 */
type GuardedOp = 'ban' | 'delete';

const OP_WORDS: Record<GuardedOp, { noun: string; verb: string; gerund: string; Verb: string }> = {
  ban: { noun: 'ban', verb: 'ban', gerund: 'banning', Verb: 'Ban' },
  delete: { noun: 'delete', verb: 'delete', gerund: 'deleting', Verb: 'Delete' },
};

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
 * Register the last-administrator guard on an ObjectQL engine: the ban half
 * (`beforeUpdate`) and the delete half (`beforeDelete`) of ONE invariant, off
 * one administrator enumeration.
 *
 * Idempotent per package the same way the identity write guard is: a caller
 * re-binding after a hot reload runs `engine.unregisterHooksByPackage(packageId)`
 * first.
 */
export function registerLastAdminGuard(
  engine: LastAdminGuardEngine,
  opts: LastAdminGuardOptions,
): void {
  const { packageId, logger } = opts;
  const maxScan = opts.maxScan ?? DEFAULT_MAX_SCAN;

  /** Enumerate `object` under a hard ceiling; overflow proves nothing → refuse. */
  const scan = async (
    op: GuardedOp,
    object: string,
    query: EngineQueryOptions,
  ): Promise<Array<Record<string, unknown>>> => {
    const rows = await engine.find(object, { ...query, limit: maxScan + 1 }, SYSTEM_READ);
    const list = Array.isArray(rows) ? rows : [];
    if (list.length > maxScan) {
      const words = OP_WORDS[op];
      throw refuse(
        `Refusing this ${words.noun}: '${object}' returned more than ${maxScan} rows, so the ` +
          `remaining administrators could not be verified (${BREAK_GLASS_CITATION}). ` +
          `${words.Verb} a narrower set of users, or raise the guard's maxScan if this ` +
          'environment really is that large.',
      );
    }
    return list;
  };

  /** Every user this environment currently recognises as an administrator. */
  const resolveAdminUserIds = async (op: GuardedOp): Promise<Set<string>> => {
    const ids = new Set<string>();
    const now = Date.now();

    // 1) Platform admins — unscoped, in-window `admin_full_access` grants.
    const sets = await scan(op, SystemObjectName.PERMISSION_SET, {
      where: { name: ADMIN_FULL_ACCESS },
      fields: ['id', 'name'],
    });
    const adminSetIds = sets.map((r) => toId(r.id)).filter((v): v is string => Boolean(v));
    if (adminSetIds.length > 0) {
      const links = await scan(op, USER_PERMISSION_SET, {
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
    const members = await scan(op, SystemObjectName.MEMBER, {
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
  const resolveUnbannedAdmins = async (
    op: GuardedOp,
    adminIds: Set<string>,
  ): Promise<Set<string>> => {
    const rows = await scan(op, SystemObjectName.USER, {
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

  /**
   * Which `sys_user` rows this one write addresses — the same answer for both
   * halves. A scalar id when the engine dispatched by id (an update payload
   * also carries it in `data.id`; a delete's `input` has no `data` at all),
   * and otherwise the caller's predicate, still on `input.options.where` while
   * `before*` runs (see the header: the composed `ast` is the part hooks
   * cannot read, and middleware may only narrow it — so this set is an
   * over-approximation, the safe direction).
   */
  const resolveTargetIds = async (
    op: GuardedOp,
    id: unknown,
    options: { where?: unknown } | undefined,
    data?: Record<string, unknown>,
  ): Promise<Set<string>> => {
    const single = toId(id) ?? toId(data?.id);
    if (single) return new Set([single]);
    const where = options?.where as EngineQueryOptions['where'];
    const rows = await scan(op, SystemObjectName.USER, {
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

  /**
   * The verdict, shared by both halves: refuse when this write takes away every
   * administrator who can still sign in. Fail-closed — any lookup that throws
   * becomes a refusal naming the reason.
   */
  const enforce = async (
    op: GuardedOp,
    input:
      | { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown } }
      | undefined,
  ): Promise<void> => {
    const words = OP_WORDS[op];
    try {
      const admins = await resolveAdminUserIds(op);
      // Nothing recognised as an administrator: there is no break-glass account
      // to protect and refusing every write would be a guard inventing a policy
      // out of an empty measurement. (A deployment reaches this only before the
      // first admin is bootstrapped.)
      if (admins.size === 0) return;

      const unbanned = await resolveUnbannedAdmins(op, admins);
      const targets = await resolveTargetIds(op, input?.id, input?.options, input?.data);

      const losing = [...unbanned].filter((id) => targets.has(id));
      // No administrator that could still sign in is affected → not our case.
      // This is also what makes re-banning — or removing — an already-banned
      // admin a no-op rather than a refusal: nothing is being taken away.
      if (losing.length === 0) return;

      const remaining = [...unbanned].filter((id) => !targets.has(id));
      if (remaining.length > 0) return;

      logger?.warn(
        `[LastAdminGuard] refused a ${words.noun} that would have left this environment with no ` +
          `unbanned administrator (target: ${losing.join(', ')})`,
      );
      const many = losing.length > 1;
      throw refuse(
        `Refusing to ${words.verb} ${losing.map((id) => `'${id}'`).join(', ')}: ` +
          `${many ? 'those are the last administrators' : 'that is the last administrator'} this ` +
          `environment has that ${many ? 'are' : 'is'} not already banned, and ${words.gerund} ` +
          `${many ? 'them' : 'that account'} would leave nobody able to administer the ` +
          `environment or restore anyone's access (${BREAK_GLASS_CITATION}). Grant another user ` +
          `the '${ADMIN_FULL_ACCESS}' permission set or an organization ` +
          `'${MEMBERSHIP_ROLE_OWNER}'/'${MEMBERSHIP_ROLE_ADMIN}' membership first, then retry. ` +
          `If the ${words.noun} came from an identity provider, the SCIM deprovision is too ` +
          'broad — fix the IdP group, not this guard.',
      );
    } catch (err) {
      if (isRefusal(err)) throw err;
      // Fail CLOSED: the guard could not prove another administrator survives,
      // and the cost of guessing wrong is a permanently locked-out environment.
      const reason = (err as Error)?.message ?? String(err);
      logger?.warn(
        `[LastAdminGuard] administrator lookup failed — ${words.noun} refused: ${reason}`,
      );
      throw refuse(
        `Refusing this ${words.noun}: the remaining administrators could not be verified ` +
          `(${reason}). This guard fails closed — a ${words.noun} is only permitted when at ` +
          `least one other unbanned administrator is provably left (${BREAK_GLASS_CITATION}). ` +
          'Retry once the identity tables are readable again.',
      );
    }
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

    await enforce('ban', { ...ctx.input, data });
  };

  const guardDelete = async (rawCtx: unknown): Promise<void> => {
    const ctx = (rawCtx ?? {}) as {
      object?: string;
      input?: { id?: unknown; options?: { where?: unknown } };
    };
    if (ctx.object !== SystemObjectName.USER) return;

    // Unlike a ban there is no payload to pre-filter on: EVERY delete of a
    // `sys_user` row removes whatever standing that row had, so every one of
    // them is judged. The population reads are a handful of small indexed
    // queries, and deleting a user is a rare, deliberate operation.
    await enforce('delete', ctx.input);
  };

  // Priority 20: AFTER the ADR-0092 identity write guard's checks (10), before
  // default-priority hooks (100) spend work on a write this may refuse.
  engine.registerHook('beforeUpdate', guardBan, {
    object: SystemObjectName.USER,
    priority: 20,
    packageId,
  });
  engine.registerHook('beforeDelete', guardDelete, {
    object: SystemObjectName.USER,
    priority: 20,
    packageId,
  });

  logger?.info('[LastAdminGuard] last-administrator ban + delete guard registered (ADR-0024 D5.2)');
}
