// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — first-boot platform admin promotion.
 *
 * Two responsibilities, both idempotent and run on `kernel:ready`:
 *
 *  1. **Seed `sys_permission_set` rows** for each `defaultPermissionSets`
 *     entry (admin_full_access / member_default / viewer_readonly).
 *
 *  2. **Answer the platform-admin question, POSTURE-KEYED** (#11184 ruling
 *     2026-08-23; re-anchored by #11663, maintainer acceptance 2026-08-25,
 *     leg L4 = #11974):
 *       - `single`: promote the first registered human user by inserting a
 *         `sys_user_permission_set` row pointing at `admin_full_access` with
 *         `organization_id = NULL`. Unchanged — Choice 4A keeps first-user
 *         promotion and its grant row for this posture (4B is the sequenced
 *         follow-up, not dropped). [#14348] "First user" means the oldest
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
 *         `platform-admin-service.ts`), and points any LEGACY unscoped grant
 *         holder at the config path via the shared once-per-process
 *         deprecation reporter (`reportLegacyPlatformAdminGrant`, pin #5:
 *         loud migration, never a silent dual-track). Undeclared/blank/
 *         refused config still refuses loudly (fail-closed backstop; the
 *         boot-refusal half lives in plugin-auth `init()`).
 *
 * The "create a Default Organization for the freshly-promoted admin"
 * behavior moved to `@objectstack/organizations` (see
 * `ensureDefaultOrganization`). Install that plugin to get
 * multi-tenant bootstrap.
 *
 * ## Provenance of the seeded permission-set rows (#8692, ruled 2026-08-15)
 *
 * The seed insert stamps `managed_by: 'platform'` **explicitly**, so a fresh
 * install's default sets are platform-owned and `os meta resync` reconciles
 * them — which is what #2705 built the resync flag for. This also puts the
 * seeder in line with its two siblings in this package,
 * `bootstrap-builtin-positions.ts` and `bootstrap-system-capabilities.ts`,
 * which have always stamped `'platform'` rather than inheriting a default.
 *
 * ⚠️ **Installs created BEFORE that ruling carry `'admin'` on these rows.**
 * The pre-ruling insert omitted `managed_by` altogether, so the value came from
 * the declared `defaultValue: 'admin'` in `objects/sys-permission-set.object.ts`
 * — measured on a real engine (#8804: a seeded row stored `'admin'`, and a real
 * resync returned `resynced 0 / resyncSkipped 8`, skipping every shipped
 * default set).
 *
 * For those legacy rows the resync SKIP stands, permanently and by decision:
 * a stored `'admin'` is **indistinguishable** between "the old seeder's field
 * default" and "an administrator took this set over in Setup". So there is
 * deliberately **no migration and no restamp** — rewriting them to `'platform'`
 * would make genuine admin customizations reconcilable and could silently
 * overwrite them on the next `os meta resync`. Report, don't rewrite. A legacy
 * install that wants the platform defaults reconciled has to re-own the rows
 * deliberately (or re-seed with `--fresh`); that is an operator's choice to
 * make, not one a boot should make on their behalf.
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
  reportLegacyPlatformAdminGrant,
  resolvePlatformAdminEmails,
} from '@objectstack/core';
import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import {
  createSeedWriteRefusals,
  reportSeedWriteRefusals,
  type SeedWriteRefusals,
} from './per-organization-catalog.js';
import { resolvePlatformAdminStanding } from './platform-admin-service.js';

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
   * [#2705] Force re-materialization of the default permission-set rows from
   * the compiled declaration.
   *
   * Default (`false`) keeps the insert-once shape: an existing row is left
   * untouched so an admin's Setup customizations survive every restart. This is
   * correct for prod boot.
   *
   * `os meta resync` sets it to `true` to reconcile the DB rows to the shipped
   * `dist` after a source edit — the dev loop that insert-once otherwise makes
   * silently stale (a changed default set is served with its OLD value until a
   * `--fresh` wipe). Only platform-owned rows (`managed_by` absent or
   * `'platform'`) are overwritten. Rows carrying any other provenance are left
   * alone: `'user'` / `'admin'` (taken over in Setup — or, on a pre-#8692
   * install, seeded before the platform stamped its own rows) and `'package'`
   * (owned by package metadata).
   */
  resync?: boolean;
  /**
   * The seed pipeline's tally at the moment this bootstrap runs, read by the
   * caller through the published `seed-settlement` contract.
   *
   * Handed straight to {@link claimSeedOwnership} and used for nothing else:
   * the claim pass is the only step here whose answer depends on whether the
   * platform's own seeder has finished writing, and a pass that cannot say so
   * reports "claimed 0 of 0" for both "nothing to claim" and "nothing had
   * landed yet". Absent for callers with no kernel context (`os meta resync`),
   * which the claim reports as `unattested` rather than guessing.
   */
  seedSettlement?: SeedSettlementSnapshot | undefined;
}

