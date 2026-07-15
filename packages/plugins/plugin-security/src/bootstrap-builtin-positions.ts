// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapBuiltinRoles — seed the framework's reserved built-in identity roles
 * (ADR-0068 D2) into `sys_position`.
 *
 * The four built-in roles (`platform_admin`, `org_owner`, `org_admin`,
 * `org_member`) are a normalized PROJECTION surfaced in `current_user.positions`.
 * Seeding their `sys_position` rows makes the role catalog (consumed by role-bound
 * permission sets, sharing-rule recipients, and the ADR-0068 D4 role-catalog
 * validator) self-describing and AI-groundable. Their SOURCES OF TRUTH —
 * `sys_member.role` for the org_* roles and the unscoped `admin_full_access`
 * grant for platform_admin — are NEVER changed by this seed.
 *
 * Idempotent upsert-by-name, no prune. Rows are stamped `managed_by = 'platform'`
 * (A4 #2920 unified vocab; formerly 'system') so tenants can see (but not
 * repurpose) them. Runs on `kernel:ready` alongside the platform-admin and
 * declared-role bootstraps.
 */

import { BUILTIN_IDENTITY_NAMES, BUILTIN_IDENTITY_METADATA, EVERYONE_POSITION, GUEST_POSITION } from '@objectstack/spec';

/**
 * [ADR-0090 D5/D9] Audience anchors seeded alongside the identity names.
 * `everyone` — implicit for every authenticated member; its bindings are the
 * tenant's default grants. `guest` — implicit for unauthenticated principals.
 * Both are system-managed and undeletable like the identity rows.
 */
const AUDIENCE_ANCHOR_METADATA: Record<string, { label: string; description: string }> = {
  [EVERYONE_POSITION]: {
    label: 'Everyone',
    description:
      'Built-in audience anchor: every authenticated member holds this position implicitly. Permission sets bound to it are the default grants for the tenant (ADR-0090 D5). High-privilege sets cannot be bound here.',
  },
  [GUEST_POSITION]: {
    label: 'Guest',
    description:
      'Built-in audience anchor: unauthenticated principals hold this position implicitly and exclusively. Bindings face the strictest checks — named objects only, read-mostly, never a wildcard (ADR-0090 D9).',
  },
};

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
  const rows: Array<[string, { label: string; description: string }]> = [
    ...BUILTIN_IDENTITY_NAMES.map((n) => [n, BUILTIN_IDENTITY_METADATA[n]] as [string, { label: string; description: string }]),
    ...Object.entries(AUDIENCE_ANCHOR_METADATA),
  ];
  for (const [name, meta] of rows) {
    // [A4 #2920] Unified provenance vocab: built-in identity/anchor positions are
    // PLATFORM-shipped (formerly stamped 'system'). Re-upserted every boot, so
    // legacy 'system' rows self-heal to 'platform' on the next kernel:ready.
    const fields = { label: meta.label, description: meta.description, managed_by: 'platform' };
    const existing = await tryFind(ql, 'sys_position', { name }, 1);
    if (existing[0]?.id) {
      if (await tryUpdate(ql, 'sys_position', { id: existing[0].id, ...fields })) updated += 1;
    } else {
      const created = await tryInsert(ql, 'sys_position', {
        id: genId('position'), name, ...fields, active: true, is_default: false,
      });
      if (created) seeded += 1;
    }
  }
  options.logger?.info?.('[security] built-in identity names + audience anchors seeded into sys_position', { seeded, updated, total: rows.length });
  return { seeded, updated };
}
