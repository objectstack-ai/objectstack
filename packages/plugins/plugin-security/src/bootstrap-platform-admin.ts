// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — first-boot platform admin promotion.
 *
 * One responsibility, idempotent and run on `kernel:ready`: **answer the
 * platform-admin question, POSTURE-KEYED** (#11184 ruling
 *     2026-08-23; re-anchored by #11663, maintainer acceptance 2026-08-25,
 *     leg L4 = #11974):
 *       - `single`: promote the first registered human user by inserting a
 *         `sys_user_permission_set` row pointing at `admin_full_access`,
 *         **owned by the Default Organization** (ADR-0131 D5; #11979 under the
 *         maintainer's ruling A on #18707): the zero-config promotion stays,
 *         and ⛔ no NULL-organization grant row is written. The holder scan
 *         and the derivation site (`resolve-authz-context.ts` §6) read that
 *         row and no other: the organization-less row an earlier release
 *         wrote is attributed to the same organization by D10's ceremony
 *         before an upgraded database boots. A deployment
 *         whose Default Organization cannot be named is not promoted: it says
 *         so, loudly, rather than writing the row without an owner.
 *         [#14348] "First user" means the oldest
 *         human that can AUTHENTICATE (holds a `sys_account`), not the oldest
 *         `sys_user` row: an app declaring people in `defineStack({ data })`
 *         stores credential-less directory rows that are always older than any
 *         account, and granting one of them platform admin writes a grant
 *         nobody can ever exercise. See the selector at the `single` branch.
 *       - walled (`group`/`isolated`): **NO grant row is written, ever.**
 *         Standing is CONFIG-DERIVED at the one derivation site
 *         (`resolve-authz-context.ts` §6b-config): each account whose stored
 *         `sys_user` row holds a declared `OS_PLATFORM_OWNER_EMAIL` address
 *         AND reads VERIFIED resolves PLATFORM_ADMIN at request time. What
 *         this bootstrap still owns under walled postures is reporting: it
 *         logs the resolved admin list's standing (the same answer the
 *         read-only `platformAdmin` service serves — see
 *         `platform-admin-service.ts`). Undeclared/blank/refused config still
 *         refuses loudly (fail-closed backstop; the boot-refusal half lives in
 *         plugin-auth `init()`).
 *
 *         [#11663 L5] ⛔ The legacy-grant deprecation pointer is GONE. L4 opened
 *         a time-boxed migration window and pointed any pre-existing unscoped
 *         `admin_full_access` holder at the config path; L5 is its EXIT. Under a
 *         walled posture that row is no longer an anchor at all — the derivation
 *         site stopped reading it (`core/src/security/resolve-authz-context.ts`
 *         §6b) — so there is nothing to migrate off and nothing to point at. The
 *         consequence carried below: a walled rig holding such a row and
 *         declaring nobody now has ZERO platform administrators, so the
 *         fail-closed line fires for it too instead of being skipped.
 *
 * The "create a Default Organization for the freshly-promoted admin"
 * behavior moved to `@objectstack/organizations` (see
 * `ensureDefaultOrganization`). Install that plugin to get
 * multi-tenant bootstrap.
 *
 * [ADR-0131 D3/D4] It writes no `sys_permission_set` row. The platform's
 * default sets (admin_full_access / member_default / viewer_readonly …) are
 * definitions this plugin ships on its manifest and the security catalog
 * serves; the promotion grant names its set. The materialization that used to
 * seed those rows insert-once — and the `os meta resync` reconcile of them —
 * retired with the rest of the catalog seeders.
 */

import { postureEnforcesWall, type PermissionSet } from '@objectstack/spec/security';
import { SystemUserId } from '@objectstack/spec/system';
import {
  isEmailVerifiedUserRow,
  PLATFORM_OWNER_EMAIL_ENV,
  resolveTenancyPosture,
} from '@objectstack/types';
import {
  normalizePlatformAdminEmail,
  organizationAnchorsPlatformStanding,
  resolvePlatformAdminEmails,
  type PlatformStandingAnchorFacts,
} from '@objectstack/core';
import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import {
  resolvePlatformAdminStanding,
  type PlatformAdminStandingEntry,
} from './platform-admin-service.js';
import {
  buildPlatformAdminStandingRow,
  platformAdminStandingChanged,
  platformAdminStandingSnapshot,
  PLATFORM_ADMIN_STANDING_ACTION,
  PLATFORM_ADMIN_STANDING_LEDGER,
  readRecordedStandingSnapshot,
  serializePlatformAdminStandingSnapshot,
} from './platform-admin-standing-audit.js';
import { GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-permission-set-name.js';
import { resolveDefaultOrganizationId } from './suggested-audience-bindings.js';

/**
 * The order the standing-audit read states TO THE DRIVER.
 *
 * `created_at` and not `id`: `sys_audit_log` ids carry no ordering, while
 * `created_at` is the field every shipped list view on that object already
 * sorts by, and it is the column the row's own meaning rests on. The read is
 * capped at one row, and a capped read without an order returns whichever row
 * that driver produced first — see {@link tryFind}.
 */
const STANDING_AUDIT_SCAN_ORDER: { field: string; order: 'asc' | 'desc' }[] = [
  { field: 'created_at', order: 'desc' },
];

/**
 * [#18412] Record a CHANGE of platform-admin standing on the existing audit
 * ledger, and write nothing when nothing changed.
 *
 * ## Three states, and the third is the one a two-valued read would lose
 *
 * - the ledger is not mounted → SKIP, silently. `sys_audit_log` belongs to the
 *   OPTIONAL `@objectstack/plugin-audit`; a host that never mounted it
 *   (`serve --preset minimal`, an EE host that composes no audit) has not
 *   FAILED to write a row, it declined to have a ledger. Attempting the insert
 *   would throw and be reported as a degradation on a deployment behaving
 *   exactly as composed — the #18368 lesson, one file over.
 * - the ledger is mounted and the last row is readable → compare, and write
 *   only on a difference.
 * - ⛔ the read was REFUSED → write NOTHING and say so. A refusal is not
 *   「no record exists」: reading it that way writes a fresh baseline on every
 *   boot, which is precisely the per-boot noise the ruling rejected. The
 *   record stays silent for this boot and the next successful read catches up,
 *   because the comparison is against the ledger rather than against a memo.
 *
 * Best-effort throughout: an audit write must never be what stops a deployment
 * booting, and this runs after the bootstrap has already done its work.
 */
async function recordPlatformAdminStandingChange(
  ql: any,
  standing: readonly PlatformAdminStandingEntry[],
  logger?: BootstrapOptions['logger'] & { debug?: (message: string) => void },
): Promise<void> {
  // ⛔ Ask before writing, and only an engine that ANSWERS licenses the skip.
  // `getSchema` is an ObjectQL member, not an `IDataEngine` one, so an engine
  // that does not carry it has told us NOTHING about the ledger — that case
  // leaves the write attempted rather than skipped.
  const getSchema = ql?.getSchema;
  let ledgerSchema: any;
  if (typeof getSchema === 'function') {
    try {
      ledgerSchema = ql.getSchema(PLATFORM_ADMIN_STANDING_LEDGER);
    } catch {
      ledgerSchema = undefined;
    }
    if (ledgerSchema == null) return;
  }

  const declared: string[] = Array.isArray(ledgerSchema?.fields)
    ? ledgerSchema.fields.map((f: any) => f?.name).filter(Boolean)
    : ledgerSchema?.fields && typeof ledgerSchema.fields === 'object'
      ? Object.keys(ledgerSchema.fields)
      : [];
  const declaresField = (field: string): boolean => declared.includes(field);

  let refused: unknown;
  const previousRows = await tryFind(
    ql,
    PLATFORM_ADMIN_STANDING_LEDGER,
    { action: PLATFORM_ADMIN_STANDING_ACTION },
    1,
    STANDING_AUDIT_SCAN_ORDER,
    undefined,
    (e) => {
      refused = e;
    },
  );
  if (refused !== undefined) {
    const message =
      '[security] platform-admin standing was NOT recorded on this boot: the audit ledger ' +
      `(${PLATFORM_ADMIN_STANDING_LEDGER}) refused the read of the last recorded snapshot, so ` +
      'this boot cannot tell whether standing changed. ⛔ Nothing was written — writing a ' +
      'baseline here would file a fresh row on every boot. The next boot whose read succeeds ' +
      'records the current standing. Cause: ' +
      String((refused as any)?.message ?? refused);
    if (logger?.error) logger.error(message);
    else logger?.warn?.(message);
    return;
  }

  const snapshot = platformAdminStandingSnapshot(standing);
  const serialized = serializePlatformAdminStandingSnapshot(snapshot);
  const previousSerialized = readRecordedStandingSnapshot(previousRows[0]);
  if (!platformAdminStandingChanged(previousSerialized, serialized)) {
    // ⛔ The card id stays in this comment and out of the STRING: a runtime
    // line reaches operators, who have no tracker to resolve `#NNNN` against
    // (#18412; `check:doc-authoring`).
    logger?.debug?.(
      '[security] platform-admin standing is unchanged since the last recorded entry — no ' +
        'audit row written. One entry per CHANGE of standing is the recorded shape.',
    );
    return;
  }

  const row = buildPlatformAdminStandingRow({
    snapshot,
    previousSerialized,
    declaresActor: declaresField('actor'),
  });
  // ⛔ Through this file's ONE write door, not a second `ql.insert` beside it.
  // `tryInsert` already threads the system execution context every write here
  // needs, and a second door with identical semantics would be a second place
  // for that context to be forgotten — it is also a second row on the
  // tenant-audit write-call-site census for one write.
  let insertRefusal: unknown;
  await tryInsert(ql, PLATFORM_ADMIN_STANDING_LEDGER, row, (e) => {
    insertRefusal = e;
  });
  if (insertRefusal !== undefined) {
    // The ledger IS mounted (or could not be asked) and the insert still
    // failed, which is AGENTS.md's durability degradation to the letter: the
    // deployment's administrators just changed and the record that was
    // supposed to outlive the process is missing. Loud, and never fatal.
    const message =
      '[security] platform-admin standing CHANGED and the audit row was NOT written — the ' +
      'durable record of who administers this deployment is missing for this change, and ' +
      'nothing retries it. Boot itself is unaffected. Cause: ' +
      String((insertRefusal as any)?.message ?? insertRefusal);
    if (logger?.error) logger.error(message);
    else logger?.warn?.(message);
  }
}

interface BootstrapOptions {
  /** Logger from PluginContext. */
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
    /**
     * [#11184] Optional because pre-existing callers hand in narrower shapes;
     * the walled owner-email refusal degrades to `warn` when absent. The meta
     * parameter is `any` on purpose: the kernel Logger types it `Error`, the
     * siblings above type it `Record<string, any>`, and this option must
     * accept both.
     */
    error?: (message: string, meta?: any) => void;
  };
  /**
   * The seed pipeline's tally at the moment this bootstrap runs, read by the
   * caller through the published `seed-settlement` contract.
   *
   * Handed straight to {@link claimSeedOwnership} and used for nothing else:
   * the claim pass is the only step here whose answer depends on whether the
   * platform's own seeder has finished writing, and a pass that cannot say so
   * reports "claimed 0 of 0" for both "nothing to claim" and "nothing had
   * landed yet". Absent for callers with no kernel context,
   * which the claim reports as `unattested` rather than guessing.
   */
  seedSettlement?: SeedSettlementSnapshot | undefined;
  /**
   * [#23354] The rows this process's boot seed landed on, per object — the
   * `seed-settlement` contract's `seededRecordIds`, bound by the caller.
   *
   * Handed straight to {@link claimSeedOwnership} and used for nothing else: it
   * is the claim's NULL-arm selection, so the promotion hands over the seed's
   * unowned rows and leaves a guest's or a form's as their writer left them
   * (ADR-0138 D1). Absent, the claim re-owns no NULL-owner row and says so.
   */
  seededRecordIds?: ((objectName: string) => readonly string[]) | undefined;
}

const SYSTEM_CTX = { isSystem: true };

/**
 * [commit 9b9581b11] The `single`-posture candidate scan's page size and hard ceiling —
 * what replaced the bare `50` at the promotion read.
 *
 * ## The cap's disposition
 *
 * The bare `50` is gone. What replaces it is a PAGE size and a scan CEILING,
 * and the difference from the old constant is the `orderBy` that now travels
 * with the read: an ORDERED page is the OLDEST rows, which is exactly the set
 * the age ranking wants, so truncation can only bite when every one of the
 * oldest `PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING` humans is non-authenticable.
 * The old unordered `50` could drop the answer on a 51-row install.
 *
 * A ceiling is KEPT rather than dropped because this pass re-runs on every
 * `sys_user` / `sys_account` insert until an admin exists
 * (`shouldReplayBootstrapFor`), so an unbounded scan would be a per-sign-up
 * full-table read on exactly the deployments that have not been promoted yet.
 * What is NOT kept is the silence: reaching the ceiling WARNS, naming the
 * number examined. "I only looked at N rows" was the whole defect.
 *
 * Exported so the guard reads the SAME numbers the selection does. A test that
 * restates them is a test that goes quietly vacuous the day one is tuned.
 */
export const PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE = 200;
export const PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING = 5000;

/**
 * [commit 1c83ca226] The `already_have_admin` guard's page size and hard ceiling — what
 * replaced the bare, unordered `50` at the HOLDERS read, one read above the
 * candidate scan.
 *
 * Deliberately the same numbers and the same shape as the candidate scan's
 * pair above rather than a second set of tuning knobs: two adjacent reads in
 * one function that bound themselves differently is a future reader's trap.
 * They are separate CONSTANTS because the populations are different objects —
 * `sys_user` there, `sys_user_permission_set` here — and tuning one must not
 * silently retune the other.
 *
 * Exported for the same reason as the pair above: a test that restates the
 * numbers goes quietly vacuous the day one is tuned. ⚠️ Neither pair is
 * re-exported from this package's `index.ts`, so neither is on the published
 * `.` surface — `bootstrapPlatformAdmin` and its RETURN OBJECT are.
 */
export const PLATFORM_ADMIN_GRANT_PAGE_SIZE = 200;
export const PLATFORM_ADMIN_GRANT_SCAN_CEILING = 5000;

/**
 * The order the grant scan states TO THE DRIVER, so a page is a deterministic
 * slice of the population instead of whatever that driver produced first.
 *
 * `id` and not `created_at`: `id` is this object's declared primary key, so it
 * is present and total on every family, and it was MEASURED honoured on this
 * very object through `ObjectQL` on both SQL families. That measurement is not
 * a formality — {@link tryFind} answers `[]` when a query is refused, and on
 * THIS guard `[]` reads as "no platform admin exists yet", which promotes.
 * An order this object could not serve would therefore be a SILENT relaxation
 * of the boundary the guard exists to hold.
 */
const ADMIN_GRANT_SCAN_ORDER: { field: string; order: 'asc' | 'desc' }[] = [
  { field: 'id', order: 'asc' },
];

/**
 * One read, with the sort and the page WHERE THE DRIVER CAN SEE THEM.
 *
 * `orderBy` / `offset` are optional and are only put on the query when a
 * caller passes them, so every pre-existing call site sends the same query it
 * always did. They exist because an UNORDERED read with a `limit` does not
 * return "the first N rows" — it returns whichever N rows that driver happened
 * to produce first, and the two families disagree by construction. Measured on
 * this repo's own drivers with 113 `sys_user` rows and `limit: 50`:
 *
 *   memory   window[0] = usr_zzz_owner   (insertion order)
 *   sqlite   window[0] = usr_ats_c001    (id order) — usr_zzz_owner ABSENT
 *
 * A caller that then sorts the returned array is sorting a SAMPLE and
 * reporting a global answer. Sorting in the query is the only way to make the
 * cap select the rows the ranking actually wants.
 */
async function tryFind(
  ql: any,
  object: string,
  where: any,
  limit = 100,
  orderBy?: { field: string; order: 'asc' | 'desc' }[],
  offset?: number,
  // ⛔ "Refused" and "empty" are not the same answer, and on most call sites in
  // this file the difference is harmless because `[]` is the conservative
  // reading. On the standing-audit read below it is NOT: `[]` would read as
  // "no record has ever been written", which writes a duplicate baseline on
  // every boot of a rig whose driver refused the query. A caller that cannot
  // afford that conflation passes this and is told.
  onRefusal?: (error: unknown) => void,
): Promise<any[]> {
  try {
    const query: Record<string, any> = { where, limit };
    if (orderBy) query.orderBy = orderBy;
    if (offset !== undefined) query.offset = offset;
    const rows = await ql.find(object, query, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    onRefusal?.(e);
    return [];
  }
}

// Never rethrows — this pass reports, it does not decide whether the
// deployment boots. A caller that must tell a refused write from "nothing to
// do" passes `onRefusal` and is told.
async function tryInsert(
  ql: any, object: string, data: any,
  // Symmetric with {@link tryFind}'s observer, and for the same reason.
  onRefusal?: (error: unknown) => void,
): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: SYSTEM_CTX });
  } catch (e) {
    onRefusal?.(e);
    return null;
  }
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

/**
 * Which writes can change the answer of the promotion in
 * {@link bootstrapPlatformAdmin} — the trigger predicate for the
 * bootstrap-replay middleware in `security-plugin.ts`. Exported so the
 * middleware and its pins consume the SAME predicate instead of re-deriving
 * it (the `resolveEngineUpdateDispatch` pattern).
 *
 * [#11974 / #11663 L4] NARROWED with the walled elevation's retirement. The
 * `update` arm of commit c0714eb5d (payload touching `email_verified` / `email`) existed
 * for exactly one reason: walled elevation was a WRITE that had to be
 * re-attempted after the owner's verifying update. Under walled postures the
 * bootstrap no longer writes a grant at all — standing is derived from config
 * at request time (`resolve-authz-context.ts` §6b-config), so there is
 * nothing to re-attempt and NO `sys_user` write can change this function's
 * answer. What remains:
 *
 *  - walled (`group`/`isolated`): never replay. Seeding and the standing log
 *    are `kernel:ready` work; re-running them per sign-up would only re-log
 *    and re-query. (The REQUESTED posture is read, same fail-stricter
 *    direction as the bootstrap itself.)
 *  - `single` + `sys_user` `create`/`insert`: a new row may be the first human
 *    user — the original first-user-promotion trigger, unchanged (Choice 4A).
 *  - `single` + `sys_account` `create`/`insert`: [#14348] a new LOGIN may make
 *    an already-stored human row promotable. This arm is not optional garnish
 *    — it is what keeps the trigger set equal to the selection's INPUTS. Since
 *    #14348 the target is the oldest human that can AUTHENTICATE, so the
 *    answer reads `sys_account`, and a predicate that watched only `sys_user`
 *    would miss every write that flips a candidate from "stored" to
 *    "promotable".
 *
 *    That is not a hypothetical ordering: on a real composed boot the sign-up
 *    pipeline writes `sys_user.insert exit` and only THEN
 *    `sys_account.insert enter` (measured on the harness stack, #14348). So the
 *    `sys_user` arm fires while the registrant still has no account — reading
 *    them non-authenticable, correctly — and without this arm the account that
 *    arrives one write later would trigger nothing at all. On an app that seeds
 *    a people directory (where boot finds humans but no logins) that is the
 *    difference between "the first real sign-up is promoted" and "no platform
 *    admin is ever promoted".
 *  - `single` + `sys_user` update touching `email` / `email_verified`, ONLY
 *    while an owner address is declared: [commit 9b9581b11, maintainer ruling of
 *    2026-09-08, decision batch #100] the `single` leg now consults
 *    `OS_PLATFORM_OWNER_EMAIL` and promotes only a VERIFIED holder of a
 *    declared address. So the verifying write is an INPUT to this function's
 *    answer again, and the ruling states the consequence directly: "the
 *    replay predicate promotes as soon as verification lands". Without this
 *    arm the accepted cost of that ruling would be far worse than the ruling
 *    describes — an owner who verified would keep waiting until some OTHER
 *    user happened to sign up.
 *
 *    ⛔ NOT the pre-#11974 arm restored wholesale. It is gated on a
 *    declaration actually existing, which is the only configuration where an
 *    update can move the answer: with none declared, `single` still promotes
 *    the oldest authenticable human and still never reads
 *    `email`/`email_verified`, so the re-run tax the #11974 narrowing removed
 *    stays removed for every deployment that has not declared an owner.
 *  - `single` + any other update (a name change, a `sys_account` update):
 *    reads nothing this function ranks on. Never replays.
 */
export function shouldReplayBootstrapFor(opCtx: {
  object?: string;
  operation?: string;
  data?: unknown;
}): boolean {
  if (opCtx?.object !== 'sys_user' && opCtx?.object !== 'sys_account') return false;
  if (postureEnforcesWall(resolveTenancyPosture())) return false;
  const op = opCtx?.operation;
  if (op === 'create' || op === 'insert') return true;
  if (op !== 'update' || opCtx.object !== 'sys_user') return false;
  // [commit 9b9581b11] The verifying write, and only where it can decide something.
  const data = opCtx.data;
  if (!data || typeof data !== 'object') return false;
  if (!('email_verified' in data) && !('email' in data)) return false;
  return resolvePlatformAdminEmails().emails.length > 0;
}

/**
 * The permission set whose anchoring grant makes a user the platform admin under
 * `single` (the Default Organization's, ADR-0131 D5). Named once so the bootstrap's guard and
 * {@link findExistingPlatformAdmin} cannot ask about two different sets.
 */
const PLATFORM_ADMIN_PERMISSION_SET_NAME = 'admin_full_access';

/**
 * Who ALREADY holds the platform-admin grant (commit 1c83ca226) — the
 * one rule both {@link bootstrapPlatformAdmin}'s `already_have_admin` guard and
 * {@link findExistingPlatformAdmin} answer with.
 *
 * ## Whose grant is the anchor ([ADR-0131] D5)
 *
 * Under `single` the promotion writes its grant OWNED BY THE DEFAULT
 * ORGANIZATION (`defaultOrganizationId`), so that row is the holder, and the
 * only one. The derivation site reads the same one
 * (`grantAnchorsPlatformStanding`, `resolve-authz-context.ts`), so the holder
 * this scan finds is the account the resolver grades PLATFORM_ADMIN. The
 * organization-less row an earlier release's promotion wrote is not read: D10's
 * ceremony attributes it to the Default Organization before an upgraded
 * database boots, and the column is NOT NULL after it. Any other organization's
 * grant of the set is an organization administrator's and never a holder.
 * `defaultOrganizationId` is `undefined` under a wall, where no grant anchors
 * standing, and where the Default Organization cannot be named; the scan then
 * asks nothing and finds nobody.
 *
 * The read was once `tryFind(ql, 'sys_user_permission_set', {
 * permission_set_id: adminPsId }, 50)` — no `orderBy`, cap 50 — with the
 * predicate that actually decides (`!organization_id`) applied CLIENT-SIDE to
 * whatever 50 rows the driver produced first. `admin_full_access` is not only
 * the platform-admin set: every ORGANIZATION-SCOPED grant of it writes a row
 * carrying the same `permission_set_id`, so this population grows with the
 * number of ORG admins, not with the number of platform admins. A tenant with
 * fifty-odd of them filled the window with rows that all fail the filter, the
 * short-circuit did not fire, a SECOND unscoped grant was minted, and
 * `claimSeedOwnership` re-owned the seeded business records to the newly
 * promoted user — silently, because the boot logs a successful promotion
 * exactly as it does on a genuinely fresh install. What fails open there is
 * #14348 case D: 「Moving an already-granted platform admin is reserved to the
 * maintainer.」
 *
 * ## Why this is TWO reads
 *
 *   Leg A — ask the driver the narrow question: the Default Organization's
 *           grants of the set. Independent of how many other organizations'
 *           grants exist, so no org-admin count can crowd the answer out of a
 *           window.
 *   Leg B — only when leg A found nobody: scan the grant population for this
 *           set, ORDERED so each page is a deterministic slice rather than
 *           "whatever the driver produced first", bounded, and reporting
 *           `truncated` at the bound with the number of rows examined. It
 *           applies the exact predicate client-side, so a driver whose `where`
 *           matching differs from it cannot make the guard fire less often.
 *
 * Both legs ask the one predicate, so the guard can only fire MORE often than
 * either leg alone, never less. (The organization-less reading — and with it
 * the `''`-shaped legacy row only the scan could see — retired with the 18.0
 * ownership ceremony, ADR-0131 D10.)
 *
 * ## Several holders
 *
 * Leg A's rows arrive ordered by grant-row `id` ({@link ADMIN_GRANT_SCAN_ORDER})
 * and the FIRST anchoring human row wins, so with two platform admins the answer
 * is the holder of the grant row whose `id` sorts first — deterministic on every
 * driver that honours the order, and the same answer for every caller.
 *
 * The seed-data owner `usr_system` (provisioned by the SeedLoader, see
 * runtime/app-plugin.ts `ensureSeedIdentity`) never counts — otherwise a DB
 * where it was wrongly promoted would block every real admin forever.
 * Ignoring it here makes the bootstrap self-healing on restart.
 *
 * ## By name, and the grant that names nothing yet ([ADR-0131] D4)
 *
 * Legs A and B ask for grants NAMING `admin_full_access`
 * (`sys_user_permission_set.permission_set`), not for grants carrying the set
 * row's id: a holder is a grant of the set by name.
 *
 * A grant written before that column existed carries no name until the v18
 * ceremony's verified rewrite names it (`os migrate organization-ownership
 * --apply`, ADR-0131 D10). A by-name scan alone would answer "nobody" for such
 * a grant, promote the oldest user and hand them the seeded records: the
 * second grant this function exists to refuse. So leg C, only when A and B
 * found nobody, reaches the anchoring human grants that name NOTHING, and one
 * comes back as `unnamedHolder`. It only ever RESTRICTS: the bootstrap
 * withholds the promotion on it, and it is never a holder — never an
 * `adminUserId`, never a claim target ({@link findExistingPlatformAdmin}).
 *
 * Leg C asks for ANY such grant, not for grants of the admin set: no read can
 * say which set an unnamed grant held (the legacy id column is retired, C7b).
 * An unnamed grant of another set therefore withholds the promotion too — the
 * stricter reading, since the one it cannot tell apart may be the
 * administrator's. A database that holds no unnamed grant (every fresh one,
 * and every one the ceremony has run on) answers by name alone.
 */
async function findPlatformAdminGrantHolder(
  ql: any,
  reachUnnamed: boolean,
  anchor: PlatformStandingAnchorFacts,
): Promise<{
  holder: any | undefined;
  /** Leg C: an anchoring human grant that names no set yet (restricts only). */
  unnamedHolder: any | undefined;
  adminGrantRowsExamined: number;
  truncated: boolean;
}> {
  // No owner can be named (a wall, or no Default Organization): no grant
  // anchors, so nothing is asked.
  const { defaultOrganizationId } = anchor;
  if (anchor.walled || defaultOrganizationId === undefined) {
    return { holder: undefined, unnamedHolder: undefined, adminGrantRowsExamined: 0, truncated: false };
  }
  // [ADR-0131 D5] Which grant anchors is core security's one rule
  // (`organizationAnchorsPlatformStanding`), the rule the resolver's §6b and
  // plugin-auth's last-administrator guard ask. ⛔ Two parts are this reader's
  // own by design: its normalizer (a grant's `organization_id` string, as read),
  // and the system-user exclusion, which is a separate rule — the seed identity
  // is never the human the promotion looks for.
  const isAnchorHumanHolder = (r: any) =>
    organizationAnchorsPlatformStanding(typeof r?.organization_id === 'string' ? r.organization_id : null, anchor)
    && r.user_id !== SystemUserId.SYSTEM;

  // Counted by row IDENTITY, not by read: the two legs overlap by construction
  // (leg A's rows are a subset of leg B's population), and a number that
  // double-counted them would answer "how many reads did you make" while
  // calling itself rows examined.
  const examinedGrantRowIds = new Set<string>();
  const countExamined = (rows: any[]) => {
    for (const r of rows) {
      examinedGrantRowIds.add(
        r?.id === undefined || r?.id === null ? `?${examinedGrantRowIds.size}` : String(r.id),
      );
    }
  };
  let truncated = false;

  // Leg A — the narrow question, asked of the driver: the Default
  // Organization's grants of the set, ordered by `id`.
  const anchorGrantRows = await tryFind(
    ql,
    'sys_user_permission_set',
    { [GRANT_SET_NAME_FIELD]: PLATFORM_ADMIN_PERMISSION_SET_NAME, organization_id: defaultOrganizationId },
    PLATFORM_ADMIN_GRANT_PAGE_SIZE,
    ADMIN_GRANT_SCAN_ORDER,
  );
  countExamined(anchorGrantRows);
  let holder: any | undefined = anchorGrantRows.find(isAnchorHumanHolder);

  /**
   * The ordered, bounded scan of one grant population, stopping at the first
   * row `matches` accepts.
   */
  const scan = async (where: Record<string, unknown>, matches: (r: any) => boolean): Promise<any | undefined> => {
    const pageSize = PLATFORM_ADMIN_GRANT_PAGE_SIZE;
    const ceiling = PLATFORM_ADMIN_GRANT_SCAN_CEILING;
    for (let offset = 0; offset < ceiling; offset += pageSize) {
      const pageLimit = Math.min(pageSize, ceiling - offset);
      const page = await tryFind(ql, 'sys_user_permission_set', where, pageLimit, ADMIN_GRANT_SCAN_ORDER, offset);
      if (page.length === 0) break;
      countExamined(page);
      const found = page.find(matches);
      if (found) return found;
      if (page.length < pageLimit) break;
      if (offset + page.length >= ceiling) truncated = true;
    }
    return undefined;
  };

  // Leg B — the ordered, bounded scan that still applies the exact predicate.
  if (!holder) {
    holder = await scan({ [GRANT_SET_NAME_FIELD]: PLATFORM_ADMIN_PERMISSION_SET_NAME }, isAnchorHumanHolder);
  }

  // Leg C — the grants that name nothing yet; it restricts only (see the
  // function note).
  let unnamedHolder: any | undefined;
  if (!holder && reachUnnamed) {
    unnamedHolder = await scan(
      { [GRANT_SET_NAME_FIELD]: null },
      (r) => grantSetNameOf(r) === undefined && isAnchorHumanHolder(r),
    );
  }

  return { holder, unnamedHolder, adminGrantRowsExamined: examinedGrantRowIds.size, truncated };
}

/**
 * The platform admin a seed-ownership claim hands rows to when no bootstrap
 * pass of THIS boot has answered yet — the existing holder, by the one rule.
 *
 * The seed-ownership claim runs whenever a seed settles (`app:seeded`), on every
 * boot. An in-budget seed settles inside `AppPlugin.start()`, BEFORE
 * `kernel:ready` runs {@link bootstrapPlatformAdmin}, so on a later boot that
 * already has an admin the claim cannot wait for the bootstrap to name its
 * target: nothing would ever re-run it. This answers the same question the
 * bootstrap's `already_have_admin` guard answers, with the same function
 * ({@link findPlatformAdminGrantHolder}) — ⛔ never a second selection rule.
 *
 * `undefined` exactly where the bootstrap names no target either:
 *  - a walled posture — no grant row anchors platform-admin standing there, and
 *    the bootstrap never promotes, so no claim ever ran under a wall;
 *  - no {@link PLATFORM_ADMIN_PERMISSION_SET_NAME} among the sets this plugin
 *    ships (`admin_permission_set_missing`);
 *  - nobody holds the anchoring grant yet — a first boot, where the promotion
 *    that follows does its own claim;
 *  - [ADR-0131 D4] the only anchoring grant of the set names nothing yet
 *    (`unnamedHolder`): it restricts the promotion and confers nothing, so it
 *    names no claim target — the claim of a later boot, once the backfill has
 *    named the grant, hands the rows over.
 *
 * Read per call and never cached: the answer is final only once the grant
 * table stops moving, and a sign-up can promote someone later in this boot.
 */
export async function findExistingPlatformAdmin(
  ql: any,
  bootstrapPermissionSets: readonly PermissionSet[],
): Promise<string | undefined> {
  if (!ql || typeof ql.find !== 'function') return undefined;
  if (postureEnforcesWall(resolveTenancyPosture())) return undefined;
  if (!bootstrapPermissionSets.some((ps) => ps.name === PLATFORM_ADMIN_PERMISSION_SET_NAME)) {
    return undefined;
  }
  // [ADR-0131 D4] By name alone: leg C (the legacy id reach) only restricts
  // and never names a holder, so this question needs no catalog row.
  // A wall returned above, so the posture here is `single`.
  const { holder } = await findPlatformAdminGrantHolder(ql, false, {
    walled: false,
    defaultOrganizationId: await readPromotionGrantOwner(ql),
  });
  return holder?.user_id ? String(holder.user_id) : undefined;
}

/**
 * [ADR-0131 D5] The owner of the grant the `single` promotion writes, and of
 * the grant the holder scan reads: the
 * Default Organization, by the definition plugin-auth's boot invariant creates
 * it by (`resolveDefaultOrganizationId` — `slug = 'default'`, else the only
 * organization) and the derivation site reads it by (`resolve-authz-context.ts`
 * `readDefaultOrganizationId`), so the row written is the row that confers.
 *
 * `undefined` when it cannot be named — no organization, several and none of
 * them `default`, a composition that registers no organization object, or a
 * read that failed. A failed read names nothing rather than guessing: the
 * promotion then withholds and says why, and its next pass reads again.
 */
async function readPromotionGrantOwner(ql: any): Promise<string | undefined> {
  try {
    return await resolveDefaultOrganizationId(ql);
  } catch {
    return undefined;
  }
}

/**
 * Answer the posture-keyed platform-admin question: promote the first
 * registered human user under `single`, report config-derived standing (and
 * write nothing) under walled postures. Safe to call multiple times.
 */
export async function bootstrapPlatformAdmin(
  ql: any,
  bootstrapPermissionSets: PermissionSet[],
  options: BootstrapOptions = {},
): Promise<{
  adminPromoted: boolean;
  reason?: string;
  /** Count of seeded rows re-owned to the freshly-promoted admin. */
  ownershipClaimed?: number;
  /**
   * WHO holds the anchoring `admin_full_access` grant after this pass — the user
   * this pass promoted, or the holder the `already_have_admin` short-circuit
   * found. Present on both, absent on every other return and under walled
   * postures (where no grant row exists and standing is config-derived at
   * request time, so there is no row-based answer to give).
   *
   * It exists because the seed-ownership claim is **not a single pass** and the
   * later passes need a target. The claim hands seeded rows to this user; a
   * bundle that overruns `OS_INLINE_SEED_BUDGET_MS` keeps writing rows after the
   * promotion instant, and the re-run on `app:seeded` must re-own them to the
   * SAME admin. Before this, the short-circuited pass knew the answer and threw
   * it away. A seed that settles BEFORE this pass runs (an in-budget seed on a
   * later boot) cannot wait for it, so the re-run then asks
   * {@link findExistingPlatformAdmin} — the same two-leg scan this pass runs,
   * one function, never a copy of it (commit 1c83ca226 is what that scan costs
   * to get right).
   */
  adminUserId?: string;
  /**
   * [commit 9b9581b11] WHY this target was chosen, when one was. `declared-owner` means
   * `OS_PLATFORM_OWNER_EMAIL` named them; `oldest-authenticable` means nobody
   * did and the age rule answered. The highest-privilege grant in the system
   * should not be auditable only by reading which code path ran.
   */
  basis?: 'declared-owner' | 'oldest-authenticable';
  /**
   * [commit 1c83ca226] How many `admin_full_access` grant rows the `already_have_admin`
   * guard actually examined before answering. The old read looked at "up to 50,
   * whichever the driver produced first" and said nothing, so a guard that had
   * seen the whole population and a guard that had seen a truncated sample of
   * it returned BYTE-IDENTICAL payloads. Present on every return the guard
   * reaches; absent on the returns that precede it.
   */
  adminGrantRowsExamined?: number;
}> {
  const logger = options.logger;
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { adminPromoted: false, reason: 'objectql_unavailable' };
  }

  // 1. [ADR-0131 D3/D4] No catalog row is written or read: the platform's
  //    default sets are definitions this plugin ships on its manifest, served
  //    from the registry, and a grant names its set. [C3 stage 8] The catalog
  //    row object is retired, so a grant written before the name column
  //    existed is reached by leg C of {@link findPlatformAdminGrantHolder}
  //    through the grant table alone.

  // 2. The platform-admin question, POSTURE-KEYED (#11184 ruling 2026-08-23,
  //    verbatim: 「1509 选择 env 指定 owner 邮箱」; re-anchored by #11663 L4):
  //
  //   - `single`: first human user is promoted — ruled reasonable, unchanged
  //     (Choice 4A keeps first-user promotion and its grant row, which ADR-0131
  //     D5 has owned by the Default Organization). [#14348]
  //     "first human user" = the oldest one that can authenticate.
  //   - walled (`group` / `isolated`): NO grant row is written. Standing is
  //     config-derived at the one derivation site (`resolve-authz-context.ts`
  //     §6b-config): a stored `sys_user` row holding a declared
  //     `OS_PLATFORM_OWNER_EMAIL` address AND reading VERIFIED resolves
  //     PLATFORM_ADMIN at request time. This branch only reports.
  //
  // The REQUESTED posture (`resolveTenancyPosture()`, what the operator asked
  // for) is deliberately the input here rather than the enforced one: a
  // deployment that requested a wall must not fall back to first-registrant
  // promotion even while running degraded (OS_ALLOW_DEGRADED_TENANCY=1) —
  // fail toward the stricter reading, same direction ADR-0093 D5 fails.
  const walled = postureEnforcesWall(resolveTenancyPosture());

  // [ADR-0131 D5] Under `single` the promotion's grant is the Default
  // Organization's, so that is the owner the holder scan asks about and the
  // owner a promotion writes. Under a wall no
  // grant anchors standing and none is written, so nothing is asked.
  const defaultOrganizationId = walled ? undefined : await readPromotionGrantOwner(ql);

  // [ADR-0131 D4] The grant names `admin_full_access`; the set is the catalog
  // definition this plugin ships, so no `sys_permission_set` row is needed to
  // grant it. The legacy row's id, when there is one, feeds only the
  // restrict-only leg of the holder scan ({@link findPlatformAdminGrantHolder}).
  if (!bootstrapPermissionSets.some((ps) => ps.name === PLATFORM_ADMIN_PERMISSION_SET_NAME)) {
    return { adminPromoted: false, reason: 'admin_permission_set_missing' };
  }

  // ── Does this deployment ALREADY have a platform admin? (commit 1c83ca226) ─
  //
  // The ONE rule — {@link findPlatformAdminGrantHolder} — that the seed-settle
  // claim also asks when no pass of this boot has answered yet
  // ({@link findExistingPlatformAdmin}). Why it is two legs and why each is
  // bounded and ordered is on the function.
  const {
    holder: anchorHolder,
    unnamedHolder,
    adminGrantRowsExamined,
    truncated: adminGrantScanTruncated,
  } = await findPlatformAdminGrantHolder(ql, true, { walled, defaultOrganizationId });

  // ⛔ The truncation is never silent (commit 1c83ca226). Reaching the ceiling is the one
  // way this scan still answers "no platform admin yet" while one exists, and
  // that answer does not merely skip a log line — it MINTS A SECOND anchoring
  // grant and hands it the seeded business records. So it says the number it
  // examined rather than letting the promotion below read as a statement about
  // the whole table.
  if (adminGrantScanTruncated && !anchorHolder && !unnamedHolder) {
    const truncation =
      '[security] the existing-platform-admin check stopped at its ceiling of '
      + `${PLATFORM_ADMIN_GRANT_SCAN_CEILING} admin_full_access grant row(s) `
      + `(${adminGrantRowsExamined} examined) without finding a human platform-admin grant — rows beyond `
      + 'that point were NOT examined, so this deployment may ALREADY have a platform administrator '
      + 'this boot did not see. Promoting now would mint a SECOND platform-admin grant and re-own the seeded '
      + `business records to it. Name the intended administrator with ${PLATFORM_OWNER_EMAIL_ENV} rather `
      + 'than leaving the answer to a scan bound.';
    if (logger?.warn) logger.warn(truncation);
    else logger?.info?.(truncation);
  }

  // Attached to every return the guard reaches, so a caller can tell a guard
  // that saw the whole population from one that saw a bounded slice of it.
  const grantScanCounts = { adminGrantRowsExamined };

  // `single`: a platform admin "already exists" — the promotion is a no-op
  // forever, and under Choice 4A that row IS this rig's anchor. [#11663 L5]
  // Under walled postures the same row is no longer an anchor at all, so the
  // walled branch below does not take this early exit: it goes on to report
  // config-derived standing, or to refuse fail-closed when nobody is declared.
  if (!walled && anchorHolder) {
    return {
      adminPromoted: false,
      reason: 'already_have_admin',
      // The promotion is a no-op forever; the CLAIM is not. The seed-settle
      // re-run hands rows to this name — or, when it fires before this pass
      // has run at all, asks {@link findExistingPlatformAdmin}, which answers
      // with this same holder (see `adminUserId` above).
      ...(anchorHolder.user_id ? { adminUserId: String(anchorHolder.user_id) } : {}),
      ...grantScanCounts,
    };
  }

  // [ADR-0131 D4] An anchoring grant that names no set yet — on an upgraded
  // deployment, possibly its platform administrator's grant, written before
  // the name column existed. It is read as an administrator who may already
  // exist: promoting now could mint the second grant
  // {@link findPlatformAdminGrantHolder} exists to refuse. It names no
  // `adminUserId` — it restricts, it confers nothing — so the seed claim waits
  // for a boot that reads the grant by its name.
  if (!walled && unnamedHolder) {
    const withheld =
      '[security] platform-admin promotion WITHHELD: a Default Organization grant exists whose permission-set name '
      + '(sys_user_permission_set.permission_set) was never written — a grant from a release before that '
      + 'column existed. Which set it holds can no longer be read, and it may be the platform administrator\'s, '
      + 'so this pass will not mint a second one. The organization-ownership migration\'s id-to-name rewrite '
      + '(ADR-0131 D10) names it; the next pass after that reads it by name.';
    if (logger?.warn) logger.warn(withheld);
    else logger?.info?.(withheld);
    return {
      adminPromoted: false,
      reason: 'admin_grant_unnamed',
      ...grantScanCounts,
    };
  }

  if (walled) {
    // [#11974 / #11663 L4, Choice 5A first half] The walled promotion is
    // RETIRED: no `sys_user_permission_set` row is minted, whatever accounts
    // exist.
    //
    // [#11663 L5] …and the row is no longer READ either. L4 left an existing
    // legacy grant conferring, inside a time-boxed window it announced once per
    // process. That window has closed: the derivation site
    // (`core/src/security/resolve-authz-context.ts` §6b) stops deriving
    // PLATFORM_ADMIN from an unscoped `admin_full_access` row under a walled
    // posture, so on these rigs standing is CONFIG-DERIVED and nothing else.
    //
    // ⛔ Nothing here writes, deletes or re-owns that row — its ownership is
    // ADR-0131 D10's ceremony's. Under a wall the holder scan asks nothing
    // (no grant anchors standing here), so `anchorHolder` is always undefined
    // on this branch.

    // Fail-closed backstop for an unusable config (unset, blank, or a list
    // REFUSED for an unparseable entry — #11663 Choice 2B folds all three
    // into `emails.length === 0`; the parser has already said WHY, once per
    // process). The startup half (walled + undeclared ⇒ REFUSE BOOT, naming
    // the variable) lives in plugin-auth's `init()`; this is the
    // defense-in-depth line for paths that reach the bootstrap without that
    // guard (embeddings without plugin-auth).
    //
    // [#11663 L5] ⛔ This line is no longer skipped when a legacy holder exists.
    // It used to be, and the reason it used to be has expired: L4's skip was
    // justified by 「the deployment HAS an administrator, on the old anchor」 and
    // by the deprecation pointer carrying the remedy instead. Both premises died
    // with the walled dual read. A walled rig holding an `admin_full_access`
    // grant and declaring nobody has ZERO platform administrators — exactly
    // the state this line exists to announce — so staying quiet for it would
    // be the silent half of a fail-closed guard.
    const platformAdminConfig = resolvePlatformAdminEmails();
    if (platformAdminConfig.emails.length === 0) {
      const message =
        `[security] tenancy posture is walled but ${PLATFORM_OWNER_EMAIL_ENV} declares no usable ` +
        'platform administrator (unset, blank, or refused for an unparseable entry) — ' +
        'this deployment has ZERO config-derived platform administrators. Under walled ' +
        'postures the first registrant is never promoted and no grant row is written; ' +
        `platform admin standing is derived from ${PLATFORM_OWNER_EMAIL_ENV} at request ` +
        "time. Set it to the operator's email address (or a comma-separated list of " +
        'addresses) and make sure the account verifies its email.';
      if (logger?.error) logger.error(message);
      else logger?.warn?.(message);
      return {
        adminPromoted: false,
        reason: 'walled_owner_email_undeclared',
        ...grantScanCounts,
      };
    }

    // The operator's first sight of the answer — the SAME answer the
    // read-only `platformAdmin` service serves (one implementation, see
    // platform-admin-service.ts). Per declared entry: does an account exist,
    // is it verified, which account holds standing.
    const standing = await resolvePlatformAdminStanding(ql, platformAdminConfig);
    const summary = standing
      .map((s) =>
        s.registered
          ? s.verified
            ? `${s.email}: registered + verified (${s.userId})`
            : `${s.email}: registered, NOT verified — no standing until the address verifies`
          : `${s.email}: not registered yet`,
      )
      .join('; ');
    logger?.info?.(
      `[security] walled posture — platform-admin standing is CONFIG-DERIVED (${PLATFORM_OWNER_EMAIL_ENV}); ` +
        'no grant row is written. Each declared, VERIFIED account resolves PLATFORM_ADMIN ' +
        `at request time. ${summary}`,
      { standing: standing.map((s) => ({ ...s })) },
    );
    // [#18412] …and the SAME answer, recorded durably. The log line above is
    // the operator's first sight of it and nothing else: it is not queryable,
    // it does not survive the process, and an auditor asking 「who held
    // administrator standing three months ago, and since when」 cannot read it.
    // This is the write that makes that question answerable — one entry per
    // CHANGE of standing, plus the first-boot baseline.
    await recordPlatformAdminStandingChange(ql, standing, logger);
    return {
      adminPromoted: false,
      reason: 'walled_config_derived',
      ...grantScanCounts,
    };
  }

  // Exclude the non-loginable system service account. It is created during
  // seed loading — *before* the first human sign-up — so without this filter
  // it is the earliest user and steals the platform-admin promotion, leaving
  // the real admin login without `setup.access` / `studio.access` (Setup and
  // Studio then stay invisible even though login succeeds).
  //
  // [#12515] The `typeof` guard mirrors `isHumanUserRow`
  // (`plugin-auth/src/audience-posture.ts`) — the #11767-consolidated owner of
  // this same question — rather than inventing a stricter rule of its own.
  // Without it a truthy NON-object input (`'usr_alice'`, a number, `true`)
  // scores HUMAN here: `.id` and `.role` are both `undefined` on a non-object,
  // so both comparisons pass. `isHumanUserRow` calls that same input non-human,
  // and this is the copy that PERFORMS the platform-admin promotion — so the
  // divergence failed OPEN on the security-critical side, which is why this
  // copy moves rather than the other. `!!` completes the mirror: both now
  // return a real boolean instead of echoing a falsy input back.
  //
  // Direction checked before tightening, because over-tightening here would
  // mean an install unable to promote its first admin: every row a real
  // `sys_user` read yields is a plain object, so the guard changes no
  // reachable answer. The identical read (`sys_user`, `where: {}`, `limit: 50`,
  // system context) is already filtered by `isHumanUserRow` in `plugin-auth`'s
  // dev-admin seed, so this guard is the incumbent on this very population.
  const isHumanUser = (u: any) =>
    !!u && typeof u === 'object' && u.id !== SystemUserId.SYSTEM && u.role !== 'system';
  // The age order "first user" has always meant, unchanged by #14348 — only
  // WHICH rows are candidates changed, never how they are ranked. Kept as a
  // named comparator (it was inlined in an `oldestOf` helper) so the selector
  // below states the age rule once instead of carrying a second copy of it.
  const byCreatedAtAsc = (a: any, b: any) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  };

  // [#14348] "First user" has always MEANT the real admin login — the comment
  // above the `isHumanUser` guard says so, and the guard exists because the
  // non-loginable `usr_system` row stole the promotion. Being human was only
  // ever a PROXY for that: on an install where every row came from sign-up,
  // oldest-human and oldest-login are the same row, so the proxy held.
  //
  // It stops holding the moment an app declares people in
  // `defineStack({ data })`. Those are credential-less directory rows, and the
  // declarative seed is awaited inside `AppPlugin.start()` — before any
  // `kernel:ready` hook — so they are ALWAYS older than any account. Measured
  // on a driven composed boot (#14348): the grant landed on
  // `person0@demo.example`, a row with no `sys_account`, while a later real
  // sign-up WITH a credential account was never promoted (the
  // `already_have_admin` short-circuit had already fired). Same row-versus-
  // login correction #14157 made in plugin-auth's dev-admin seed, one package
  // over, on this very population.
  //
  // "Can authenticate" is ANY `sys_account` row, not `provider_id ===
  // 'credential'`: a federated/SSO account is a login too, and narrowing to
  // passwords would refuse to promote the admin of an SSO-only deployment —
  // re-creating this defect for a different population.
  //
  // Asked per candidate, oldest-first, stopping at the first hit, rather than
  // bulk-reading accounts and intersecting. A bulk read would need a bound,
  // and a user holding several accounts (credential + OAuth) can push another
  // user's only account past it — which reads as "cannot authenticate" and
  // silently SKIPS a legitimate target. The typical fresh boot answers on the
  // first query.
  const canAuthenticate = async (user: any): Promise<boolean> => {
    if (user?.id === undefined || user?.id === null) return false;
    const accounts = await tryFind(ql, 'sys_account', { user_id: user.id }, 1);
    return accounts.length > 0;
  };
  const firstAuthenticable = async (users: any[]): Promise<any | undefined> => {
    for (const user of users) if (await canAuthenticate(user)) return user;
    return undefined;
  };

  /**
   * Mint the grant and RECORD it. One call site for both legs, so the write,
   * the log and the seed-ownership handoff cannot drift apart per basis.
   *
   * [commit 9b9581b11] The old line was `first user promoted to platform admin: <email>`
   * and nothing else. It is the only record of the highest-privilege grant
   * this system ever makes, and it did not say WHY that row won or HOW MANY
   * rows it was chosen from — so a promotion decided by a truncated,
   * driver-ordered 50-row sample and one decided by an operator's declaration
   * produced BYTE-IDENTICAL evidence. The prefix is unchanged (existing
   * consumers match on it); the basis and the candidate pool are appended, and
   * repeated in `meta` so a structured sink gets them as fields.
   */
  const promote = async (
    chosen: any,
    audit: { basis: 'declared-owner' | 'oldest-authenticable'; pool: string; candidatePoolSize: number },
  ) => {
    // [ADR-0131 D5] ⛔ Never a NULL-organization grant: the row is the Default
    // Organization's, and a deployment whose Default Organization cannot be
    // named is not promoted. Writing the row without an owner would hand out
    // the highest-privilege grant in the system as the one shape D5 retires;
    // guessing an owner would hand it to an organization the derivation site
    // does not read as the anchor. So it withholds and says why — at `error`,
    // because the deployment boots on looking healthy with no administrator —
    // and the next pass (every `kernel:ready`, every sign-up) promotes once the
    // organization can be named.
    if (defaultOrganizationId === undefined) {
      const message =
        `[security] platform-admin promotion WITHHELD for ${chosen.email ?? chosen.id}: the grant it writes `
        + 'is owned by the Default Organization (ADR-0131 D5), and this deployment names none — no '
        + "sys_organization row with slug 'default' and not exactly one organization (or the read was "
        + 'refused). Under the single tenancy posture the auth plugin creates the Default Organization at '
        + 'boot; with several organizations, give the intended one the slug \'default\'. This deployment has '
        + 'NO platform administrator until then.';
      if (logger?.error) logger.error(message);
      else logger?.warn?.(message);
      return {
        adminPromoted: false,
        reason: 'default_organization_unresolved',
        ...grantScanCounts,
      };
    }
    const inserted = await tryInsert(ql, 'sys_user_permission_set', {
      id: genId('ups'),
      user_id: chosen.id,
      // [ADR-0131 D4] The grant names its set; no id is written (D10).
      permission_set: PLATFORM_ADMIN_PERMISSION_SET_NAME,
      organization_id: defaultOrganizationId,
      granted_by: null,
    });
    if (!inserted) {
      logger?.warn?.(`[security] failed to grant admin_full_access to first user ${chosen.email ?? chosen.id}`);
      return {
        adminPromoted: false,
        reason: 'insert_failed',
        ...grantScanCounts,
      };
    }
    logger?.info?.(
      `[security] first user promoted to platform admin: ${chosen.email ?? chosen.id} `
        + `— basis: ${audit.basis}; candidate pool: ${audit.pool}`,
      { basis: audit.basis, candidatePoolSize: audit.candidatePoolSize, userId: String(chosen.id) },
    );

    // Hand seeded business records (the seed's NULL-owner rows, and usr_system
    // rows) to the freshly promoted admin so owner-keyed UX works out of the
    // box — and no other unowned row (ADR-0138 D1). Best-effort and
    // idempotent — failures here must not undo the promotion above.
    //
    // ⚠️ This pass is NOT the last word, and does not pretend to be. The
    // promotion instant is not the moment the seed is done: an app bundle that
    // overruns `OS_INLINE_SEED_BUDGET_MS` keeps writing in the background, so
    // rows can land after this walk and would stay ownerless forever. The
    // settlement snapshot is what lets the pass SAY which of the two it was,
    // and `security-plugin.ts` re-runs the claim on `app:seeded`.
    let ownershipClaimed = 0;
    try {
      const claims = await claimSeedOwnership(ql, chosen.id, {
        logger,
        seedSettlement: options.seedSettlement,
        seededRecordIds: options.seededRecordIds,
      });
      ownershipClaimed = claims.reduce((sum, c) => sum + c.count, 0);
    } catch (e) {
      logger?.warn?.('[security] seed ownership handoff failed', { error: (e as Error).message });
    }

    return {
      adminPromoted: true,
      ownershipClaimed,
      adminUserId: String(chosen.id),
      basis: audit.basis,
      ...grantScanCounts,
    };
  };

  // ── The candidate ORDER, stated to the DRIVER (commit 9b9581b11) ──────────
  //
  // The age rule used to be applied by `[...users].sort(byCreatedAtAsc)` over
  // whatever `tryFind(ql, 'sys_user', {}, 50)` returned. That read carried no
  // `orderBy`, so "the oldest authenticable user" meant *the oldest
  // authenticable user among whatever 50 rows this driver produced first* —
  // and the two families disagree by construction. Measured on 113 seeded
  // `sys_user` rows, the intended owner inserted FIRST and holding an id that
  // sorts LAST:
  //
  //     memory   window[0] = usr_zzz_owner   -> promoted admin@objectos.ai
  //     sqlite   window[0] = usr_ats_c001    -> promoted candidate001@mail.example
  //              (usr_zzz_owner was not in the window AT ALL)
  //
  // Same code, same config, same data; the answer changed with the storage
  // driver, and a job-seeker persona took the unscoped `admin_full_access`
  // grant plus — through `claimSeedOwnership` — ownership of every seeded row.
  // A client-side sort cannot notice this: it sorts a SAMPLE and reports a
  // global answer.
  //
  // So the ranking moves into the query and there is deliberately NO
  // client-side re-sort left behind. A defensive `.sort()` here would re-rank
  // the returned page and hide it if the `orderBy` ever stopped being sent —
  // the guard would go on passing while the selection went back to being a
  // function of the driver.
  //
  // `id` is the tie-breaker, not decoration: seeded populations routinely
  // share one `created_at`, and among ties an unordered read is exactly the
  // sample-dependent answer this fixes.
  const OLDEST_FIRST: { field: string; order: 'asc' | 'desc' }[] = [
    { field: 'created_at', order: 'asc' },
    { field: 'id', order: 'asc' },
  ];
  // [#11974 / #11663 L4] `single` is the ONLY posture that still selects a
  // target and writes the grant row (Choice 4A). The walled selection — query
  // by declared email, verified-only, oldest wins — moved with the decision
  // itself into the derivation site (`resolve-authz-context.ts` §6b-config)
  // and, for the audit answer, `platform-admin-service.ts`.
  //
  // ── Leg 1: the DECLARED owner, when the operator declared one (commit 9b9581b11) ─
  //
  // `PLATFORM_OWNER_EMAIL_ENV` was imported into this file and read only on
  // the walled branch. So a deployment that had SAID who the owner is could
  // still have someone else promoted here — which is what made the loose read
  // above a security defect rather than a nondeterminism one. This leg asks
  // the anchor first.
  //
  // A VERIFIED holder, and nothing less — maintainer ruling of 2026-09-08
  // (decision batch #100) on this card, which supersedes the Choice 4A
  // sentence for this one point:
  //
  //   > F4 — verification is a requirement, not a preference, on the
  //   > declared-owner leg. A declared address held by a row with
  //   > `email_verified !== true` is treated like a declared owner nobody can
  //   > sign in as: REFUSE [...] zero grant rows, and the replay predicate
  //   > promotes as soon as verification lands. ⛔ No fall-back to
  //   > oldest-authenticable while a declared address exists.
  //
  // So a row is the declared owner only when all four hold: it holds the
  // declared address, it is human, it can authenticate, and it has verified
  // that address. An earlier draft of this leg ranked verified rows AHEAD of
  // unverified ones instead — that ordering is ruled moot and is gone, because
  // a preference only helps when a verified holder EXISTS. `sys_user.email`
  // carries a UNIQUE index on the SQL family, so a squatter who registers the
  // operator's address first leaves the operator unable to hold a row at all,
  // and a preference then promotes the squat. `matchesConfiguredPlatformAdmin`
  // states that threat for the walled derivation — "an attacker who registers
  // the operator's address before the operator does gains no standing by it" —
  // and this leg now answers it the same way the walled derivation does: by
  // refusal.
  //
  // The accepted cost, stated by the ruling rather than discovered later: a
  // `single` deployment whose declared owner has not verified their email gets
  // NO platform admin at first boot until they do, loudly. That is the
  // intended loud failure; it replaces a silent wrong promotion.
  //
  // `isHumanUser` still applies: a declared address sitting on `usr_system` or
  // a `role: 'system'` row must not become a route to the grant.
  const declaredOwners = resolvePlatformAdminEmails();
  if (declaredOwners.emails.length > 0) {
    // Both spellings, same discipline as `resolvePlatformAdminStanding`: a
    // driver `where` is an exact match and an imported/legacy row may not be
    // stored lowercased. Declaration order decides between several declared
    // addresses; `created_at` decides between several rows holding one.
    let declaredTarget: any | undefined;
    let declaredMatches = 0;
    // Rows that hold a declared address, are human, and can sign in. The
    // decline below discriminates on this count, so "nobody holds it / nobody
    // can sign in as it" and "somebody can sign in but has not verified"
    // report different reasons instead of one blurred refusal.
    let declaredAuthenticable = 0;
    for (let i = 0; i < declaredOwners.emails.length && !declaredTarget; i++) {
      const email = declaredOwners.emails[i]!;
      const spelling = declaredOwners.declaredSpellings[i] ?? email;
      const byId = new Map<string, any>();
      for (const s of new Set([email, spelling])) {
        for (const row of await tryFind(ql, 'sys_user', { email: s }, 10)) {
          if (row && typeof row === 'object' && row.id) byId.set(String(row.id), row);
        }
      }
      const matching = [...byId.values()]
        .filter((row) => normalizePlatformAdminEmail(row.email) === email)
        .filter(isHumanUser)
        .sort(byCreatedAtAsc);
      declaredMatches += matching.length;
      // Authenticability is asked FIRST so the two refusals stay separable:
      // #14348's "nobody can sign in as the declared address" keeps its own
      // reason code and its own pins, and the ruling's new requirement reports
      // itself as itself. `isEmailVerifiedUserRow` is the same fail-closed
      // predicate the walled derivation and the audit surface read (an ABSENT
      // column is unverified) — never a second local copy of "looks verified".
      for (const row of matching) {
        if (!(await canAuthenticate(row))) continue;
        declaredAuthenticable += 1;
        if (!isEmailVerifiedUserRow(row)) continue;
        declaredTarget = row;
        break;
      }
    }
    if (declaredTarget) {
      return promote(declaredTarget, {
        basis: 'declared-owner',
        pool:
          `${declaredOwners.emails.length} address(es) declared in ${PLATFORM_OWNER_EMAIL_ENV}, `
          + `${declaredMatches} matching human user row(s)`,
        candidatePoolSize: declaredMatches,
      });
    }
    // Declared, and not one declared address is held by a verified holder who
    // can sign in. ⛔ NOT a silent fall-back to whoever happens to be oldest:
    // the operator named the owner, so promoting somebody else is the very
    // outcome this card is about. The walled branch already refuses loudly for
    // the same input (see the `walled_owner_email_undeclared` diagnostic
    // above); this is that answer for `single`. The replay predicate re-runs
    // this pass on the next `sys_user` / `sys_account` insert AND on the
    // verifying update, so the declared owner is promoted the moment both
    // their login and their verification exist.
    const unverifiedOnly = declaredAuthenticable > 0;
    const diagnosis = declaredMatches === 0
      ? 'no human sys_user row holds that address'
      : unverifiedOnly
        ? `none of the ${declaredAuthenticable} matching human row(s) that can sign in has VERIFIED that `
          + 'address (email_verified is not true), and verification is REQUIRED of the declared owner'
        : `none of the ${declaredMatches} matching human row(s) can authenticate (no sys_account)`;
    const remedy = unverifiedOnly
      ? 'Complete the email verification for the declared address'
      : 'Register and sign in as the declared address';
    const message =
      `[security] ${PLATFORM_OWNER_EMAIL_ENV} declares `
      + `${declaredOwners.emails.map((e) => JSON.stringify(e)).join(', ')} as this deployment's platform `
      + `administrator, but ${diagnosis}`
      + ' — platform admin NOT promoted. Promotion is NOT falling back to the oldest '
      + 'authenticable user: that would hand the highest-privilege grant to somebody the '
      + `operator did not choose. ${remedy}, or unset `
      + `${PLATFORM_OWNER_EMAIL_ENV} to use first-user promotion.`;
    if (logger?.warn) logger.warn(message);
    else logger?.info?.(message);
    return {
      adminPromoted: false,
      // [commit 9b9581b11, batch #100] The ruling allows either a distinct code or a
      // fold into `declared_owner_not_authenticable` with verification named
      // in the warning. A distinct code is used for the verification miss so
      // #14348's refusal keeps its own name and its own pins, and an operator
      // reading a structured sink can tell "register a login" apart from
      // "click the link in your mailbox".
      reason: unverifiedOnly ? 'declared_owner_not_verified' : 'declared_owner_not_authenticable',
      ...grantScanCounts,
    };
  }

  // ── Leg 2: no declaration — the oldest authenticable human ─────────────────
  let scannedHumans = 0;
  let scanTruncated = false;
  let target: any | undefined;
  const pageSize = PLATFORM_ADMIN_CANDIDATE_PAGE_SIZE;
  const ceiling = PLATFORM_ADMIN_CANDIDATE_SCAN_CEILING;
  for (let offset = 0; offset < ceiling && !target; offset += pageSize) {
    const pageLimit = Math.min(pageSize, ceiling - offset);
    const page = await tryFind(ql, 'sys_user', {}, pageLimit, OLDEST_FIRST, offset);
    if (page.length === 0) break;
    const humans = page.filter(isHumanUser);
    scannedHumans += humans.length;
    target = await firstAuthenticable(humans);
    if (target) break;
    if (page.length < pageLimit) break;
    if (offset + page.length >= ceiling) scanTruncated = true;
  }
  if (scannedHumans === 0) {
    logger?.info?.('[security] no human users yet — first sign-up will be promoted to platform admin');
    return { adminPromoted: false, reason: 'no_users', ...grantScanCounts };
  }
  if (!target) {
    // [#14348] Humans exist, but not one of them can sign in. Measured on a
    // real composed boot before this branch existed: an app seeding people
    // through `defineStack({ data })` had `admin_full_access` granted to
    // `person0@demo.example` — `has_sys_account: false`, with the whole
    // `sys_account` table EMPTY — and `claimSeedOwnership` handed it the
    // seeded business records too. The grant was WRITTEN and unusable.
    //
    // The honest answer for that population is to promote NOBODY and wait: the
    // replay predicate above now fires on the `sys_account` insert, so the
    // first real login is promoted the moment it exists. `info`, not `error` —
    // this is a legitimate pre-login state (the app declared a directory and
    // nobody has signed up yet), the same register the `no_users` line above
    // uses, and a published sink shape gains nothing from a louder level.
    logger?.info?.(
      `[security] ${scannedHumans} human user row(s) exist but none can authenticate (no sys_account) ` +
        '— platform admin NOT promoted. The first human that signs in will be promoted instead; a ' +
        'directory row nobody can sign in as would hold a grant it could never exercise.',
    );
    // ⛔ The truncation is never silent again (commit 9b9581b11). Reaching the ceiling is
    // the ONE way an ordered scan can still answer "nobody" while a promotable
    // human exists, so it says the number it examined instead of letting the
    // line above read as a statement about the whole table.
    if (scanTruncated) {
      const truncation =
        `[security] the platform-admin candidate scan stopped at its ceiling of ${ceiling} `
        + 'oldest sys_user row(s) and none of them can authenticate — rows beyond that point were NOT '
        + 'examined, so this deployment may hold a promotable human the boot did not see. Promote the '
        + `intended administrator explicitly by setting ${PLATFORM_OWNER_EMAIL_ENV}.`;
      if (logger?.warn) logger.warn(truncation);
      else logger?.info?.(truncation);
    }
    return {
      adminPromoted: false,
      reason: 'no_authenticable_user',
      ...grantScanCounts,
    };
  }

  return promote(target, {
    basis: 'oldest-authenticable',
    pool:
      `${scannedHumans} human user row(s) examined oldest-first by created_at`
      + `${scanTruncated ? ` (scan ceiling ${ceiling} reached)` : ''}`,
    candidatePoolSize: scannedHumans,
  });
}
