// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Return a SQLite file this release built to the shape an EARLIER release's
 * database has: every tenant column (`organization_id`) nullable.
 *
 * ADR-0131 D1: since 18.x the SQL driver creates a table's tenant column NOT
 * NULL. A v17 or 18.0 database still holds the nullable column, and the
 * organization-ownership ceremony is what tightens it. A suite that boots this
 * release over a file and then plants that earlier release's organization-less
 * rows calls this between the two, so the file is the store the ceremony
 * meets. Each column is relaxed through the driver's own drift apply door
 * (`relax_not_null`, the SQLite table rebuild), never a hand `ALTER`.
 */
export async function relaxTenantColumnsOnFile(file: string, column = 'organization_id'): Promise<string[]> {
  // A dynamic import: this file lives under `src/`, where a static driver import
  // is refused (`schema-migrate.lazy-driver-import.test.ts`).
  const { SqlDriver } = await import('@objectstack/driver-sql');
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  const relaxed: string[] = [];
  try {
    const knex = (driver as any).knex;
    const tables = (await knex.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)) as Array<{ name: string }>;
    for (const { name } of tables) {
      const info = (await knex.raw(`SELECT name, "notnull" AS nn FROM pragma_table_info(?)`, [name])) as Array<{ name: string; nn: number }>;
      if (!info.some((c) => c.name === column && Number(c.nn) === 1)) continue;
      const op = { type: 'relax_not_null', table: name, column };
      const { applied } = await driver.applyMigrationEntries([
        { kind: 'nullability_mismatch', remoteName: name, table: name, column, category: 'needs_confirm', op } as never,
      ]);
      if (applied.length !== 1) throw new Error(`relaxTenantColumnsOnFile: ${name}.${column} was not relaxed`);
      relaxed.push(name);
    }
  } finally {
    await driver.disconnect();
  }
  return relaxed;
}
