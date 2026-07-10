// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — first-boot platform admin promotion.
 *
 * Two responsibilities, both idempotent and run on `kernel:ready`:
 *
 *  1. **Seed `sys_permission_set` rows** for each `defaultPermissionSets`
 *     entry (admin_full_access / member_default / viewer_readonly).
 *
 *  2. **Promote the first registered user to platform admin** by
 *     inserting a `sys_user_permission_set` row that points at
 *     `admin_full_access` with `organization_id = NULL` (= cross-tenant).
 *     If a platform admin already exists, this is a no-op forever.
 *
 * The "create a Default Organization for the freshly-promoted admin"
 * behavior moved to `@objectstack/organizations` (see
 * `ensureDefaultOrganization`). Install that plugin to get
 * multi-tenant bootstrap.
 */

import type { PermissionSet } from '@objectstack/spec/security';
import { SystemUserId } from '@objectstack/spec/system';
import { claimSeedOwnership } from './claim-seed-ownership.js';

interface BootstrapOptions {
  /** Logger from PluginContext. */
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
  /**
   * [#2705] Force re-materialization of the default permission-set rows from
   * the compiled declaration.
   *
   * Default (`false`) keeps the insert-once shape: an existing row is left
   * untouched so an admin's Setup customizations survive every restart, and so
   * the platform defaults stay env-authored (never clobbered — the exact
   * posture `bootstrapDeclaredPermissions` relies on). This is correct for
   * prod boot.
   *
   * `os meta resync` sets it to `true` to reconcile the DB rows to the shipped
   * `dist` after a source edit — the dev loop that insert-once otherwise makes
   * silently stale (a changed default set is served with its OLD value until a
   * `--fresh` wipe). Only platform-owned rows (`managed_by` absent or
   * `'platform'`) are overwritten; a row an admin explicitly took over
   * (`managed_by:'user'`) or a package owns (`'package'`) is left alone so the
   * resync never destroys an intentional override.
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
 * The platform-owned definition facets of a default permission set — the
 * fields the runtime resolver hydrates back into ExecutionContext
 * (`resolve-authz-context.ts` → systemPermissions / tabPermissions / object &
 * field masks). Single source for both the first-boot insert and the `#2705`
 * resync update so the two paths can never drift. Identity/provenance columns
 * (`id`, `name`, `active`, `managed_by`, `package_id`) are deliberately NOT
 * here — resync reconciles the declaration, never the ownership.
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
      // Insert-once by default: an existing row is env-authored config and is
      // never clobbered on restart (protects admin Setup edits, and keeps the
      // platform defaults env-authored — the posture bootstrapDeclaredPermissions
      // relies on). Under `resync` (`os meta resync`, #2705) reconcile the row to
      // the shipped dist so a dev source edit takes effect without `--fresh` —
      // but only for rows the platform still owns. A row an admin explicitly took
      // over (`managed_by:'user'`) or a package owns (`'package'`) is an
      // intentional override and is left alone.
      if (options.resync) {
        if (!row.managed_by || row.managed_by === 'platform') {
          if (await tryUpdate(ql, 'sys_permission_set', { id: row.id, ...platformOwnedFields(ps) })) {
            resynced += 1;
          }
        } else {
          resyncSkipped += 1;
          logger?.warn?.(
            `[security] resync left ${ps.name} untouched — row is ${row.managed_by}-owned (intentional override)`,
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
    });
    if (created?.id) seeded[ps.name] = created.id;
    else if (created) seeded[ps.name] = id;
  }

  const seededCount = Object.keys(seeded).length;
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

  const allUsers = await tryFind(ql, 'sys_user', {}, 50);
  // Exclude the non-loginable system service account. It is created during
  // seed loading — *before* the first human sign-up — so without this filter
  // it is the earliest user and steals the platform-admin promotion, leaving
  // the real admin login without `setup.access` / `studio.access` (Setup and
  // Studio then stay invisible even though login succeeds).
  const humanUsers = allUsers.filter(
    (u) => u.id !== SystemUserId.SYSTEM && u.role !== 'system',
  );
  if (humanUsers.length === 0) {
    logger?.info?.('[security] no human users yet — first sign-up will be promoted to platform admin');
    return { seeded: seededCount, adminPromoted: false, reason: 'no_users', ...resyncCounts };
  }
  const sorted = [...humanUsers].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
  const target = sorted[0];

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
