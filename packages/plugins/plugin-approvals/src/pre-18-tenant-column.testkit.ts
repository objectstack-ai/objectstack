// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Return engine-synced tables to the shape a store built BEFORE 18.x has: the
 * tenant column nullable.
 *
 * ADR-0131 D1: since 18.x the SQL driver creates a table's tenant column NOT
 * NULL. A store an earlier release built still holds the nullable column and
 * its organization-less rows — the holdings, grants and seeds this package's
 * NULL readers still answer for until the organization-ownership ceremony has
 * attributed them. A suite whose subject is those rows calls this after
 * `syncSchemas()` and before seeding them. Done through each table's driver
 * and its own drift apply door (`relax_not_null`), never a hand `ALTER`.
 *
 * Name only the tables the suite writes organization-less: a relaxed table
 * also admits an unstamped production write, which an 18.x store refuses.
 */
export async function relaxTenantColumns(
  engine: { getDriverForObject(object: string): unknown },
  tables: readonly string[],
  column = 'organization_id',
): Promise<void> {
  for (const table of tables) {
    const driver = engine.getDriverForObject(table) as {
      applyMigrationEntries(entries: never[]): Promise<{ applied: unknown[] }>;
    };
    const op = { type: 'relax_not_null', table, column };
    const { applied } = await driver.applyMigrationEntries([
      { kind: 'nullability_mismatch', remoteName: table, table, column, category: 'needs_confirm', op } as never,
    ]);
    if (applied.length !== 1) throw new Error(`relaxTenantColumns: ${table}.${column} was not relaxed`);
  }
}
