// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';

/**
 * [#21243] The `sys_packages` table, spelled for the dialect of the driver it
 * lands on.
 *
 * Internal to this package (not re-exported from `index.ts`): the service is
 * the only reader, and its suites import this module directly.
 *
 * ## Why not a declared object on the driver's schema path — measured
 *
 * A declared object would have let the SQL driver's own schema sync write the
 * DDL. It cannot carry this table's key. Measured through `SqlDriver.syncSchema`
 * on SQLite (better-sqlite3), PostgreSQL 16.14 and MySQL 8.0.46, a declared
 * `sys_packages` comes out with `PRIMARY KEY (id)` alone on all three — the
 * driver's managed tables always key on `id` — and a second VERSION of one
 * package id is then refused (`SQLITE_CONSTRAINT_PRIMARYKEY`, `23505`,
 * `ER_DUP_ENTRY`). Over an EXISTING table the same sync keeps the old
 * `(id, version)` key and `TEXT` timestamps, so fresh and adopted databases
 * would disagree on the key. Carrying `(id, version)` that way needs a data
 * migration, so the table keeps its own DDL — spelled per dialect below.
 *
 * ## How `os migrate plan` / `apply` reach that DDL anyway (#23022)
 *
 * Not being an object kept the table off the managed migration path, so a
 * deployment that sets `OS_SKIP_SCHEMA_SYNC=1` ("use after running migrations
 * manually") had no documented way to get it. The plugin now DECLARES the table
 * in `init()`, the phase a migrate boot runs, as its `package.storage` service:
 * {@link probePackageTable} is the plan's read-only "is it there?", and
 * {@link ensurePackageTable} is what `apply` runs. These are the boot's own
 * statements, so a table `apply` creates is the one the boot creates.
 * Re-measured for that card on SQLite: a declared `sys_packages` still keys on
 * `id` alone (a second version refused, `SQLITE_CONSTRAINT_PRIMARYKEY`) and
 * types the timestamps `datetime`, while the same object adopted over an
 * existing table reports no drift — fresh and adopted databases would disagree.
 */

/**
 * The dialects `sys_packages` carries a statement set for. `'standard'` is the
 * set this service has always sent, which SQLite and PostgreSQL both run;
 * `'mysql'` is MySQL's own.
 */
export type PackageTableDialect = 'standard' | 'mysql';

/**
 * One dialect's statements for `sys_packages`.
 *
 * Only the statements whose SPELLING differs between dialects live here. The
 * reads (`get` / `list`) and the delete are one portable spelling each and stay
 * in the service.
 */
export interface PackageTableStatements {
  /** `CREATE TABLE IF NOT EXISTS` — native on every dialect, so an existing table is never an error. */
  readonly createTable: string;
  /**
   * The catalog read that answers "does `idx_packages_latest` exist?" — one
   * row means present, none means absent — or `undefined` when
   * {@link createLatestIndex} carries `IF NOT EXISTS` itself.
   */
  readonly latestIndexProbe?: string;
  /** The `idx_packages_latest` DDL. */
  readonly createLatestIndex: string;
  /** Insert-or-update of one `(id, version)` row; bindings: id, version, manifest, metadata, hash. */
  readonly upsert: string;
}

/**
 * The `sys_packages` statements, per dialect.
 *
 * ## Why a MySQL set exists — measured, not read
 *
 * On a live MySQL 8.0.46 the standard set fails four independent ways, each
 * masking the next, so fixing one alone only surfaces the following refusal:
 *
 *  - `created_at TEXT DEFAULT CURRENT_TIMESTAMP` → `ER_INVALID_DEFAULT` (MySQL
 *    takes `CURRENT_TIMESTAMP` as a default on a temporal column only);
 *  - `PRIMARY KEY (id, version)` over `TEXT` → `ER_BLOB_KEY_WITHOUT_LENGTH`;
 *  - `CREATE INDEX IF NOT EXISTS` → `ER_PARSE_ERROR` (no such clause);
 *  - the publish `INSERT … ON CONFLICT(id, version) DO UPDATE … excluded.x` →
 *    `ER_PARSE_ERROR` (MySQL's only upsert is `ON DUPLICATE KEY UPDATE`).
 *
 * So the table was never created on MySQL and every publish was refused.
 *
 * ## What the MySQL set keeps identical to the standard one
 *
 * The key — `PRIMARY KEY (id, version)`, several versions of one package side
 * by side — the column names, and what each column holds. The timestamps are
 * the `YYYY-MM-DD HH:MM:SS` UTC text SQLite's `CURRENT_TIMESTAMP` writes
 * (`UTC_TIMESTAMP()`, not the session-zone `NOW()`), so `get(id, 'latest')`'s
 * `ORDER BY created_at` compares one format. `id` and `version` use
 * `utf8mb4_bin` because the key compares bytes on SQLite and PostgreSQL, and
 * MySQL's default collation would fold `1.0.0-Beta` and `1.0.0-beta` into one
 * row. The two timestamp columns carry no default because MySQL refuses the
 * standard one on a text column and every write here supplies both.
 *
 * ⚠️ `… AS incoming ON DUPLICATE KEY UPDATE` needs MySQL 8.0.19+. The older
 * `VALUES(col)` spelling still runs on 8.0.46, with deprecation warning 1287
 * naming the alias form as its replacement.
 *
 * ## Why the standard set is byte-for-byte what shipped
 *
 * SQLite and PostgreSQL ran it correctly, and every existing `sys_packages`
 * table on both was created by it. One changed character would make a fresh
 * table differ from an adopted one on the dialects that never had the defect.
 */
