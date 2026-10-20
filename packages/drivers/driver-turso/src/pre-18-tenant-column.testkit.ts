// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { TursoDriver } from './turso-driver.js';

type ObjectDef = { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] };

/**
 * Build an object's table on either `TursoDriver` face in the shape a database
 * built BEFORE 18.x has: its tenant column nullable.
 *
 * ADR-0131 D1: since 18.x both faces create a table's tenant column NOT NULL.
 * A store built by an earlier release still holds the nullable column, and
 * rows with no organization where the organization-ownership ceremony reported
 * a table rather than clearing it. A suite whose subject is how a face treats
 * THOSE rows (the chokepoint's NULL-organization arm, the NULL-safe unique key
 * part) builds its table through this, so it keeps measuring that shape.
 *
 * - **local face:** `initObjects`, then the driver's own drift apply door
 *   (`relax_not_null`, the SQLite table rebuild), never a hand `ALTER`.
 * - **remote face:** that face has no door that relaxes a column (its
 *   `driftApplyLimit`), so the table is created the way a pre-18 remote sync
 *   created it — the transport's own `CREATE TABLE` with the tenant column's
 *   `NOT NULL` left off — and `initObjects` then runs over the existing table
 *   (its additive sync and declared indexes) as it would on an upgraded store.
 */
export async function initObjectsPre18(driver: TursoDriver, objectDef: ObjectDef): Promise<void> {
  const d = driver as any;
  const column: string | null = d.computeTenantField(objectDef);
  if (column === null) throw new Error(`initObjectsPre18: ${objectDef.name} has no tenant column`);

  if (driver.transportMode !== 'remote') {
    await driver.initObjects([objectDef] as never);
    const entry = {
      kind: 'nullability_mismatch',
      remoteName: objectDef.name,
      table: objectDef.name,
      column,
      expected: 'NULL',
      actual: 'NOT NULL',
      severity: 'warning',
      category: 'needs_confirm',
      op: { type: 'relax_not_null', table: objectDef.name, column },
      message: `${objectDef.name}.${column}: the pre-18 nullable tenant column (test fixture).`,
    };
    const { applied } = await driver.applyMigrationEntries([entry as never]);
    if (applied.length !== 1) throw new Error(`initObjectsPre18: ${objectDef.name}.${column} was not relaxed`);
    return;
  }

  const transport = d.remoteTransport;
  const created: string = transport.buildCreateTableSQL(objectDef.name, objectDef);
  const constrained = new RegExp(`("${column}" [A-Z]+) NOT NULL`);
  if (!constrained.test(created)) {
    throw new Error(`initObjectsPre18: the remote CREATE TABLE for ${objectDef.name} does not constrain ${column}`);
  }
  await transport.ensureConnected();
  await transport.client.execute(created.replace(constrained, '$1'));
  await driver.initObjects([objectDef] as never);
}
