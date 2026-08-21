// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [cloud ADR-0024 D5.2] Break-glass — a write may never leave this environment
 * with ZERO administrators able to sign in.
 *
 * FOUR write shapes can take the last administrator away, and this guard
 * holds on all of them — they are one invariant, not four policies:
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
 *  4. **deleting, RENAMING — or DEACTIVATING — the `admin_full_access`
 *     `sys_permission_set` row** (#6084) — the one table the enumeration reads
 *     that is not itself an identity table. "Who is a platform admin" is
 *     resolved by NAME: the first step of `resolveAdminUserIds` looks the
 *     permission set up as `where: { name: 'admin_full_access' }` and only then
 *     reads the grants pointing at its id. Remove that row, call it something
 *     else, or (ADR-0049, since `active` became a resolution-time predicate)
 *     switch it off, and every grant, every `sys_user` row and every
 *     `sys_member` row survives untouched while nobody is a platform admin any
 *     more — one write, the whole platform-admin population. Unlike (3) this one
 *     is not driven by an IdP at all: it is written by a metadata delete, an
 *     `os meta` run, a package uninstall — or, for the deactivation spelling, by
 *     one click on a Setup row action that carries no visibility or condition
 *     guard — which is why it needs its own two hooks rather than a wider filter
 *     on the three tables above.
 *
 * In the case that matters both are driven by an EXTERNAL system: nobody reads
 * the payload before it commits, so one mis-scoped IdP group or one over-broad
 * deprovision run is enough for an organization to remove its own last
 * administrator and lock itself out of its environment permanently. There is no
 * recovery path from inside the product once that happens.
 *
 * So the invariant is enforced at the WRITE, on the chokepoints every path goes
 * through — `beforeUpdate` and `beforeDelete` on `sys_user`, `sys_member`,
 * `sys_user_permission_set` and `sys_permission_set` — rather than at any
 * individual endpoint.
 * HTTP-level guards protect only the endpoints they are attached to; these hold
 * for the admin ban / remove endpoints, `updateMemberRole`, the SCIM adapter
 * writes, an import, a script, and anything added later.
 *
 * ## How the standing halves decide (#5978)
 *
 * The row halves can answer by set arithmetic — "is every unbanned
 * administrator inside the doomed set of `sys_user` ids?". The standing halves
 * cannot: the write does not name users at all, it edits the evidence the
 * administrator set is DERIVED from. (#6084's two permission-set halves are
 * standing halves in exactly this sense, and reuse the same three steps — the
 * `sys_permission_set` row is a step further from the user than a grant is, not
 * a different kind of evidence.) So they answer the way the issue framed it —
 * **enumerate, simulate, enumerate again**:
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
 * The two grades below are what the ADR-0024 `/sso/register` admin gate counted
 * until #10009 narrowed that gate to platform-admin-only and removed its
 * `AuthManager.isOrgOrPlatformAdmin` predicate. That predicate is gone; this
 * guard is unchanged and still counts both, so the definition stands on its own
 * here, enumerated in the opposite direction:
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
 * ## The bootstrap window, and the state that only LOOKS like one (#6084)
 *
 * Both verdicts open by asking "does this environment recognise any
 * administrator at all", and answer "no" by PERMITTING the write: before the
 * first admin is bootstrapped there is no break-glass account to protect, and
 * refusing every identity write in that window would be a guard inventing a
 * policy out of an empty measurement.
 *
 * Write shape (4) turns that exemption into an AMPLIFIER, which is the half of
 * #6084 that matters more than the fourth pair of hooks: an environment whose
 * `admin_full_access` row is gone reads as ZERO administrators, so the exemption
 * fires and every OTHER path — ban, delete, downgrade, revoke — is waved through
 * as well. One write does not just lock the environment out, it disables the
 * whole guard on the way.
 *
 * So "zero administrators" is resolved into the two states it was conflating,
 * and only one of them is the bootstrap window:
 *
 *  - **a genuinely fresh environment** — no evidence anybody was ever a platform
 *    admin here. Permitted, exactly as before.
 *  - **an environment that was EMPTIED** — an unscoped, in-window
 *    `sys_user_permission_set` grant still points at a `sys_permission_set` row
 *    that no longer exists. Refused, loudly, naming the dangling grants.
 *  - **an environment whose break-glass set was switched OFF** (ADR-0049) — the
 *    `admin_full_access` row is present and named correctly, and unscoped,
 *    in-window grants still point at it, but `active` is false so it confers
 *    nothing. Refused too, with its own remedy: re-activate the row. This state
 *    became reachable the moment `active` became a resolution-time predicate,
 *    and it produces the identical emptiness while leaving no dangling grant to
 *    read. A write that RESTORES standing — re-activation itself — is exempt,
 *    measured through the same simulation, or the refusal would have no way out
 *    from inside the product.
 *
 * The evidence is chosen so the FRESH-INSTALL answer cannot change: a dangling
 * grant is unreachable on the happy path in either direction. Every writer
 * inserts the permission set first and reads its id back to write the grant —
 * `bootstrapPlatformAdmin` seeds the set rows in step 1 and only then promotes
 * the first user in step 2, returning `admin_permission_set_missing` rather than
 * granting when the set is absent — so no ordering of a fresh boot produces one.
 * It is produced by exactly one thing: DELETING a permission set that grants
 * already point at.
 *
 * A RENAME leaves no dangling grant, so this predicate cannot see it: the row is
 * still there and every grant still resolves. That path is closed at the WRITE
 * instead (`guardPermissionSetUpdate`), which narrows the residual to one state
 * — an environment renamed away from `admin_full_access` by a write that landed
 * while this guard was not registered. Widening the predicate to cover it ("no
 * `admin_full_access` row exists AND some unscoped grant does") was considered
 * and rejected: it changes the answer for a fresh environment that writes an
 * unscoped grant before the admin set exists, and not changing the fresh-install
 * answer is the one thing this predicate may not do.
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
 *  - **predicate / `multi`**: the CALLER's own options bag is still on
 *    `input.options`, predicate and `multi` included — `delete()` only rebuilds
 *    that slot into `DriverOptions` *after* the `before*` hooks return. That is
 *    the same slot the ban half reads, and it does not contradict the
 *    `HookContextSchema.input` contract table (#5273 / #5899): what is
 *    unreachable from `input` is the composed `ast` — the *effective*
 *    predicate, onto which the filters middleware may add RLS / sharing
 *    scoping. Middleware can only NARROW it, so treating the caller's predicate
 *    as the doomed set over-approximates it, which is the fail-closed
 *    direction: this guard may refuse a delete that would have removed fewer
 *    rows, and can never miss one that removes more.
 *
 *    ⚠️ [#5574] `input.id` USED to be present-but-undefined here, and this
 *    guard used to key on that. It no longer is: ADR-0058 Addendum II
 *    dispatches `before*` once per MATCHED ROW, each context naming its own
 *    row, so a predicate write is now indistinguishable from a by-id write by
 *    the id alone — and reading it that way approved a sweep of every
 *    administrator one legitimate-looking row at a time. `options.multi` is the
 *    discriminator, and `resolveTargetIds` asks it FIRST. See that function.
 *  - `ctx.previous` (the engine's #5272 pre-image — its SOLE producer since
 *    #5929, which retired objectql's `sys_fetch_previous_delete` builtin
 *    (`object: '*'`, priority 5) once the engine's own earlier read made that
 *    hook's `!ctx.previous` guard unreachable) is now bound on BOTH shapes:
 *    by-id since #5272, and per matched row since #5574.
 *    The guard still never consumes it, and the reason is sharper than before:
 *    it needs the target IDS as a SET, and a `previous`-based implementation
 *    would see exactly one row per dispatch — correct for a single write and
 *    blind on exactly the bulk path that can sweep every administrator at
 *    once.
 *
 * ## Scope: the ENVIRONMENT, not each organization
 *
 * The invariant protects the deployment's ability to be administered at all —
 * "≥ 1 unbanned administrator remains anywhere in this environment". A stricter
 * per-organization rule ("every org keeps an owner") is a different, larger
 * policy with its own product decisions (what happens to an org whose only
 * owner leaves the company); it is deliberately not invented here.
 *
 * Scope in the other direction: this guard watches writes to the four tables
 * the administrator population is derived from, and stops there. It has no
 * opinion on what a permission set CONTAINS, and that is not a gap being left
 * open — it was measured. `resolveAuthzContext` sets `hasPlatformAdminGrant`
 * from `ps.name === 'admin_full_access'` alone and `derivePosture` returns
 * `PLATFORM_ADMIN` off that boolean, so emptying the set's
 * `system_permissions` does NOT un-make a platform admin: the posture rung and
 * the superuser bypass ride on the NAME (ADR-0068 D2 / ADR-0095 D3). Such an
 * edit costs the holder `setup.access` / `studio.access` — Setup and Studio go
 * invisible — while the data plane still answers, so it is recoverable from
 * inside the product and is a capability question (ADR-0086), not a break-glass
 * one. The name is the whole of what makes an administrator here, so the name
 * is the whole of what this guard reads.
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
import { isGrantActive, isRowActive } from '@objectstack/core';

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
 * The eight writes this guard judges. Carried into every message so a refusal
 * describes the operation the caller actually attempted — an operator reading
 * "refusing this ban" after a SCIM `DELETE /Users/{id}` would go looking in the
 * wrong place, and one reading it after an `updateMemberRole` would go looking
 * on the wrong TABLE.
 *
 * The first two take the administrator away with their `sys_user` row; the four
 * `standing` ops (#5978) leave the row untouched and take away what MAKES them
 * an administrator; the last two (#6084) take away the `sys_permission_set` row
 * that the platform-admin half of the enumeration resolves BY NAME.
 */
type GuardedOp =
  | 'ban'
  | 'delete'
  | 'member-update'
  | 'member-delete'
  | 'grant-update'
  | 'grant-delete'
  | 'permission-set-update'
  | 'permission-set-delete';

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
  'permission-set-update': {
    noun: 'permission-set rename',
    verb: 'rename',
    gerund: 'renaming',
    Verb: 'Rename',
    subject: 'permission sets',
    table: SystemObjectName.PERMISSION_SET,
  },
  'permission-set-delete': {
    noun: 'permission-set removal',
    verb: 'remove',
    gerund: 'removing',
    Verb: 'Remove',
    subject: 'permission sets',
    table: SystemObjectName.PERMISSION_SET,
  },
};

/**
 * [#6084] The closing sentence of a standing refusal: where a write of THIS
 * shape actually comes from, so the operator goes and fixes the source instead
 * of this guard.
 *
 * The two identity tables are written by IdP integrations, so their refusals
 * point at the SCIM group mapping. `sys_permission_set` is not — nothing in
 * SCIM or better-auth writes it; a metadata delete, an `os meta` run or a
 * package uninstall does. Sending THAT operator to look at an IdP group would
 * send them into a system they may not even run.
 */
function standingOrigin(table: string, noun: string): string {
  if (table === SystemObjectName.PERMISSION_SET) {
    return (
      `If the ${noun} came from a metadata delete, an 'os meta' run or a package uninstall, ` +
      `revoke the '${ADMIN_FULL_ACCESS}' grants first — the permission-set row every platform ` +
      'admin is derived from is the last thing an environment gives up, not the first.'
    );
  }
  return (
    `If the ${noun} came from an identity provider, the SCIM group mapping is too broad — fix ` +
    'the IdP group, not this guard.'
  );
}

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
  /** `sys_member`, `sys_user_permission_set` or `sys_permission_set` (#6084). */
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
 * `member` → `admin`, a grant re-pointed AT `admin_full_access`, or — since
 * #6084 — another permission set RENAMED INTO `admin_full_access`) writes a row
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
export const MEMBER_STANDING_KEYS = ['role', 'user_id', 'userId'] as const;

/**
 * Same, for `sys_user_permission_set`: which permission set the grant points
 * at, whose it is, whether it is org-scoped, and its ADR-0091 validity window
 * — every column the grant half of the enumeration consumes, in both the
 * snake_case and camelCase spellings the readers already tolerate.
 */
export const GRANT_STANDING_KEYS = [
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

/**
 * [#6084] Same, for `sys_permission_set` — the two columns of that table the
 * platform-admin half of the enumeration reads:
 *
 *  - `name`, the column it looks the set up by. Renaming the row takes the
 *    standing away from everyone holding a grant to it, in one write.
 *  - `active` [ADR-0049]. This column USED to be inert, and this comment used
 *    to say so: `resolveAuthzContext` derived `platform_admin` from the name
 *    alone and read no flag. It now drops a DEACTIVATED set before any
 *    derivation, so `active: false` on `admin_full_access` un-makes every
 *    platform admin at once — the same end state as renaming or deleting the
 *    row, reached by a payload that touches neither. Enforcing the flag without
 *    listing it here would have left exactly one unguarded route to an
 *    installation-wide lockout: the action is offered on every row with no
 *    visibility or condition guard, the seeders deliberately never reconcile
 *    `active`, and re-activating requires the permission the click just took
 *    away.
 *
 * Everything else a permission-set write touches (`label`, `description`, the
 * four permission JSON blobs, provenance) is still invisible to "who is an
 * administrator" — `resolveAuthzContext` derives `platform_admin` from the NAME
 * of an ACTIVE set, never from the capabilities it carries — so those writes
 * still cost this guard no reads at all. Adding `active` does not walk that
 * back: the projection is FACETS ONLY and deliberately never re-flips a
 * record's on/off switch (`permission-set-projection.ts`, #4669), so every
 * projection pass, every `os meta resync` and every ordinary Setup edit still
 * misses this list entirely. What now pays for an enumeration is the write that
 * actually toggles the switch — which is the write this list exists to judge.
 *
 * `id` is deliberately NOT here even though the enumeration reads it. On this
 * engine `data.id` on an update ADDRESSES the row (it is what
 * `resolveTargetIds` resolves the target from) rather than proposing a new
 * primary key, so a key rewrite is not expressible through this write path; the
 * two standing key lists above exclude `id` for the same reason.
 *
 * `sys_position` gets no analogous list because it has no route into this
 * enumeration to guard: platform-admin standing is read from UNSCOPED
 * `sys_user_permission_set` grants only (a position-bound `admin_full_access`
 * never conferred it, in the resolver or here), and org-administrator standing
 * is read from `sys_member.role`. Deactivating a position cannot empty either.
 */
export const PERMISSION_SET_STANDING_KEYS = ['name', 'active'] as const;

/**
 * [#8734] The three lists above, keyed by the table each one judges — the shape
 * the correspondence gate consumes.
 *
 * The gate (`last-admin-standing-keys.test.ts`) reads
 * `ADMIN_STANDING_SURFACE` from `@objectstack/core`, which is the MEASURED set
 * of columns `resolveAuthzContext` reads per table, and requires every column
 * of every standing-bearing table to have an answer here: either the guard
 * treats it as standing-bearing (it is in the list) or it is excluded below
 * with the reason it cannot move the administrator population.
 *
 * Keying by table is not cosmetic. It is what makes a resolver that starts
 * deriving administrator standing from a NEW table fail: core reclassifies the
 * table as `derives`, and the gate then demands a list here that does not
 * exist. A column-set comparison alone cannot see that, because a new table is
 * absent from both sides.
 */
export const STANDING_KEYS_BY_TABLE: Readonly<Record<string, readonly string[]>> = {
  [SystemObjectName.MEMBER]: MEMBER_STANDING_KEYS,
  [USER_PERMISSION_SET]: GRANT_STANDING_KEYS,
  [SystemObjectName.PERMISSION_SET]: PERMISSION_SET_STANDING_KEYS,
};

/**
 * [#8734] Columns the resolver reads that this guard deliberately does NOT
 * treat as standing-bearing, each with the reason it cannot empty the
 * administrator population.
 *
 * Every exclusion here was already argued in the prose above; what changes is
 * that the argument is now attached to a column the gate has measured, and a
 * column that acquires a reader gets no disposition until someone writes one.
 * The reason strings can still go out of date in their CONTENT — that is true
 * of any prose — but they can no longer go out of date in their SUBJECT, which
 * is how #6084's comment about `active` survived #8613.
 *
 * ⚠️ An entry here is a decision that a write to that column is safe, on a path
 * whose failure mode is an installation-wide administrator lockout with no
 * in-product recovery. Adding one to make a red gate green is the wrong move in
 * exactly the way this card exists to prevent; the right move is almost always
 * to add the column to the list above.
 */
export const STANDING_KEY_EXCLUSIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [SystemObjectName.MEMBER]: {
    organization_id:
      'The invariant is scoped to the ENVIRONMENT, not to each organization ("Scope" above), so '
      + 'which org a membership sits in never changes who administers this deployment. The '
      + 'resolver reads it to scope positions to the ACTIVE org and to build accessible_org_ids; '
      + 'neither is a count of administrators.',
    organizationId: 'Camel-case spelling of `organization_id` — same reason.',
    valid_from:
      'ADR-0091 windows are not columns on `sys_member` today. The resolver calls isGrantActive '
      + 'on membership rows only when building `accessible_org_ids` (the group posture read '
      + 'reach); the org-administration role projection it feeds `positions` from is NOT window '
      + 'filtered, and this guard counts org administrators by GRADE alone (isOrgAdminGrade). So '
      + 'no reader of administrator standing consults these bounds, and writing one cannot revoke '
      + 'a grade. If the columns ever land on `sys_member`, the resolver is where the two halves '
      + 'have to be reconciled first — this list follows it, it does not lead.',
    validFrom: 'Camel-case spelling of `valid_from` — same reason.',
    valid_until: 'Upper bound of the same absent window as `valid_from` — same reason.',
    validUntil: 'Camel-case spelling of `valid_until` — same reason.',
  },

  [USER_PERMISSION_SET]: {},

  [SystemObjectName.PERMISSION_SET]: {
    id:
      'On this engine `data.id` on an update ADDRESSES the row rather than proposing a new '
      + 'primary key (see the note above `PERMISSION_SET_STANDING_KEYS`), so a key rewrite is not '
      + 'expressible through this write path at all.',
    system_permissions:
      'What the set CONTAINS does not un-make a platform admin: `hasPlatformAdminGrant` is set '
      + "from `ps.name === 'admin_full_access'` on an ACTIVE set, and the posture rung and "
      + 'superuser bypass ride on that boolean. Emptying the blob costs the holder setup/studio '
      + 'access — recoverable from inside the product, an ADR-0086 capability question, not a '
      + 'break-glass one.',
    systemPermissions: 'Camel-case spelling of `system_permissions` — same reason.',
    tab_permissions:
      'Tab visibility per app. Same reason as `system_permissions`: it is content of the set, '
      + 'never the name-and-active pair the derivation reads.',
    tabPermissions: 'Camel-case spelling of `tab_permissions` — same reason.',
  },
};

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
    //
    // [#6084] The set row is simulated exactly like the grant rows below it: a
    // pending write on `sys_permission_set` can DELETE this row (it drops out of
    // `adminSetIds`, and with it every grant that pointed at it), RENAME it, or
    // DEACTIVATE it, and each is RE-TESTED for the same reason the grant's
    // `permission_set_id` is — the scan's own `where` only proved what the row
    // was called BEFORE the write.
    //
    // [ADR-0049] `active` rides the projection because the flag is now read at
    // resolution time: `fields` is a projection, so a column left out of this
    // list would read as absent here and absent means ACTIVE — the guard would
    // model an environment in which no set is ever deactivated and permit the
    // one write that empties it.
    const sets = await scan(op, SystemObjectName.PERMISSION_SET, {
      where: { name: ADMIN_FULL_ACCESS },
      fields: ['id', 'name', 'active'],
    });
    const adminSetIds: string[] = [];
    for (const rawSet of sets) {
      const set = applyPending(rawSet, pending, SystemObjectName.PERMISSION_SET);
      if (!set) continue; // removed outright by the pending write
      if (set.name !== ADMIN_FULL_ACCESS) continue; // renamed away — the row survives, the meaning does not
      // Deactivated — the row survives under its own name and grants nothing,
      // judged by the SAME predicate `resolveAuthzContext` resolves with.
      if (!isRowActive(set)) continue;
      const sid = toId(set.id);
      if (sid) adminSetIds.push(sid);
    }
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
   * [#6084] Called at the ONE place both verdicts read zero administrators:
   * decide whether that emptiness is the bootstrap window or an environment
   * that has just been emptied, and refuse in the second case.
   *
   * The evidence is a DANGLING platform-admin-shaped grant: an unscoped,
   * in-window `sys_user_permission_set` row whose `permission_set_id` names a
   * `sys_permission_set` row that is not there any more. Nobody writes such a
   * row — every producer inserts the set first and reads its id back — so it
   * can only be left behind by deleting a permission set that grants already
   * pointed at, which is write shape (4) landing on `admin_full_access`. A
   * fresh environment has no grants at all, or grants whose sets exist; either
   * way this returns without refusing and the bootstrap window is untouched.
   *
   * Deliberately an OVER-approximation of "the `admin_full_access` row was
   * deleted": a dangling unscoped grant to some other set trips it too. The
   * guard cannot tell the two apart (the name it would compare went away with
   * the row), and refusing in an environment that has zero administrators AND a
   * grant pointing into nowhere is the fail-closed direction.
   *
   * [ADR-0049] DEACTIVATION is the second way to reach the same emptiness, and
   * it leaves NO dangling grant to read — the row is still there, still named
   * `admin_full_access`, and simply grants nothing. Left unhandled, enforcing
   * the flag would turn this exemption into the amplifier the paragraph above
   * exists to prevent: one deactivation empties the administrator population
   * and every later ban, delete and downgrade sails through unguarded. So the
   * deactivated row with unscoped, in-window grants still pointing at it is
   * read as the SAME evidence, with its own remedy — re-activate it.
   */
  const refuseIfEmptiedRatherThanFresh = async (op: GuardedOp): Promise<void> => {
    const sets = await scan(op, SystemObjectName.PERMISSION_SET, { fields: ['id', 'name', 'active'] });
    const known = new Set<string>();
    const deactivatedAdminSetIds: string[] = [];
    for (const row of sets) {
      const sid = toId(row.id);
      if (!sid) continue;
      known.add(sid);
      if (row.name === ADMIN_FULL_ACCESS && !isRowActive(row)) deactivatedAdminSetIds.push(sid);
    }

    // The deactivated-break-glass case, checked before the dangling one: it has
    // a precise diagnosis and a one-click remedy, so it must not be reported as
    // the vaguer "something was deleted" story.
    if (deactivatedAdminSetIds.length > 0) {
      const held = await scan(op, USER_PERMISSION_SET, {
        where: { permission_set_id: { $in: deactivatedAdminSetIds } },
      });
      const nowMs = Date.now();
      const stranded = held.filter(
        (link) => !(link.organization_id ?? link.organizationId) && isGrantActive(link, nowMs),
      );
      if (stranded.length > 0) {
        const words = OP_WORDS[op];
        logger?.warn(
          `[LastAdminGuard] refused a ${words.noun} in an environment whose '${ADMIN_FULL_ACCESS}' ` +
            `permission set is DEACTIVATED — ${stranded.length} unscoped grant(s) confer nothing`,
        );
        throw refuse(
          `Refusing this ${words.noun}: this environment recognises NO administrator because its ` +
            `'${ADMIN_FULL_ACCESS}' '${SystemObjectName.PERMISSION_SET}' row is DEACTIVATED — ` +
            `${stranded.length} unscoped, in-window '${USER_PERMISSION_SET}' grant(s) still point ` +
            'at it and confer nothing while it is off. That is not the bootstrap window, and ' +
            'reading the resulting emptiness as "no administrator to protect" would switch this ' +
            `guard off for every other write too (${BREAK_GLASS_CITATION}). Re-activate the ` +
            `'${ADMIN_FULL_ACCESS}' permission set (set 'active' back to true) — the grants naming ` +
            'it are still there — before writing the identity tables again.',
          words.table,
        );
      }
    }
    // With no permission set at all every grant is dangling, and `$nin: []` is
    // not a predicate every driver agrees on — so that case reads unfiltered
    // and lets the in-memory re-test below do the work.
    const candidates = await scan(op, USER_PERMISSION_SET, {
      ...(known.size > 0 ? { where: { permission_set_id: { $nin: [...known] } } } : {}),
    });

    const now = Date.now();
    const dangling: string[] = [];
    for (const link of candidates) {
      const setId = toId(link.permission_set_id ?? link.permissionSetId);
      // A grant that points at nothing names no deleted set.
      if (!setId) continue;
      // `$nin` is NULL-safe on this engine (#5298) and the drivers differ on
      // the edges, so danglingness is re-tested in memory rather than trusted
      // from the `where` — the same discipline the enumeration applies to
      // `permission_set_id` and `name`.
      if (known.has(setId)) continue;
      // An org-SCOPED grant never conferred the environment's break-glass
      // standing, and an out-of-window one never conferred it either, so
      // neither is evidence that this environment once had a platform admin.
      if (link.organization_id ?? link.organizationId) continue;
      if (!isGrantActive(link, now)) continue;
      const uid = toId(link.user_id ?? link.userId);
      dangling.push(uid ? `'${uid}' → '${setId}'` : `'${setId}'`);
    }
    if (dangling.length === 0) return; // a genuinely fresh environment

    const words = OP_WORDS[op];
    logger?.warn(
      `[LastAdminGuard] refused a ${words.noun} in an environment with no administrator that is ` +
        `NOT a fresh install — ${dangling.length} dangling unscoped grant(s): ${dangling.join(', ')}`,
    );
    throw refuse(
      `Refusing this ${words.noun}: this environment recognises NO administrator, and this is not ` +
        `the bootstrap window — ${dangling.length} unscoped, in-window '${USER_PERMISSION_SET}' ` +
        `grant(s) still point at a '${SystemObjectName.PERMISSION_SET}' row that no longer exists ` +
        `(${dangling.join(', ')}). That is the state a DELETED '${ADMIN_FULL_ACCESS}' ` +
        'permission-set row leaves behind (#6084): it un-makes every platform admin at once, and ' +
        'reading the resulting emptiness as "no administrator to protect" would switch this guard ' +
        `off for every other write too (${BREAK_GLASS_CITATION}). Restore the ` +
        `'${ADMIN_FULL_ACCESS}' permission set — the grants naming it are still there — before ` +
        'writing the identity tables again.',
      words.table,
    );
  };

  /**
   * Which rows of `object` this one write addresses — the same answer for all
   * eight halves. A scalar id when the engine dispatched by id (an update payload
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
   *
   * ## [#5574] Why `multi` outranks a bound `input.id`, and why that is the
   * whole fix
   *
   * This function used to read "is there an id? then that is the target set",
   * and that was sound only because a predicate write's `before*` dispatch left
   * `input.id` present-but-UNDEFINED. ADR-0058 Addendum II made the `before*`
   * phase per row: a predicate write now dispatches once per MATCHED ROW, each
   * context carrying that row's id. Read naively, every one of those dispatches
   * looks like a by-id write of a single administrator — and a ban of ONE admin
   * out of three is legitimately allowed, so a `multi` ban of ALL THREE passed
   * as three separate approvals and locked the environment out. Measured, on
   * this file's own #5892 / #5941 / #5978 cases.
   *
   * The distinction the guard actually needs is UNCHANGED and is the one the
   * contract preserves on purpose: `input.options` is the CALLER's bag during
   * `before*`, `multi` and `where` included (D2, and `hook.zod.ts`'s PHASE
   * rule). So `multi` is asked FIRST — on a predicate write the target set is
   * the caller's predicate, whichever row this particular dispatch happens to
   * name — and the id is only the answer when the write really is by-id.
   *
   * This is the general shape of what per-row dispatch does to a guard that
   * reasons about a write as a SET rather than about one record: the per-row
   * view is strictly less information for that question, and the batch-scoped
   * slot is where the question is still answerable. A guard here must never be
   * rewritten to reason from `ctx.previous` alone for the same reason.
   *
   * Cost, named: on a legitimate predicate write this resolves the same set
   * once per matched row. It is bounded by `maxScan` and it is the correct
   * trade — the alternative is a break-glass guard that is exact and wrong.
   */
  const resolveTargetIds = async (
    op: GuardedOp,
    object: string,
    id: unknown,
    options: { where?: unknown; multi?: unknown } | undefined,
    data?: Record<string, unknown>,
  ): Promise<Set<string>> => {
    const isPredicateWrite = options?.multi === true;
    const single = isPredicateWrite ? undefined : (toId(id) ?? toId(data?.id));
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
      | { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown; multi?: unknown } }
      | undefined,
  ): Promise<void> => {
    const words = OP_WORDS[op];
    await failClosed(op, async () => {
      const admins = await resolveAdminUserIds(op);
      // Nothing recognised as an administrator: there is no break-glass account
      // to protect and refusing every write would be a guard inventing a policy
      // out of an empty measurement. [#6084] …provided the emptiness really IS
      // the bootstrap window, and not an environment whose `admin_full_access`
      // row was just deleted out from under it — reading THAT as "nothing to
      // protect" is what switches this guard off wholesale.
      if (admins.size === 0) {
        await refuseIfEmptiedRatherThanFresh(op);
        return;
      }

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
      | { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown; multi?: unknown } }
      | undefined,
    patch?: Record<string, unknown>,
  ): Promise<void> => {
    const words = OP_WORDS[op];
    await failClosed(op, async () => {
      const before = await resolveAdminUserIds(op);
      // Same bootstrap exemption the row halves make, with the same #6084
      // qualification: with nobody recognised as an administrator there is no
      // break-glass account to protect — unless the environment got there by
      // being emptied rather than by being new.
      if (before.size === 0) {
        // [ADR-0049] …and unless THIS write is the way back. A write that
        // RESTORES standing can never be the write that takes the last one
        // away, and re-activating a deactivated `admin_full_access` row is
        // exactly the remedy the refusal below prescribes — judged by the same
        // simulation as everything else, so the exemption is a measurement and
        // not a special case for one column. Without it the refusal would be
        // unrecoverable from inside the product: the only fix is an update, and
        // every update would be refused.
        const restoringIds = await resolveTargetIds(op, table, input?.id, input?.options, input?.data);
        if (restoringIds.size > 0) {
          const restored = await resolveAdminUserIds(op, {
            table,
            ids: restoringIds,
            ...(patch ? { patch } : {}),
          });
          if (restored.size > 0) return;
        }
        await refuseIfEmptiedRatherThanFresh(op);
        return;
      }

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
          `${REMEDY} ${standingOrigin(table, words.noun)}`,
        words.table,
      );
    });
  };

  const guardBan = async (rawCtx: unknown): Promise<void> => {
    const ctx = (rawCtx ?? {}) as {
      object?: string;
      input?: { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown; multi?: unknown } };
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
      input?: { id?: unknown; options?: { where?: unknown; multi?: unknown } };
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
      input?: { id?: unknown; data?: Record<string, unknown>; options?: { where?: unknown; multi?: unknown } };
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

  /**
   * [#6084] The fourth table. `resolveAdminUserIds` resolves "who is a platform
   * admin" by looking the permission set up BY NAME, so renaming that row takes
   * the standing away from everyone holding a grant to it, in one write, with
   * no identity table touched at all.
   *
   * Only a payload that touches `name` can move the enumeration
   * (PERMISSION_SET_STANDING_KEYS), which is what keeps every projection pass,
   * every `os meta resync` and every Setup edit — none of which write `name` —
   * free of any read. The data door refuses renames on its own (ADR-0094), and
   * that is not this guard's coverage: this one holds for the engine-level and
   * system-context writes that never pass the data door.
   */
  const guardPermissionSetUpdate = async (rawCtx: unknown): Promise<void> => {
    const ctx = ctxOf(rawCtx);
    if (ctx.object !== SystemObjectName.PERMISSION_SET) return;
    const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
    if (!touchesAny(data, PERMISSION_SET_STANDING_KEYS)) return;
    await enforceStanding(
      'permission-set-update',
      SystemObjectName.PERMISSION_SET,
      ctx.input,
      data,
    );
  };

  const guardPermissionSetDelete = async (rawCtx: unknown): Promise<void> => {
    const ctx = ctxOf(rawCtx);
    if (ctx.object !== SystemObjectName.PERMISSION_SET) return;
    // No payload to pre-filter on, and the same reasoning as the other delete
    // halves: removing ANY permission-set row is judged, and the simulation
    // answers "not `admin_full_access`, nothing changes" without a refusal for
    // every row that is not the one the enumeration reads.
    await enforceStanding('permission-set-delete', SystemObjectName.PERMISSION_SET, ctx.input);
  };

  // Priority 20: AFTER the ADR-0092 identity write guard's checks (10), before
  // default-priority hooks (100) spend work on a write this may refuse. The
  // four standing hooks (#5978) and the two permission-set hooks (#6084) are
  // registered in exactly the shape the two `sys_user` hooks established — same
  // event names, same priority, same `packageId`, only the `object` filter
  // differs — so the whole invariant binds and unbinds as one package.
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
  engine.registerHook('beforeUpdate', guardPermissionSetUpdate, {
    object: SystemObjectName.PERMISSION_SET,
    priority: 20,
    packageId,
  });
  engine.registerHook('beforeDelete', guardPermissionSetDelete, {
    object: SystemObjectName.PERMISSION_SET,
    priority: 20,
    packageId,
  });

  logger?.info(
    '[LastAdminGuard] last-administrator guard registered on sys_user (ban + delete), ' +
      'sys_member and sys_user_permission_set (standing revocation), and sys_permission_set ' +
      '(the admin_full_access row every platform admin is derived from) — ADR-0024 D5.2',
  );
}
