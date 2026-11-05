// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Schema sync never drops a table that holds rows.
 *
 * `initObjects` adopts an existing table by adding the columns the object
 * declares and it lacks — rows kept. One shape it cannot adopt that way: a
 * table keyed by `_id` with no `id` column, the storage key of the ObjectQL
 * driver this one was ported from. Every row this driver writes and reads is
 * keyed by `id`, so for that shape the sync rebuilds the table: drop, then
 * create it as the object declares. On an empty table that loses nothing and
 * still happens.
 *
 * On a table that holds rows the rebuild deleted them, with no warning. The
 * table did not have to be the platform's: a managed datasource over an
 * existing database is reached by storing an object whose name matches one of
 * its tables, and the save went on to answer success. So the rebuild is now
 * gated on the row count, and a table holding rows is refused instead — before
 * anything is written: no column added, no index built, no row touched. The
 * refusal names the table and the column, and says what the operator can do.
 *
 * It carries no ADR-0112 `code`. No door answers this refusal on the wire: the
 * metadata save door reports a refused schema sync in the server log at
 * `error` and answers the save (`ensureObjectStorage`), the boot sync and a
 * datasource connect do the same, and `os migrate apply` prints the message.
 * A code a driver stamps carries a row in the error-code ledger; this refusal
 * has no door to serve one through.
 */

/** Thrown by `SqlDriver.initObjects` (`sql-driver-rotation.ts`) — its one throw site. */
export class ExistingTableAdoptionRefusal extends Error {
  constructor(
    /** The existing table the sync was refused for. */
    readonly table: string,
    /** The column that makes its shape one the sync can only rebuild. */
    readonly column: string,
    /** How many rows it holds — never zero: an empty table is rebuilt. */
    readonly rows: number,
  ) {
    super(renderExistingTableAdoptionRefusal(table, column, rows));
    this.name = 'ExistingTableAdoptionRefusal';
  }
}

/**
 * The refusal's prose: what was refused and why, what was left alone, and the
 * three ways forward. Exported so the pins read the renderer the driver throws
 * through, never a copy of its text.
 */
export function renderExistingTableAdoptionRefusal(table: string, column: string, rows: number): string {
  return (
    `Schema sync REFUSED for the existing table '${table}': it has a '${column}' column and no 'id' column, ` +
    `and it holds ${rows} row${rows === 1 ? '' : 's'}. ObjectStack keys every row by 'id', so it could adopt ` +
    `this table only by dropping and recreating it, which would delete those rows. Nothing was changed: no ` +
    `column was added and no row was touched. To keep the rows and use the table, rename its '${column}' ` +
    `column to 'id' and save the object again; to read the table as it is, bind the object through a ` +
    `datasource whose schemaMode is 'external'; if the rows are not needed, empty the table and save again.`
  );
}
