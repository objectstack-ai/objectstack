// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rows `os migrate security-catalog-overlays` lists and deletes, and how it
 * deletes them (maintainer ruling letter B on #22371, record 6074838935,
 * amending item 1 of ruling A′, record 6073500921).
 *
 * ## The population
 *
 * Every active, environment-wide `sys_metadata` row (`organization_id IS NULL`,
 * `state = 'active'`) of type `permission` or `position` — the legacy plurals
 * `permissions` / `positions` included, which the boot's load folds to the same
 * types — whose name a configured package holds. That is exactly what the cold
 * boot's catalog check refuses (ADR-0048 N.3): the check meets the package-held
 * names with what `sys_metadata` hydration put in the registry's bare slot, and
 * hydration loads precisely these rows. This module meets the SAME package-held
 * reading, exported by the engine for this purpose
 * (`findPackageHeldSecurityCatalogNames`), with the rows read directly, on a boot
 * that hydrated nothing — so it lists what the cold boot would refuse, and it
 * holds no second reading of "who holds a name".
 *
 * ⛔ A draft row and an organization-scoped row are not loaded at boot and do
 * not refuse it, so they are never listed. ⛔ Nothing is adopted: `managed_by`
 * and `package_id` are never rewritten (the Discard Overlay scope ruled
 * 2026-08-20); a listed row is deleted, or left alone.
 *
 * ## The deletion: the engine's audited write path
 *
 * A row stored under the canonical type goes through the metadata protocol's
 * own delete, `deleteMetaItem` — the door `DELETE /api/v1/meta/:type/:name`
 * takes: one transaction that removes the row and appends a
 * `sys_metadata_history` tombstone, a `sys_metadata_audit` row, the mutation
 * projector and the watch event. That door addresses a row by `(type, name)`
 * and removes one row per call; where two rows share the name (one bound to no
 * package, one bound to the package), each call removes one, and which row went
 * is read back by id rather than assumed.
 *
 * A row stored under a legacy plural is out of that door's reach: it folds the
 * type it is given to the canonical one before reading, and the audit trail
 * refuses a non-canonical type by design. Such a row goes through the layer
 * beneath it, the `SysMetadataRepository` delete, addressed by its stored
 * spelling, its name, its `package_id` and its checksum: the same transaction
 * and the same history tombstone (under the spelling the row carried), without
 * the audit row. Each outcome names the door it took.
 */

import type { SecurityCatalogType } from '@objectstack/core';

/** The command's own name, the `actor` its deletions record. */
export const SECURITY_CATALOG_OVERLAYS_ACTOR = 'os migrate security-catalog-overlays';

/** The stored spellings of each catalog type the boot's load folds together. */
const STORED_TYPE_SPELLINGS: ReadonlyArray<readonly [string, 'permission' | 'position']> = [
  ['position', 'position'],
  ['positions', 'position'],
  ['permission', 'permission'],
  ['permissions', 'permission'],
];

/** One listed row. */
export interface SecurityCatalogOverlayRow {
  /** The `sys_metadata` row id. */
  readonly id: string;
  /** The type as stored: `permission` / `position`, or a legacy plural. */
  readonly storedType: string;
  /** The catalog type the boot folds it to. */
  readonly catalogType: 'permission' | 'position';
  readonly name: string;
  /** The row's own package binding (`package_id`), `null` when it has none. */
  readonly packageId: string | null;
  /** The configured packages that hold the name — what the cold boot names as the incoming side. */
  readonly heldBy: readonly string[];
  /** The stored checksum, the optimistic lock a repository delete is taken under. */
  readonly checksum: string | null;
}

/** What a deletion did with one listed row. */
export type SecurityCatalogOverlayOutcome =
  | {
      readonly row: SecurityCatalogOverlayRow;
      readonly outcome: 'deleted';
      /** The write path the deletion took (module header). */
      readonly door: 'protocol.deleteMetaItem' | 'sys-metadata-repository';
    }
  | { readonly row: SecurityCatalogOverlayRow; readonly outcome: 'failed'; readonly error: string };

const SYSTEM = { context: { isSystem: true } } as const;

