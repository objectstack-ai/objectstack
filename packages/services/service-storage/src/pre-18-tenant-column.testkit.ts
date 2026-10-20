// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Return driver-created tables to the shape a store built BEFORE 18.x has:
 * the tenant column nullable.
 *
 * ADR-0131 D1: since 18.x the SQL driver creates a table's tenant column NOT
 * NULL. A store an earlier release built still holds the nullable column and
 * its organization-less legacy rows (until the organization-ownership
 * ceremony attributes them, or reports them). A suite whose subject is those
 * rows — a backfill over them, a sweep that must still reach them — builds
 * its tables, then calls this before seeding them. Done through the driver's
 * own drift apply door (`relax_not_null`), never a hand `ALTER`.
 */
export async function relaxTenantColumns(
  driver: { applyMigrationEntries(entries: never[]): Promise<{ applied: unknown[] }> },
  tables: readonly string[],
  column = 'organization_id',
): Promise<void> {
  for (const table of tables) {
    const op = { type: 'relax_not_null', table, column };
    const { applied } = await driver.applyMigrationEntries([
      { kind: 'nullability_mismatch', remoteName: table, table, column, category: 'needs_confirm', op } as never,
    ]);
    if (applied.length !== 1) throw new Error(`relaxTenantColumns: ${table}.${column} was not relaxed`);
  }
}
