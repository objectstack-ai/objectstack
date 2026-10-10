// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: bind a security catalog to a fake engine.
 *
 * `resolveUserAuthzGrants` (`@objectstack/core`) reads positions, the sets
 * they name and the set bodies from the catalog the security plugin binds to
 * its engine (ADR-0131 D3/D4). A suite whose engine is a double has no plugin,
 * so it binds one here, over the definitions it declares. A row alone grants
 * nothing any more: the set or position a fixture grants must be declared.
 */

import { bindSecurityCatalogReader, convertPositionBindingRows, createSecurityCatalogReader } from '@objectstack/core';

type Definition = Record<string, unknown>;

/** The definitions a suite declares, per catalog type. */
export interface TestSecurityCatalog {
  positions?: readonly Definition[];
  permissions?: readonly Definition[];
}

/**
 * Bind a catalog over `catalog`'s definitions to `engine` and return the
 * engine. Given a function, the definitions are read afresh on every lookup.
 */
export function bindTestSecurityCatalog<T extends object>(engine: T, catalog: TestSecurityCatalog | (() => TestSecurityCatalog)): T {
  const current = typeof catalog === 'function' ? catalog : () => catalog;
  const itemsOf = (type: string): readonly Definition[] => {
    const c = current();
    return type === 'position' ? (c.positions ?? []) : type === 'permission' ? (c.permissions ?? []) : [];
  };
  bindSecurityCatalogReader(engine, createSecurityCatalogReader({
    registry: {
      getItem: (type, name) => itemsOf(type).find((d) => d.name === name),
      listItems: (type) => itemsOf(type),
      isPackageDisabled: () => false,
    },
    metadata: { get: () => undefined, list: () => [] },
  }));
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
 * The definitions a row-shaped fixture's catalog rows convert to: each
 * `sys_permission_set` row's body becomes a set definition (the first row of a
 * name wins), and the `sys_position_permission_set` rows become each
 * position's `permissionSets` through `convertPositionBindingRows` — the
 * conversion the upgrade ceremony applies. A position name the conversion
 * reports `conflicting` names no set.
 */
export function catalogFromTables(tables: Record<string, readonly unknown[] | undefined>): TestSecurityCatalog {
  const setRows = (tables.sys_permission_set ?? []) as Definition[];
  const permissions: Definition[] = [];
  for (const row of setRows) {
    if (typeof row.name !== 'string' || permissions.some((d) => d.name === row.name)) continue;
    const definition: Definition = { name: row.name };
    for (const [column, key] of [
      ['system_permissions', 'systemPermissions'],
      ['tab_permissions', 'tabPermissions'],
      ['object_permissions', 'objects'],
    ] as const) {
      const value = parsed(row[column] ?? row[key]);
      if (value !== undefined && value !== null) definition[key] = value;
    }
    permissions.push(definition);
  }
  const conversion = convertPositionBindingRows({
    positions: (tables.sys_position ?? []) as Definition[],
    permissionSets: setRows,
    bindings: (tables.sys_position_permission_set ?? []) as Definition[],
  });
  const positions: Definition[] = [];
  for (const fate of conversion.positions) {
    if (fate.fate !== 'conflicting') positions.push({ name: fate.name, permissionSets: [...fate.permissionSets] });
  }
  return { positions, permissions };
}

/** Bind the catalog `tables`' rows convert to, re-derived on every lookup so later writes are in it. */
export function bindCatalogFromTables<T extends object>(engine: T, tables: Record<string, readonly unknown[] | undefined>): T {
  return bindTestSecurityCatalog(engine, () => catalogFromTables(tables));
}
