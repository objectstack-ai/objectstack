// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [cloud ADR-0024 D5.2] Break-glass — a write may never leave this environment
 * with ZERO administrators able to sign in.
 *
 * THREE write shapes can take the last administrator away, and this guard
 * holds on all of them — they are one invariant, not three policies:
 *
 *  1. **`sys_user.banned = true`** (#5892) — how every *disable* lands: the
 *     better-auth admin plugin's ban endpoint writes it, and
 *     `@better-auth/scim` maps a SCIM `active: false` onto that same admin ban
 *     (which is why SCIM forces the admin plugin on — ADR-0071).
 *  2. **deleting the `sys_user` row** (#5941) — how every *remove* lands: SCIM
 *     `DELETE /Users/{id}`, better-auth's `/admin/remove-user` and
 *     `/delete-user`, an import, a script.
 *  3. **revoking the STANDING, leaving the user row untouched** (#5978) — the
 *     shape neither of the first two can see, because "who is an
 *     administrator" is not a fact stored on `sys_user` at all. It lives in the
 *     two tables `resolveAdminUserIds` enumerates, so it is taken away by
 *     writing THEM: downgrading (or deleting) the `sys_member` row that carries
 *     the `owner`/`admin` grade — better-auth's `updateMemberRole`, a SCIM
 *     group-mapping change — or deleting the `admin_full_access`
 *     `sys_user_permission_set` grant, or editing it until it no longer counts
 *     (re-pointed at another set, scoped to an organization, moved outside its
 *     ADR-0091 validity window). The end state is identical to (2): everyone is
 *     still there, nobody can administer anything, and there is no recovery
 *     path from inside the product.
 *
 * In the case that matters both are driven by an EXTERNAL system: nobody reads
 * the payload before it commits, so one mis-scoped IdP group or one over-broad
 * deprovision run is enough for an organization to remove its own last
 * administrator and lock itself out of its environment permanently. There is no
 * recovery path from inside the product once that happens.
 *
 * So the invariant is enforced at the WRITE, on the chokepoints every path goes
 * through — `beforeUpdate` and `beforeDelete` on `sys_user`, `sys_member` and
 * `sys_user_permission_set` — rather than at any individual endpoint.
 * HTTP-level guards protect only the endpoints they are attached to; these hold
 * for the admin ban / remove endpoints, `updateMemberRole`, the SCIM adapter
 * writes, an import, a script, and anything added later.
 *
 * ## How the standing halves decide (#5978)
 *
 * The row halves can answer by set arithmetic — "is every unbanned
 * administrator inside the doomed set of `sys_user` ids?". The standing halves
 * cannot: the write does not name users at all, it edits the evidence the
 * administrator set is DERIVED from. So they answer the way the issue framed
 * it — **enumerate, simulate, enumerate again**:
 *
 *  1. enumerate the administrators as the tables read now;
 *  2. replay the SAME enumeration over the rows as this write would leave them
 *     (`applyPending`: addressed rows are dropped for a delete, or `{...row,
 *     ...payload}` for an update);
 *  3. refuse when step 2 leaves nobody who can sign in and step 1 did not.
 *
 * One enumeration function serves both readings, so the before-answer and the
 * after-answer are the same code and cannot drift. The simulation is
 * deliberately one-directional — it can only take standing away, never grant
 * it (`applyPending`'s comment says why) — which keeps every rounding error
 * pointing at "refuse", not at "allow".
 *
 * A predicate write (`multi`, one `where` matching many memberships or grants)
 * is resolved to its matching row ids first and then simulated over that whole
 * set, so bulk writes get a real answer rather than a blanket refusal; when the
 * match set itself cannot be resolved — the read throws, or it overflows
 * `maxScan` — the write is refused loudly instead of guessed at.
 *
 * The standing halves judge EVERY membership downgrade, not only a caller
 * downgrading themselves. Narrowing to self-downgrade would miss the case that
 * actually happens: an IdP group mapping that rewrites other people's roles.
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
 * Scope in the other direction: this guard watches writes to the three tables
 * the administrator population is derived from. It does NOT watch
 * `sys_permission_set` itself — deleting or renaming the row named
 * `admin_full_access` would un-make every platform admin at once, which is a
 * fourth write shape on a fourth table; filed as #6084 rather than
 * half-guarded from here.
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
 * The six writes this guard judges. Carried into every message so a refusal
 * describes the operation the caller actually attempted — an operator reading
 * "refusing this ban" after a SCIM `DELETE /Users/{id}` would go looking in the
 * wrong place, and one reading it after an `updateMemberRole` would go looking
 * on the wrong TABLE.
 *
 * The first two take the administrator away with their `sys_user` row; the four
 * `standing` ops (#5978) leave the row untouched and take away what MAKES them
 * an administrator.
 */
type GuardedOp =
  | 'ban'
  | 'delete'
  | 'member-update'
  | 'member-delete'
  | 'grant-update'
  | 'grant-delete';

interface OpWords {
  /** Reads after "Refusing this …". */
  noun: string;
  verb: string;
  gerund: string;
  /** Sentence-initial imperative, for the "…a narrower set of X" advice. */
  Verb: string;
  /** What a narrower set would be a set OF. */
  subject: string;
  /** The table this op writes — what a refusal reports as `err.object`. */
  table: string;
}

const OP_WORDS: Record<GuardedOp, OpWords> = {
  ban: {
    noun: 'ban',
    verb: 'ban',
    gerund: 'banning',
    Verb: 'Ban',
    subject: 'users',
    table: SystemObjectName.USER,
  },
  delete: {
    noun: 'delete',
    verb: 'delete',
    gerund: 'deleting',
    Verb: 'Delete',
    subject: 'users',
    table: SystemObjectName.USER,
  },
  'member-update': {
    noun: 'membership change',
    verb: 'change',
    gerund: 'changing',
    Verb: 'Change',
    subject: 'memberships',
    table: SystemObjectName.MEMBER,
  },
  'member-delete': {
    noun: 'membership removal',
    verb: 'remove',
    gerund: 'removing',
    Verb: 'Remove',
    subject: 'memberships',
    table: SystemObjectName.MEMBER,
  },
  'grant-update': {
    noun: 'grant change',
    verb: 'change',
    gerund: 'changing',
    Verb: 'Change',
    subject: 'permission-set grants',
    table: USER_PERMISSION_SET,
  },
  'grant-delete': {
    noun: 'grant removal',
    verb: 'revoke',
    gerund: 'revoking',
    Verb: 'Revoke',
    subject: 'permission-set grants',
    table: USER_PERMISSION_SET,
  },
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

/**
 * The refusal. `PERMISSION_DENIED` + 403 is what `mapDataError` already maps.
 * `object` names the table the CALLER was writing — `sys_user` for the two
 * halves that take the row away, `sys_member` / `sys_user_permission_set` for
 * the standing halves (#5978) — so the error points at the write that was
 * refused rather than at the table the invariant is about.
 */
function refuse(message: string, object: string = SystemObjectName.USER): Error {
  const err = new Error(`PERMISSION_DENIED: ${message}`) as Error & {
    code?: string;
    status?: number;
    object?: string;
  };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.object = object;
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
 * [#5978] The write the standing halves have to judge, described the way the
 * enumeration can consume it: WHICH rows of the standing table this write
 * addresses, and what it does to them.
 *
 * `patch: undefined` means the rows are being deleted; otherwise the rows are
 * updated and `patch` is the caller's payload, applied over each row.
 */
interface PendingStandingWrite {
  /** `sys_member` or `sys_user_permission_set`. */
  table: string;
  /** Ids of the rows this one write addresses (by-id, or the predicate's matches). */
  ids: Set<string>;
  /** The update payload, or `undefined` for a delete. */
  patch?: Record<string, unknown>;
}

/**
 * The row as it would read AFTER `pending` lands — `undefined` when the row
 * would no longer exist. Rows this write does not address come back unchanged.
 *
 * Deliberately one-directional: a pending write can only take standing AWAY in
 * this simulation, never add it. A payload that would *promote* someone (role
 * `member` → `admin`, a grant re-pointed AT `admin_full_access`) writes a row
 * the enumeration's narrowing `where` never selected, so the simulation does
 * not see the new administrator and under-counts the survivors. That is the
 * fail-closed direction: the guard may refuse a write that would in fact have
 * left an administrator behind, and can never wave through one that leaves
 * none.
 */
function applyPending(
  row: Record<string, unknown>,
  pending: PendingStandingWrite | undefined,
  table: string,
): Record<string, unknown> | undefined {
  if (!pending || pending.table !== table) return row;
  const id = toId(row.id);
  if (!id || !pending.ids.has(id)) return row;
  if (!pending.patch) return undefined; // deleted
  return { ...row, ...pending.patch };
}

/**
 * Which keys of a `sys_member` payload can move the administrator enumeration.
 * The `sys_member` half of `resolveAdminUserIds` reads exactly two columns —
 * the graded `role` and the `user_id` the standing belongs to — so a payload
 * touching neither provably produces the same enumeration and is skipped
 * without any reads. (`organization_id` is NOT one of them: the invariant is
 * scoped to the ENVIRONMENT, so which org a membership sits in never changes
 * who administers this deployment.)
 */
const MEMBER_STANDING_KEYS = ['role', 'user_id', 'userId'] as const;

/**
 * Same, for `sys_user_permission_set`: which permission set the grant points
 * at, whose it is, whether it is org-scoped, and its ADR-0091 validity window
 * — every column the grant half of the enumeration consumes, in both the
 * snake_case and camelCase spellings the readers already tolerate.
 */
const GRANT_STANDING_KEYS = [
  'permission_set_id',
  'permissionSetId',
  'user_id',
  'userId',
  'organization_id',
  'organizationId',
  'valid_from',
  'validFrom',
  'valid_until',
  'validUntil',
] as const;

function touchesAny(data: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((k) => k in data);
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
          `${words.Verb} a narrower set of ${words.subject}, or raise the guard's maxScan if ` +
          'this environment really is that large.',
        words.table,
      );
    }
    return list;
  };

  /**
   * Every user this environment recognises as an administrator.
   *
   * With `pending` (#5978) the SAME enumeration is replayed over the rows as
   * they would read once that write lands — one code path answers both "who
   * administers this environment now" and "who would administer it after", so
   * the two answers can never drift apart the way two separate readers would.
   */
  const resolveAdminUserIds = async (
    op: GuardedOp,
    pending?: PendingStandingWrite,
  ): Promise<Set<string>> => {
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
      for (const raw of links) {
        const link = applyPending(raw, pending, USER_PERMISSION_SET);
        // Revoked outright by the pending write.
        if (!link) continue;
        // Re-pointed away from `admin_full_access` — the row survives, the
        // standing does not. Re-tested rather than assumed, because the scan's
        // own `where` only proved where the grant pointed BEFORE the write.
        const setId = toId(link.permission_set_id ?? link.permissionSetId);
        if (setId !== undefined && !adminSetIds.includes(setId)) continue;
        // An org-SCOPED grant makes a tenant admin, not the environment's
        // break-glass admin — the same distinction `resolveAuthzContext` draws
        // when it derives `platform_admin` from the unscoped grant only. This
        // is also the "scope it to an org" revocation shape: a pending write
        // that fills `organization_id` in lands here.
        if (link.organization_id ?? link.organizationId) continue;
        // ADR-0091's ONE validity predicate, consumed exactly as it already was
        // — the guard invents no expiry semantics of its own (#5893 owns that
        // question, and is blocked on #5702). A pending write that moves
        // `valid_until` into the past is judged by the same predicate that
        // judges a stored one.
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
    for (const raw of members) {
      const m = applyPending(raw, pending, SystemObjectName.MEMBER);
      if (!m) continue;
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
   * Which rows of `object` this one write addresses — the same answer for all
   * six halves. A scalar id when the engine dispatched by id (an update payload
   * also carries it in `data.id`; a delete's `input` has no `data` at all),
   * and otherwise the caller's predicate, still on `input.options.where` while
   * `before*` runs (see the header: the composed `ast` is the part hooks
   * cannot read, and middleware may only narrow it — so this set is an
   * over-approximation, the safe direction).
   *
   * [#5978] A predicate write on a standing table is resolved to its matching
   * row ids the same way — this is what lets the simulation be exact for a
   * `where` that sweeps many memberships or grants at once, rather than the
   * guard having to refuse every bulk write on principle. When the resolution
   * itself cannot be completed (the read throws, or the match set overflows
   * `maxScan`) `scan` refuses loudly instead of guessing.
   */
  const resolveTargetIds = async (
    op: GuardedOp,
    object: string,
    id: unknown,
    options: { where?: unknown } | undefined,
    data?: Record<string, unknown>,
  ): Promise<Set<string>> => {
    const single = toId(id) ?? toId(data?.id);
    if (single) return new Set([single]);
    const where = options?.where as EngineQueryOptions['where'];
    const rows = await scan(op, object, {
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
   * The fail-CLOSED envelope every half runs inside. A lookup that throws is
   * not "probably fine": the guard could not prove another administrator
   * survives, and the cost of guessing wrong is a permanently locked-out
   * environment. A deliberate refusal from inside passes through unchanged.
   */
  const failClosed = async (op: GuardedOp, judge: () => Promise<void>): Promise<void> => {
    const words = OP_WORDS[op];
    try {
      await judge();
    } catch (err) {
      if (isRefusal(err)) throw err;
      const reason = (err as Error)?.message ?? String(err);
      logger?.warn(
        `[LastAdminGuard] administrator lookup failed — ${words.noun} refused: ${reason}`,
      );
      throw refuse(
        `Refusing this ${words.noun}: the remaining administrators could not be verified ` +
          `(${reason}). This guard fails closed — a ${words.noun} is only permitted when at ` +
          `least one other unbanned administrator is provably left (${BREAK_GLASS_CITATION}). ` +
          'Retry once the identity tables are readable again.',
        words.table,
      );
    }
  };

  /** The one sentence every refusal ends with: how to make the write legal. */
  const REMEDY =
    `Grant another user the '${ADMIN_FULL_ACCESS}' permission set or an organization ` +
    `'${MEMBERSHIP_ROLE_OWNER}'/'${MEMBERSHIP_ROLE_ADMIN}' membership first, then retry.`;

  /**
   * The verdict for the two `sys_user` halves: refuse when this write takes
   * away every administrator who can still sign in.
   */
  const enforce = async (
    op: GuardedOp,
    input:
      | { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown } }
      | undefined,
  ): Promise<void> => {
    const words = OP_WORDS[op];
    await failClosed(op, async () => {
      const admins = await resolveAdminUserIds(op);
      // Nothing recognised as an administrator: there is no break-glass account
      // to protect and refusing every write would be a guard inventing a policy
      // out of an empty measurement. (A deployment reaches this only before the
      // first admin is bootstrapped.)
      if (admins.size === 0) return;

      const unbanned = await resolveUnbannedAdmins(op, admins);
      const targets = await resolveTargetIds(
        op,
        SystemObjectName.USER,
        input?.id,
        input?.options,
        input?.data,
      );

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
          `environment or restore anyone's access (${BREAK_GLASS_CITATION}). ${REMEDY} ` +
          `If the ${words.noun} came from an identity provider, the SCIM deprovision is too ` +
          'broad — fix the IdP group, not this guard.',
        words.table,
      );
    });
  };

  /**
   * [#5978] The verdict for the four STANDING halves — the third write shape,
   * where the `sys_user` row is never touched and what is taken away is the
   * thing that MADE the user an administrator.
   *
   * The criterion is the issue's, verbatim: enumerate the administrators, then
   * enumerate them AGAIN over the rows as this write would leave them, and
   * refuse if the second enumeration is empty while the first was not. Both
   * enumerations are the same function, so "who administers this environment"
   * has one implementation and cannot answer the before-question and the
   * after-question differently.
   */
  const enforceStanding = async (
    op: GuardedOp,
    table: string,
    input:
      | { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown } }
      | undefined,
    patch?: Record<string, unknown>,
  ): Promise<void> => {
    const words = OP_WORDS[op];
    await failClosed(op, async () => {
      const before = await resolveAdminUserIds(op);
      // Same bootstrap exemption the row halves make: with nobody recognised as
      // an administrator there is no break-glass account to protect.
      if (before.size === 0) return;

      const unbannedBefore = await resolveUnbannedAdmins(op, before);
      // Every administrator is already banned — this write cannot take away an
      // ability to sign in that nobody currently has.
      if (unbannedBefore.size === 0) return;

      // Which rows of the standing table this write addresses. For a predicate
      // write this resolves the whole matched set, so the simulation below is
      // exact for bulk writes rather than being refused wholesale.
      const ids = await resolveTargetIds(op, table, input?.id, input?.options, input?.data);
      if (ids.size === 0) return;

      const after = await resolveAdminUserIds(op, { table, ids, ...(patch ? { patch } : {}) });
      // A patch that re-homes standing onto a DIFFERENT user (a `user_id`
      // rewrite) can put someone in `after` who was not in `before`, so the
      // survivors' ban state is re-read rather than intersected with the
      // before-set.
      const unbannedAfter: Set<string> =
        after.size > 0 ? await resolveUnbannedAdmins(op, after) : new Set<string>();

      const losing = [...unbannedBefore].filter((id) => !unbannedAfter.has(id));
      // The write leaves every administrator's standing intact → not our case.
      // This is the common path for the vast majority of membership and grant
      // writes, and it costs no refusal and no surprise.
      if (losing.length === 0) return;
      // Somebody can still administer the environment afterwards.
      if (unbannedAfter.size > 0) return;

      logger?.warn(
        `[LastAdminGuard] refused a ${words.noun} on '${table}' that would have left this ` +
          `environment with no unbanned administrator (losing: ${losing.join(', ')})`,
      );
      const many = losing.length > 1;
      throw refuse(
        `Refusing this ${words.noun}: it would revoke the administrator standing of ` +
          `${losing.map((id) => `'${id}'`).join(', ')}, ` +
          `${many ? 'who are the last administrators' : 'who is the last administrator'} this ` +
          `environment has that ${many ? 'are' : 'is'} not already banned. The ` +
          `'${table}' row is what MAKES ${many ? 'those accounts' : 'that account'} an ` +
          `administrator, so ${words.gerund} it has the same end state as ${words.gerund} ` +
          `${many ? 'the users themselves' : 'the user themselves'}: nobody would be able to ` +
          `administer the environment or restore anyone's access (${BREAK_GLASS_CITATION}). ` +
          `${REMEDY} If the ${words.noun} came from an identity provider, the SCIM group ` +
          'mapping is too broad — fix the IdP group, not this guard.',
        words.table,
      );
    });
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

  /**
   * [#5978] Standing halves. `ctxOf` is the same unwrap the two row halves do;
   * `object` is re-checked here as well as in the registration filter, so a
   * handler can never judge a table it was not written for.
   */
  const ctxOf = (rawCtx: unknown) =>
    (rawCtx ?? {}) as {
      object?: string;
      input?: { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown } };
    };

  const guardMemberUpdate = async (rawCtx: unknown): Promise<void> => {
    const ctx = ctxOf(rawCtx);
    if (ctx.object !== SystemObjectName.MEMBER) return;
    const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
    // The whole downgrade family lands here: better-auth's `updateMemberRole`,
    // a SCIM group-mapping change, an import, a script. It is NOT narrowed to
    // "the caller downgrading themselves" — an IdP writes these on everyone's
    // behalf, which is exactly the case ADR-0024 D5.2 exists for.
    //
    // A payload touching neither `role` nor `user_id` provably cannot move the
    // enumeration (see MEMBER_STANDING_KEYS), so it costs no reads at all.
    if (!touchesAny(data, MEMBER_STANDING_KEYS)) return;
    await enforceStanding('member-update', SystemObjectName.MEMBER, ctx.input, data);
  };

  const guardMemberDelete = async (rawCtx: unknown): Promise<void> => {
    const ctx = ctxOf(rawCtx);
    if (ctx.object !== SystemObjectName.MEMBER) return;
    // No payload to pre-filter on: removing a membership removes whatever
    // administrative standing it carried, so every one of them is judged.
    await enforceStanding('member-delete', SystemObjectName.MEMBER, ctx.input);
  };

  const guardGrantUpdate = async (rawCtx: unknown): Promise<void> => {
    const ctx = ctxOf(rawCtx);
    if (ctx.object !== USER_PERMISSION_SET) return;
    const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
    // The three ways a grant stops counting without being deleted: re-pointed
    // at another permission set, scoped to an organization, or moved outside
    // its ADR-0091 validity window. All three are just columns, so the
    // simulation reads them back through the same predicates the enumeration
    // already uses rather than special-casing any of them here.
    if (!touchesAny(data, GRANT_STANDING_KEYS)) return;
    await enforceStanding('grant-update', USER_PERMISSION_SET, ctx.input, data);
  };

  const guardGrantDelete = async (rawCtx: unknown): Promise<void> => {
    const ctx = ctxOf(rawCtx);
    if (ctx.object !== USER_PERMISSION_SET) return;
    await enforceStanding('grant-delete', USER_PERMISSION_SET, ctx.input);
  };

  // Priority 20: AFTER the ADR-0092 identity write guard's checks (10), before
  // default-priority hooks (100) spend work on a write this may refuse. The
  // four standing hooks (#5978) are registered in exactly the shape the two
  // `sys_user` hooks established — same event names, same priority, same
  // `packageId`, only the `object` filter differs — so the whole invariant
  // binds and unbinds as one package.
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
  engine.registerHook('beforeUpdate', guardMemberUpdate, {
    object: SystemObjectName.MEMBER,
    priority: 20,
    packageId,
  });
  engine.registerHook('beforeDelete', guardMemberDelete, {
    object: SystemObjectName.MEMBER,
    priority: 20,
    packageId,
  });
  engine.registerHook('beforeUpdate', guardGrantUpdate, {
    object: USER_PERMISSION_SET,
    priority: 20,
    packageId,
  });
  engine.registerHook('beforeDelete', guardGrantDelete, {
    object: USER_PERMISSION_SET,
    priority: 20,
    packageId,
  });

  logger?.info(
    '[LastAdminGuard] last-administrator guard registered on sys_user (ban + delete), ' +
      'sys_member and sys_user_permission_set (standing revocation) — ADR-0024 D5.2',
  );
}
