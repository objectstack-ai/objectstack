// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SQL Server arms of the driver's catalog reads — what the Studio Tables
 * tab, `list_remote_tables` and `import_object` see of a federated SQL Server
 * database (ADR-0015), and what the federated read path asks for a table's key.
 *
 * ## Why one module rather than an `else if` per reader
 *
 * The other three dialects resolve a table by a bare name inside one scope
 * (Postgres's search path, MySQL's connection database, SQLite's one file). A
 * SQL Server database is routinely MANY schemas — `dbo`, `Sales`, `Person`, an
 * ERP's own — so a bare name is ambiguous there, and every reader below takes
 * the schema as an argument. {@link splitMssqlQualifiedName} is the one place a
 * `schema.table` key is taken apart, so the listing and the per-table reads
 * cannot disagree about where the dot is.
 *
 * ## The key shape
 *
 * {@link listMssqlTables} lists every user base table in every schema, and the
 * schema introspection keys each one `schema.table` (`dbo.Orders`). That is the
 * shape `ExternalDatasourceService` already reads as a qualified name: a
 * `?schema=` filter and `external.allowedSchemas` are answered from it, and a
 * drafted object gets `external.remoteSchema` and `external.remoteName` split
 * from it. A name with no dot (a caller passing a bare `Orders`) is read in
 * the session's default schema, `SCHEMA_NAME()` — SQL Server's own resolution
 * rule for an unqualified name, never a hard-coded `dbo`.
 *
 * ## Catalog views, not `INFORMATION_SCHEMA`
 *
 * `sys.*` carries what the standard views leave out — the key ordinal
 * (`index_columns.key_ordinal`), whether a unique index is FILTERED
 * (`has_filter`, a uniqueness that holds only over a subset and therefore is
 * not a unique column), and `is_ms_shipped`, which separates a database's own
 * tables from the ones SQL Server installs. Every view used here exists since
 * SQL Server 2005.
 *
 * Every reader takes the knex instance, never the driver: none of them reads
 * driver state, and the module imports no value from `sql-driver.ts`.
 */

import type { Knex } from 'knex';
import type { IntrospectedColumn, IntrospectedForeignKey } from './sql-driver-top-level.js';
import type { PhysicalIndex } from './schema-drift.js';

/** A table as SQL Server's catalog names it: its schema and its own name. */
export interface MssqlTableName {
  /** The schema, or `undefined` for "the session's default schema". */
  readonly schema: string | undefined;
  readonly table: string;
}

/**
 * Take a `schema.table` key apart at its FIRST dot. A key with no dot is a bare
 * name in the session's default schema. The first dot, because a schema name
 * with a dot in it is not something SQL Server lets a schema be created with
 * unquoted, while a table name with one is merely unusual — the split that
 * keeps the schema intact is the one that can be right.
 */
export function splitMssqlQualifiedName(name: string): MssqlTableName {
  const dot = name.indexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { schema: undefined, table: name };
  return { schema: name.slice(0, dot), table: name.slice(dot + 1) };
}

/** `SCHEMA_NAME()` when no schema was named — SQL Server's own default-schema rule. */
const SCHEMA_PREDICATE = 's.name = COALESCE(?, SCHEMA_NAME())';

/** The rows of a `knex.raw` on the mssql client: an array of plain row objects. */
function rowsOf(result: unknown): Array<Record<string, any>> {
  return Array.isArray(result) ? (result as Array<Record<string, any>>) : [];
}

/**
 * Every user base table, in every schema, as `{ schema, table }`. Ordered by
 * schema then name, so the listing a person reads is stable across calls.
 * `is_ms_shipped = 0` drops the tables SQL Server itself installs.
 */
export async function listMssqlTables(knex: Knex): Promise<Array<{ schema: string; table: string }>> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT s.name AS table_schema, t.name AS table_name
         FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE t.is_ms_shipped = 0
        ORDER BY s.name, t.name`,
    ),
  );
  return rows.map((r) => ({ schema: String(r.table_schema), table: String(r.table_name) }));
}

/** Column names in DECLARED order (`column_id`), the order `introspectColumns` emits. */
export async function mssqlColumnOrder(knex: Knex, name: MssqlTableName): Promise<string[]> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT c.name AS column_name
         FROM sys.columns c
         JOIN sys.tables t ON t.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE t.name = ? AND ${SCHEMA_PREDICATE}
        ORDER BY c.column_id`,
      [name.table, name.schema ?? null],
    ),
  );
  return rows.map((r) => String(r.column_name));
}

/**
 * The per-column facts, read from `INFORMATION_SCHEMA.COLUMNS` — the view
 * knex's own `columnInfo()` reads on this client, minus its hard-coded `dbo`
 * for an unnamed schema. `CHARACTER_MAXIMUM_LENGTH` is `-1` for a `(max)`
 * column, which is "unbounded", not a length: it is reported as absent, so a
 * drafted field never carries a negative `maxLength`.
 */