export const PACKAGE_TABLE_STATEMENTS: Readonly<Record<PackageTableDialect, PackageTableStatements>> = {
  standard: {
    createTable: `
          CREATE TABLE IF NOT EXISTS sys_packages (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            manifest TEXT NOT NULL,
            metadata TEXT NOT NULL,
            hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id, version)
          )
        `,
    createLatestIndex: `
          CREATE INDEX IF NOT EXISTS idx_packages_latest
          ON sys_packages(id, created_at DESC)
        `,
    upsert: `
              INSERT INTO sys_packages (id, version, manifest, metadata, hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT(id, version) DO UPDATE SET
                manifest = excluded.manifest,
                metadata = excluded.metadata,
                hash = excluded.hash,
                updated_at = CURRENT_TIMESTAMP
            `,
  },
  mysql: {
    createTable: `
          CREATE TABLE IF NOT EXISTS sys_packages (
            id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            version VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            manifest LONGTEXT NOT NULL,
            metadata LONGTEXT NOT NULL,
            hash TEXT NOT NULL,
            created_at VARCHAR(32) NULL,
            updated_at VARCHAR(32) NULL,
            PRIMARY KEY (id, version)
          )
        `,
    latestIndexProbe: `
          SELECT 1 AS present FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = 'sys_packages'
            AND index_name = 'idx_packages_latest'
          LIMIT 1
        `,
    createLatestIndex: `
          CREATE INDEX idx_packages_latest
          ON sys_packages (id, created_at DESC)
        `,
    upsert: `
              INSERT INTO sys_packages (id, version, manifest, metadata, hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP()) AS incoming
              ON DUPLICATE KEY UPDATE
                manifest = incoming.manifest,
                metadata = incoming.metadata,
                hash = incoming.hash,
                updated_at = UTC_TIMESTAMP()
            `,
  },
};

/**
 * The table's columns, in the order every dialect's `createTable` declares
 * them — what a `create_table` line in `os migrate plan` lists (#23022).
 */
export const PACKAGE_TABLE_COLUMNS: readonly string[] = [
  'id', 'version', 'manifest', 'metadata', 'hash', 'created_at', 'updated_at',
];

/**
 * [#23022] The catalog read that answers "does `sys_packages` exist?", per
 * dialect name `SqlDriver.dialectName` answers with — one row means present,
 * none means absent. Each asks the schema the dialect's unqualified
 * `CREATE TABLE IF NOT EXISTS` would create the table in: SQLite's `main`,
 * PostgreSQL's `current_schema()`, MySQL's `DATABASE()`.
 */
const PRESENCE_PROBE_FOR_DRIVER_DIALECT: ReadonlyMap<string, string> = new Map<string, string>([
  ['sqlite', "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'sys_packages' LIMIT 1"],
  [
    'postgres',
    'SELECT 1 AS present FROM information_schema.tables '
      + "WHERE table_schema = current_schema() AND table_name = 'sys_packages' LIMIT 1",
  ],
  [
    'mysql',
    'SELECT 1 AS present FROM information_schema.tables '
      + "WHERE table_schema = DATABASE() AND table_name = 'sys_packages' LIMIT 1",
  ],
]);

/**
 * The statement set for each dialect name `SqlDriver.dialectName` answers
 * with. A name not in this table — `'unknown'`, or no answer at all — takes
 * `'standard'` (see {@link resolvePackageTableDialect}).
 */
const STATEMENT_SET_FOR_DRIVER_DIALECT: ReadonlyMap<string, PackageTableDialect> = new Map<string, PackageTableDialect>([
  ['sqlite', 'standard'],
  ['postgres', 'standard'],
  ['mysql', 'mysql'],
]);