const SYSTEM_CTX = { isSystem: true };

/**
 * [#16682] The `single`-posture candidate scan's page size and hard ceiling —
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
 * [#16861] The `already_have_admin` guard's page size and hard ceiling — what
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
): Promise<any[]> {
  try {
    const query: Record<string, any> = { where, limit };
    if (orderBy) query.orderBy = orderBy;
    if (offset !== undefined) query.offset = offset;
    const rows = await ql.find(object, query, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// ⛔ The `catch` RECORDS the refusal before it answers, when the caller passed
// a log to record into. Answering `null`/`false` alone is what made a refused
// write indistinguishable from "nothing to do": `seeded` never grows, the pass
// returns normally, and the boot reports a successful seed of zero rows. Still
// no rethrow — this pass reports, it does not decide whether the deployment
// boots. See `reportSeedWriteRefusals` in `per-organization-catalog.ts`.
async function tryInsert(
  ql: any, object: string, data: any, refusals?: SeedWriteRefusals,
): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: SYSTEM_CTX });
  } catch (e) {
    refusals?.record(object, e);
    return null;
  }
}

async function tryUpdate(
  ql: any, object: string, data: any, refusals?: SeedWriteRefusals,
): Promise<boolean> {
  try {
    await ql.update(object, data, { context: SYSTEM_CTX });
    return true;
  } catch (e) {
    refusals?.record(object, e);
    return false;
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
 * #11343 `update` arm (payload touching `email_verified` / `email`) existed
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
 *    while an owner address is declared: [#16682, maintainer ruling of
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
  // [#16682] The verifying write, and only where it can decide something.
  const data = opCtx.data;
  if (!data || typeof data !== 'object') return false;
  if (!('email_verified' in data) && !('email' in data)) return false;
  return resolvePlatformAdminEmails().emails.length > 0;
}

/**
 * The platform-owned definition facets of a default permission set — the
 * fields the runtime resolver hydrates back into ExecutionContext
 * (`resolve-authz-context.ts` → systemPermissions / tabPermissions / object &
 * field masks). Single source for both the first-boot insert and the `#2705`
 * resync update so the two paths can never drift. Identity/provenance columns
 * (`id`, `name`, `active`, `managed_by`, `package_id`) are deliberately NOT
 * here — resync reconciles the declaration, never the ownership.
 *
 * [#8692] `managed_by` must stay out of this helper even though the seed insert
 * now stamps it. Both paths share these fields, so adding it here would make
 * every resync RESTAMP the row it reconciles -- silently converting a legacy
 * `admin`-owned row (which may be a real Setup takeover) into a platform-owned
 * one and clobbering it on that same pass. The insert stamps provenance at its
 * own call site precisely so the resync update cannot.
 *
 * `description` / `adminScope` are read defensively: neither is on the typed
 * PermissionSet shape (name/label/objects/fields/...), but both persist when a
 * runtime declaration provides them without tripping the dts typecheck.
 */
function platformOwnedFields(ps: PermissionSet): Record<string, any> {
  return {
    label: ps.label ?? ps.name,
    description: (ps as any).description ?? null,
    object_permissions: JSON.stringify(ps.objects ?? {}),
    field_permissions: JSON.stringify(ps.fields ?? {}),
    system_permissions: JSON.stringify(ps.systemPermissions ?? []),
    row_level_security: JSON.stringify(ps.rowLevelSecurity ?? []),
    tab_permissions: JSON.stringify(ps.tabPermissions ?? {}),
    // [ADR-0090 D12] Delegated-admin scope travels with the set row.
    admin_scope: (ps as any).adminScope ? JSON.stringify((ps as any).adminScope) : null,
  };
}

/**
 * Persist seed permission sets and answer the posture-keyed platform-admin
 * question: promote the first registered human user under `single`, report
 * config-derived standing (and write nothing) under walled postures. Safe to
 * call multiple times.
 */
