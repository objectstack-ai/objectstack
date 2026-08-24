// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — first-boot platform admin promotion.
 *
 * Two responsibilities, both idempotent and run on `kernel:ready`:
 *
 *  1. **Seed `sys_permission_set` rows** for each `defaultPermissionSets`
 *     entry (admin_full_access / member_default / viewer_readonly).
 *
 *  2. **Promote the platform OWNER to platform admin** by inserting a
 *     `sys_user_permission_set` row that points at `admin_full_access` with
 *     `organization_id = NULL` (= cross-tenant). If a platform admin already
 *     exists, this is a no-op forever. WHO the owner is depends on the
 *     tenancy posture (#11184, maintainer ruling 2026-08-23):
 *       - `single`: the first registered human user (unchanged);
 *       - walled (`group`/`isolated`): ONLY the account matching the
 *         env-declared `OS_PLATFORM_OWNER_EMAIL` — never the first
 *         registrant, and never anyone at all while that var is undeclared
 *         (fail-closed; the boot-refusal half lives in plugin-auth `init()`).
 *         [#11343] The match must additionally be VERIFIED (`email_verified`):
 *         an unverified account holding the owner's email string is refused
 *         like any stranger, because with verification off by default the
 *         string alone proves nothing about who registered it. The verifying
 *         write is a sys_user UPDATE, so `shouldReplayBootstrapFor` (below)
 *         gives the replay middleware an update trigger — without it the
 *         genuine owner would verify and never be elevated at all.
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
  PLATFORM_OWNER_EMAIL_ENV,
  resolvePlatformOwnerEmail,
  resolveTenancyPosture,
} from '@objectstack/types';
import { claimSeedOwnership } from './claim-seed-ownership.js';

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

async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try {
    return await ql.insert(object, data, { context: SYSTEM_CTX });
  } catch {
    return null;
  }
}

