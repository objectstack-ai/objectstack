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
import { PLATFORM_OWNER_EMAIL_ENV, resolveTenancyPosture } from '@objectstack/types';
import {
  reportLegacyPlatformAdminGrant,
  resolvePlatformAdminEmails,
} from '@objectstack/core';
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
}

const SYSTEM_CTX = { isSystem: true };

async function tryFind(ql: any, object: string, where: any, limit = 100): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
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
 *  - `single` + any update: could never change the promotion answer —
 *    `single` promotes the oldest authenticable human and never reads
 *    `email`/`email_verified`. The pre-#11974 update arm fired here for the
 *    walled match's sake only; with that gone it would be a pure re-run tax
 *    on every verification write.
 */
export function shouldReplayBootstrapFor(opCtx: {
  object?: string;
  operation?: string;
  data?: unknown;
}): boolean {
  if (opCtx?.object !== 'sys_user' && opCtx?.object !== 'sys_account') return false;
  const op = opCtx?.operation;
  if (op !== 'create' && op !== 'insert') return false;
  return !postureEnforcesWall(resolveTenancyPosture());
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
  /** [#2705] Existing platform-owned rows reconciled to dist under `resync`. */
  resynced?: number;
  /** [#2705] Existing rows left untouched by `resync` (admin/package-owned). */
  resyncSkipped?: number;
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

  const existingAdminLinks = await tryFind(
    ql,
    'sys_user_permission_set',
    { permission_set_id: adminPsId },
    50,
  );
  // Human holders of the cross-tenant grant. The seed-data owner `usr_system`
  // (provisioned by the SeedLoader, see runtime/app-plugin.ts
  // `ensureSeedIdentity`) never counts — otherwise a DB where it was wrongly
  // promoted would block every real admin forever. Ignoring it here makes the
  // bootstrap self-healing on restart.
  const humanUnscopedHolders = existingAdminLinks.filter(
    (r) => !r.organization_id && r.user_id !== SystemUserId.SYSTEM,
  );
  // `single`: a platform admin "already exists" — the promotion is a no-op
  // forever. Under walled postures that same row is the LEGACY anchor and gets
  // the deprecation pointer below instead of a silent early exit.
  if (!walled && humanUnscopedHolders.length > 0) {
    return { seeded: seededCount, adminPromoted: false, reason: 'already_have_admin', ...resyncCounts };
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
    if (humanUnscopedHolders.length > 0) {
      const holder = humanUnscopedHolders[0];
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
      if (humanUnscopedHolders.length === 0) {
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
  const oldestAuthenticable = async (ql2: any, users: any[]): Promise<any | undefined> => {
    const byAge = [...users].sort(byCreatedAtAsc);
    for (const user of byAge) {
      if (user?.id === undefined || user?.id === null) continue;
      const accounts = await tryFind(ql2, 'sys_account', { user_id: user.id }, 1);
      if (accounts.length > 0) return user;
    }
    return undefined;
  };

  // [#11974 / #11663 L4] `single` is the ONLY posture that still selects a
  // target and writes the grant row (Choice 4A). The walled selection — query
  // by declared email, verified-only, oldest wins — moved with the decision
  // itself into the derivation site (`resolve-authz-context.ts` §6b-config)
  // and, for the audit answer, `platform-admin-service.ts`.
  const allUsers = await tryFind(ql, 'sys_user', {}, 50);
  const humanUsers = allUsers.filter(isHumanUser);
  if (humanUsers.length === 0) {
    logger?.info?.('[security] no human users yet — first sign-up will be promoted to platform admin');
    return { seeded: seededCount, adminPromoted: false, reason: 'no_users', ...resyncCounts };
  }
  const target = await oldestAuthenticable(ql, humanUsers);
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
      `[security] ${humanUsers.length} human user row(s) exist but none can authenticate (no sys_account) ` +
        '— platform admin NOT promoted. The first human that signs in will be promoted instead; a ' +
        'directory row nobody can sign in as would hold a grant it could never exercise.',
    );
    return {
      seeded: seededCount,
      adminPromoted: false,
      reason: 'no_authenticable_user',
      ...resyncCounts,
    };
  }

  const inserted = await tryInsert(ql, 'sys_user_permission_set', {
    id: genId('ups'),
    user_id: target.id,
    permission_set_id: adminPsId,
    organization_id: null,
    granted_by: null,
  });
  if (!inserted) {
    logger?.warn?.(`[security] failed to grant admin_full_access to first user ${target.email ?? target.id}`);
    return { seeded: seededCount, adminPromoted: false, reason: 'insert_failed', ...resyncCounts };
  }
  logger?.info?.(`[security] first user promoted to platform admin: ${target.email ?? target.id}`);

  // Hand seeded business records (owner_id NULL / usr_system) to the freshly
  // promoted admin so owner-keyed UX works out of the box. Best-effort and
  // idempotent — failures here must not undo the promotion above.
  let ownershipClaimed = 0;
  try {
    const claims = await claimSeedOwnership(ql, target.id, { logger });
    ownershipClaimed = claims.reduce((s, c) => s + c.count, 0);
  } catch (e) {
    logger?.warn?.('[security] seed ownership handoff failed', { error: (e as Error).message });
  }

  return { seeded: seededCount, adminPromoted: true, ownershipClaimed, ...resyncCounts };
}