export async function bootstrapPlatformAdmin(
  ql: any,
  bootstrapPermissionSets: PermissionSet[],
  options: BootstrapOptions = {},
): Promise<{
  seeded: number;
  adminPromoted: boolean;
  reason?: string;
  /** Count of seeded rows re-owned to the freshly-promoted admin. */
  ownershipClaimed?: number;
  /**
   * WHO holds the unscoped `admin_full_access` grant after this pass — the user
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
   * it away, so the only way to re-own the missed rows was to re-derive the
   * holder — a second implementation of the two-leg scan above, which is how the
   * guard and its copy drift apart (#16861 is what that scan costs to get
   * right). One owner, read by both passes.
   */
  adminUserId?: string;
  /** [#2705] Existing platform-owned rows reconciled to dist under `resync`. */
  resynced?: number;
  /** [#2705] Existing rows left untouched by `resync` (admin/package-owned). */
  resyncSkipped?: number;
  /**
   * [#16682] WHY this target was chosen, when one was. `declared-owner` means
   * `OS_PLATFORM_OWNER_EMAIL` named them; `oldest-authenticable` means nobody
   * did and the age rule answered. The highest-privilege grant in the system
   * should not be auditable only by reading which code path ran.
   */
  basis?: 'declared-owner' | 'oldest-authenticable';
  /**
   * [#16861] How many `admin_full_access` grant rows the `already_have_admin`
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
    return { seeded: 0, adminPromoted: false, reason: 'objectql_unavailable' };
  }

  // 1. Seed permission set rows.
  const seeded: Record<string, string> = {};
  let resynced = 0;
  let resyncSkipped = 0;
  // One log per pass, not per refused row: a legacy platform-wide unique index
  // refuses EVERY default permission set, and a line each would bury the remedy.
  const refusals = createSeedWriteRefusals();
  for (const ps of bootstrapPermissionSets) {
    if (!ps.name) continue;
    const existing = await tryFind(ql, 'sys_permission_set', { name: ps.name }, 1);
    if (existing.length > 0 && existing[0].id) {
      const row = existing[0];
      seeded[ps.name] = row.id;
      // Insert-once by default: an existing row is never clobbered on restart,
      // which is what protects an admin's Setup edits. Under `resync`
      // (`os meta resync`, #2705) reconcile the row to the shipped dist so a dev
      // source edit takes effect without `--fresh` -- but only for rows the
      // platform still owns.
      if (options.resync) {
        if (!row.managed_by || row.managed_by === 'platform') {
          if (await tryUpdate(ql, 'sys_permission_set', { id: row.id, ...platformOwnedFields(ps) }, refusals)) {
            resynced += 1;
          }
        } else {
          resyncSkipped += 1;
          // [#8692] Neutral by ruling: state the provenance and the action, and
          // claim NOTHING about intent. This used to say "(intentional
          // override)", which is a lie for every row on a pre-#8692 install --
          // there the only writer may have been this very seeder one call
          // earlier, inheriting `defaultValue: 'admin'` rather than any admin
          // deciding anything. The stored value cannot tell the two apart, so
          // the log must not pretend it can.
          logger?.warn?.(
            `[security] resync left ${ps.name} untouched — row is ${row.managed_by}-owned`,
            { name: ps.name, managedBy: row.managed_by },
          );
        }
      }
      continue;
    }
    const id = genId('ps');
    const created = await tryInsert(ql, 'sys_permission_set', {
      id,
      name: ps.name,
      ...platformOwnedFields(ps),
      active: true,
      // [#8692] Stamp provenance EXPLICITLY rather than letting it fall to the
      // declaration's `defaultValue: 'admin'`. Without this the platform's own
      // default sets are stored indistinguishably from admin-authored ones, so
      // `os meta resync` skips every single one of them (measured in #8804:
      // resynced 0 / resyncSkipped 8) -- the exact inverse of what #2705 built
      // the flag for. Matches `bootstrap-builtin-positions.ts` and
      // `bootstrap-system-capabilities.ts`, which already stamp `'platform'`.
      managed_by: 'platform',
    }, refusals);
    if (created?.id) seeded[ps.name] = created.id;
    else if (created) seeded[ps.name] = id;
  }

  // Reported HERE rather than at function end: every `return` below this point
  // is an early exit of the PROMOTION half, and the catalog seed above is
  // finished either way. Placing it at the end would make the diagnosis
  // conditional on how promotion happened to resolve.
  reportSeedWriteRefusals(logger, refusals);

  const seededCount = Object.keys(seeded).length;
  // [#11532] Under a walled posture these rows are organization-less BY RULING
  // (#10103, 2026-08-20) and unreadable through the wall, and the catalog pass
  // that runs next reports them once per organization. Saying so HERE is what
  // stops the operator's first sight of them being a warning that calls the
  // platform's own output legacy state: the fresh walled rig logged
  // `seeded: 8` with nothing to indicate the rows carried no organization at
  // all. Not a behaviour change — the seeding above is byte-identical.
  if (seededCount > 0 && postureEnforcesWall(resolveTenancyPosture())) {
    logger?.info?.(
      '[security] platform default permission sets seeded WITHOUT an organization (the platform ' +
        'bucket) — ruled 2026-08-20 and unchanged: the platform-admin grant points at the ' +
        'admin_full_access row by id. Under a walled posture they are unreadable through the ' +
        'tenant wall; each organization gets its own copies from the per-organization catalog ' +
        'pass, so no principal is missing a set.',
      { seeded: seededCount, names: Object.keys(seeded).sort() },
    );
  }
  // Attached to every return below so `os meta resync` can report the reconcile
  // outcome even when admin promotion short-circuits (the common dev case: a DB
  // that already has an admin returns `already_have_admin`).
  const resyncCounts = { resynced, resyncSkipped };

  // 2. The platform-admin question, POSTURE-KEYED (#11184 ruling 2026-08-23,
  //    verbatim: 「1509 选择 env 指定 owner 邮箱」; re-anchored by #11663 L4):
  //
  //   - `single`: first human user is promoted — ruled reasonable, unchanged
  //     (Choice 4A keeps first-user promotion and its grant row). [#14348]
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

  const adminPsId = seeded['admin_full_access'];
  if (!adminPsId) {
    return { seeded: seededCount, adminPromoted: false, reason: 'admin_permission_set_missing', ...resyncCounts };
  }

  // ── Does this deployment ALREADY have a platform admin? (#16861) ──────────
  //
  // This read was `tryFind(ql, 'sys_user_permission_set', { permission_set_id:
  // adminPsId }, 50)` — no `orderBy`, cap 50 — with the predicate that actually
  // decides (`!organization_id`) applied CLIENT-SIDE to whatever 50 rows the
  // driver produced first. `admin_full_access` is not only the platform-admin
  // set: every ORGANIZATION-SCOPED grant of it writes a row carrying the same
  // `permission_set_id`, so this population grows with the number of ORG
  // admins, not with the number of platform admins. A tenant with fifty-odd of
  // them filled the window with rows that all fail the filter, the short-circuit
  // did not fire, a SECOND unscoped grant was minted, and `claimSeedOwnership`
  // re-owned the seeded business records to the newly promoted user — silently,
  // because the boot logs a successful promotion exactly as it does on a
  // genuinely fresh install. What fails open there is #14348 case D:
  // 「Moving an already-granted platform admin is reserved to the maintainer.」
  //
  // ## Why this is TWO reads and not `organization_id: null` in the `where`
  //
  // The card's suggested one-line narrowing was MEASURED before it was taken,
  // and on its own it would have RELAXED this guard. Null matching itself is
  // uniform across the families that can be measured — each answers "the column
  // holds no value":
  //
  //     driver-sql (better-sqlite3)  via ObjectQL + these real objects  -> the unscoped row only
  //     driver-sqlite-wasm           via ObjectQL + these real objects  -> the unscoped row only
  //     driver-memory                driver face                       -> null-valued AND key-absent rows
  //     driver-mongodb               translator (its own live suites    -> `{organization_id: null}`,
  //                                  need a 123 MB binary download)        Mongo's null-or-missing reading
  //
  // What is NOT uniform is the narrowed read against THIS code's own predicate.
  // `organization_id: ''` is storable on both SQL families and reads back as
  // `''`: `!organization_id` counts that row UNSCOPED, and `where: {
  // organization_id: null }` does NOT return it. A narrowing that REPLACED the
  // client-side predicate would therefore stop seeing a legacy unscoped holder
  // stored that way, fire less often, and mint the second grant this card is
  // about. ⛔ This card only tightens, so the predicate is untouched and the
  // READ is what changes:
  //
  //   Leg A — ask the driver the narrow question. Independent of how many
  //           org-scoped grants exist, so no org-admin count can crowd the
  //           answer out of a window.
  //   Leg B — only when leg A found nobody: scan the grant population for this
  //           set, ORDERED so each page is a deterministic slice rather than
  //           "whatever the driver produced first", bounded, and WARNING at the
  //           bound with the number of rows examined. This is the leg that
  //           still sees a `''`-shaped legacy row.
  //
  // Both legs are strictly ADDITIVE to what the old read could see, so the
  // guard can only fire MORE often than before, never less.
  //
  // The seed-data owner `usr_system` (provisioned by the SeedLoader, see
  // runtime/app-plugin.ts `ensureSeedIdentity`) never counts — otherwise a DB
  // where it was wrongly promoted would block every real admin forever.
  // Ignoring it here makes the bootstrap self-healing on restart.
  const isUnscopedHumanHolder = (r: any) =>
    !r.organization_id && r.user_id !== SystemUserId.SYSTEM;

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
  let adminGrantScanTruncated = false;

  // Leg A — the narrow question, asked of the driver.
  const unscopedGrantRows = await tryFind(
    ql,
    'sys_user_permission_set',
    { permission_set_id: adminPsId, organization_id: null },
    PLATFORM_ADMIN_GRANT_PAGE_SIZE,
    ADMIN_GRANT_SCAN_ORDER,
  );
  countExamined(unscopedGrantRows);
  let unscopedHolder: any | undefined = unscopedGrantRows.find(isUnscopedHumanHolder);

  // Leg B — the ordered, bounded scan that still applies the exact predicate.
  if (!unscopedHolder) {
    const pageSize = PLATFORM_ADMIN_GRANT_PAGE_SIZE;
    const ceiling = PLATFORM_ADMIN_GRANT_SCAN_CEILING;
    for (let offset = 0; offset < ceiling && !unscopedHolder; offset += pageSize) {
      const pageLimit = Math.min(pageSize, ceiling - offset);
      const page = await tryFind(
        ql,
        'sys_user_permission_set',
        { permission_set_id: adminPsId },
        pageLimit,
        ADMIN_GRANT_SCAN_ORDER,
        offset,
      );
      if (page.length === 0) break;
      countExamined(page);
      unscopedHolder = page.find(isUnscopedHumanHolder);
      if (unscopedHolder) break;
      if (page.length < pageLimit) break;
      if (offset + page.length >= ceiling) adminGrantScanTruncated = true;
    }
  }

  // ⛔ The truncation is never silent (#16861). Reaching the ceiling is the one
  // way this scan still answers "no platform admin yet" while one exists, and
  // that answer does not merely skip a log line — it MINTS A SECOND unscoped
  // grant and hands it the seeded business records. So it says the number it
  // examined rather than letting the promotion below read as a statement about
  // the whole table.
  const adminGrantRowsExamined = examinedGrantRowIds.size;
  if (adminGrantScanTruncated && !unscopedHolder) {
    const truncation =
      '[security] the existing-platform-admin check stopped at its ceiling of '
      + `${PLATFORM_ADMIN_GRANT_SCAN_CEILING} admin_full_access grant row(s) `
      + `(${adminGrantRowsExamined} examined) without finding an unscoped human grant — rows beyond `
      + 'that point were NOT examined, so this deployment may ALREADY have a platform administrator '
      + 'this boot did not see. Promoting now would mint a SECOND unscoped grant and re-own the seeded '
      + `business records to it. Name the intended administrator with ${PLATFORM_OWNER_EMAIL_ENV} rather `
      + 'than leaving the answer to a scan bound.';
    if (logger?.warn) logger.warn(truncation);
    else logger?.info?.(truncation);
  }

  // Attached to every return the guard reaches, so a caller can tell a guard
  // that saw the whole population from one that saw a bounded slice of it.
  const grantScanCounts = { adminGrantRowsExamined };

  // `single`: a platform admin "already exists" — the promotion is a no-op
  // forever. Under walled postures that same row is the LEGACY anchor and gets
  // the deprecation pointer below instead of a silent early exit.
  if (!walled && unscopedHolder) {
    return {
      seeded: seededCount,
      adminPromoted: false,
      reason: 'already_have_admin',
      // The promotion is a no-op forever; the CLAIM is not. This pass is the
      // only thing on a later boot that knows who the seeded rows belong to,
      // and the seed-settle re-run needs that name (see `adminUserId` above).
      ...(unscopedHolder.user_id ? { adminUserId: String(unscopedHolder.user_id) } : {}),
      ...resyncCounts,
      ...grantScanCounts,
    };
  }

  if (walled) {
    // [#11974 / #11663 L4, Choice 5A first half] The walled promotion is
    // RETIRED: no `sys_user_permission_set` row is minted, whatever accounts
    // exist. Nothing is revoked either — an existing legacy grant still
    // confers (P5's honoured window, enforced at the derivation site) — but
    // it is now the OLD anchor, so its holder is pointed at the config path
    // ONCE per process through the same latch the derivation-site reporter
    // uses (`reportLegacyPlatformAdminGrant`): boot-time detection here and
    // request-time detection there can never add up to two lines.
    if (unscopedHolder) {
      const holder = unscopedHolder;
      const holderRows = await tryFind(ql, 'sys_user', { id: holder.user_id }, 1);
      reportLegacyPlatformAdminGrant({
        userId: String(holder.user_id),
        email: holderRows[0]?.email,
      });
    }

    // Fail-closed backstop for an unusable config (unset, blank, or a list
    // REFUSED for an unparseable entry — #11663 Choice 2B folds all three
    // into `emails.length === 0`; the parser has already said WHY, once per
    // process). The startup half (walled + undeclared ⇒ REFUSE BOOT, naming
    // the variable) lives in plugin-auth's `init()`; this is the
    // defense-in-depth line for paths that reach the bootstrap without that
    // guard (`os meta resync`, embeddings without plugin-auth). With a legacy
    // holder present the deprecation pointer above already carries the
    // remedy, so the extra error line is skipped — the deployment HAS an
    // administrator, on the old anchor.
    const platformAdminConfig = resolvePlatformAdminEmails();
    if (platformAdminConfig.emails.length === 0) {
      if (!unscopedHolder) {
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
      }
      return {
        seeded: seededCount,
        adminPromoted: false,
        reason: 'walled_owner_email_undeclared',
        ...resyncCounts,
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
    return {
      seeded: seededCount,
      adminPromoted: false,
      reason: 'walled_config_derived',
      ...resyncCounts,
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
   * [#16682] The old line was `first user promoted to platform admin: <email>`
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
    const inserted = await tryInsert(ql, 'sys_user_permission_set', {
      id: genId('ups'),
      user_id: chosen.id,
      permission_set_id: adminPsId,
      organization_id: null,
      granted_by: null,
    });
    if (!inserted) {
      logger?.warn?.(`[security] failed to grant admin_full_access to first user ${chosen.email ?? chosen.id}`);
      return {
        seeded: seededCount,
        adminPromoted: false,
        reason: 'insert_failed',
        ...resyncCounts,
        ...grantScanCounts,
      };
    }
    logger?.info?.(
      `[security] first user promoted to platform admin: ${chosen.email ?? chosen.id} `
        + `— basis: ${audit.basis}; candidate pool: ${audit.pool}`,
      { basis: audit.basis, candidatePoolSize: audit.candidatePoolSize, userId: String(chosen.id) },
    );

    // Hand seeded business records (owner_id NULL / usr_system) to the freshly
    // promoted admin so owner-keyed UX works out of the box. Best-effort and
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
      });
      ownershipClaimed = claims.reduce((sum, c) => sum + c.count, 0);
    } catch (e) {
      logger?.warn?.('[security] seed ownership handoff failed', { error: (e as Error).message });
    }

    return {
      seeded: seededCount,
      adminPromoted: true,
      ownershipClaimed,
      adminUserId: String(chosen.id),
      basis: audit.basis,
      ...resyncCounts,
      ...grantScanCounts,
    };
  };

  // ── The candidate ORDER, stated to the DRIVER (#16682) ────────────────────
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
  // ── Leg 1: the DECLARED owner, when the operator declared one (#16682) ────
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
      seeded: seededCount,
      adminPromoted: false,
      // [#16682, batch #100] The ruling allows either a distinct code or a
      // fold into `declared_owner_not_authenticable` with verification named
      // in the warning. A distinct code is used for the verification miss so
      // #14348's refusal keeps its own name and its own pins, and an operator
      // reading a structured sink can tell "register a login" apart from
      // "click the link in your mailbox".
      reason: unverifiedOnly ? 'declared_owner_not_verified' : 'declared_owner_not_authenticable',
      ...resyncCounts,
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
    return { seeded: seededCount, adminPromoted: false, reason: 'no_users', ...resyncCounts, ...grantScanCounts };
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
    // ⛔ The truncation is never silent again (#16682). Reaching the ceiling is
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
      seeded: seededCount,
      adminPromoted: false,
      reason: 'no_authenticable_user',
      ...resyncCounts,
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
