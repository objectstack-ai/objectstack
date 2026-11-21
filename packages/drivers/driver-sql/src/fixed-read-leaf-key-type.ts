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
 * - **No cast without a reading.** A table the catalog has not answered for
 *   (no door primed it, the read failed, the relation is not visible yet) is
 *   compiled as before: an integer or uuid key fails loudly (42883), but a
 *   `character(n)` key compares as text and misses a padded grant silently,
 *   which is why every door primes. A failed or empty read records nothing,
 *   so the next door asks again.
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

/** Per knex client: the physical table's key → each column's cast, `null` for none. */
const castsByClient = new WeakMap<object, Map<string, ReadonlyMap<string, FixedReadLeafKeyCast | null>>>();

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

function cacheOf(client: object): Map<string, ReadonlyMap<string, FixedReadLeafKeyCast | null>> {
  let cache = castsByClient.get(client);
  if (cache === undefined) {
    cache = new Map();
    castsByClient.set(client, cache);
  }
  return cache;
}

/**
 * Whether a catalog name can be spelled as one `??` identifier binding: knex
 * splits an identifier on `.` and on ` as `, so a name holding either is not
 * cast (the statement then compiles as before and fails loudly).
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
 */
export async function primeFixedReadLeafKeyTypes(source: FixedReadLeafKeySource, object: string, where: unknown): Promise<void> {
  const objects = new Set<string>();
  collectLeafKeyObjects(where, object, objects, new Set());
  for (const target of objects) {
    const builder = source.getBuilder(target) as Knex.QueryBuilder & { _single?: { table?: unknown; schema?: unknown } };
    const client = builder.client;
    if (client.dialect !== 'postgresql') return;
    const table = builder._single?.table;
    if (typeof table !== 'string') continue;
    const schema = typeof builder._single?.schema === 'string' ? builder._single.schema : undefined;
    const cache = cacheOf(client);
    const key = tableKey(schema, table);
    if (cache.has(key)) continue;
    let rows: { column_name: string; type_schema: string; type_name: string }[];
    try {
      const relation = schema === undefined ? `format('%I', ?::text)` : `format('%I.%I', ?::text, ?::text)`;
      const bindings = schema === undefined ? [table] : [schema, table];
      const result = await client.raw(COLUMN_BASE_TYPES_SQL.replace('%RELATION%', relation), bindings);
      rows = result.rows;
    } catch {
      // A catalog that cannot be read records nothing: the statement compiles
      // as before, and the next door asks again.
      continue;
    }
    // No row: the relation is not visible to this session (yet). Nothing is recorded.
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const columns = new Map<string, FixedReadLeafKeyCast | null>();
    for (const row of rows) {
      const uncast = UNCAST_BASE_TYPES.has(`${row.type_schema}.${row.type_name}`)
        || !bindableIdentifier(row.type_schema)
        || !bindableIdentifier(row.type_name);
      columns.set(row.column_name, uncast ? null : Object.freeze({ schema: row.type_schema, type: row.type_name }));
    }
    cache.set(key, columns);
  }
}

/**
 * The cast {@link primeFixedReadLeafKeyTypes} recorded for `column` of the
 * physical table `schema.table` on this knex client, or `null`: no reading,
 * or a text key, which takes no cast.
 */
export function fixedReadLeafKeyCast(
  client: object,
  schema: string | undefined,
  table: string,
  column: string,
): FixedReadLeafKeyCast | null {
  return castsByClient.get(client)?.get(tableKey(schema, table))?.get(column) ?? null;
}

/** The inner read's projection under a cast: `CAST(NULLIF(record_id, '') AS "schema"."type")`. */
export function castFixedReadLeafColumn(knexInstance: Knex, column: string, cast: FixedReadLeafKeyCast): Knex.Raw {
  return knexInstance.raw(`CAST(NULLIF(??, '') AS ??.??)`, [column, cast.schema, cast.type]);
}
