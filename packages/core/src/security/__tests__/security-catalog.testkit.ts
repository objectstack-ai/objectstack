// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: bind a security catalog to a fake engine.
 *
 * The authorization resolver reads positions, the sets they name and the set
 * bodies from the catalog the security plugin binds to its engine
 * (`bindSecurityCatalogReader`, ADR-0131 D3/D4). A unit suite's fake engine
 * has no plugin, so it binds one here — over an in-memory registry holding the
 * definitions the suite declares.
 *
 * {@link catalogFromTables} derives those definitions from a suite's row-shaped
 * fixture: the `sys_permission_set` rows become set definitions, and the
 * `sys_position_permission_set` rows become each position's `permissionSets`
 * through `convertPositionBindingRows` — the very conversion the upgrade
 * ceremony applies — so a fixture that resolved some grants from rows proves
 * the converted definitions resolve the same ones. {@link ledgerFromTables}
 * does the same for the rows' ADR-0049 `active` flags, through
 * `convertDeactivatedCatalogRows`, into activation-ledger rows.
 */

import {
  bindSecurityCatalogReader,
  createSecurityCatalogReader,
  type SecurityCatalogReader,
} from '../security-catalog.js';
import { convertDeactivatedCatalogRows, convertPositionBindingRows } from '../position-binding-conversion.js';

type Definition = Record<string, unknown>;

/** The definitions a suite declares, per catalog type. */
export interface StaticCatalog {
  positions?: readonly Definition[];
  permissions?: readonly Definition[];
}

/**
 * A catalog over these definitions alone (first definition of a name wins).
 * Given a function, the definitions are read afresh on every lookup — the
 * shape for a suite that writes its fixture between two resolutions.
 */
export function createStaticSecurityCatalog(catalog: StaticCatalog | (() => StaticCatalog)): SecurityCatalogReader {
  const current = typeof catalog === 'function' ? catalog : () => catalog;
  const itemsOf = (type: string): readonly Definition[] => {
    const c = current();
    return type === 'position' ? (c.positions ?? []) : type === 'permission' ? (c.permissions ?? []) : [];
  };
  return createSecurityCatalogReader({
    registry: {
      getItem: (type, name) => itemsOf(type).find((d) => d.name === name),
      listItems: (type) => itemsOf(type),
      isPackageDisabled: () => false,
    },
    metadata: { get: () => undefined, list: () => [] },
  });
}

/** Bind {@link createStaticSecurityCatalog} to `engine`; returns the engine for chaining. */
export function bindStaticSecurityCatalog<T extends object>(engine: T, catalog: StaticCatalog | (() => StaticCatalog)): T {
  bindSecurityCatalogReader(engine, createStaticSecurityCatalog(catalog));
  return engine;
}

const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

/**
 * The definitions a row-shaped fixture's catalog rows convert to (module doc).
 * A set name held by several rows takes the first row's body; a position name
 * the conversion reports `conflicting` names no set.
 */
export function catalogFromTables(tables: Record<string, readonly unknown[] | undefined>): StaticCatalog {
  const setRows = (tables.sys_permission_set ?? []) as Definition[];
  const positionRows = (tables.sys_position ?? []) as Definition[];
  const permissions: Definition[] = [];
  for (const row of setRows) {
    if (typeof row.name !== 'string' || permissions.some((d) => d.name === row.name)) continue;
    const systemPermissions = parsed(row.system_permissions ?? row.systemPermissions);
    const tabPermissions = parsed(row.tab_permissions ?? row.tabPermissions);
    permissions.push({
      name: row.name,
      ...(systemPermissions !== undefined && systemPermissions !== null ? { systemPermissions } : {}),
      ...(tabPermissions !== undefined && tabPermissions !== null ? { tabPermissions } : {}),
    });
  }
  const conversion = convertPositionBindingRows({
    positions: positionRows,
    permissionSets: setRows,
    bindings: (tables.sys_position_permission_set ?? []) as Definition[],
  });
  const positions: Definition[] = [];
  for (const fate of conversion.positions) {
    if (fate.fate !== 'conflicting') positions.push({ name: fate.name, permissionSets: [...fate.permissionSets] });
  }
  return { positions, permissions };
}

/**
 * Bind to `engine` the catalog `tables`' rows convert to ({@link catalogFromTables}),
 * re-derived on every lookup, so a row the suite writes later is in it.
 */
export function bindCatalogFromTables<T extends object>(engine: T, tables: Record<string, readonly unknown[] | undefined>): T {
  return bindStaticSecurityCatalog(engine, () => catalogFromTables(tables));
}

/**
 * The `sys_metadata_activation` rows a row-shaped fixture's `active: false`
 * catalog rows convert to (`convertDeactivatedCatalogRows`, module doc).
 */
export function ledgerFromTables(tables: Record<string, readonly unknown[] | undefined>): Definition[] {
  return convertDeactivatedCatalogRows({
    positions: (tables.sys_position ?? []) as Definition[],
    permissionSets: (tables.sys_permission_set ?? []) as Definition[],
  }).ledger.map((row) => ({ ...row, package_id: null }));
}