export async function mssqlColumns(knex: Knex, name: MssqlTableName): Promise<IntrospectedColumn[]> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable,
              c.COLUMN_DEFAULT AS column_default, c.CHARACTER_MAXIMUM_LENGTH AS max_length
         FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = ? AND c.TABLE_SCHEMA = COALESCE(?, SCHEMA_NAME())
        ORDER BY c.ORDINAL_POSITION`,
      [name.table, name.schema ?? null],
    ),
  );
  return rows.map((r) => {
    const maxLength = typeof r.max_length === 'number' && r.max_length > 0 ? r.max_length : undefined;
    return {
      name: String(r.column_name),
      type: String(r.data_type ?? 'string').toLowerCase(),
      nullable: r.is_nullable !== 'NO',
      defaultValue: r.column_default ?? null,
      primaryKey: false,
      isUnique: false,
      ...(maxLength === undefined ? {} : { maxLength }),
    };
  });
}

/**
 * The primary key's columns IN KEY ORDER (`key_ordinal`), not column order —
 * the order is load-bearing for the same reasons the other arms record: the
 * list addresses rows and names a conflict target, and a key in the wrong
 * order is a different key.
 */
export async function mssqlPrimaryKey(knex: Knex, name: MssqlTableName): Promise<string[]> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE i.is_primary_key = 1 AND ic.key_ordinal > 0 AND t.name = ? AND ${SCHEMA_PREDICATE}
        ORDER BY ic.key_ordinal`,
      [name.table, name.schema ?? null],
    ),
  );
  return rows.map((r) => String(r.column_name));
}

/**
 * Every column that is, BY ITSELF, the whole key of a unique constraint or a
 * unique index. Excluded, each for a stated reason:
 *
 * - the primary key — reported losslessly by {@link mssqlPrimaryKey}, the same
 *   split the other three arms make;
 * - a FILTERED unique index (`has_filter`): `… WHERE deleted = 0` is unique
 *   over a subset only, so the column is not unique;
 * - `INCLUDE`d columns (`key_ordinal = 0`): carried by the index, not keyed by it;
 * - a disabled index, which enforces nothing.
 */
export async function mssqlSingleColumnUniques(knex: Knex, name: MssqlTableName): Promise<string[]> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT i.index_id, c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE i.is_unique = 1 AND i.is_primary_key = 0 AND i.has_filter = 0 AND i.is_disabled = 0
          AND ic.key_ordinal > 0 AND t.name = ? AND ${SCHEMA_PREDICATE}`,
      [name.table, name.schema ?? null],
    ),
  );
  const byIndex = new Map<number, string[]>();
  for (const r of rows) {
    const id = Number(r.index_id);
    const cols = byIndex.get(id) ?? [];
    cols.push(String(r.column_name));
    byIndex.set(id, cols);
  }
  const single = new Set<string>();
  for (const cols of byIndex.values()) if (cols.length === 1) single.add(cols[0]!);
  return [...single];
}

/**
 * The table's foreign keys, one row per column pair in KEY order (#11324's
 * flat per-column record: a composite key is ordered sibling rows).
 *
 * `referencedSchema` follows the #11377 presence-is-the-fact contract: it is
 * present exactly when the parent does NOT resolve by its bare name — when its
 * schema is not the session's default schema — and absent otherwise.
 */
export async function mssqlForeignKeys(knex: Knex, name: MssqlTableName): Promise<IntrospectedForeignKey[]> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT pc.name AS column_name, rt.name AS referenced_table, rc.name AS referenced_column,
              fk.name AS constraint_name,
              CASE WHEN rs.name = SCHEMA_NAME() THEN NULL ELSE rs.name END AS referenced_schema
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.tables t ON t.object_id = fk.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
         JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE t.name = ? AND ${SCHEMA_PREDICATE}
        ORDER BY fk.name, fkc.constraint_column_id`,
      [name.table, name.schema ?? null],
    ),
  );
  return rows.map((r) => ({
    columnName: String(r.column_name),
    referencedTable: String(r.referenced_table),
    referencedColumn: String(r.referenced_column),
    constraintName: String(r.constraint_name),
    ...(r.referenced_schema != null ? { referencedSchema: String(r.referenced_schema) } : {}),
  }));
}

/**
 * The table's indexes, keyed by name, columns in key order — what the upsert
 * conflict-target check reads. A filtered index is `partial`; `INCLUDE`d
 * columns are not key columns and are left out; a heap (`index_id = 0`) is no
 * index at all.
 */
export async function mssqlIndexes(knex: Knex, name: MssqlTableName): Promise<PhysicalIndex[]> {
  const rows = rowsOf(
    await knex.raw(
      `SELECT i.name AS index_name, i.is_unique, i.is_primary_key, i.has_filter, c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE i.index_id > 0 AND i.is_disabled = 0 AND ic.key_ordinal > 0 AND t.name = ? AND ${SCHEMA_PREDICATE}
        ORDER BY i.name, ic.key_ordinal`,
      [name.table, name.schema ?? null],
    ),
  );
  const byName = new Map<string, PhysicalIndex>();
  for (const r of rows) {
    const indexName = String(r.index_name);
    let entry = byName.get(indexName);
    if (!entry) {
      entry = { name: indexName, columns: [], unique: Boolean(r.is_unique), primary: Boolean(r.is_primary_key) };
      if (r.has_filter) entry.partial = true;
      byName.set(indexName, entry);
    }
    entry.columns.push(String(r.column_name));
  }
  return [...byName.values()];
}
