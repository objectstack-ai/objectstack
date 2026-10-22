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

/**
 * {@link relaxTenantColumns} over every object of an app that carries a tenant
 * column as the engine registered it — the shape a whole pre-18 store has.
 */
export async function relaxEveryTenantColumn(
  engine: { getDriverForObject(object: string): unknown; getSchema(object: string): unknown },
  objects: readonly { name: string }[],
): Promise<void> {
  const tenant = objects
    .map((o) => o.name)
    .filter((name) => {
      const schema = engine.getSchema(name) as { fields?: Record<string, unknown>; tenancy?: { enabled?: boolean } } | undefined;
      return !!schema?.fields?.organization_id && schema.tenancy?.enabled !== false;
    });
  await relaxTenantColumns(engine, tenant);
}

/** {@link relaxEveryTenantColumn} over every object the engine's registry holds. */
export async function relaxEveryRegisteredTenantColumn(engine: {
  getDriverForObject(object: string): unknown;
  getSchema(object: string): unknown;
  registry: { getAllObjects(): readonly { name: string }[] };
}): Promise<void> {
  await relaxEveryTenantColumn(engine, engine.registry.getAllObjects());
}
