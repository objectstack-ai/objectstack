// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D-0, D2, O2] The outer key's type, for a fixed-read leaf's inner
 * read on PostgreSQL.
 *
 * A `SharedRecordIds` leaf compiles to `field IN (SELECT record_id FROM
 * sys_record_share WHERE …)` (`fixed-read-leaf-compile.ts`). `record_id` is a
 * text column. Today's id list binds each member as a string the server types
 * by the column it meets, so `07` names the integer 7 and an upper-case uuid
 * names its lower-case twin. A column compared with a column gets no such
 * typing: PostgreSQL has no `integer = text` or `uuid = text` operator and
 * refuses the statement (42883), and a `character(n)` key is compared as text,
 * which drops the padding the list's comparison ignores (a silent miss).
 *
 * So, on PostgreSQL only, the inner read projects `record_id` cast to the
 * outer key column's BASE type (a domain resolved to the type under it), read
 * once per table from the catalog and cached (ruling 7051669729 on the O2
 * card, option A):
 *
 * ```sql
 * id IN (SELECT CAST(NULLIF(record_id, '') AS "pg_catalog"."int4") FROM sys_record_share WHERE …)
 * ```
 *
 * - **The same conversion as the list.** A text-to-type cast runs the type's
 *   input function, the one a string bound against the column runs, without
 *   the column's typmod (a bound parameter has none either), so `character(4)`
 *   is cast to `bpchar` and a long value is compared, never truncated. A
 *   malformed grant id (`abc` against an integer key) fails the statement as
 *   a list member does today (22P02), ⛔ never a silent miss.
 * - **`NULLIF(record_id, '')`.** The blank-id guard in the `WHERE` keeps an
 *   empty id out of the set; the `NULLIF` keeps the cast total on one even if
 *   a planner evaluates the projection first. NULL is in no `IN` set.
 * - **Text keys keep step 3's statement.** A `text` or `varchar` key (every
 *   table the platform manages) is cast to nothing: `record_id` already
 *   compares as the list's members do.
 * - **No reading, no statement.** On PostgreSQL a leaf compared with a table
 *   the catalog has not answered for is REFUSED, in ADR-0139 D3's envelope
 *   (`INTERNAL_ERROR` / 500, logged at `error` once per knex client), never
 *   compiled uncast. Uncast, `record_id` meets the key as text: an integer or
 *   uuid key fails (42883), but a `character(n)` key silently misses a padded
  *   grant, which ADR-0155 D2 forbids. "No reading" is kept apart from "read:
 *   a text key" (which takes no cast). A table has no reading when no door
 *   primed it, or when the catalog read failed or found no relation. A failed
 *   or empty read records nothing, so the next statement asks again. A type
 *   knex cannot spell as one identifier is refused the same way.
 * - **Read where the statement runs (ADR-0155 D-0).** A door running in the
 *   caller's transaction reads the catalog ON that transaction's connection,
 *   inside a savepoint (a knex nested transaction): it sees a table the
 *   transaction created, it needs no second pooled connection (a pool the
 *   transaction holds cannot time it out), and a failed read rolls back the
 *   savepoint alone, never the caller's transaction. That reading is kept
 *   for that transaction, and the savepoints derived from it, only (it may
 *   describe a table that never commits).
 *   A door with no transaction reads on the pool and keeps the reading for
 *   the knex client's life.
 *
 * ## When the catalog is read
 *
 * The filter compiler is synchronous, so the read happens before it: every
 * door that compiles a `where` calls {@link primeFixedReadLeafKeyTypes} beside
 * its other catalog primes (`primeMssqlGuidColumns`). It walks the `where`
 * for a leaf in a field's `$in` (in `aggregate`, its measure filters too); a
 * statement with none costs a walk and no read. For each object a leaf compares against (the door's own, and the
 * object of every composed `ReadableIds` leaf it sits under) it reads the
 * column types of that object's table, once per table for the life of the
 * driver's knex client. The key is the PHYSICAL table, as `getBuilder`
 * addresses it, so a re-bound external object meets its new table's entry.
 * Nothing invalidates an entry: the driver never changes a key column's type,
 * and DDL made elsewhere is not observable here (as with the Oracle and SQL
 * Server catalog primes). A key retyped elsewhere fails or compares as its
 * old type until restart.
 *
 * Every other dialect is untouched: SQLite compares by column affinity (the
 * same rows, measured on step 3), and MySQL, SQL Server and Oracle are named
 * as left in the O2 card's report.
 */

