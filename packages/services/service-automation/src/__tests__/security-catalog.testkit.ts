// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: bind a security catalog to a fake engine (ADR-0131 D3/D4).
 * `resolveUserAuthzGrants` reads positions, their sets and the set bodies from
 * the catalog the security plugin binds to its engine; a suite whose engine is
 * a double binds one here. A row alone grants nothing: what a fixture grants
 * must be declared. {@link catalogFromTables} declares a row-shaped fixture's
 * catalog, its junction rows through `convertPositionBindingRows` — the
 * conversion the upgrade ceremony applies.
 */

import { bindSecurityCatalogReader, convertPositionBindingRows, createSecurityCatalogReader } from '@objectstack/core';

type Definition = Record<string, unknown>;

/** The definitions a suite declares, per catalog type. */
export interface TestSecurityCatalog {
  positions?: readonly Definition[];
  permissions?: readonly Definition[];
}

/** Bind a catalog over these definitions (read afresh per lookup when given a function); returns `engine`. */
export function bindTestSecurityCatalog<T extends object>(engine: T, catalog: TestSecurityCatalog | (() => TestSecurityCatalog)): T {
  const items = (type: string): readonly Definition[] => {
    const c = typeof catalog === 'function' ? catalog() : catalog;
    return (type === 'position' ? c.positions : type === 'permission' ? c.permissions : undefined) ?? [];
  };
  bindSecurityCatalogReader(engine, createSecurityCatalogReader({
    registry: { getItem: (type, name) => items(type).find((d) => d.name === name), listItems: items, isPackageDisabled: () => false },
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

/** The definitions a fixture's catalog rows convert to (first set row of a name wins; a `conflicting` position names no set). */
export function catalogFromTables(tables: Record<string, readonly unknown[] | undefined>): TestSecurityCatalog {
  const setRows = (tables.sys_permission_set ?? []) as Definition[];
  const permissions: Definition[] = [];
  for (const row of setRows) {
    if (typeof row.name !== 'string' || permissions.some((d) => d.name === row.name)) continue;
    const definition: Definition = { name: row.name };
    for (const [column, key] of [['system_permissions', 'systemPermissions'], ['tab_permissions', 'tabPermissions'], ['object_permissions', 'objects']] as const) {
      const value = parsed(row[column] ?? row[key]);
      if (value !== undefined && value !== null) definition[key] = value;
    }
    permissions.push(definition);
  }
  const { positions } = convertPositionBindingRows({
    positions: (tables.sys_position ?? []) as Definition[],
    permissionSets: setRows,
    bindings: (tables.sys_position_permission_set ?? []) as Definition[],
  });
  return {
    permissions,
    positions: positions.flatMap((f) => (f.fate === 'conflicting' ? [] : [{ name: f.name, permissionSets: [...f.permissionSets] }])),
  };
}

/** Bind the catalog `tables` convert to, re-derived per lookup so a row written later is in it. */
export function bindCatalogFromTables<T extends object>(engine: T, tables: Record<string, readonly unknown[] | undefined>): T {
  return bindTestSecurityCatalog(engine, () => catalogFromTables(tables));
}
