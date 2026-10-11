// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4, ADR-0126 §4] Whether a permission set NAME confers anything
 * on this engine — asked the way the authorization resolver answers it
 * (`resolveUserAuthzGrants`, `@objectstack/core`), so a plugin-auth reader that
 * decides "would a grant of this set grant" cannot disagree with the resolver
 * that grants it:
 *
 *  - the set EXISTS when the security catalog bound to the engine
 *    (`securityCatalogReaderOf`) holds a `permission` definition of that name;
 *    an engine with no catalog bound holds none;
 *  - it is IN EFFECT unless the activation ledger (`sys_metadata_activation`,
 *    one row per `(metadata_type, name)`) carries a `permission` row of that
 *    name whose `active` reads false — a driver `0` included. No row means
 *    active; a composition that registers no ledger object, or a ledger table
 *    never provisioned, holds no row.
 *
 * ⛔ The `sys_permission_set` row's `active` column is not read: the resolver
 * reads no catalog row, so a flag there switches nothing.
 *
 * A catalog or ledger read that fails throws; the caller decides its own
 * failure direction.
 */

import type { EngineQueryOptions } from '@objectstack/spec/data';
import { securityCatalogReaderOf } from '@objectstack/core';
import { isMissingTableError } from '@objectstack/types';

/** The activation ledger (ADR-0126 §4), reached by name. */
const METADATA_ACTIVATION = 'sys_metadata_activation';

/** A system-context read of one object. */
export type CatalogStandingRead = (object: string, query: EngineQueryOptions) => Promise<unknown>;

/** Whether the ledger switches `name` off. */
async function switchedOff(engine: object, read: CatalogStandingRead, name: string): Promise<boolean> {
  const registry = (engine as { registry?: { getObject?: (object: string) => unknown } }).registry;
  if (typeof registry?.getObject === 'function' && !registry.getObject(METADATA_ACTIVATION)) return false;
  let rows: unknown;
  try {
    rows = await read(METADATA_ACTIVATION, { where: { metadata_type: 'permission', name }, limit: 1 });
  } catch (err) {
    if (isMissingTableError(err, METADATA_ACTIVATION)) return false;
    throw err;
  }
  const row = Array.isArray(rows) ? (rows[0] as { active?: unknown } | undefined) : undefined;
  return row !== undefined && (row.active === false || row.active === 0);
}

/**
 * Whether the permission set `name` confers anything on `engine` (module doc).
 *
 * @param engine The ObjectQL engine the security plugin bound its catalog to.
 * @param read   The system-context read the ledger is asked through.
 */
export async function permissionSetInEffect(engine: object, read: CatalogStandingRead, name: string): Promise<boolean> {
  const catalog = securityCatalogReaderOf(engine);
  if (!catalog || (await catalog.resolve('permission', name)) === undefined) return false;
  return !(await switchedOff(engine, read, name));
}