async function tryUpdate(ql: any, object: string, data: any): Promise<boolean> {
  try {
    await ql.update(object, data, { context: SYSTEM_CTX });
    return true;
  } catch {
    return false;
  }
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

/**
 * [#11343] Verified-email predicate for the walled elevation match — a
 * fail-closed ALLOW-LIST over the representations a driver may hand back for
 * the `sys_user.email_verified` boolean column (JS `true`, SQLite `1`, and
 * their stringified forms). Everything else — `false`/`0`, `null`, an ABSENT
 * field on an imported/legacy row, or any representation not listed — reads
 * as UNVERIFIED. Absent-means-unverified is deliberate: treating a missing
 * column as verified would re-open the exact hole this predicate closes for
 * every row that predates the column.
 */
function isEmailVerified(u: any): boolean {
  const v = u?.email_verified;
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * [#11343] Which `sys_user` writes can change the answer of the elevation
 * query in {@link bootstrapPlatformAdmin} — the trigger predicate for the
 * bootstrap-replay middleware in `security-plugin.ts`. Exported so the
 * middleware and its pins consume the SAME predicate instead of re-deriving
 * it (the `resolveEngineUpdateDispatch` pattern).
 *
 *  - `create` / `insert`: a new account may be the declared owner (walled) or
 *    the first human user (`single`) — the original re-run trigger, unchanged.
 *  - `update` whose payload touches `email_verified` or `email`: email
 *    verification is an UPDATE (better-auth flips `emailVerified` when the
 *    link is clicked, and change-email writes `{ email, emailVerified: true }`
 *    — both reach the engine snake_cased via the adapter mapping). A re-run
 *    bound to insert alone would refuse the unverified owner at sign-up and
 *    then never look again, so the genuine owner would NEVER be elevated —
 *    trading the wrong-person-elevated defect for a nobody-can-administer
 *    one. These two columns are exactly the `sys_user` columns the walled
 *    owner-match reads.
 *  - any other operation, or an update touching neither column: cannot change
 *    the elevation answer — no re-run. The bootstrap is idempotent but not
 *    free; it must not run on every profile edit.
 */
export function shouldReplayBootstrapFor(opCtx: {
  object?: string;
  operation?: string;
  data?: unknown;
}): boolean {
  if (opCtx?.object !== 'sys_user') return false;
  const op = opCtx?.operation;
  if (op === 'create' || op === 'insert') return true;
  if (op === 'update') {
    const data = opCtx?.data;
    if (!data || typeof data !== 'object') return false;
    return ['email_verified', 'email'].some((column) =>
      Object.prototype.hasOwnProperty.call(data, column),
    );
  }
  return false;
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
 * Persist seed permission sets and promote the first registered user to
 * platform admin. Safe to call multiple times.
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
          if (await tryUpdate(ql, 'sys_permission_set', { id: row.id, ...platformOwnedFields(ps) })) {
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
    });
    if (created?.id) seeded[ps.name] = created.id;
    else if (created) seeded[ps.name] = id;
  }

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

  // 2. First-user platform admin promotion.
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
  // A platform admin "already exists" only if a *human* holds the
  // cross-tenant grant. The seed-data owner `usr_system` (provisioned by
  // the SeedLoader, see runtime/app-plugin.ts `ensureSeedIdentity`) must
  // never count — otherwise a DB where it was wrongly promoted would block
  // every real admin forever. Ignoring it here makes the bootstrap
  // self-healing on restart.
  if (existingAdminLinks.some((r) => !r.organization_id && r.user_id !== SystemUserId.SYSTEM)) {
    return { seeded: seededCount, adminPromoted: false, reason: 'already_have_admin', ...resyncCounts };
  }

  // [#11184 / cloud#1509] Elevation is POSTURE-KEYED (maintainer ruling
  // 2026-08-23, verbatim: 「1509 选择 env 指定 owner 邮箱」):
  //
  //   - `single`: first human user is promoted — ruled reasonable, unchanged.
  //   - walled (`group` / `isolated`): the first-registrant path is REMOVED.
  //     Platform admin is granted ONLY to the account matching the
  //     env-declared owner email (`OS_PLATFORM_OWNER_EMAIL`). On a walled
  //     deployment with self-registration reachable, whoever curls sign-up
  //     first would otherwise receive the cross-tenant `admin_full_access`
  //     grant AND (via `ensureDefaultOrganization`, which binds "the platform
  //     admin") the operator's Default Organization — measured on a real
  //     walled SaaS in cloud#1509.
  //
  // The REQUESTED posture (`resolveTenancyPosture()`, what the operator asked
  // for) is deliberately the input here rather than the enforced one: a
  // deployment that requested a wall must not fall back to first-registrant
  // elevation even while running degraded (OS_ALLOW_DEGRADED_TENANCY=1) —
  // fail toward the stricter reading, same direction ADR-0093 D5 fails.
  //
  // The startup half of the fail-closed clause (walled + undeclared owner ⇒
  // REFUSE BOOT, naming the variable) lives in plugin-auth's `init()`, which
  // every standard walled composition runs and where a throw aborts the boot.
  // This branch is the defense-in-depth backstop for paths that reach the
  // bootstrap without that guard (`os meta resync`, embeddings without
  // plugin-auth): it refuses the ELEVATION, loudly, and never silently
  // reverts to promoting the first registrant.
  const walled = postureEnforcesWall(resolveTenancyPosture());
  const declaredOwnerEmail = walled ? resolvePlatformOwnerEmail() : undefined;
  if (walled && !declaredOwnerEmail) {
    const message =
      `[security] tenancy posture is walled but ${PLATFORM_OWNER_EMAIL_ENV} is not set — ` +
      'REFUSING platform-admin elevation. Under walled postures the first registrant is ' +
      'never promoted; platform admin is granted only to the account matching the declared ' +
      `owner email. Set ${PLATFORM_OWNER_EMAIL_ENV} to the operator's email address.`;
    if (logger?.error) logger.error(message);
    else logger?.warn?.(message);
    return {
      seeded: seededCount,
      adminPromoted: false,
      reason: 'walled_owner_email_undeclared',
      ...resyncCounts,
    };
  }

  // Exclude the non-loginable system service account. It is created during
  // seed loading — *before* the first human sign-up — so without this filter
  // it is the earliest user and steals the platform-admin promotion, leaving
  // the real admin login without `setup.access` / `studio.access` (Setup and
  // Studio then stay invisible even though login succeeds).
  const isHumanUser = (u: any) => u && u.id !== SystemUserId.SYSTEM && u.role !== 'system';
  const oldestOf = (users: any[]) =>
    [...users].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    })[0];

  let target: any;
  if (walled) {
    // Query BY EMAIL rather than scanning the first N users: on a walled
    // deployment any number of self-registrants may exist before the owner
    // registers, and the owner must be found regardless of arrival order.
    // Email comparison is case-insensitive; better-auth stores sign-up emails
    // lowercased, but imported/legacy rows may not be, so both the lowercased
    // and the verbatim spellings are queried and matches are de-duplicated.
    const wanted = declaredOwnerEmail!.toLowerCase();
    const spellings = [...new Set([wanted, declaredOwnerEmail!])];
    const byId = new Map<string, any>();
    for (const spelling of spellings) {
      for (const u of await tryFind(ql, 'sys_user', { email: spelling }, 5)) {
        if (u?.id) byId.set(u.id, u);
      }
    }
    const owners = [...byId.values()].filter(
      (u) => isHumanUser(u) && String(u.email ?? '').trim().toLowerCase() === wanted,
    );
    if (owners.length === 0) {
      logger?.info?.(
        `[security] walled posture — platform admin will be granted to the declared owner ` +
          `(${PLATFORM_OWNER_EMAIL_ENV}) when that account registers; self-registrants are never promoted`,
      );
      return {
        seeded: seededCount,
        adminPromoted: false,
        reason: 'walled_owner_not_registered',
        ...resyncCounts,
      };
    }
    // [#11343] The email STRING alone is not identity: with self-registration
    // reachable and email verification off by default, anyone who knows the
    // declared owner's address and registers before the owner would match here
    // and be elevated. Elevation therefore requires the match to be VERIFIED —
    // an account row whose `email_verified` better-auth has confirmed (the
    // verification link, or a trusted SSO provider at insert). An owner-email
    // account that is not verified is refused exactly like a stranger, loudly,
    // and never falls back — same fail-closed direction as the undeclared-owner
    // refusal above. The refusal is transient for the genuine owner: the
    // verifying write is a sys_user UPDATE, and the bootstrap-replay middleware
    // (security-plugin.ts, via `shouldReplayBootstrapFor`) re-runs this
    // function on exactly that update.
    const verifiedOwners = owners.filter(isEmailVerified);
    if (verifiedOwners.length === 0) {
      logger?.warn?.(
        `[security] walled posture — an account matching the declared owner email ` +
          `(${PLATFORM_OWNER_EMAIL_ENV}) exists but its email is NOT VERIFIED; ` +
          `REFUSING platform-admin elevation until the owner account verifies its address. ` +
          `Unverified accounts are never promoted, whoever registered them. If this ` +
          `deployment has no verification path, wire an email transport (or sign the ` +
          `owner in through a trusted SSO provider) — elevation will not fall back.`,
      );
      return {
        seeded: seededCount,
        adminPromoted: false,
        reason: 'walled_owner_not_verified',
        ...resyncCounts,
      };
    }
    target = oldestOf(verifiedOwners);
  } else {
    const allUsers = await tryFind(ql, 'sys_user', {}, 50);
    const humanUsers = allUsers.filter(isHumanUser);
    if (humanUsers.length === 0) {
      logger?.info?.('[security] no human users yet — first sign-up will be promoted to platform admin');
      return { seeded: seededCount, adminPromoted: false, reason: 'no_users', ...resyncCounts };
    }
    target = oldestOf(humanUsers);
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
  logger?.info?.(
    walled
      ? `[security] declared platform owner (${PLATFORM_OWNER_EMAIL_ENV}) promoted to platform admin: ${target.email ?? target.id}`
      : `[security] first user promoted to platform admin: ${target.email ?? target.id}`,
  );

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
