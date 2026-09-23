// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The REMOTE-mode backfill for cells the pre-#19844 batch door stored without
 * the write codec: a `Field.date` stored as a full timestamp, and a `Field.json`
 * scalar stored without its JSON encoding.
 *
 * ## Where the cells came from
 *
 * Before #19844, `TursoDriver.syncSchemasBatch` — the door the engine's boot
 * sync takes on this driver — ran the remote DDL and registered no field types.
 * `formatInput` reads those registries, so on every object a remote app synced
 * at boot it converted nothing: a `date` reached `RemoteTransport.serializeValue`
 * as the caller wrote it (a `Date` became its `toISOString()`), and a scalar
 * `json` value reached the wire bare. The door is fixed; this module converges
 * the cells it left behind.
 *
 * ## The one rule: rewrite only a cell whose READ is already settled
 *
 * A cell is rewritten only when the value the fixed driver READS from it today
 * is already determined by its stored text, and the fixed WRITE door stores that
 * value in exactly one form. The rewrite puts that form on disk. So a converted
 * cell reads back byte-for-byte what it read before. What changes is what a
 * FILTER compares against, since the stored form is now the canonical one. No
 * read is repaired here, because repairing a read would mean knowing a value
 * the disk no longer holds.
 *
 * Measured on the `libsql` SQLite double (`makeLibsqlSqliteStub`). Cells were
 * written through the pre-fix arm (`RemoteTransport.syncSchemasBatch` alone)
 * and read through the fixed driver:
 *
 * | written | stored (double) | stored (Turso wire) | fixed read | fixed door stores | rewritten |
 * |---|---|---|---|---|---|
 * | json `'hello'` | TEXT `hello` | TEXT `hello` | `'hello'` | `"hello"` | yes |
 * | json `''` | TEXT (empty) | TEXT (empty) | `''` | `""` | yes |
 * | json `true` | TEXT `1.0` | TEXT `1` | `1` | `true` | no, ambiguous |
 * | json `false` | TEXT `0.0` | TEXT `0` | `0` | `false` | no, ambiguous |
 * | json `1` / `0` / `42` | TEXT `1.0` / `0.0` / `42.0` | the same | `1` / `0` / `42` | `1` / `0` / `42` | no, ambiguous |
 * | json `'42'` | TEXT `42` | TEXT `42` | `42` | `"42"` | no, ambiguous |
 * | json `'true'` | TEXT `true` | TEXT `true` | `true` | `"true"` | no, ambiguous |
 * | json `null` | NULL | NULL | `null` | NULL | already canonical |
 * | date `Date` / `…Z` / `±HH:MM` / zone-naive / padded | TEXT full timestamp | the same | its `YYYY-MM-DD` | its `YYYY-MM-DD` | yes |
 *
 * The json column is TEXT affinity (`RemoteTransport.mapFieldTypeToSQL`), so
 * every scalar lands as TEXT and `typeof` separates nothing. The text itself
 * separates only one class.
 *
 * - **Text that does not parse as JSON** is rewritten as its JSON string. Only a
 *   string could have produced it: `JSON.stringify` of an object or array
 *   always parses, and a number or boolean becomes numeric text. The fixed read
 *   already answers that string (`formatOutput`'s parse fallback), and the fixed
 *   door stores `JSON.stringify` of it. This is the class the local
 *   `SqlDriver.backfillCanonicalJsonEncoding` converts, for the same reason.
 * - **Text that parses** is left alone. `1` is what the fixed door writes for
 *   the number `1`, what the Turso wire made of a pre-fix `true` (a boolean is
 *   bound as INTEGER 1, which TEXT affinity stores as `1`), and what a pre-fix
 *   string `'1'` became. The bytes are identical, so no migration can tell
 *   which was written. `42` and `true` collide the same way with what the fixed
 *   door writes for the number `42` and the boolean `true`. These cells keep
 *   reading as their text parses. This is the class the ruling on the local
 *   json backfill accepts as unrecoverable.
 *
 * A `date` is a calendar day. The fixed door stores `SqlDriver.toDateOnly(value)`,
 * which takes the leading `YYYY-MM-DD` of a string after trimming it, and the UTC
 * day of a `Date`. The pre-fix door stored a string as sent and a `Date` as its
 * `toISOString()`, whose leading ten characters are that UTC day. So
 * `toDateOnly(stored)` is exactly what the fixed door stores for the original
 * input, and it is also what the fixed read already answers.
 *
 * ⚠️ That holds for a `Date` a caller built at LOCAL midnight too, and it is
 * still not the day the caller meant. `new Date(2025, 6, 28)` in UTC+8 is
 * `2025-07-27T16:00:00.000Z`. The fixed door stores it as `2025-07-27` (the
 * helper reads a `Date` on the UTC clock, see `SqlDriver.toDateOnly`). The
 * fixed read already answers `2025-07-27`, and this module writes `2025-07-27`.
 * The writer's zone was never stored, so no door can recover `2025-07-28`, and
 * this module does not try.
 *
 * ## Excluded on purpose
 *
 * - **Single-value media columns** (`image` / `file` / `avatar` / `video` /
 *   `audio`). Whether their canonical form is a JSON-quoted id or a bare one is
 *   an ADR-0104 deployment fact, and the remote schema doors never resolve it.
 *   Both encodings read the same, so leaving them costs nothing.
 * - **`datetime` / `time`** — `remote-canonical-backfill.ts` owns them.
 *
 * ## Exact by construction, not by a second definition
 *
 * The SQL here only PRE-FILTERS: it selects a superset of the cells that could
 * be rewritten, cheaply enough to run on every boot. There is one exception, in
 * the safe direction: a `date` text with an embedded NUL after the day. SQLite's
 * `length()` stops at the NUL, so that cell is never selected and stays as
 * stored. The decision and the new
 * value come from the driver's own codec, handed over rather than copied. That
 * is `JSON.parse` / `JSON.stringify` for json (the `formatOutput` / `formatInput`
 * json arms) and `SqlDriver.toDateOnly` for date. A cell the pre-filter selects
 * and the codec declines is left alone and counted in `rowsWithheld`. The one
 * known case is JSON nested deeper than SQLite's JSON depth limit, which
 * `json_valid()` rejects and `JSON.parse` reads. Rewriting that cell would turn
 * an array into a string.
 *
 * Each write is a compare-and-set on the text it was computed from, so a row
 * written concurrently between the read and the write is left alone.
 *
 * ## Batched, resumable, idempotent, quiet
 *
 * One `SELECT` per table per invocation measures every column of that table,
 * and all tables go out in one round-trip. On a converged database that probe
 * is the whole cost. A column with candidates is walked in `rowid` order,
 * `batchSize` rows per page and at most `maxBatches` pages per invocation. A
 * budget-stopped column is not marked, and the next invocation resumes it. A
 * rewritten cell is outside the pre-filter, so a second run writes nothing.
 * Nothing here throws. A failure is reported per column and leaves the cells as
 * they were. A migration must never take a boot down (ADR-0053 D-B3).
 */

import {
  assertSafeIdentifier,
  REMOTE_BACKFILL_DEFAULT_BATCH_SIZE,
  REMOTE_BACKFILL_DEFAULT_MAX_BATCHES,
  type RemoteBackfillClient,
  type RemoteBackfillLogger,
  type RemoteCanonicalBackfillOptions,
} from './remote-canonical-backfill.js';

/** Which codec a column is converged on. */
export type RemoteCodecResidueKind = 'date' | 'json';

/** A column to converge. */
export interface RemoteCodecResidueColumn {
  table: string;
  field: string;
  kind: RemoteCodecResidueKind;
}

/** The driver's write codec for `Field.date`, handed over rather than copied. */
export interface RemoteCodecResidueCodec {
  /** `SqlDriver.toDateOnly`, the conversion `formatInput` applies to a `date`. */
  toDateOnly: (value: string) => unknown;
}

/** What one column's pass did. */
export interface RemoteCodecResidueColumnReport extends RemoteCodecResidueColumn {
  /** Cells rewritten into the fixed door's form. */
  rowsConverted: number;
  /** Cells the pre-filter selected and the codec declined; left as stored. */
  rowsWithheld: number;
  /** The batch budget stopped the pass before it reached the last candidate. */
  budgetExhausted: boolean;
  /**
   * Every candidate the probe saw was either rewritten or declined, so there
   * is nothing left for this process to do. `false` on a budget stop or an
   * error.
   */
  done: boolean;
  /** Present when a statement failed; the column's cells are as they were. */
  error?: string;
}

export interface RemoteCodecResidueReport {
  columns: RemoteCodecResidueColumnReport[];
}

/**
 * The characters `String.prototype.trim` removes, which is what
 * `SqlDriver.toDateOnly` calls before it reads the leading day. The date
 * pre-filter left-trims the same set in SQL, so the pre-filter and the codec
 * select the same cells. `remote-codec-residue-backfill.test.ts` holds this
 * equal to the engine's own `trim` over the whole Basic Multilingual Plane.
 *
 * Written as escapes and BOUND as an argument, never inlined into SQL.
 */
export const JS_TRIM_CHARS =
  '\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004' +
  '\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';

interface SqlFragment {
  sql: string;
  args: unknown[];
}

/**
 * The pre-filter: a superset of the cells the codec could rewrite, with one
 * exception in the safe direction (the date bullet).
 *
 * - json: TEXT that SQLite's `json_valid()` rejects. `JSON.parse` then decides.
 * - date: TEXT longer than a bare day whose left-trimmed first ten characters
 *   are `YYYY-MM-DD`. That is when `toDateOnly` answers a different string,
 *   since its answer is those ten characters. The exception is a text with an
 *   embedded NUL after the day: SQLite's `length()` stops at the NUL, so the
 *   cell is not selected and stays as stored. `GLOB '[0-9]'` is ASCII
 *   digits, like the helper's `\d`.
 */
export function residueCandidateSql(kind: RemoteCodecResidueKind, columnSql: string): SqlFragment {
  if (kind === 'json') {
    return { sql: `typeof(${columnSql}) = 'text' and json_valid(${columnSql}) = 0`, args: [] };
  }
  return {
    sql:
      `typeof(${columnSql}) = 'text' and length(${columnSql}) > 10 ` +
      `and substr(ltrim(${columnSql}, ?), 1, 10) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    args: [JS_TRIM_CHARS],
  };
}

/**
 * What the fixed door stores for the value this cell already reads as, or
 * `null` when the cell must be left alone.
 */
export function recoverResidueCell(
  kind: RemoteCodecResidueKind,
  stored: string,
  codec: RemoteCodecResidueCodec,
): string | null {
  if (kind === 'json') {
    try {
      // It parses, so it reads as what it parses to: one of the ambiguous
      // classes, or a structure too deep for `json_valid()`. Never rewritten.
      JSON.parse(stored);
      return null;
    } catch {
      // Only a string produces unparseable text, and it reads back as itself.
      return JSON.stringify(stored);
    }
  }
  const day = codec.toDateOnly(stored);
  return typeof day === 'string' && day !== stored ? day : null;
}

const quote = (identifier: string): string => {
  assertSafeIdentifier(identifier);
  return `"${identifier}"`;
};

const readCount = (row: unknown, key: string): number => {
  const raw = (row as Record<string, unknown> | undefined)?.[key];
  return typeof raw === 'number' ? raw : Number(raw ?? 0) || 0;
};

/** One statement measuring every listed column of one table. */
function buildTableProbe(table: string, columns: RemoteCodecResidueColumn[]): SqlFragment {
  const args: unknown[] = [];
  const sums = columns.map((column, i) => {
    const candidate = residueCandidateSql(column.kind, quote(column.field));
    args.push(...candidate.args);
    return `sum(case when ${candidate.sql} then 1 else 0 end) as c${i}`;
  });
  return { sql: `select ${sums.join(', ')} from ${quote(table)}`, args };
}

/**
 * Walk one column's candidates in `rowid` order and rewrite what the codec
 * recovers. Returns the report; never throws.
 */
async function convergeColumn(
  client: RemoteBackfillClient,
  column: RemoteCodecResidueColumn,
  codec: RemoteCodecResidueCodec,
  batchSize: number,
  maxBatches: number,
): Promise<RemoteCodecResidueColumnReport> {
  const report: RemoteCodecResidueColumnReport = {
    ...column,
    rowsConverted: 0,
    rowsWithheld: 0,
    budgetExhausted: false,
    done: false,
  };
  try {
    const table = quote(column.table);
    const col = quote(column.field);
    const candidate = residueCandidateSql(column.kind, col);
    const pageSql =
      `select rowid as rid, ${col} as val from ${table} ` +
      `where rowid > ? and ${candidate.sql} order by rowid limit ?`;
    // Compare-and-set: the text this rewrite was computed from must still be
    // there, so a row written between the page read and here is left alone.
    const updateSql =
      `update ${table} set ${col} = ? where rowid = ? and typeof(${col}) = 'text' and ${col} = ?`;

    // Below any rowid SQLite assigns. `RemoteTransport` keys its tables on a
    // TEXT `id`, so `rowid` here is the implicit, auto-assigned one.
    let cursor: unknown = Number.MIN_SAFE_INTEGER;
    for (let page = 0; page < maxBatches; page++) {
      const res = await client.execute({ sql: pageSql, args: [cursor, ...candidate.args, batchSize] });
      const rows = res.rows as Array<Record<string, unknown>>;
      const writes: Array<{ sql: string; args: unknown[] }> = [];
      for (const row of rows) {
        const stored = row.val;
        const next = typeof stored === 'string' ? recoverResidueCell(column.kind, stored, codec) : null;
        if (next === null) report.rowsWithheld++;
        else writes.push({ sql: updateSql, args: [next, row.rid, stored] });
      }
      if (writes.length > 0) {
        const results = await client.batch(writes, 'write');
        for (const r of results) report.rowsConverted += r.rowsAffected ?? 0;
      }
      if (rows.length < batchSize) {
        report.done = true;
        return report;
      }
      cursor = rows[rows.length - 1].rid;
    }
    report.budgetExhausted = true;
    return report;
  } catch (err) {
    return { ...report, done: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Converge every given column: probe all of them in one round-trip, then walk
 * only the columns that have candidates.
 *
 * Never throws. A column whose probe or pass fails comes back with `error` set
 * and `done: false`, and its cells stay as they were.
 */
export async function backfillRemoteCodecResidueColumns(
  client: RemoteBackfillClient,
  columns: RemoteCodecResidueColumn[],
  codec: RemoteCodecResidueCodec,
  options: RemoteCanonicalBackfillOptions = {},
  logger?: RemoteBackfillLogger,
): Promise<RemoteCodecResidueReport> {
  if (columns.length === 0) return { columns: [] };
  const batchSize = Math.max(1, options.batchSize ?? REMOTE_BACKFILL_DEFAULT_BATCH_SIZE);
  const maxBatches = Math.max(1, options.maxBatches ?? REMOTE_BACKFILL_DEFAULT_MAX_BATCHES);

  const byTable = new Map<string, RemoteCodecResidueColumn[]>();
  for (const column of columns) {
    const list = byTable.get(column.table) ?? [];
    list.push(column);
    byTable.set(column.table, list);
  }
  const tables = [...byTable.keys()];

  // Per-table probe counts, or the error that stopped the probe.
  const probed = new Map<string, number[] | { error: string }>();
  const statements: Array<SqlFragment | null> = tables.map((table) => {
    try {
      return buildTableProbe(table, byTable.get(table)!);
    } catch (err) {
      probed.set(table, { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  });
  const runnable = tables.filter((_, i) => statements[i] !== null);
  const runnableStatements = statements.filter((s): s is SqlFragment => s !== null);
  const countsOf = (table: string, row: unknown) => byTable.get(table)!.map((_, i) => readCount(row, `c${i}`));
  if (runnableStatements.length > 0) {
    try {
      const results = await client.batch(runnableStatements, 'read');
      runnable.forEach((table, i) => probed.set(table, countsOf(table, results[i]?.rows?.[0])));
    } catch {
      // A batch is all-or-nothing; probe per table so one unreadable table
      // cannot hide the rest.
      for (let i = 0; i < runnable.length; i++) {
        try {
          const res = await client.execute(runnableStatements[i]);
          probed.set(runnable[i], countsOf(runnable[i], res.rows[0]));
        } catch (err) {
          probed.set(runnable[i], { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  const reports: RemoteCodecResidueColumnReport[] = [];
  for (const table of tables) {
    const counts = probed.get(table)!;
    const tableColumns = byTable.get(table)!;
    for (let i = 0; i < tableColumns.length; i++) {
      const column = tableColumns[i];
      if (!Array.isArray(counts)) {
        reports.push({
          ...column, rowsConverted: 0, rowsWithheld: 0, budgetExhausted: false, done: false, error: counts.error,
        });
        continue;
      }
      if (counts[i] === 0) {
        reports.push({ ...column, rowsConverted: 0, rowsWithheld: 0, budgetExhausted: false, done: true });
        continue;
      }
      reports.push(await convergeColumn(client, column, codec, batchSize, maxBatches));
    }
  }

  for (const report of reports) {
    const where = `${report.table}.${report.field}`;
    if (report.error) {
      logger?.warn(
        `[driver-turso] could not converge remote ${report.kind} storage for ${where}; ` +
          `its cells stay as they were and read the same`,
        { error: report.error },
      );
      continue;
    }
    if (report.rowsConverted > 0) {
      logger?.info?.(
        `[driver-turso] converged remote ${report.kind} storage for ${where} on the form the write path stores`,
        { rowsConverted: report.rowsConverted },
      );
    }
    if (report.budgetExhausted) {
      logger?.warn(
        `[driver-turso] remote ${report.kind} backfill for ${where} stopped on its batch budget; ` +
          `it resumes on the next schema sync`,
        { rowsConverted: report.rowsConverted },
      );
    }
    if (report.rowsWithheld > 0) {
      logger?.info?.(
        `[driver-turso] left ${report.rowsWithheld} ${report.kind} cell(s) of ${where} as stored: ` +
          `the write codec does not recover a different form for them`,
        { rowsWithheld: report.rowsWithheld },
      );
    }
  }

  return { columns: reports };
}