/**
 * Which statement set the driver behind `objectql.execute()` takes.
 *
 * ## Asked of the driver, and of the RIGHT driver
 *
 * `SqlDriver.dialectName` is that driver's public answer to "which SQL do I
 * speak", published for readers outside the driver; `service-analytics` reads
 * it the same structural way. This package depends on no driver, so it reads
 * the member by name and reads nothing else — no connection string, no client
 * name, no error code.
 *
 * The driver asked is the DEFAULT one, because that is where every statement in
 * this service runs: the service calls `objectql.execute()` with no `object` /
 * `datasource` option, and `ObjectQL.execute` then routes to its default driver.
 * `getDriverForObject('sys_packages')` could name a different datasource under
 * a `datasourceMapping` rule, and the dialect would then describe a database
 * these statements never reach.
 *
 * ## What a driver that names no SQL dialect gets
 *
 * The standard set — what this service sent every driver before this change.
 * That covers `'unknown'` (a client the SQL driver does not model), a non-SQL
 * driver (memory, MongoDB) and a host or double with no driver registry. It is
 * not a guess that passes silently: a refusal now surfaces from `ensureTable`,
 * and a seam that answers nothing is the read guard's case (commit ab47f6974).
 *
 * Resolved per call and never cached, so no verdict is recorded that a later
 * driver registration could contradict.
 */
export function resolvePackageTableDialect(objectql: IDataEngine): PackageTableDialect {
  const named = defaultDriverDialectName(objectql);
  return (named === undefined ? undefined : STATEMENT_SET_FOR_DRIVER_DIALECT.get(named)) ?? 'standard';
}

/**
 * The `dialectName` the default driver answers with, or `undefined` when it
 * names none. The one read {@link resolvePackageTableDialect} and
 * {@link probePackageTable} share, for the reasons the former documents.
 */
function defaultDriverDialectName(objectql: IDataEngine): string | undefined {
  try {
    const driverName = objectql.getDefaultDriverName?.();
    const driver = driverName === undefined ? undefined : objectql.getDriverByName?.(driverName);
    const named = (driver as { dialectName?: unknown } | undefined)?.dialectName;
    return typeof named === 'string' ? named : undefined;
  } catch {
    // A registry or getter that throws names no dialect.
    return undefined;
  }
}

/**
 * [#23022] Does `sys_packages` exist on the database {@link ensurePackageTable}
 * writes to? Read-only: one catalog SELECT, never DDL. This is the question
 * `os migrate plan` asks before it lists the table as `create_table`.
 *
 * `undefined` means "could not tell", and it is never read as absent:
 *
 *  - the default driver names no dialect with a catalog probe (`'unknown'`, a
 *    non-SQL driver, a host with no driver registry), so no SQL is sent; or
 *  - the seam accepted the probe and returned no result set at all — the read
 *    guard's case (commit ab47f6974): a seam that cannot answer has not
 *    answered "absent".
 *
 * A probe the database REFUSES throws, whole.
 */
export async function probePackageTable(objectql: IDataEngine): Promise<boolean | undefined> {
  const named = defaultDriverDialectName(objectql);
  const probe = named === undefined ? undefined : PRESENCE_PROBE_FOR_DRIVER_DIALECT.get(named);
  if (probe === undefined) return undefined;
  const result = await objectql.execute!({ sql: probe });
  if (!isResultSet(result)) return undefined;
  return hasRows(result);
}

/** A raw SELECT's answer in one of the shapes the drivers return: rows, `{ rows }`, or mysql2's tuple. */
function isResultSet(result: unknown): boolean {
  if (Array.isArray(result)) return true;
  return Array.isArray((result as { rows?: unknown } | null | undefined)?.rows);
}

/** One row or more in a result set, across the shapes a raw SELECT returns. */
function hasRows(result: unknown): boolean {
  if (Array.isArray(result)) {
    // mysql2's `[rows, fields]` tuple: the first element is the row array.
    if (result.length > 0 && Array.isArray(result[0])) return result[0].length > 0;
    return result.length > 0;
  }
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Create `sys_packages` and `idx_packages_latest` when absent, in the dialect of
 * the driver they land on.
 *
 * ⛔ Nothing here catches a refusal. "Already exists" is never an error:
 * `CREATE TABLE IF NOT EXISTS` is native on every dialect, and the index is
 * created either with `IF NOT EXISTS` or after the dialect's own catalog says
 * it is absent. Any statement that throws is therefore a REAL refusal, and it
 * leaves this function whole for the plugin's `start()` to report.
 *
 * The one throw that is examined is a refused `CREATE INDEX` on a dialect that
 * probes: another process booting on the same database may have created the
 * index between the probe and the create. The catalog is asked again, and the
 * refusal stands unless the index is now there.
 */
export async function ensurePackageTable(objectql: IDataEngine): Promise<PackageTableDialect> {
  const dialect = resolvePackageTableDialect(objectql);
  const statements = PACKAGE_TABLE_STATEMENTS[dialect];
  const execute = (sql: string) => objectql.execute!({ sql });

  await execute(statements.createTable);

  const probe = statements.latestIndexProbe;
  if (probe === undefined) {
    await execute(statements.createLatestIndex);
    return dialect;
  }
  if (hasRows(await execute(probe))) return dialect;
  try {
    await execute(statements.createLatestIndex);
  } catch (refusal) {
    if (hasRows(await execute(probe))) return dialect;
    throw refusal;
  }
  return dialect;
}
