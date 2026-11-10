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
 * [ADR-0150 D3/D4] Asked per HOLDER: the set the name resolves to with no
 * caller — the holder a grant written by name is stamped with — or, for an
 * identity the platform derives from the name (`platform`), the PLATFORM's
 * set of it (`platformPermissionSet`); and a ledger row switches it off when
 * its `package_id` names that holder, or names none and the name resolves to
 * it (`ledgerRowSwitchesOff`). A name two holders share, with no caller to
 * tell them apart, resolves to no set: it confers nothing.
 *
 * A catalog or ledger read that fails throws; the caller decides its own
 * failure direction.
 */

import type { EngineQueryOptions } from '@objectstack/spec/data';
import { catalogEntryAddress, ledgerRowSwitchesOff, platformPermissionSet, securityCatalogReaderOf } from '@objectstack/core';
import { isMissingTableError } from '@objectstack/types';

/** The activation ledger (ADR-0126 §4), reached by name. */
const METADATA_ACTIVATION = 'sys_metadata_activation';

/** A system-context read of one object. */
export type CatalogStandingRead = (object: string, query: EngineQueryOptions) => Promise<unknown>;

/** Ledger rows read for one name: a row per holder (R4), bounded. */
const LEDGER_ROWS_PER_NAME = 50;

/** Whether the ledger switches off the set of `name` held at `packageId`. */
async function switchedOff(engine: object, read: CatalogStandingRead, packageId: string | null, name: string): Promise<boolean> {
  const registry = (engine as { registry?: { getObject?: (object: string) => unknown } }).registry;
  if (typeof registry?.getObject === 'function' && !registry.getObject(METADATA_ACTIVATION)) return false;
  let rows: unknown;
  try {
    rows = await read(METADATA_ACTIVATION, { where: { metadata_type: 'permission', name }, limit: LEDGER_ROWS_PER_NAME });
  } catch (err) {
    if (isMissingTableError(err, METADATA_ACTIVATION)) return false;
    throw err;
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (await ledgerRowSwitchesOff(engine, row as Record<string, unknown>, packageId, name)) return true;
  }
  return false;
}

/**
 * Whether the permission set `name` confers anything on `engine` (module doc).
 *
 * @param engine The ObjectQL engine the security plugin bound its catalog to.
 * @param read   The system-context read the ledger is asked through.
 * @param options.platform Ask for the PLATFORM's set of the name — for an
 *   identity the platform derives from it (`admin_full_access`).
 */
export async function permissionSetInEffect(
  engine: object,
  read: CatalogStandingRead,
  name: string,
  options: { platform?: boolean } = {},
): Promise<boolean> {
  const catalog = securityCatalogReaderOf(engine);
  if (!catalog) return false;
  const entry = options.platform ? await platformPermissionSet(engine, name) : await catalog.resolve('permission', name);
  if (entry === undefined) return false;
  return !(await switchedOff(engine, read, catalogEntryAddress(entry).packageId, name));
}
