// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredPermissions — seed stack-declared `permissions` into
 * `sys_permission_set` (ADR-0086 D5; the exact sibling of
 * `bootstrapDeclaredPositions`).
 *
 * `stack.permissions` has always been declarable and runtime-ENFORCED (the
 * evaluator resolves declared sets through the metadata registry), but it was
 * never materialized as `sys_permission_set` records — the ADR-0078
 * inert-metadata smell: the admin surface (which reads the table) can't see a
 * package's sets, uninstall is undefined, and no provenance axis exists. This
 * seeder closes that gap:
 *
 *  - each declared set is upserted by `name` with `managed_by: 'package'` and
 *    `package_id` = the registering package (`_packageId` stamped by the
 *    SchemaRegistry / ADR-0010 `applyProtection`, with the spec-level
 *    `packageId` (ADR-0086 D3) as the author-declared fallback);
 *  - IDEMPOTENT + UPGRADE-AWARE: a row this seeder owns
 *    (`managed_by:'package'`, same `package_id`) is re-seeded on every boot so
 *    the record always reflects the shipped declaration (version bumps
 *    included). Rows owned by a DIFFERENT package are skipped loudly;
 *  - env-authored rows are NEVER clobbered: `managed_by` of
 *    `platform`/`user` — or absent (legacy/pre-provenance rows, including the
 *    platform defaults inserted by `bootstrapPlatformAdmin`) — is left alone.
 *
 * Runs on `kernel:ready` after `bootstrapPlatformAdmin` (so the platform
 * defaults keep their existing insert-once shape) and alongside
 * `bootstrapDeclaredPositions`.
 *
 * The ENVIRONMENT door (env-scope metadata saves, the Setup data-door
 * write-through, boot reconciliation) lives in `permission-set-projection.ts`
 * (ADR-0094) — this module is the PACKAGE door only. Both project through the
 * shared {@link permissionSetRowFields} row shape so they can never hydrate
 * differently.
 */

import {
  genId,
  permissionSetRowFields,
  tryFind,
  tryInsert,
  tryUpdate,
  type PermissionSeedOutcome,
  type ProjectionLogger,
} from './permission-set-projection.js';

export type { PermissionSeedOutcome } from './permission-set-projection.js';

interface SeedOptions {
  logger?: ProjectionLogger;
}

/**
 * Read declared metadata items of a type. The engine's SchemaRegistry
 * (populated by `manifest.register` from the stack's `permissions` array,
 * items provenance-stamped with `_packageId`) is the reliable source in every
 * boot path; the metadata-service facade only surfaces these once the
 * compiled-artifact loader runs (serve.ts).
 */
export function readDeclared(engine: any, type: string): any[] {
  try {
    const reg = engine?._registry;
    if (reg?.listItems) {
      return (reg.listItems(type) ?? []).map((i: any) => i?.content ?? i).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

/**
 * Upsert ONE declared/published PermissionSet body into `sys_permission_set`
 * under the owning `packageId`, applying the ADR-0086 provenance rules
 * (own-row re-seed, foreign-package refuse, env-authored never clobbered).
 * Shared by the boot seeder (every declared set) and the publish-time
 * materializer (ADR-0086 P2 — a package-door set promoted from a draft). Returns
 * a one-hot outcome so callers can aggregate.
 */
export async function upsertPackagePermissionSet(
  ql: any,
  ps: any,
  packageId: string | null | undefined,
  logger?: SeedOptions['logger'],
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, skippedEnvAuthored: 0, skippedForeign: 0 };
  if (!ps?.name) return out;
  // A `managed_by:'package'` row without a `package_id` would make uninstall
  // undefined again — the exact ambiguity ADR-0086 D3 exists to remove — so a
  // set with no resolvable owner is skipped rather than materialized unowned.
  if (!packageId) {
    logger?.warn?.('[security] permission set has no owning package — not materialized', { name: ps.name });
    return out;
  }

  const existing = (await tryFind(ql, 'sys_permission_set', { name: ps.name }, 1))[0];
  if (!existing?.id) {
    const created = await tryInsert(ql, 'sys_permission_set', {
      id: genId('ps'),
      name: ps.name,
      ...permissionSetRowFields(ps),
      active: true,
      package_id: packageId,
      managed_by: 'package',
    });
    if (created) out.seeded += 1;
    return out;
  }

  if (existing.managed_by === 'package') {
    if (existing.package_id === packageId) {
      // Our own row — re-seed so the record always reflects the shipped/published
      // declaration (idempotent; covers version bumps without bookkeeping).
      if (await tryUpdate(ql, 'sys_permission_set', { id: existing.id, ...permissionSetRowFields(ps) })) {
        out.updated += 1;
      }
    } else {
      // Package-namespaced object api names make set-name collisions a
      // packaging bug, not a merge case — refuse loudly (ADR-0086 D4:
      // a package never writes into a foreign record).
      out.skippedForeign += 1;
      logger?.warn?.('[security] permission set name owned by another package — skipped', {
        name: ps.name, declaredBy: packageId, ownedBy: existing.package_id,
      });
    }
    return out;
  }

  // `platform`/`user` — or absent (legacy rows, incl. bootstrapPlatformAdmin
  // defaults): env-authored config. Never clobbered by package materialization.
  out.skippedEnvAuthored += 1;
  return out;
}

export async function bootstrapDeclaredPermissions(
  ql: any,
  metadataService: any,
  options: SeedOptions = {},
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, skippedEnvAuthored: 0, skippedForeign: 0 };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  let sets: any[] = readDeclared(ql, 'permission');
  if (sets.length === 0) {
    try {
      const listed = metadataService?.list?.('permission');
      sets = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { sets = []; }
  }
  if (!Array.isArray(sets) || sets.length === 0) return out;

  for (const ps of sets) {
    if (!ps?.name) continue;
    // Registry provenance first (ADR-0010 `_packageId`), author-declared
    // spec `packageId` (ADR-0086 D3) as fallback.
    const packageId: string | undefined = ps._packageId ?? ps.packageId ?? undefined;
    const r = await upsertPackagePermissionSet(ql, ps, packageId, options.logger);
    out.seeded += r.seeded;
    out.updated += r.updated;
    out.skippedEnvAuthored += r.skippedEnvAuthored;
    out.skippedForeign += r.skippedForeign;
  }

  options.logger?.info?.('[security] declared permission sets seeded into sys_permission_set (ADR-0086 D5)', {
    ...out, total: sets.length,
  });
  return out;
}
