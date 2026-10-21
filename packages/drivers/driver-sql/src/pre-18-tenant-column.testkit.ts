// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SqlDriver } from './sql-driver.js';

/**
 * Return a table the driver just created to the shape a database built BEFORE
 * 18.x has: its tenant column nullable.
 *
 * ADR-0131 D1: since 18.x the driver creates a table's tenant column NOT NULL
 * (`createColumn`'s `tenantColumn`). A database built by an earlier release
 * still holds the nullable column — and, where the organization-ownership
 * ceremony reported a table rather than clearing it (D10 fate 4), real rows
 * with no organization in it. A suite whose subject is how the driver treats
 * THOSE rows (the NULL-safe unique key part, the legacy composites, the
 * respelling migrations) builds its table with `initObjects` and then calls
 * this, so it keeps measuring the shape it was written for.
 *
 * Done through the driver's own drift apply door (`relax_not_null`: the SQLite
 * table rebuild, or `ALTER COLUMN … DROP NOT NULL`), never a hand `ALTER`, so
 * every index the table carries survives exactly as the driver built it.
 */
export async function asPre18TenantColumn(
  driver: SqlDriver,
  table: string,
  column: string = 'organization_id',
): Promise<void> {
  const entry = {
    kind: 'nullability_mismatch',
    remoteName: table,
    table,
    column,
    expected: 'NULL',
    actual: 'NOT NULL',
    severity: 'warning',
    category: 'needs_confirm',
    op: { type: 'relax_not_null', table, column },
    message: `${table}.${column}: the pre-18 nullable tenant column (test fixture).`,
  } as unknown as Parameters<SqlDriver['applyMigrationEntries']>[0][number];
  const { applied } = await driver.applyMigrationEntries([entry]);
  if (applied.length !== 1) {
    throw new Error(`asPre18TenantColumn: the drift apply door did not relax ${table}.${column}`);
  }
}