import type { Knex } from 'knex';
import { describeFixedReadLeaf, refuseFixedReadLeafOnce } from '@objectstack/core';
import type { ReadableIdsRefusalLog } from '@objectstack/core';
import { isComposedReadableIds, isFixedReadLeaf } from '@objectstack/spec/data';

/** The PostgreSQL type a leaf's inner read casts `record_id` to: the outer key's base type. */
export interface FixedReadLeafKeyCast {
  /** The type's schema (`pg_catalog` for a built-in type). */
  readonly schema: string;
  /** The type's catalog name (`int4`, `uuid`, `bpchar`), without a typmod. */
  readonly type: string;
}

/** What a door hands {@link primeFixedReadLeafKeyTypes}: its own `getBuilder`. */
export interface FixedReadLeafKeySource {
  getBuilder(object: string): Knex.QueryBuilder;
}

/** The caller's knex transaction, when a door's options carry one this module can open a savepoint on. */
function savepointHost(transaction: unknown): Knex.Transaction | undefined {
  // A knex transaction is a function object (it builds queries when called).
  if (transaction === null || (typeof transaction !== 'object' && typeof transaction !== 'function')) return undefined;
  return typeof (transaction as { transaction?: unknown }).transaction === 'function' ? (transaction as Knex.Transaction) : undefined;
}

/** A column whose base type knex cannot spell as one identifier: refused, never cast or left uncast. */
const UNSPELLABLE = Object.freeze({ unspellable: true as const });

/** One column's reading: the cast, `null` for a text key (no cast), or {@link UNSPELLABLE}. */
type ColumnReading = FixedReadLeafKeyCast | null | typeof UNSPELLABLE;

/** Per knex client: the physical table's key → each column's reading, read on the pool. A table with no entry has NO reading. */
const castsByClient = new WeakMap<object, Map<string, ReadonlyMap<string, ColumnReading>>>();

/** Per caller transaction: the readings taken on its own connection, which may describe tables it has not committed. */
const castsByTransaction = new WeakMap<object, Map<string, ReadonlyMap<string, ColumnReading>>>();

/**
 * A transaction's reading of a table, or one an ENCLOSING transaction took:
 * a savepoint derived from the caller's transaction (knex's
 * `parentTransaction`, as `attemptWithoutPoisoning` opens for the presumed
 * `updated_at` write) runs on the same connection and sees what its parent
 * sees, so the parent's reading holds there. Never the reverse: a reading a
 * savepoint took may describe a table that rolls back with it.
 */
function transactionReading(trx: Knex.Transaction, key: string): ReadonlyMap<string, ColumnReading> | undefined {
  const seen = new Set<object>();
  for (let at: Knex.Transaction | undefined = trx; at !== undefined && !seen.has(at); at = at.parentTransaction) {
    seen.add(at);
    const columns = castsByTransaction.get(at)?.get(key);
    if (columns !== undefined) return columns;
  }
  return undefined;
}

/** Per knex client: whether a no-reading refusal was logged (once per client, its own flag). */
const refusalLogByClient = new WeakMap<object, { logged: boolean }>();

/** Base types `record_id` (text) already compares as today's list members do. */
const UNCAST_BASE_TYPES = new Set(['pg_catalog.text', 'pg_catalog.varchar']);

/**
 * One catalog read per table: each live column's base type. A domain is
 * walked down to the type under it. `to_regclass` answers NULL for a relation
 * this session cannot see, so the read answers no row rather than an error.
 */
const COLUMN_BASE_TYPES_SQL = `
WITH RECURSIVE col AS (
  SELECT a.attname::text AS column_name, a.atttypid AS type_oid
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = to_regclass(%RELATION%) AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT col.column_name, t.typbasetype
    FROM col JOIN pg_catalog.pg_type t ON t.oid = col.type_oid
   WHERE t.typtype = 'd'
)
SELECT col.column_name, n.nspname::text AS type_schema, t.typname::text AS type_name
  FROM col
  JOIN pg_catalog.pg_type t ON t.oid = col.type_oid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
 WHERE t.typtype <> 'd'`;

