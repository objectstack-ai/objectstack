// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — first-boot platform admin promotion.
 *
 * Two responsibilities, both idempotent and run on `kernel:ready`:
 *
 *  1. **Seed `sys_permission_set` rows** for each `defaultPermissionSets`
 *     entry (admin_full_access / member_default / viewer_readonly). The
 *     dashboard's CRUD on `sys_permission_set` needs persisted rows to
 *     exist so admins can grant them to users by id; the in-memory
 *     bootstrap list alone is invisible to the standard CRUD UI.
 *
 *  2. **Promote the first registered user to platform admin** by
 *     inserting a `sys_user_permission_set` row that points at
 *     `admin_full_access` with `organization_id = NULL` (= cross-tenant).
 *     If a platform admin already exists, this is a no-op forever.
 *
 *     Zero configuration: `pnpm dev:crm` → sign up → "I'm admin".
 *
 * The DB column shape (`object_permissions` JSON text) does not match
 * the spec shape (`objects` record). For now we only need stable rows
 * with the right `name` so `resolveExecutionContext` can translate the
 * link-table id back to the bootstrap permission set name; the actual
 * `objects`/`rowLevelSecurity` definitions are still served from the
 * in-memory `bootstrapPermissionSets` list inside SecurityPlugin.
 */

import type { PermissionSet } from '@objectstack/spec/security';

interface BootstrapOptions {
  /** Logger from PluginContext. */
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
  /**
   * Multi-tenant deployments need at least one `sys_organization` row
   * for the first admin's session to carry an `activeOrganizationId`
   * — otherwise the default `tenant_isolation` RLS policy filters
   * everything to zero rows. When `true` and the freshly-promoted
   * admin has no membership, this helper creates a "Default
   * Organization" (slug `default`) and binds them as `owner`.
   *
   * This is the ONLY framework-side auto-provisioning of an org.
   * Subsequent users must either accept an invitation or explicitly
   * create an org via the account UI — no "personal workspace" is
   * created behind their back.
   *
   * @default false
   */
  multiTenant?: boolean;
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

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
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
  defaultOrgCreated?: boolean;
  defaultOrgId?: string;
  reason?: string;
}> {
  const logger = options.logger;
  const multiTenant = options.multiTenant === true;
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, adminPromoted: false, reason: 'objectql_unavailable' };
  }

  // 1. Seed permission set rows (one row per name, idempotent).
  const seeded: Record<string, string> = {}; // name -> id
  for (const ps of bootstrapPermissionSets) {
    if (!ps.name) continue;
    const existing = await tryFind(ql, 'sys_permission_set', { name: ps.name }, 1);
    if (existing.length > 0 && existing[0].id) {
      seeded[ps.name] = existing[0].id;
      continue;
    }
    const id = genId('ps');
    const created = await tryInsert(ql, 'sys_permission_set', {
      id,
      name: ps.name,
      label: ps.label ?? ps.name,
      description: ps.description ?? null,
      object_permissions: JSON.stringify(ps.objects ?? {}),
      field_permissions: JSON.stringify(ps.fields ?? {}),
      active: true,
    });
    if (created?.id) seeded[ps.name] = created.id;
    else if (created) seeded[ps.name] = id;
  }

  const seededCount = Object.keys(seeded).length;

  // 2. First-user platform admin promotion.
  const adminPsId = seeded['admin_full_access'];
  if (!adminPsId) {
    return { seeded: seededCount, adminPromoted: false, reason: 'admin_permission_set_missing' };
  }

  // If a platform admin already exists, we're done.
  const existingAdminLinks = await tryFind(
    ql,
    'sys_user_permission_set',
    { permission_set_id: adminPsId },
    5,
  );
  if (existingAdminLinks.some((r) => !r.organization_id)) {
    return { seeded: seededCount, adminPromoted: false, reason: 'already_have_admin' };
  }

  // Promote the oldest user (= first registrant). If no users yet, the
  // sys_user post-create middleware will rerun this on first sign-up.
  const allUsers = await tryFind(ql, 'sys_user', {}, 50);
  if (allUsers.length === 0) {
    logger?.info?.('[security] no users yet — first sign-up will be promoted to platform admin');
    return { seeded: seededCount, adminPromoted: false, reason: 'no_users' };
  }
  const sorted = [...allUsers].sort((a, b) => {
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
    return { seeded: seededCount, adminPromoted: false, reason: 'insert_failed' };
  }
  logger?.info?.(`[security] first user promoted to platform admin: ${target.email ?? target.id}`);

  // Multi-tenant bootstrap: ensure the freshly-promoted admin has at
  // least one organization so their session has an active org and the
  // tenant_isolation RLS policy resolves. We only do this when the
  // admin currently has zero memberships — if they already created an
  // org of their own (or were invited into one before sign-up), we
  // respect that and do not create a "Default Organization" too.
  let defaultOrgCreated = false;
  let defaultOrgId: string | undefined;
  if (multiTenant) {
    const memberships = await tryFind(ql, 'sys_member', { user_id: target.id }, 1);
    if (memberships.length === 0) {
      // Re-use a pre-existing slug=`default` org if any; otherwise
      // create one. Stable slug keeps human-readable URLs predictable
      // across cold-boots.
      const existingDefault = await tryFind(ql, 'sys_organization', { slug: 'default' }, 1);
      if (existingDefault.length > 0 && existingDefault[0].id) {
        defaultOrgId = String(existingDefault[0].id);
      } else {
        const newOrgId = genId('org');
        const orgRow = await tryInsert(ql, 'sys_organization', {
          id: newOrgId,
          name: 'Default Organization',
          slug: 'default',
          logo: null,
          metadata: null,
        });
        if (orgRow) {
          defaultOrgId = orgRow?.id ?? newOrgId;
          defaultOrgCreated = true;
        } else {
          logger?.warn?.('[security] failed to create default organization for platform admin');
        }
      }
      if (defaultOrgId) {
        const memRow = await tryInsert(ql, 'sys_member', {
          id: genId('mem'),
          organization_id: defaultOrgId,
          user_id: target.id,
          role: 'owner',
        });
        if (memRow) {
          logger?.info?.(
            `[security] bound platform admin to default organization (${defaultOrgId}): ${target.email ?? target.id}`,
          );
        } else {
          logger?.warn?.('[security] failed to bind platform admin to default organization');
        }
      }
    }
  }

  return { seeded: seededCount, adminPromoted: true, defaultOrgCreated, defaultOrgId };
}
