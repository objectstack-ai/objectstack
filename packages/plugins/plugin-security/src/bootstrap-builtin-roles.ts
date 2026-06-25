// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapBuiltinRoles — seed the framework's reserved built-in identity roles
 * (ADR-0068 D2) into `sys_role`.
 *
 * The four built-in roles (`platform_admin`, `org_owner`, `org_admin`,
 * `org_member`) are a normalized PROJECTION surfaced in `current_user.roles`.
 * Seeding their `sys_role` rows makes the role catalog (consumed by role-bound
 * permission sets, sharing-rule recipients, and the ADR-0068 D4 role-catalog
 * validator) self-describing and AI-groundable. Their SOURCES OF TRUTH —
 * `sys_member.role` for the org_* roles and the unscoped `admin_full_access`
 * grant for platform_admin — are NEVER changed by this seed.
 *
 * Idempotent upsert-by-name, no prune. Rows are stamped `managed_by = 'system'`
 * so tenants can see (but not repurpose) them. Runs on `kernel:ready` alongside
 * the platform-admin and declared-role bootstraps.
 */

import { BUILTIN_ROLE_NAMES, BUILTIN_ROLE_METADATA } from '@objectstack/spec';

const SYSTEM_CTX = { isSystem: true };

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

async function tryFind(ql: any, object: string, where: any, limit = 100): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try { return await ql.insert(object, data, { context: SYSTEM_CTX }); } catch { return null; }
}
async function tryUpdate(ql: any, object: string, data: any): Promise<boolean> {
  try { await ql.update(object, data, { context: SYSTEM_CTX }); return true; } catch { return false; }
}

interface SeedOptions {
  logger?: { info: (m: string, meta?: Record<string, any>) => void; warn: (m: string, meta?: Record<string, any>) => void };
}

export async function bootstrapBuiltinRoles(
  ql: any,
  options: SeedOptions = {},
): Promise<{ seeded: number; updated: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0 };
  }
  let seeded = 0;
  let updated = 0;
  for (const name of BUILTIN_ROLE_NAMES) {
    const meta = BUILTIN_ROLE_METADATA[name];
    const fields = { label: meta.label, description: meta.description, managed_by: 'system' };
    const existing = await tryFind(ql, 'sys_role', { name }, 1);
    if (existing[0]?.id) {
      if (await tryUpdate(ql, 'sys_role', { id: existing[0].id, ...fields })) updated += 1;
    } else {
      const created = await tryInsert(ql, 'sys_role', {
        id: genId('role'), name, ...fields, active: true, is_default: false,
      });
      if (created) seeded += 1;
    }
  }
  options.logger?.info?.('[security] built-in identity roles seeded into sys_role', { seeded, updated, total: BUILTIN_ROLE_NAMES.length });
  return { seeded, updated };
}