function tableKey(schema: string | undefined, table: string): string {
  return JSON.stringify([schema ?? null, table]);
}

function cacheOf(owner: object, caches: WeakMap<object, Map<string, ReadonlyMap<string, ColumnReading>>> = castsByClient): Map<string, ReadonlyMap<string, ColumnReading>> {
  let cache = caches.get(owner);
  if (cache === undefined) {
    cache = new Map();
    caches.set(owner, cache);
  }
  return cache;
}

/**
 * Whether a catalog name can be spelled as one `??` identifier binding: knex
 * splits an identifier on `.` and on ` as `, so a name holding either cannot
 * be cast to, and a leaf compared with such a column is refused.
 */
function bindableIdentifier(name: string): boolean {
  return name.length > 0 && !name.includes('.') && !/\sas\s/i.test(name);
}

/**
 * Add to `out` every object whose key a fixed-read leaf in `node` is compared
 * with: `object` for a leaf in a field's `$in` at this level, and a composed
 * `ReadableIds` leaf's object for one inside its scope (the scope compiles
 * against that object's table). Over-collecting is harmless; a misplaced leaf
 * is refused by `applyFilters` before anything compiles.
 */
function collectLeafKeyObjects(node: unknown, object: string, out: Set<string>, seen: Set<object>): void {
  if (node === null || typeof node !== 'object' || isFixedReadLeaf(node)) return;
  if (seen.has(node)) return;
  seen.add(node);
  if (isComposedReadableIds(node)) {
    if (node.scope !== undefined) collectLeafKeyObjects(node.scope, node.object, out, seen);
    return;
  }
  if (Array.isArray(node)) {
    for (const member of node) collectLeafKeyObjects(member, object, out, seen);
    return;
  }
  const proto = Object.getPrototypeOf(node);
  if (proto !== Object.prototype && proto !== null) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$in' && isFixedReadLeaf(value)) out.add(object);
    else collectLeafKeyObjects(value, object, out, seen);
  }
}

/**
 * [ADR-0155 O2] Read, once per table, the column types of every table a
 * fixed-read leaf in `where` is compared with, so the filter compiler can
 * cast `record_id` to the key's base type (see the module docblock). A no-op
 * on every dialect but PostgreSQL, and for a `where` holding no leaf.
 * `options.transaction`, when present, is where the catalog is read: on the
 * caller's connection, inside a savepoint. While that savepoint is open, knex
 * runs the caller's other concurrent statements on the same transaction
 * inside it, so a catalog read that fails rolls back a concurrent write the
 * caller made on that transaction during the read.
 */
export async function primeFixedReadLeafKeyTypes(
  source: FixedReadLeafKeySource,
  object: string,
  where: unknown,
  options?: { readonly transaction?: unknown },
): Promise<void> {
  const objects = new Set<string>();
  collectLeafKeyObjects(where, object, objects, new Set());
  const trx = savepointHost(options?.transaction);
  for (const target of objects) {
    // No options: the root client is the cache's key, as the compile site reads it.
    const builder = source.getBuilder(target) as Knex.QueryBuilder & { _single?: { table?: unknown; schema?: unknown } };
    const client = builder.client;
    if (client.dialect !== 'postgresql') return;
    const table = builder._single?.table;
    if (typeof table !== 'string') continue;
    const schema = typeof builder._single?.schema === 'string' ? builder._single.schema : undefined;
    const key = tableKey(schema, table);
    if (cacheOf(client).has(key)) continue;
    if (trx !== undefined && transactionReading(trx, key) !== undefined) continue;
    let rows: { column_name: string; type_schema: string; type_name: string }[];
    try {
      const relation = schema === undefined ? `format('%I', ?::text)` : `format('%I.%I', ?::text, ?::text)`;
      const bindings = schema === undefined ? [table] : [schema, table];
      const sql = COLUMN_BASE_TYPES_SQL.replace('%RELATION%', relation);
      const result = trx === undefined
        ? await client.raw(sql, bindings)
        : await trx.transaction((savepoint) => savepoint.raw(sql, bindings));
      rows = result.rows;
    } catch {
      // A catalog that cannot be read records nothing: the leaf is refused
      // at compile (no reading), and the next door asks again. In a
      // transaction the savepoint, not the caller's transaction, rolled back.
      continue;
    }
    // No row: the relation is not visible to this session. Nothing is recorded.
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const columns = new Map<string, ColumnReading>();
    for (const row of rows) {
      let reading: ColumnReading;
      if (UNCAST_BASE_TYPES.has(`${row.type_schema}.${row.type_name}`)) reading = null;
      else if (!bindableIdentifier(row.type_schema) || !bindableIdentifier(row.type_name)) reading = UNSPELLABLE;
      else reading = Object.freeze({ schema: row.type_schema, type: row.type_name });
      columns.set(row.column_name, reading);
    }
    (trx === undefined ? cacheOf(client) : cacheOf(trx, castsByTransaction)).set(key, columns);
  }
}