interface EngineLike {
  registry: unknown;
  find(object: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<any[]>;
}

function engineOf(kernel: { getService(name: string): unknown }): EngineLike {
  const engine = kernel.getService('objectql') as EngineLike | undefined;
  if (!engine || typeof engine.find !== 'function' || !engine.registry) {
    throw new Error(
      'No ObjectQL engine on this stack, so the package-held names cannot be read. '
      + 'Run this from the project root whose stack registers the ObjectQL engine.',
    );
  }
  return engine;
}

/** Every active environment-wide row of one stored spelling, ordered by name then id. */
async function storedRows(engine: EngineLike, storedType: string): Promise<any[]> {
  const rows = await engine.find(
    'sys_metadata',
    { where: { type: storedType, organization_id: null, state: 'active' } },
    SYSTEM,
  );
  return [...rows].sort((a, b) =>
    String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
}

/**
 * The listed rows (module header, "The population"), positions first, then by
 * name, then by stored spelling (canonical first).
 *
 * @param kernel a kernel booted with the deployment's composition and WITHOUT
 *   `sys_metadata` hydration, its packages registered.
 */
export async function listSecurityCatalogOverlayRows(
  kernel: { getService(name: string): unknown },
): Promise<SecurityCatalogOverlayRow[]> {
  const engine = engineOf(kernel);
  const { findPackageHeldSecurityCatalogNames } = await import('@objectstack/objectql');
  const held = new Map<string, readonly string[]>();
  for (const entry of findPackageHeldSecurityCatalogNames(engine.registry as never)) {
    held.set(`${entry.catalogType}|${entry.name}`, entry.packageIds);
  }
  if (held.size === 0) return [];

  const listed: SecurityCatalogOverlayRow[] = [];
  for (const [storedType, catalogType] of STORED_TYPE_SPELLINGS) {
    for (const row of await storedRows(engine, storedType)) {
      const name = String(row.name);
      const heldBy = held.get(`${catalogType}|${name}`);
      if (!heldBy) continue;
      listed.push({
        id: String(row.id),
        storedType,
        catalogType,
        name,
        packageId: typeof row.package_id === 'string' && row.package_id !== '' ? row.package_id : null,
        heldBy,
        checksum: typeof row.checksum === 'string' ? row.checksum : null,
      });
    }
  }
  const typeOrder: Record<SecurityCatalogType, number> = { position: 0, permission: 1, capability: 2 };
  return listed.sort((a, b) =>
    typeOrder[a.catalogType] - typeOrder[b.catalogType]
    || a.name.localeCompare(b.name)
    || Number(a.storedType !== a.catalogType) - Number(b.storedType !== b.catalogType)
    || a.id.localeCompare(b.id));
}

/** Which of `ids` are still stored. */
async function stillStored(engine: EngineLike, storedType: string, name: string, ids: readonly string[]): Promise<Set<string>> {
  const rows = await engine.find(
    'sys_metadata',
    { where: { type: storedType, name, organization_id: null, state: 'active' } },
    SYSTEM,
  );
  const present = new Set(rows.map((r: any) => String(r.id)));
  return new Set(ids.filter((id) => present.has(id)));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Delete `rows` through the engine's audited write path (module header, "The
 * deletion"), one outcome per row, in the order given. Never throws for a row:
 * a refusal is that row's `failed` outcome, and the next row is still tried.
 */
export async function deleteSecurityCatalogOverlayRows(
  kernel: { getService(name: string): unknown },
  rows: readonly SecurityCatalogOverlayRow[],
): Promise<SecurityCatalogOverlayOutcome[]> {
  const engine = engineOf(kernel);
  const protocol = kernel.getService('protocol') as {
    deleteMetaItem?: (request: Record<string, unknown>) => Promise<{ success?: boolean; reset?: boolean; message?: string }>;
  } | undefined;
  const outcomes = new Map<string, SecurityCatalogOverlayOutcome>();

  // Canonical spellings: the protocol's delete, one call per row of a name.
  const canonical = new Map<string, SecurityCatalogOverlayRow[]>();
  for (const row of rows) {
    if (row.storedType !== row.catalogType) continue;
    const key = `${row.catalogType}|${row.name}`;
    canonical.set(key, [...(canonical.get(key) ?? []), row]);
  }
  for (const group of canonical.values()) {
    const { catalogType, name } = group[0]!;
    const pending = new Map(group.map((r) => [r.id, r]));
    if (typeof protocol?.deleteMetaItem !== 'function') {
      for (const row of group) {
        outcomes.set(row.id, { row, outcome: 'failed', error: 'No metadata protocol on this stack, so the row cannot be deleted through it.' });
      }
      continue;
    }
    for (let attempt = 0; attempt < group.length && pending.size > 0; attempt++) {
      let refusal: string | undefined;
      try {
        const receipt = await protocol.deleteMetaItem({
          type: catalogType,
          name,
          state: 'active',
          actor: SECURITY_CATALOG_OVERLAYS_ACTOR,
        });
        if (receipt?.reset !== true) refusal = receipt?.message ?? 'the delete removed no row';
      } catch (error) {
        refusal = messageOf(error);
      }
      const remaining = await stillStored(engine, catalogType, name, [...pending.keys()]);
      for (const [id, row] of [...pending]) {
        if (remaining.has(id)) continue;
        outcomes.set(id, { row, outcome: 'deleted', door: 'protocol.deleteMetaItem' });
        pending.delete(id);
      }
      if (refusal !== undefined) {
        for (const row of pending.values()) outcomes.set(row.id, { row, outcome: 'failed', error: refusal });
        pending.clear();
        break;
      }
    }
    for (const row of pending.values()) {
      outcomes.set(row.id, { row, outcome: 'failed', error: 'the delete reported success, and the row is still stored' });
    }
  }

  // Legacy plural spellings: the repository beneath that door, row by row.
  const plural = rows.filter((row) => row.storedType !== row.catalogType);
  if (plural.length > 0) {
    const { SysMetadataRepository } = await import('@objectstack/metadata-protocol');
    const repository = new SysMetadataRepository({ engine: engine as never, organizationId: null, orgLabel: 'env' });
    for (const row of plural) {
      try {
        await repository.delete(
          { type: row.storedType, name: row.name, org: 'env' } as never,
          {
            // The repository's own lock: the stored checksum, and a null one
            // against a row that carries none (`lockAccepts`).
            parentVersion: row.checksum as string,
            actor: SECURITY_CATALOG_OVERLAYS_ACTOR,
            source: SECURITY_CATALOG_OVERLAYS_ACTOR,
            message: `Deleted the environment-wide ${row.storedType}/${row.name} row over a name `
              + `${row.heldBy.join(', ')} holds (ADR-0048 N.3)`,
            intent: 'override-artifact',
            state: 'active',
            packageId: row.packageId,
          },
        );
        const remaining = await stillStored(engine, row.storedType, row.name, [row.id]);
        outcomes.set(row.id, remaining.has(row.id)
          ? { row, outcome: 'failed', error: 'the delete returned, and the row is still stored' }
          : { row, outcome: 'deleted', door: 'sys-metadata-repository' });
      } catch (error) {
        outcomes.set(row.id, { row, outcome: 'failed', error: messageOf(error) });
      }
    }
  }

  return rows.map((row) => outcomes.get(row.id) ?? { row, outcome: 'failed', error: 'not attempted' });
}
