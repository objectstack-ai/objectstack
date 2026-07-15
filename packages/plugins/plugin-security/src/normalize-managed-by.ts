// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * normalizeManagedByVocab — heal legacy `managed_by` values on the RBAC
 * catalogs to the unified tri-state vocabulary (A4 #2920).
 *
 * The three RBAC catalogs (`sys_capability`, `sys_permission_set`,
 * `sys_position`) historically spoke three different provenance dialects:
 *   - capability: platform / package / admin   (already canonical)
 *   - permission set: platform / package / user
 *   - position: system / config / user
 *
 * A4 unifies all three on **platform / package / admin**. New rows are written
 * canonically by the seeders/projector; this reconciler rewrites the residual
 * legacy values on rows those writers do NOT re-touch — env-authored permission
 * sets stamped `'user'`, and older tenant positions stamped `'system'` /
 * `'config'` / `'user'`. Built-in position rows and declared package sets
 * self-heal on their own bootstrap upsert, so this only mops up the rest.
 *
 * Safe by construction: NO runtime path branches on the legacy values (every
 * read keys on `'package'` or `'platform'`, both unchanged by the rename), so
 * this is a pure display-vocabulary migration — it never changes an access
 * decision. Idempotent: canonical rows are skipped, so a re-run is a no-op.
 * Best-effort and non-fatal, like the sibling boot reconcilers.
 *
 * Runs on `kernel:ready` after the seeders, as `isSystem` (the field is
 * `readonly`, so only a system write may set it).
 */

const SYSTEM_CTX = { isSystem: true };

/** legacy value -> canonical value, per object. */
const POSITION_MAP: Record<string, string> = {
  system: 'platform',
  config: 'package',
  user: 'admin',
};
const PERMISSION_SET_MAP: Record<string, string> = {
  user: 'admin',
};

interface NormalizeOptions {
  logger?: {
    info: (message: string, meta?: Record<string, any>) => void;
    warn: (message: string, meta?: Record<string, any>) => void;
  };
}

async function tryFind(ql: any, object: string, where: any): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit: 10_000, fields: ['id', 'managed_by'] }, { context: SYSTEM_CTX });
    if (Array.isArray(rows)) return rows;
    if (Array.isArray(rows?.records)) return rows.records;
    return [];
  } catch {
    return [];
  }
}

async function normalizeObject(
  ql: any,
  object: string,
  map: Record<string, string>,
  logger?: NormalizeOptions['logger'],
): Promise<number> {
  let updated = 0;
  for (const [legacy, canonical] of Object.entries(map)) {
    // Narrow equality scan per legacy value keeps the where-clause
    // driver-portable (no IN / OR predicate).
    const rows = await tryFind(ql, object, { managed_by: legacy });
    for (const row of rows) {
      if (!row?.id) continue;
      try {
        await ql.update(object, { id: row.id, managed_by: canonical }, { context: SYSTEM_CTX });
        updated += 1;
      } catch (e) {
        logger?.warn?.(`[security] managed_by normalize failed for ${object}:${row.id}`, {
          error: (e as Error).message,
        });
      }
    }
  }
  return updated;
}

/**
 * Rewrite legacy `managed_by` values on `sys_permission_set` and `sys_position`
 * to the unified tri-state vocab. Returns a per-object count of rows healed.
 */
export async function normalizeManagedByVocab(
  ql: any,
  options: NormalizeOptions = {},
): Promise<{ permissionSets: number; positions: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.update !== 'function') {
    return { permissionSets: 0, positions: 0 };
  }
  const positions = await normalizeObject(ql, 'sys_position', POSITION_MAP, options.logger);
  const permissionSets = await normalizeObject(ql, 'sys_permission_set', PERMISSION_SET_MAP, options.logger);
  const total = positions + permissionSets;
  if (total > 0) {
    options.logger?.info?.('[security] managed_by vocab normalized to platform/package/admin (A4 #2920)', {
      positions,
      permissionSets,
    });
  }
  return { permissionSets, positions };
}