/** What the compile does with `record_id` for one outer column, per {@link fixedReadLeafKeyReading}. */
export type FixedReadLeafKeyReading =
  | { readonly kind: 'cast'; readonly cast: FixedReadLeafKeyCast }
  | { readonly kind: 'uncast' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'unspellable' };

/**
 * What {@link primeFixedReadLeafKeyTypes} recorded for `column` of the
 * physical table `schema.table` on this knex client, or on `transaction`
 * (the caller's, when the door ran in one):
 *
 * - `cast`: a base type that is not text;
 * - `uncast`: a text or varchar key, or a column the read table does not
 *   have (the database then names the missing column itself);
 * - `unread`: no reading of the table at all;
 * - `unspellable`: a type knex cannot spell as one identifier.
 *
 * On PostgreSQL the last two are refused ({@link refuseFixedReadLeafKey}).
 */
export function fixedReadLeafKeyReading(
  client: object,
  schema: string | undefined,
  table: string,
  column: string,
  transaction?: unknown,
): FixedReadLeafKeyReading {
  const key = tableKey(schema, table);
  const trx = savepointHost(transaction);
  const columns = castsByClient.get(client)?.get(key) ?? (trx === undefined ? undefined : transactionReading(trx, key));
  if (columns === undefined) return { kind: 'unread' };
  const reading = columns.get(column);
  if (reading === undefined || reading === null) return { kind: 'uncast' };
  if (reading === UNSPELLABLE) return { kind: 'unspellable' };
  return { kind: 'cast', cast: reading as FixedReadLeafKeyCast };
}

/**
 * [ADR-0155 D2, O2] The refusal of a leaf compared with a column this driver
 * cannot type on PostgreSQL: ADR-0139 D3's envelope, `INTERNAL_ERROR` / 500,
 * logged at `error` once per knex client. The message names the leaf (by
 * name and table, never its recipient), the object and column, why, and the
 * remedy.
 */
export function refuseFixedReadLeafKey(
  evaluator: string,
  leaf: unknown,
  object: string | null,
  column: string,
  kind: 'unread' | 'unspellable',
  logger: ReadableIdsRefusalLog | undefined,
  client: object,
): Error {
  let state = refusalLogByClient.get(client);
  if (state === undefined) {
    state = { logged: false };
    refusalLogByClient.set(client, state);
  }
  const at = `the $in of column '${column}' of '${object ?? '(no object)'}'`;
  const why = kind === 'unread'
    ? 'whose type this driver holds no reading of from the PostgreSQL catalog: the catalog read failed '
      + '(on the pool, or in a savepoint on the caller\'s transaction, which stays usable), or found no such '
      + 'relation from the connection that read it'
    : 'whose type the PostgreSQL catalog names with a spelling this driver cannot bind as one identifier';
  const message = `${describeFixedReadLeaf(at, leaf)}, compared with a column ${why}. Uncast, record_id would `
    + 'meet the key as text, which fails on an integer or uuid key and silently misses a padded id on a '
    + 'character(n) key (ADR-0155 D2, O2). The statement was NOT run. The next statement reads the catalog '
    + 'again.';
  return refuseFixedReadLeafOnce(evaluator, message, logger, state, object ?? undefined);
}

/** The inner read's projection under a cast: `CAST(NULLIF(record_id, '') AS "schema"."type")`. */
export function castFixedReadLeafColumn(knexInstance: Knex, column: string, cast: FixedReadLeafKeyCast): Knex.Raw {
  return knexInstance.raw(`CAST(NULLIF(??, '') AS ??.??)`, [column, cast.schema, cast.type]);
}
