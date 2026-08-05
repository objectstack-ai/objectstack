// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Remote Transport for TursoDriver
 *
 * Implements IDataDriver CRUD operations using @libsql/client for
 * remote-only (libsql://, https://) connections. No local SQLite or
 * Knex dependency — all queries execute via HTTP/WebSocket against
 * the remote Turso database.
 *
 * This transport is used internally by TursoDriver when the connection
 * URL is a remote-only endpoint without a local file backend.
 */

import type { Client, InStatement, ResultSet } from '@libsql/client';
import { StandardErrorCode } from '@objectstack/spec/api';
import { nanoid } from 'nanoid';

/**
 * Default ID length for auto-generated IDs.
 */
const DEFAULT_ID_LENGTH = 16;

/**
 * Columns created unconditionally by syncSchema — skip when iterating fields.
 */
const BUILTIN_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

/**
 * Pattern for valid SQL identifiers (table and column names).
 * Prevents SQL injection in DDL statements where parameterized queries
 * are not supported (e.g. PRAGMA, CREATE TABLE, ALTER TABLE).
 */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Every filter operator `buildWhereSQL` compiles — the vocabulary this
 * transport CLAIMS to speak, and (since #1004) the exact set it accepts.
 *
 * It is the spec's `FieldOperatorsSchema` list minus `$between`, which the
 * driver lowers before the filter gets here (see {@link unsupportedOperator}),
 * plus `$regex`, which is not spec-declared but is what better-auth's adapter
 * emits for a substring search and what `SqlDriver` therefore compiles.
 */
const SUPPORTED_FILTER_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$contains',
  '$notContains',
  '$startsWith',
  '$endsWith',
  '$regex',
  '$null',
  '$exists',
] as const;

/**
 * Where the wildcard goes in a LIKE pattern: `contains` → `%v%`,
 * `starts` → `v%`, `ends` → `%v`.
 */
type LikeShape = 'contains' | 'starts' | 'ends';

/**
 * The SQL comparison each range operator compiles to. One table rather than one
 * arm apiece so the four share a single comparand-binding path (#1058) — the
 * operator is the ONLY thing that differs between them.
 */
const RANGE_SQL_OPERATOR: Record<string, string> = {
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
};

/**
 * The dialect's canonical FALSE, as a predicate (#1073).
 *
 * SQLite has no boolean literal, so the empty disjunction — `$or: []`, whose
 * boolean identity element is FALSE — is spelled as a constant comparison that
 * is false for every row. It is emitted rather than omitted because omitting it
 * says TRUE, which is the opposite answer. TRUE needs no such spelling: a WHERE
 * clause that is missing a conjunct already MEANS "no constraint".
 *
 * `$not` of a vacuously-TRUE sub-filter (`$not: {}`) is the second way to reach
 * it (#1076): `NOT TRUE` is FALSE, and FALSE has to be *written*.
 */
const SQL_FALSE = '1 = 0';

/**
 * Is this comparand the spec's cross-field marker, `{ $field: 'other_column' }`?
 *
 * Recognised only to give it a message of its own — it is refused either way
 * (see {@link RemoteTransport.uncompilableComparand}). Deliberately shallow: a
 * `$field` key is the whole marker per `FieldReferenceSchema`, and anything
 * carrying one is asking for a cross-field comparison whatever else it carries.
 */
function isFieldReference(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && '$field' in value;
}

/**
 * Is this value one `serializeComparand` binds AS A VALUE, even though `typeof`
 * calls it an object?
 *
 * The ONE list both halves of the filter path consult — the ROUTER (is this
 * field's comparand an operator map, or a value?) and the SERIALIZER (can this
 * comparand be bound?). Keeping it in one place is the whole fix for #1066: the
 * two questions had drifted, so a `Date` was "a bindable value" to
 * {@link RemoteTransport.serializeComparand} (its allow-list names it as this
 * transport's one declared object conversion) and "an operator map" to
 * `buildWhereSQL`'s routing test. Since `Object.entries(new Date())` is empty,
 * that map had no operators in it, the loop never ran, and `{ closed_at: date }`
 * compiled to a WHERE-less full table scan — the mirror of #1058's silent zero
 * rows, and worse, because the caller gets back the very rows the filter was
 * written to exclude.
 *
 * `Date` is the only entry today, matching the allow-list exactly. Adding an
 * object form there means adding it here, and the `value is Date` narrowing
 * makes the compiler say so.
 */
function isBindableObjectComparand(value: unknown): value is Date {
  return value instanceof Date;
}

/**
 * Is this field's comparand an operator map (`{ $gt: 18 }`) rather than a value?
 *
 * Every non-array object EXCEPT the value forms above — including plain objects
 * with no `$` keys, which reach the operator loop and are refused there by name
 * (#1004) rather than being quietly read as equality comparands.
 */
function isOperatorMap(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isBindableObjectComparand(value)
  );
}

/**
 * Is this a filter NODE — the record shape `$and`/`$or` elements must have?
 *
 * A plain record, i.e. `{…}` / `Object.create(null)`. Not a `Date`, not a typed
 * array, not a class instance, not an array, not `null`, not a scalar.
 *
 * The narrowness is the point (#1073). A sub-filter that compiles to no SQL is
 * read as the branch's identity element (TRUE), so "compiles to nothing" has to
 * be provable from the INPUT rather than inferred from the output. Every form
 * excluded here has own-enumerable-key behaviour that would make it compile to
 * nothing *by accident* — `Object.entries(new Date())` and
 * `Object.entries(new Uint8Array([]))` are both `[]`, which is how #1066
 * happened one level down — and "accidentally empty" read as TRUE is the full
 * table scan this fix exists to prevent. Refusing them by FORM keeps the two
 * cases apart with no guessing.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** How long a refused comparand may be echoed back in an error message. */
const COMPARAND_PREVIEW_LIMIT = 120;

/**
 * The refused comparand, as written, for the error message — truncated, because
 * a filter value can be arbitrarily large and an error is read in a log.
 */
function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    // Cyclic or otherwise unserialisable — the shape is what matters here.
    text = Object.prototype.toString.call(value);
  }
  return text.length > COMPARAND_PREVIEW_LIMIT ? `${text.slice(0, COMPARAND_PREVIEW_LIMIT)}…` : text;
}

/** A human name for the refused comparand's FORM (`an array`, `an object`, …). */
function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return 'a binary buffer';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/**
 * A filter this transport refuses to COMPILE, in the ADR-0112 envelope (#1116).
 *
 * Every refusal below — #1004's unknown operator, #1058's unbindable comparand,
 * #1066/#1071's empty operator map, #1073/#1076's non-node sub-filter, #1075's
 * non-node top-level `where`, and now #1116's non-boolean `$null` — describes
 * the SAME condition: the caller sent a filter this transport cannot compile.
 * Each of them threw a bare `Error`, so `code` and `status` were `undefined`
 * and the wire identity of the refusal was carried by ENGLISH PROSE alone.
 *
 * That is the gap this closes. `mapDataError` reads `error.code` / `error.status`
 * to build the response envelope; with neither set, these fell through to its
 * default branch and shipped `{ "error": "<message>" }` with no `code` at all —
 * while the framework twins that refuse the very same shapes (`driver-sql`,
 * `driver-sqlite-wasm`, `driver-memory`, `driver-mongodb`) all speak
 * `INVALID_FILTER` / 400 (objectstack#4436, #5368). One condition answered by
 * two spellings depending on whether the driver was local or remote is the same
 * class of local/remote fork #1075/#1076/#1116 exist to close, one layer up:
 * a caller could not branch on the refusal without string-matching it, and a
 * refusal only a human reading a log can classify is not much better than a
 * wrong answer.
 *
 * `INVALID_FILTER` is the catalogued `StandardErrorCode` for the condition and
 * the one `metadata-protocol` already emits for a filter that fails to parse
 * upstream — one condition, one wire code, however the caller reached it. The
 * enum member is referenced rather than the string literal so that a rename in
 * `@objectstack/spec` breaks this build instead of silently shipping a code the
 * schema no longer knows.
 *
 * `status: 400` is the other half: it puts the rejection on `@objectstack/rest`'s
 * `isExpectedQueryRejection` list, so a client's malformed filter stops being
 * logged as an unhandled SERVER error once per request.
 *
 * The `[RemoteTransport]` prefix on the existing messages is deliberately left
 * as it is — #1116 asked for the missing `code`/`status`, and rewording six
 * shipped refusals is a separate, user-visible change. (framework dropped its
 * `[sql-driver]` prefix when it did this same work; that this transport still
 * carries one is noted in #1116 and belongs with the rest of #1077's envelope
 * pass, not here.)
 */
function invalidFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * How a filtered column must be READ so it is in the same storage form the
 * comparand was coerced into — the column half of the driver's temporal seam
 * (`SqlDriver.temporalFilterColumnSql`), injected by TursoDriver.
 *
 * Takes the already-quoted column reference this transport was going to emit
 * and returns the SQL to emit instead. Returning it unchanged is the answer for
 * every column whose stored form already matches the comparand.
 */
export type FilterColumnSqlResolver = (
  object: string,
  field: string,
  columnSql: string,
) => string;

/**
 * Remote transport that executes all queries via @libsql/client.
 *
 * Handles SQL generation, filter compilation, and result mapping for
 * remote-only Turso connections. Designed to be used as a delegate
 * inside TursoDriver — not exposed directly to users.
 */
export class RemoteTransport {
  private client: Client | null = null;

  /**
   * Factory function for lazy (re)connection.
   *
   * When set, `ensureConnected()` will invoke this factory to create a
   * @libsql/client instance on-demand — recovering from cold-start failures,
   * transient network errors, or serverless recycling without requiring the
   * caller to explicitly call `connect()` again.
   */
  private connectFactory: (() => Promise<Client>) | null = null;

  /**
   * Tracks whether a lazy-connect attempt is already in progress to prevent
   * concurrent reconnection storms under high concurrency.
   */
  private connectPromise: Promise<Client> | null = null;

  /**
   * The driver's storage-form rule for a filtered column — see
   * {@link setFilterColumnSql}. Absent (the default) means "the plain
   * identifier is already correct", which is what every non-temporal column
   * and every backfilled one resolves to anyway.
   */
  private filterColumnSql: FilterColumnSqlResolver | null = null;

  /**
   * Set the @libsql/client instance used for all queries.
   */
  setClient(client: Client): void {
    this.client = client;
  }

  /**
   * Register a factory function for lazy (re)connection.
   *
   * TursoDriver calls this during construction so that the transport can
   * self-heal when the initial `connect()` call fails or when the client
   * becomes unavailable (e.g., serverless cold-start, transient error).
   */
  setConnectFactory(factory: () => Promise<Client>): void {
    this.connectFactory = factory;
  }

  /**
   * Register the driver's rule for reading a filtered column in the same
   * storage form the comparand was coerced into.
   *
   * The comparand half of that pair already goes through the driver
   * (`temporalFilterValue`, applied in `TursoDriver.toRemoteFilter` before the
   * filter reaches this class). Its own docs say coercing the value is
   * "necessary but NOT sufficient — a caller that binds `temporalFilterValue`
   * must wrap its column with this too, or it keeps half the bug": a column
   * that still holds PRE-convention values (a zone-naive `datetime('now')`
   * default, an offset-bearing string, a full ISO timestamp in a `Field.time`
   * column) only compares correctly once the column is read through the
   * driver's repair expression.
   *
   * This transport does not decide when that applies — it asks. Keeping the
   * rule on the driver side is the point of ADR-0053 D-A1: one dialect-aware
   * implementation, never a second one re-derived from the value's shape.
   */
  setFilterColumnSql(resolver: FilterColumnSqlResolver): void {
    this.filterColumnSql = resolver;
  }

  /**
   * Get the current @libsql/client instance.
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Close the client and release resources.
   */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  // ===================================
  // Health Check
  // ===================================

  async checkHealth(): Promise<boolean> {
    try {
      const client = await this.ensureConnected();
      await client.execute('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ===================================
  // Raw Execution
  // ===================================

  async execute(command: unknown, params?: unknown[]): Promise<unknown> {
    await this.ensureConnected();
    if (typeof command !== 'string') return command;

    const stmt: InStatement = params && params.length > 0
      ? { sql: command, args: params as any[] }
      : command;

    const result = await this.client!.execute(stmt);
    return result.rows;
  }

  // ===================================
  // CRUD Operations
  // ===================================

  async find(object: string, query: any): Promise<Record<string, unknown>[]> {
    await this.ensureConnected();

    const { sql, args } = this.buildSelectSQL(object, query);

    try {
      const result = await this.client!.execute({ sql, args });
      return this.mapRows(result);
    } catch (error: any) {
      const isUnknownColumn =
        error.message &&
        (error.message.includes('no such column') ||
          (error.message.includes('column') && error.message.includes('does not exist')));
      if (isUnknownColumn) {
        // A `$select` projection naming a column the table lacks (e.g. a
        // generic list view auto-requesting status/due_date/image on an object
        // without them) makes the WHOLE query fail. Swallowing that into an
        // empty result — the old behavior — reads to the UI as "no records
        // exist" even though the rows are there: a silent data-loss footgun
        // that left published AI-built apps looking empty. When the failure
        // came from the projection, retry once selecting all columns so the
        // real rows still come back; the unknown field is simply absent from
        // each row (it never existed). Mirrors the SqlDriver backstop — the
        // remote Turso path overrides find(), so it needs its own copy.
        if (query?.fields && Array.isArray(query.fields) && query.fields.length > 0) {
          try {
            const fallback = this.buildSelectSQL(object, { ...query, fields: undefined });
            const result = await this.client!.execute({ sql: fallback.sql, args: fallback.args });
            return this.mapRows(result);
          } catch {
            return [];
          }
        }
        return [];
      }
      throw error;
    }
  }

  /**
   * An id lookup is spelled as the query it is: `{ where: { id } }`.
   *
   * This used to carry an extra `typeof query === 'string' | 'number'` branch
   * that ran its own `WHERE id = ?`. framework#4311 removed the identical
   * undeclared branch from `SqlDriver.findOne`, which left `TursoDriver`
   * answering the SAME call two ways — remote resolved the id, local silently
   * returned `null` — a divergence no caller could see until a row went
   * missing. Neither the contract nor any caller outside these tests spelled it
   * that way, so the branch is gone here too: one driver, one spelling.
   */
  async findOne(object: string, query: any): Promise<Record<string, unknown> | null> {
    if (query && typeof query === 'object') {
      const results = await this.find(object, { ...query, limit: 1 });
      return results[0] || null;
    }

    return null;
  }

  // `findStream` retired with the contract method in spec 17.0.0
  // (objectstack#4484). It read the whole result set through `find()` before
  // yielding, so it never streamed anything either; its only caller was
  // `TursoDriver.findStream`, which went at the same time.

  async aggregate(object: string, query: any): Promise<Record<string, unknown>[]> {
    await this.ensureConnected();
    this.assertSafeIdentifier(object);

    const selectParts: string[] = [];
    const groupBy: string[] = Array.isArray(query?.groupBy) ? query.groupBy : [];

    for (const field of groupBy) {
      this.assertSafeIdentifier(field);
      selectParts.push(`"${field}"`);
    }

    const aggregations = query?.aggregations || query?.aggregate || [];
    for (const agg of aggregations) {
      const funcRaw = String(agg.function || agg.func || '').toLowerCase();
      if (!['count', 'sum', 'avg', 'min', 'max'].includes(funcRaw)) {
        throw new Error(`Unsupported aggregate function: ${funcRaw}`);
      }
      const field = agg.field || '*';
      let fieldSql: string;
      if (field === '*') {
        fieldSql = '*';
      } else {
        this.assertSafeIdentifier(field);
        fieldSql = `"${field}"`;
      }
      const alias = agg.alias || `${funcRaw}_${field === '*' ? 'all' : field}`;
      this.assertSafeIdentifier(alias);
      selectParts.push(`${funcRaw}(${fieldSql}) AS "${alias}"`);
    }

    if (selectParts.length === 0) selectParts.push('*');

    let sql = `SELECT ${selectParts.join(', ')} FROM "${object}"`;
    const args: any[] = [];

    const { whereClauses, args: whereArgs } = this.buildWhereSQL(object, query?.where);
    if (whereClauses) {
      sql += ` WHERE ${whereClauses}`;
      args.push(...whereArgs);
    }

    if (groupBy.length > 0) {
      sql += ` GROUP BY ${groupBy.map((f) => `"${f}"`).join(', ')}`;
    }

    try {
      const result = await this.client!.execute({ sql, args });
      return this.mapRows(result);
    } catch (error: any) {
      if (
        error.message &&
        (error.message.includes('no such table') ||
          error.message.includes('no such column'))
      ) {
        return [];
      }
      throw error;
    }
  }

  async create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureConnected();

    const { _id, ...rest } = data as any;
    const toInsert = { ...rest };

    if (_id !== undefined && toInsert.id === undefined) {
      toInsert.id = _id;
    } else if (toInsert.id === undefined) {
      toInsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    const columns = Object.keys(toInsert);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => this.serializeValue(toInsert[col]));

    const sql = `INSERT INTO "${object}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    await this.client!.execute({ sql, args: values });

    // Fetch the inserted row to return complete record
    const result = await this.client!.execute({
      sql: `SELECT * FROM "${object}" WHERE "id" = ?`,
      args: [toInsert.id],
    });
    const rows = this.mapRows(result);
    return rows[0] || toInsert;
  }

  async update(object: string, id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureConnected();

    const columns = Object.keys(data);
    const setClauses = columns.map((col) => `"${col}" = ?`).join(', ');
    const values = columns.map((col) => this.serializeValue(data[col]));

    const sql = `UPDATE "${object}" SET ${setClauses} WHERE "id" = ?`;
    await this.client!.execute({ sql, args: [...values, id] });

    // Fetch updated row
    const result = await this.client!.execute({
      sql: `SELECT * FROM "${object}" WHERE "id" = ?`,
      args: [id],
    });
    const rows = this.mapRows(result);
    return rows[0] || { id, ...data };
  }

  async upsert(object: string, data: Record<string, unknown>, conflictKeys?: string[]): Promise<Record<string, unknown>> {
    await this.ensureConnected();

    const { _id, ...rest } = data as any;
    const toUpsert = { ...rest };

    if (_id !== undefined && toUpsert.id === undefined) {
      toUpsert.id = _id;
    } else if (toUpsert.id === undefined) {
      toUpsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    const columns = Object.keys(toUpsert);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => this.serializeValue(toUpsert[col]));
    const mergeKeys = conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'];

    // Build ON CONFLICT ... DO UPDATE SET
    const updateCols = columns.filter((c) => !mergeKeys.includes(c));
    const updateClauses = updateCols.map((col) => `"${col}" = excluded."${col}"`).join(', ');

    let sql = `INSERT INTO "${object}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    sql += ` ON CONFLICT(${mergeKeys.map((k) => `"${k}"`).join(', ')})`;
    if (updateClauses) {
      sql += ` DO UPDATE SET ${updateClauses}`;
    } else {
      sql += ` DO NOTHING`;
    }

    await this.client!.execute({ sql, args: values });

    // Fetch the result row
    const result = await this.client!.execute({
      sql: `SELECT * FROM "${object}" WHERE "id" = ?`,
      args: [toUpsert.id],
    });
    const rows = this.mapRows(result);
    return rows[0] || toUpsert;
  }

  async delete(object: string, id: string | number): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.client!.execute({
      sql: `DELETE FROM "${object}" WHERE "id" = ?`,
      args: [id],
    });
    return result.rowsAffected > 0;
  }

  async count(object: string, query?: any): Promise<number> {
    await this.ensureConnected();

    const { whereClauses, args } = this.buildWhereSQL(object, query?.where);
    let sql = `SELECT COUNT(*) as count FROM "${object}"`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args });
    if (result.rows.length > 0) {
      // Use result.columns to find the count column dynamically
      const row = result.rows[0] as any;
      const countCol = result.columns.find((c) => c.toLowerCase().includes('count'));
      return Number(countCol ? row[countCol] : row.count ?? 0);
    }
    return 0;
  }

  // ===================================
  // Bulk Operations
  // ===================================

  async bulkCreate(object: string, dataArray: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (const data of dataArray) {
      const created = await this.create(object, data);
      results.push(created);
    }
    return results;
  }

  async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, unknown> }>): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (const { id, data } of updates) {
      const updated = await this.update(object, id, data);
      if (updated) results.push(updated);
    }
    return results;
  }

  async bulkDelete(object: string, ids: Array<string | number>): Promise<void> {
    await this.ensureConnected();
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    await this.client!.execute({
      sql: `DELETE FROM "${object}" WHERE "id" IN (${placeholders})`,
      args: ids as any[],
    });
  }

  async updateMany(object: string, query: any, data: Record<string, unknown>): Promise<number> {
    await this.ensureConnected();

    const columns = Object.keys(data);
    const setClauses = columns.map((col) => `"${col}" = ?`).join(', ');
    const setValues = columns.map((col) => this.serializeValue(data[col]));

    const { whereClauses, args: whereArgs } = this.buildWhereSQL(object, query?.where);
    let sql = `UPDATE "${object}" SET ${setClauses}`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args: [...setValues, ...whereArgs] });
    return result.rowsAffected;
  }

  async deleteMany(object: string, query: any): Promise<number> {
    await this.ensureConnected();

    const { whereClauses, args } = this.buildWhereSQL(object, query?.where);
    let sql = `DELETE FROM "${object}"`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args });
    return result.rowsAffected;
  }

  // ===================================
  // Transactions
  // ===================================

  async beginTransaction(): Promise<any> {
    await this.ensureConnected();
    return this.client!.transaction();
  }

  async commit(transaction: any): Promise<void> {
    await transaction.commit();
  }

  async rollback(transaction: any): Promise<void> {
    await transaction.rollback();
  }

  // ===================================
  // Schema Management
  // ===================================

  async syncSchema(object: string, schema: any): Promise<void> {
    await this.ensureConnected();

    const objectDef = schema as { name: string; fields?: Record<string, any> };
    const tableName = object;
    this.assertSafeIdentifier(tableName);

    // Check if table exists
    const checkResult = await this.client!.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      args: [tableName],
    });
    const exists = checkResult.rows.length > 0;

    if (!exists) {
      await this.client!.execute(this.buildCreateTableSQL(tableName, objectDef));
    } else {
      // ALTER TABLE — add missing columns
      if (objectDef.fields) {
        const columnsResult = await this.client!.execute({
          sql: `PRAGMA table_info("${tableName}")`,
          args: [],
        });
        const existingColumns = new Set(columnsResult.rows.map((r: any) => r.name));

        for (const [name, field] of Object.entries(objectDef.fields)) {
          if (existingColumns.has(name)) continue;
          const type = (field as any).type || 'string';
          if (type === 'formula') continue; // Virtual — no column
          this.assertSafeIdentifier(name);
          const colType = this.mapFieldTypeToSQL(field);
          await this.client!.execute(`ALTER TABLE "${tableName}" ADD COLUMN "${name}" ${colType}`);
        }
      }
    }
  }

  /**
   * Batch-synchronize multiple object schemas using batched libsql calls.
   *
   * Collects all DDL statements (CREATE TABLE / ALTER TABLE ADD COLUMN)
   * for every schema and uses `client.batch()` to minimize network
   * round-trips. The process may perform up to three batch calls:
   * one to introspect existing tables, one to introspect columns for
   * existing tables, and one to apply DDL statements.
   *
   * This method does not implement an internal fallback to sequential
   * `syncSchema()`. Any fallback behavior is expected to be handled
   * by the caller if a batch operation is not supported or fails.
   */
  async syncSchemasBatch(schemas: Array<{ object: string; schema: any }>): Promise<void> {
    await this.ensureConnected();
    if (schemas.length === 0) return;

    // Validate all identifiers up-front
    for (const s of schemas) {
      this.assertSafeIdentifier(s.object);
    }

    // Phase 1: introspect all tables in one batch
    const introspectStmts: InStatement[] = schemas.map((s) => ({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      args: [s.object],
    }));
    const introspectResults = await this.client!.batch(introspectStmts, 'read');

    // Separate new tables from existing tables
    const newSchemas: Array<{ object: string; schema: any }> = [];
    const existingSchemas: Array<{ object: string; schema: any }> = [];

    for (let i = 0; i < schemas.length; i++) {
      if (introspectResults[i].rows.length > 0) {
        existingSchemas.push(schemas[i]);
      } else {
        newSchemas.push(schemas[i]);
      }
    }

    // Phase 2a: build CREATE TABLE statements for new tables
    const ddlStatements: InStatement[] = [];

    for (const { object, schema } of newSchemas) {
      const objectDef = schema as { name: string; fields?: Record<string, any> };
      ddlStatements.push(this.buildCreateTableSQL(object, objectDef));
    }

    // Phase 2b: for existing tables, introspect columns in one batch
    if (existingSchemas.length > 0) {
      const pragmaStmts: InStatement[] = existingSchemas.map((s) => ({
        sql: `PRAGMA table_info("${s.object}")`,
        args: [],
      }));
      const pragmaResults = await this.client!.batch(pragmaStmts, 'read');

      for (let i = 0; i < existingSchemas.length; i++) {
        const { object, schema } = existingSchemas[i];
        const objectDef = schema as { name: string; fields?: Record<string, any> };
        if (!objectDef.fields) continue;

        const existingColumns = new Set(pragmaResults[i].rows.map((r: any) => r.name));

        for (const [name, field] of Object.entries(objectDef.fields)) {
          if (existingColumns.has(name)) continue;
          const type = (field as any).type || 'string';
          if (type === 'formula') continue;
          this.assertSafeIdentifier(name);
          const colType = this.mapFieldTypeToSQL(field);
          ddlStatements.push(`ALTER TABLE "${object}" ADD COLUMN "${name}" ${colType}`);
        }
      }
    }

    // Phase 3: execute all DDL in a single batch
    if (ddlStatements.length > 0) {
      await this.client!.batch(ddlStatements, 'write');
    }
  }

  async dropTable(object: string): Promise<void> {
    await this.ensureConnected();
    await this.client!.execute(`DROP TABLE IF EXISTS "${object}"`);
  }

  // ===================================
  // Internal Helpers
  // ===================================

  /**
   * Ensure the @libsql/client is initialized, attempting lazy connect if a
   * factory was registered and the client is not yet available.
   *
   * Uses a singleton promise to prevent concurrent reconnection storms:
   * multiple callers that race into this method while a connect is in flight
   * will all await the same promise.
   */
  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;

    if (this.connectFactory) {
      // De-duplicate concurrent connect attempts
      if (!this.connectPromise) {
        this.connectPromise = this.connectFactory()
          .then((client) => {
            this.client = client;
            this.connectPromise = null;
            return client;
          })
          .catch((err) => {
            this.connectPromise = null;
            throw new Error(
              `RemoteTransport: lazy connect failed: ${err instanceof Error ? err.message : String(err)}`
            );
          });
      }
      return this.connectPromise;
    }

    throw new Error('RemoteTransport: @libsql/client is not initialized. Call connect() first.');
  }

  /**
   * Validate that a string is a safe SQL identifier.
   * Prevents injection in DDL where parameterized queries are unsupported.
   */
  private assertSafeIdentifier(name: string): void {
    if (!SAFE_IDENTIFIER.test(name)) {
      throw new Error(`RemoteTransport: unsafe identifier rejected: "${name}"`);
    }
  }

  /**
   * Build a CREATE TABLE SQL string for the given object definition.
   * Shared by syncSchema() and syncSchemasBatch() to avoid duplication.
   */
  private buildCreateTableSQL(tableName: string, objectDef: { fields?: Record<string, any> }): string {
    let sql = `CREATE TABLE "${tableName}" ("id" TEXT PRIMARY KEY, "created_at" TEXT DEFAULT (datetime('now')), "updated_at" TEXT DEFAULT (datetime('now'))`;

    if (objectDef.fields) {
      for (const [name, field] of Object.entries(objectDef.fields)) {
        if (BUILTIN_COLUMNS.has(name)) continue;
        const type = (field as any).type || 'string';
        if (type === 'formula') continue; // Virtual — no column
        this.assertSafeIdentifier(name);
        const colType = this.mapFieldTypeToSQL(field);
        sql += `, "${name}" ${colType}`;
      }
    }

    sql += ')';
    return sql;
  }

  /**
   * Map ObjectStack field types to SQLite column types for DDL.
   */
  private mapFieldTypeToSQL(field: any): string {
    if (field.multiple) return 'TEXT'; // JSON array stored as text

    const type = field.type || 'string';
    switch (type) {
      case 'string':
      case 'email':
      case 'url':
      case 'phone':
      case 'password':
      case 'text':
      case 'textarea':
      case 'html':
      case 'markdown':
      case 'lookup':
      case 'auto_number':
        return 'TEXT';
      case 'integer':
      case 'int':
        return 'INTEGER';
      case 'float':
      case 'number':
      case 'currency':
      case 'percent':
      case 'summary':
        return 'REAL';
      case 'boolean':
        return 'INTEGER'; // SQLite: 0/1
      case 'date':
      case 'datetime':
      case 'time':
        return 'TEXT';
      case 'json':
      case 'object':
      case 'array':
      case 'image':
      case 'file':
      case 'avatar':
      case 'location':
        return 'TEXT'; // JSON stored as text
      case 'formula':
        return ''; // Virtual — should not be created
      default:
        return 'TEXT';
    }
  }

  /**
   * Build a SELECT SQL statement from a QueryAST-like object.
   */
  private buildSelectSQL(object: string, query: any): { sql: string; args: any[] } {
    const fields = query.fields && Array.isArray(query.fields) && query.fields.length > 0
      ? query.fields.map((f: string) => `"${this.mapSortField(f)}"`).join(', ')
      : '*';

    let sql = `SELECT ${fields} FROM "${object}"`;
    const allArgs: any[] = [];

    // WHERE
    const { whereClauses, args: whereArgs } = this.buildWhereSQL(object, query.where);
    if (whereClauses) {
      sql += ` WHERE ${whereClauses}`;
      allArgs.push(...whereArgs);
    }

    // ORDER BY
    if (query.orderBy && Array.isArray(query.orderBy)) {
      const orderParts = query.orderBy
        .filter((item: any) => item.field)
        .map((item: any) => `"${this.mapSortField(item.field)}" ${(item.order || 'asc').toUpperCase()}`);
      if (orderParts.length > 0) {
        sql += ` ORDER BY ${orderParts.join(', ')}`;
      }
    }

    // PAGINATION
    if (query.limit !== undefined) {
      sql += ` LIMIT ?`;
      allArgs.push(query.limit);
    }
    if (query.offset !== undefined) {
      sql += ` OFFSET ?`;
      allArgs.push(query.offset);
    }

    return { sql, args: allArgs };
  }

  /**
   * The SQL to put on the LEFT of a comparison for `key`.
   *
   * `column` — the raw quoted identifier — stays the answer for predicates
   * whose result cannot depend on the stored FORM (`IS NULL`) or which are
   * asked about the raw text the user typed against (`LIKE`), matching which
   * predicates SqlDriver leaves on the plain column locally. Everything that
   * compares a VALUE goes through the driver's rule.
   */
  private comparisonColumn(object: string, key: string, column: string): string {
    return this.filterColumnSql ? this.filterColumnSql(object, key, column) : column;
  }

  /**
   * Build WHERE clause from MongoDB-style filter object.
   *
   * `object` is threaded through (and into every `$and`/`$or`/`$not` sub-filter)
   * because the storage form of a column is a property of the OBJECT's field
   * metadata — the transport cannot ask the driver about a column without
   * saying which object it belongs to.
   *
   * **Invariant (#1073): an empty `whereClauses` means the filter is vacuously
   * TRUE — never "something was dropped".** That is what makes the identity
   * elements in the `$and`/`$or`/`$not` branches below safe to apply: they read
   * `''` from a sub-filter as "this branch imposes no constraint" (and `$not`
   * inverts it to FALSE), so every OTHER way of compiling to nothing has to be
   * impossible. It is, by enumeration:
   * the operator-map branch throws when its map yields zero clauses (#1071),
   * the comparand gate throws on a value it cannot bind (#1058), an unknown
   * operator throws (#1004), a sub-filter that is not a filter NODE is refused
   * by {@link buildSubFilterSQL} rather than compiled to `''`, and — since
   * #1075 — a TOP-LEVEL filter that is not a filter node is refused by the same
   * test before the loop runs. The only remaining sources of `''` are
   * genuinely-empty inputs (`{}`, `$and: []`, an `$or` with a TRUE disjunct) —
   * all of which ARE TRUE.
   */
  private buildWhereSQL(object: string, filters: any): { whereClauses: string; args: any[] } {
    // "No filter" is spelled by ABSENCE, and that is the only spelling. All
    // five call sites hand this method `query?.where` (`query.where` in
    // `buildSelectSQL`), so a caller that supplied no filter arrives as
    // `undefined`; `null` is accepted as its equivalent because that is what a
    // JSON round-trip of an absent key produces.
    if (filters === null || filters === undefined) {
      return { whereClauses: '', args: [] };
    }

    // Everything else must be a filter NODE (#1075). This test used to be a
    // `typeof filters === 'object' && !Array.isArray(filters)` guard around the
    // loop below, so any OTHER shape fell straight through it to the `return`
    // at the bottom and compiled to NO WHERE CLAUSE — the caller asked to
    // filter and silently received the unfiltered table. Measured on the
    // shipped build: `[['stage','=','won']]`, `'stage'`, `42` and `[]` each
    // produced `SELECT * FROM "deal"` with no args, and the same emptiness on
    // `deleteMany`/`updateMany` is a whole-table write.
    //
    // The bare AST array is the shape that actually arrives: `isFilterAST()`
    // refuses an operator outside `VALID_AST_OPERATORS` (8 of the canonical
    // view operators are in that position — `before`, `after`, `equals`, …), so
    // `parseFilterAST()` never converts it and the raw array is assigned to
    // `where` (framework's `sql-driver-filter-no-silent-drop`, #3948).
    //
    // Refused rather than compiled: the spec declares `where` as an OBJECT
    // (`QueryASTSchema.where: FilterConditionSchema`, itself
    // `z.record(z.string(), z.unknown()).and(…)`), so the array dialect is not
    // this transport's language, and growing a second implementation of it here
    // is exactly the divergence ADR-0053 D-A1 forbids. `driver-sql` still
    // compiles its legacy INFIX array form; on this transport that form now
    // says so out loud instead of answering a different question.
    if (!isFilterNode(filters)) {
      throw this.uncompilableWhere(object, filters);
    }

    // `{}` — the one empty that is legal. It means "no filter at all", the
    // vacuous-TRUE control of #1073/#1074, and it keeps its early return.
    // Reaching it only AFTER the node test is what stops the accidental
    // empties from borrowing its meaning: `Object.keys()` is also `[]` for
    // `new Date()`, `new Uint8Array([])` and `[]` itself, each of which used to
    // return here as "no filter" (the #1066 mistake, one level up).
    if (Object.keys(filters).length === 0) {
      return { whereClauses: '', args: [] };
    }

    const clauses: string[] = [];
    const args: any[] = [];

    for (const [key, value] of Object.entries(filters)) {
      if (key === '$and' && Array.isArray(value)) {
        const subClauses: string[] = [];
        const subArgs: any[] = [];
        for (const [index, sub] of value.entries()) {
          const { whereClauses: sc, args: sa } = this.buildSubFilterSQL(object, key, index, sub);
          // A TRUE conjunct is AND's identity element: `x AND TRUE ≡ x`, so
          // dropping it loses nothing. This is the ONE direction the old
          // "skip whatever compiled to nothing" rule happened to get right.
          if (!sc) continue;
          subClauses.push(`(${sc})`);
          subArgs.push(...sa);
        }
        if (subClauses.length > 0) {
          clauses.push(`(${subClauses.join(' AND ')})`);
          args.push(...subArgs);
        }
        // Every conjunct TRUE (`$and: []`, `$and: [{}]`) → the conjunction is
        // TRUE → emit no clause, which is exactly how TRUE is spelled in a
        // list of AND-ed clauses.
      } else if (key === '$or' && Array.isArray(value)) {
        const subClauses: string[] = [];
        const subArgs: any[] = [];
        // `TRUE OR x ≡ TRUE`: one vacuous disjunct absorbs the disjunction,
        // whatever its siblings say. Tracked rather than folded into
        // `subClauses.length` because "no disjuncts at all" is the OPPOSITE
        // truth value — which is the asymmetry #1073 is about.
        let hasTrueDisjunct = false;
        for (const [index, sub] of value.entries()) {
          const { whereClauses: sc, args: sa } = this.buildSubFilterSQL(object, key, index, sub);
          if (!sc) {
            hasTrueDisjunct = true;
            continue;
          }
          subClauses.push(`(${sc})`);
          subArgs.push(...sa);
        }
        if (hasTrueDisjunct) {
          // The whole disjunction is TRUE → no clause, and deliberately no
          // args either: `subArgs` belong to clauses that are not emitted, and
          // a bind list that outruns its `?`s is a different bug again.
        } else if (subClauses.length === 0) {
          // The empty disjunction. Boolean OR's identity is FALSE, so `$or:
          // []` matches ZERO rows — it does NOT mean "no filter". Compiling it
          // away (the old behaviour) turned a query that selects nothing into
          // a full table scan, and on `deleteMany`/`updateMany` into a
          // whole-table write.
          clauses.push(SQL_FALSE);
        } else {
          clauses.push(`(${subClauses.join(' OR ')})`);
          args.push(...subArgs);
        }
      } else if (key === '$not') {
        // The third logical operator the spec declares (#1076). `$not` was
        // missing here while `$and`/`$or` were handled, so it fell through to
        // the FIELD path and was read as a column literally named `$not`:
        // `{ $not: { $eq: 'won' } }` compiled to `WHERE "$not" = ?` (SQLite:
        // `no such column`), `{ $not: null }` to `WHERE "$not" IS NULL`, and
        // `{ $not: { stage: 'won' } }` threw an error naming `$not` as a
        // FIELD — sending the reader to `describe_object` to look for a
        // column that cannot exist, the #1051 diagnostic detour.
        //
        // It is not an exotic shape: `SqlDriver.applyFilterCondition` compiles
        // it with `whereNot` (framework#2704), `driver-memory` and
        // `matchesFilterCondition` both evaluate it, and CEL `!expr` in a
        // permission / RLS read scope lowers to `{ $not: {…} }`
        // (`formula/src/cel-to-filter.ts`). Without this branch the SAME scope
        // answered correctly on a local SqlDriver and failed on Turso remote.
        //
        // Deliberately NOT guarded by a value-shape test (`&& isFilterNode`):
        // a guard would send `$not: null` / `$not: 'won'` back down the field
        // path, i.e. straight back into the bug. Every `$not` is compiled
        // here, and a value that is not a filter node is refused BY NAME.
        //
        // NULL semantics are SQL's, matching what `whereNot` emits locally:
        // `NOT ("stage" = ?)` is UNKNOWN for a row whose `stage` is NULL, so
        // that row is not returned. `driver-memory`/`matchesFilterCondition`
        // return it (JS `undefined !== 'won'`). The divergence is the SQL
        // family's, not this transport's, and remote mode is pinned to the
        // family it belongs to — filed as objectstack#5146.
        const { whereClauses: sc, args: sa } = this.buildSubFilterSQL(object, key, null, value);
        if (sc) {
          clauses.push(`NOT (${sc})`);
          args.push(...sa);
        } else {
          // The inner filter imposes no constraint — it is vacuously TRUE
          // (`$not: {}`, `$not: { $and: [] }`), and `NOT TRUE` is FALSE. The
          // #1073 invariant above is what licenses reading `''` that way: it
          // can ONLY mean TRUE, never "something was dropped". Emitting no
          // clause here would say TRUE — the exact inversion of the answer.
          clauses.push(SQL_FALSE);
        }
      } else if (isOperatorMap(value)) {
        // Field-level operators: { age: { $gt: 18 } }
        const column = `"${this.mapSortField(key)}"`;
        const field = this.comparisonColumn(object, key, column);
        // How many clauses this field's map is required to produce (#1066):
        // a comparand that compiles to NOTHING is the same failure family as
        // #1004/#1058 approached from a third direction, and the loudest of
        // the three — the predicate does not match zero rows, it DISAPPEARS,
        // widening the statement to every row in the table.
        const clausesBefore = clauses.length;
        for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
          switch (op) {
            case '$eq':
              if (opValue === null || opValue === undefined) {
                clauses.push(`${column} IS NULL`);
              } else {
                const bind = this.serializeComparand(object, key, op, opValue);
                clauses.push(`${field} = ?`);
                args.push(bind);
              }
              break;
            case '$ne':
              if (opValue === null || opValue === undefined) {
                clauses.push(`${column} IS NOT NULL`);
              } else {
                const bind = this.serializeComparand(object, key, op, opValue);
                clauses.push(`${field} <> ?`);
                args.push(bind);
              }
              break;
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte': {
              const bind = this.serializeComparand(object, key, op, opValue);
              clauses.push(`${field} ${RANGE_SQL_OPERATOR[op]} ?`);
              args.push(bind);
              break;
            }
            // `$in` / `$nin` take the one comparand form that IS a container:
            // the array is the operator's own shape, and each ELEMENT is a
            // comparand in its own right — so the element is what must be
            // bindable. An element that is not (`$in: [{ $field: 'x' }]`)
            // degrades exactly like a scalar operator's object comparand did,
            // just one row of the IN list at a time.
            case '$in': {
              const inVals = opValue as any[];
              const binds = inVals.map((v: any, i: number) =>
                this.serializeComparand(object, key, `${op}[${i}]`, v),
              );
              clauses.push(`${field} IN (${binds.map(() => '?').join(', ')})`);
              args.push(...binds);
              break;
            }
            case '$nin': {
              const ninVals = opValue as any[];
              const binds = ninVals.map((v: any, i: number) =>
                this.serializeComparand(object, key, `${op}[${i}]`, v),
              );
              clauses.push(`${field} NOT IN (${binds.map(() => '?').join(', ')})`);
              args.push(...binds);
              break;
            }
            // ── Text predicates ──────────────────────────────────────────
            // All five are asked about the raw stored text, not about an
            // instant, so they stay on the plain `column` — which is what
            // SqlDriver does with the LIKE family locally.
            //
            // Their comparand goes through the same gate (#1058) before
            // `pushLike` stringifies it: `String({ $field: 'x' })` is
            // `'[object Object]'`, so an uncompilable value here produced the
            // same valid-SQL-matching-nothing as the scalar operators did —
            // and refusing it in one family while tolerating it in the other
            // would leave the failure mode alive at a different spelling.
            case '$contains':
            // `$regex` is not spec-declared: it reaches SQL only via the
            // better-auth adapter, which emits it for a `contains` search (a
            // plain substring, not a real regex). SqlDriver compiles it as
            // that substring LIKE, so remote mode must too — otherwise a
            // Turso-backed auth store answers differently from a local one.
            case '$regex':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'contains');
              break;
            case '$notContains':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'contains', true);
              break;
            case '$startsWith':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'starts');
              break;
            case '$endsWith':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'ends');
              break;
            // ── Existence ────────────────────────────────────────────────
            // `{ $null: true }` → IS NULL, `{ $null: false }` → IS NOT NULL;
            // `$exists` is its inverse. Both compare the presence of a value,
            // which no storage form can change, so both read the plain column
            // (same reasoning as the `$eq: null` arm above).
            case '$null':
              // A THIRD value is not a third answer (#1116). The emitter below
              // asks `opValue === false`, so every non-boolean — `'yes'`, `1`,
              // `0`, `null`, `undefined`, `{}` and the string `'false'` — fell
              // to the `NULL` side and compiled to `IS NULL`. Refused instead,
              // per objectstack#5347 / #5368; see
              // {@link nonBooleanNullComparand} for why.
              if (typeof opValue !== 'boolean') {
                throw this.nonBooleanNullComparand(object, key, opValue);
              }
              // Written as a TOTAL choice over the two booleans rather than as
              // `=== false ? … : …`. The two spell the same thing only while
              // the guard above holds; the bisecting spelling has a DEFAULT
              // side, and a default side is what silently resumed answering
              // for a third value. framework tightened its twin the same way
              // and for the same reason (objectstack#5368).
              clauses.push(`${column} IS ${opValue ? 'NULL' : 'NOT NULL'}`);
              break;
            case '$exists':
              // Deliberately NOT given the same guard (#1116's scope fence).
              // `$exists` carries the identical `=== false` bisection, but its
              // divergence is on another axis — whether "exists" means "key
              // present" or "has a value" is objectstack#5299's open question,
              // reopened as #5369 — and framework left it alone for exactly
              // this reason. Tightening it here ALONE would manufacture a
              // local/remote fork rather than close one.
              clauses.push(`${column} IS ${opValue === false ? 'NULL' : 'NOT NULL'}`);
              break;
            default:
              // Declared = enforced. This arm used to compile ANY unknown
              // operator to `column = ?` against its comparand — so a
              // `$startsWith` prefix, an `$exists` boolean or a typo'd
              // operator each produced valid SQL that matched nothing, which
              // reads exactly like "no rows matched" (#1004). An operator this
              // transport cannot compile is a programming error and must say
              // so.
              throw this.unsupportedOperator(object, key, op);
          }
        }
        if (clauses.length === clausesBefore) {
          throw this.emptyFieldFilter(object, key, value);
        }
      } else if (value === null || value === undefined) {
        // Null equality MUST use `IS NULL` — `col = NULL` is always UNKNOWN
        // in SQL, so it matches zero rows. Env-wide metadata (and drafts) are
        // stored with `organization_id IS NULL`; emitting `= ?` here is what
        // made every env-wide draft read come back empty even though the row
        // was written. (Knex special-cases this; this hand-rolled builder did not.)
        const column = `"${this.mapSortField(key)}"`;
        clauses.push(`${column} IS NULL`);
      } else {
        // Simple equality: { name: 'Alice' }, and every comparand that is a
        // VALUE despite being an object — today `Date` (#1066), which lands
        // here rather than in the operator-map branch above and compiles to
        // exactly what its explicit `{ $eq: date }` spelling always did.
        //
        // What can still arrive here and NOT be bindable is an array (the one
        // object form the router leaves alone, since `$in`'s array is an
        // OPERATOR's shape, not a comparand). It is no more bindable in
        // implicit-equality position than in explicit `$eq` position, so it
        // takes the same gate (#1058); a plain object was read as an operator
        // map above and a bad one already threw (#1004).
        const column = `"${this.mapSortField(key)}"`;
        const bind = this.serializeComparand(object, key, '$eq', value);
        clauses.push(`${this.comparisonColumn(object, key, column)} = ?`);
        args.push(bind);
      }
    }

    return {
      whereClauses: clauses.join(' AND '),
      args,
    };
  }

  /**
   * Append one parameterized `LIKE` / `NOT LIKE` predicate.
   *
   * The LIKE metacharacters `%` / `_` (and the escape character `\` itself) are
   * escaped in the COMPARAND so they match literally: unescaped, a value of `%`
   * expands to `%%%` and matches every row — a filter bypass, and a P0 the
   * framework already paid for (`sql-driver-like-escape.test.ts`). The escape
   * clause is written explicitly because SQLite honours no default escape
   * character; it is a literal here rather than a bind (as `SqlDriver` does)
   * only because this transport is SQLite-by-construction and keeping the bind
   * list to comparands keeps the arg arithmetic in every caller unchanged.
   *
   * This is the ONE place the LIKE family is built. That is the point: five
   * operators sharing one escape rule is the opposite of the second
   * implementation ADR-0053 D-A1 warns about — the rule cannot drift between
   * `$contains` and `$startsWith` because there is only one of it. It does
   * restate the framework's rule (which lives in `SqlDriver.applyLike`, a
   * private Knex-builder method with no reusable export), so the two must be
   * read together; the row-level suite in
   * `remote-transport-text-predicates.test.ts` is what pins them to the same
   * answers.
   */
  private pushLike(
    clauses: string[],
    args: any[],
    column: string,
    value: unknown,
    shape: LikeShape,
    negate = false,
  ): void {
    const escaped = String(value).replace(/[\\%_]/g, '\\$&');
    const pattern = shape === 'starts' ? `${escaped}%` : shape === 'ends' ? `%${escaped}` : `%${escaped}%`;
    clauses.push(`${column} ${negate ? 'NOT LIKE' : 'LIKE'} ? ESCAPE '\\'`);
    args.push(pattern);
  }

  /**
   * The error for a `$null` whose comparand is not a boolean (#1116).
   *
   * `@objectstack/spec`'s `FieldOperatorsSchema` declares `$null: z.boolean()`,
   * and nothing between an authored `where` and this transport validates against
   * it — so a non-boolean really does arrive here. The emitter asked
   * `opValue === false`, which is a BISECTION: `false` on one side, everything
   * else on the other. Measured on real SQLite (`makeLibsqlSqliteStub`) against
   * one row with `stage: 'won'` and one with `stage: null`:
   *
   * | filter | compiled to | rows |
   * |---|---|---|
   * | `{ $null: true }`    | `IS NULL`     | the NULL row  |
   * | `{ $null: false }`   | `IS NOT NULL` | the valued row |
   * | `{ $null: 'yes' }` / `1` / `0` / `null` / `undefined` / `{}` / `'false'` | `IS NULL` | the NULL row |
   *
   * Every third value answered as if `true` had been written. The trap in that
   * list is the STRING `'false'`: it is truthy, so the one spelling most likely
   * to arrive from a JSON round-trip or a template concatenation compiled to the
   * exact OPPOSITE of what its author meant.
   *
   * Refused rather than coerced, per the maintainer's ruling on the identical
   * shape in objectstack#5347 — landed across framework's four backends in
   * objectstack#5368. The reasoning is not "this transport picked the wrong
   * side": there is no side to pick. The backends read a non-boolean in
   * OPPOSITE directions (this transport, `driver-sql`, `driver-sqlite-wasm` and
   * Turso LOCAL said `IS NULL`; `driver-memory`'s query path and
   * `driver-mongodb` said `IS NOT NULL`; `driver-memory`'s reference matcher
   * dropped the constraint entirely and matched BOTH rows — a widening, i.e. a
   * bypass on an RLS read scope). Three answers to one declared operator, none
   * of them a rule anyone wrote down; all three are just what a two-branch
   * conditional does with a third value. So the transport stops guessing.
   *
   * Until #5368 this transport was one of two faces of the SAME `TursoDriver`
   * giving different answers to one filter depending only on whether `url` sent
   * it down the local or the remote path. This closes it from the remote side;
   * the local side inherits `SqlDriver`'s refusal the moment `.objectstack-sha`
   * moves past `9c5abf4e9`.
   *
   * The leading sentence is copied VERBATIM from the framework twins (identical
   * word-for-word across `driver-sql`, `driver-memory` and `driver-mongodb`), so
   * a caller who hits this on Turso reads the same sentence they would read on
   * Postgres. Only the location is spelled in this transport's own convention —
   * it names `'object.field'` rather than threading a `filter.…` path.
   */
  private nonBooleanNullComparand(object: string, field: string, value: unknown): Error {
    // `describeValue` calls `null` "an object" and `undefined` "a undefined" —
    // both are the two comparands most likely to arrive here, so they are named
    // outright, exactly as {@link uncompilableSubFilter} does one level up.
    const shown = value === null ? 'null' : value === undefined ? 'undefined' : describeValue(value);
    return invalidFilterError(
      `[RemoteTransport] Operator "$null" on field "${field}" requires a boolean comparand (true or ` +
        `false). Received ${shown} (${preview(value)}) at '${object}.${field}'.$null. ` +
        `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather than ` +
        `coerced because the backends read a non-boolean in OPPOSITE directions — this transport ` +
        `(with driver-sql, driver-sqlite-wasm and Turso local) compiled IS NULL (anything but false), ` +
        `driver-memory's query path and driver-mongodb compiled IS NOT NULL (anything but true), and ` +
        `driver-memory's matcher dropped the constraint entirely. Note "false" the STRING is truthy, ` +
        `so it landed on the side opposite the false it was written to mean ` +
        `(objectstack#5347, objectstack#5368, #1116).`,
    );
  }

  /**
   * The error for an operator this transport does not compile.
   *
   * `$between` gets its own sentence because it is not missing by oversight:
   * `TursoDriver.toRemoteFieldSpec` lowers it to `$gte`/`$lte` (#1003) so the
   * calendar-day upper-bound rule is applied in exactly one place. Growing a
   * `$between` arm here would be that second implementation, silently without
   * the rule — so reaching this point means the lowering step was bypassed, and
   * saying which step it was is the whole value of the message.
   */
  private unsupportedOperator(object: string, field: string, op: string): Error {
    const target = `'${object}.${field}'`;
    if (op === '$between') {
      return invalidFilterError(
        `[RemoteTransport] $between on ${target} must be lowered to $gte/$lte before it reaches the ` +
          `transport — TursoDriver.toRemoteFieldSpec does that so the calendar-day upper-bound rule is ` +
          `applied exactly once (#1003). Refusing rather than compiling a second, rule-free range.`,
      );
    }
    if (!op.startsWith('$')) {
      return invalidFilterError(
        `[RemoteTransport] Filter on ${target} has an object comparand whose key "${op}" is not an ` +
          `operator. A field's filter must be a scalar (equality) or an object of $-operators ` +
          `(${SUPPORTED_FILTER_OPERATORS.join(', ')}).`,
      );
    }
    return invalidFilterError(
      `[RemoteTransport] Unsupported filter operator "${op}" on ${target} in remote mode. Supported: ` +
        `${SUPPORTED_FILTER_OPERATORS.join(', ')}. Refusing rather than compiling it to an equality — a ` +
        `silent degradation is indistinguishable from "no rows matched" (#1004).`,
    );
  }

  /**
   * Compile ONE sub-filter of a logical operator — an element of `$and` / `$or`
   * (#1073), or the whole operand of `$not` (#1076).
   *
   * The gate that gives `buildWhereSQL`'s empty return its meaning. A filter
   * NODE that compiles to no SQL is vacuously TRUE and the caller applies the
   * operator's rule to it (drop it under `$and`, absorb the group under `$or`,
   * invert it to FALSE under `$not`); ANYTHING ELSE that compiles to no SQL is a
   * shape this transport failed to compile, and must not borrow that meaning —
   * `$or: [null]` silently became `$or: []` before this, and would silently
   * become "match every row" after it, which is worse.
   *
   * So the two are separated by FORM, before compilation: a non-node operand is
   * refused here, and everything that gets past is a node whose `''` is provably
   * TRUE (see the invariant on {@link buildWhereSQL}).
   *
   * `index` is the element's position for the array operators, and `null` for
   * `$not`, which takes a single operand rather than a list.
   */
  private buildSubFilterSQL(
    object: string,
    branch: '$and' | '$or' | '$not',
    index: number | null,
    sub: unknown,
  ): { whereClauses: string; args: any[] } {
    if (!isFilterNode(sub)) throw this.uncompilableSubFilter(object, branch, index, sub);
    return this.buildWhereSQL(object, sub);
  }

  /**
   * The error for a logical operator's operand that is not a filter node.
   *
   * Same family as {@link emptyFieldFilter}, one level up: the old code pushed a
   * sub-clause only `if (sc)`, so a `null`, a bare string, a nested AST array or
   * a `Date` in a logical array left NO trace — the branch compiled as if that
   * element had never been written. In `$or` that silently NARROWS the result
   * (the missing disjunct's rows disappear); in `$and` it silently WIDENS it.
   * Both are "valid SQL, zero errors, wrong answer" (#1004, #1058, #1066).
   *
   * Under `$not` (#1076) the same non-node operand has a THIRD ending, and it is
   * why the branch above compiles every `$not` rather than only the well-shaped
   * ones: left to fall through, `$not: null` became `WHERE "$not" IS NULL` and
   * `$not: 'won'` became `WHERE "$not" = ?` — a predicate on a column that
   * cannot exist, reported (if at all) as a missing FIELD.
   */
  private uncompilableSubFilter(
    object: string,
    branch: '$and' | '$or' | '$not',
    index: number | null,
    sub: unknown,
  ): Error {
    const shown = sub === null ? 'null' : sub === undefined ? 'undefined' : describeValue(sub);
    const location = index === null ? branch : `${branch}[${index}]`;
    const requirement =
      branch === '$not'
        ? `$not takes exactly ONE condition, and it must be a plain object of conditions (spec ` +
          `FilterConditionSchema declares \`$not: FilterConditionSchema\`). Refusing rather than ` +
          `reading '${branch}' as a COLUMN NAME — that is the bug this branch exists to close: it ` +
          `compiled a predicate against a column that cannot exist, and named it as a field of ` +
          `'${object}' when it complained (#1051, #1076). A negation of "no condition" is written ` +
          `\`{ $not: {} }\`, which matches zero rows.`
        : `Every element of ${branch} must be a plain object of conditions (spec ` +
          `FilterConditionSchema). Refusing rather than skipping it — a dropped element leaves ` +
          `valid SQL that answers a DIFFERENT question: narrower in $or, wider in $and (#1004, ` +
          `#1058, #1066, #1073). An intentionally unconstrained branch is written \`{}\`.`;
    return invalidFilterError(
      `[RemoteTransport] ${location} on '${object}' is ${shown}, not a filter condition: ` +
        `${preview(sub)}. ${requirement}`,
    );
  }

  /**
   * The error for a TOP-LEVEL `where` that is not a filter condition (#1075).
   *
   * The same refusal as {@link uncompilableSubFilter}, one level UP — and the
   * level where the consequence is largest, because there is no surrounding
   * filter left to constrain the statement: the WHERE clause does not lose a
   * conjunct, it never exists. `find`/`count` hand back the rows the filter was
   * written to exclude, and `deleteMany`/`updateMany` run against every row in
   * the table.
   *
   * An ARRAY gets its own sentence because it is the shape that actually
   * arrives rather than a typo. `parseFilterAST()` converts a filter AST to the
   * object form ONLY when `isFilterAST()` accepts it; an operator outside
   * `VALID_AST_OPERATORS` — `before`, `after`, `equals` and five more canonical
   * view operators — makes it refuse, and the raw array is then assigned to
   * `where` unconverted (framework#3948, whose fix made `driver-sql` and
   * `driver-memory` throw on the shapes they could not compile). `driver-sql`
   * does still compile its own legacy INFIX array form, so a caller may find
   * one that works locally and throws here: that is deliberate. The spec
   * declares `where` as an object (`QueryASTSchema.where: FilterConditionSchema`
   * — `z.record(z.string(), z.unknown())` and friends), and re-implementing an
   * undeclared array dialect inside this transport would be the second,
   * drifting implementation ADR-0053 D-A1 exists to prevent. Answering out loud
   * is the repairable failure; answering with the whole table is not.
   */
  private uncompilableWhere(object: string, filters: unknown): Error {
    const requirement = Array.isArray(filters)
      ? `A query's \`where\` must be a plain object of conditions (spec QueryASTSchema declares ` +
        `\`where: FilterConditionSchema\`, a record) — this transport does not compile the filter ` +
        `AST array form. Convert it first (\`parseFilterAST\`), or write the object spelling: ` +
        `[["stage","=","won"]] is { stage: 'won' }.`
      : `A query's \`where\` must be a plain object of conditions (spec QueryASTSchema declares ` +
        `\`where: FilterConditionSchema\`, a record).`;
    return invalidFilterError(
      `[RemoteTransport] where on '${object}' is ${describeValue(filters)}, not a filter condition: ` +
        `${preview(filters)}. ${requirement} Refusing rather than compiling it to NO WHERE clause — ` +
        `a filter that vanishes WIDENS the statement to the whole table, so a read returns exactly ` +
        `the rows the filter was written to exclude and deleteMany/updateMany touch every row ` +
        `(#1004, #1058, #1066, #1073, #1075). "No filter" is written \`{}\`, or by omitting \`where\`.`,
    );
  }

  /**
   * The error for a field filter that compiles to no predicate at all.
   *
   * The third face of #1004's rule, and the one that fails OPEN. An unknown
   * operator (#1004) and an unbindable comparand (#1058) both produced valid SQL
   * that matched NOTHING; an operator map with no operators in it produces no
   * SQL — the WHERE clause loses a conjunct, and a statement missing a conjunct
   * is WIDER than the one that was asked for. On a read that is rows the caller
   * filtered out; on `deleteMany`/`updateMany` it is rows the caller never meant
   * to touch.
   *
   * `{}` is the spelling that gets here on purpose. A bare `Date` used to get
   * here by accident — `Object.entries(new Date())` is empty — which is what
   * #1066 was; that is now routed to implicit equality, so anything still
   * reaching this point genuinely carries no operator. A top-level `where: {}`
   * is a different statement ("no filter at all") and keeps its early return.
   */
  private emptyFieldFilter(object: string, field: string, value: unknown): Error {
    return invalidFilterError(
      `[RemoteTransport] Filter on '${object}.${field}' is an object comparand that compiles to NO ` +
        `predicate: ${preview(value)}. An operator map must carry at least one operator ` +
        `(${SUPPORTED_FILTER_OPERATORS.join(', ')}); to compare against a value, write the value ` +
        `itself. Refusing rather than dropping the condition — a predicate that vanishes WIDENS the ` +
        `statement to the whole table, so the caller gets back exactly the rows the filter was ` +
        `written to exclude (#1004, #1058, #1066).`,
    );
  }

  /**
   * A filter comparand in the form this transport can BIND — or an error.
   *
   * The read half of {@link serializeValue}'s job, split off because the two
   * halves want opposite answers for the same input (#1058). On the WRITE path
   * an object is a JSON column's value and `JSON.stringify` is exactly right.
   * On the FILTER path it is a value the transport cannot compile: stringifying
   * it produced valid SQL that binds the JSON TEXT of the object, and in
   * SQLite's type ordering every number sorts below every string, so
   * `"amount" > '{"$field":"budget"}'` is false for every row — zero rows, zero
   * errors, indistinguishable from "nothing matched".
   *
   * That is the failure mode #1004 already refused in the OPERATOR position
   * (`default:` above). It stayed open in the VALUE position, so the same
   * mistake threw or degraded depending only on how deeply it was nested:
   * `{ amount: { $field: 'budget' } }` threw, `{ amount: { $gt: { $field:
   * 'budget' } } }` returned an empty page. Declared = enforced applies to both
   * halves of a comparison.
   *
   * The accepted set is an ALLOW-list of what libsql binds and SQLite compares
   * meaningfully — `string` / `number` / `bigint` / `boolean` / `null`, plus
   * `Date` as the one declared conversion (→ ISO 8601, the storage form
   * `TursoDriver.toRemoteWriteForms` wrote). Everything else — plain objects,
   * arrays, `Uint8Array`, functions — is refused by name. An allow-list is the
   * point: a deny-list would silently re-admit whatever value form is invented
   * next, which is precisely how this bug survived #1004.
   *
   * The object half of that allow-list is {@link isBindableObjectComparand},
   * shared with `buildWhereSQL`'s routing test so a form cannot be a VALUE here
   * and an OPERATOR MAP there (#1066).
   */
  private serializeComparand(object: string, field: string, op: string, value: unknown): any {
    if (value === null || value === undefined) return null;
    if (isBindableObjectComparand(value)) return value.toISOString();
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    throw this.uncompilableComparand(object, field, op, value);
  }

  /**
   * The error for a comparison value this transport cannot bind.
   *
   * `{ $field: … }` gets its own sentence for the same reason `$between` does in
   * {@link unsupportedOperator}: it is not a typo but a spec-declared construct
   * (`FieldReferenceSchema`, `data/filter.zod.ts`) that asks for a cross-field
   * comparison — `amount > budget` rather than `amount > 1000`. No executor
   * cloud runs compiles it (#1051), so the repair is never "use a different
   * operator" (every one fails identically); it is to compare against a literal,
   * or to compare the two columns after the rows come back. `service-ai` refuses
   * the same shape by name at the tool boundary (#1059) — this is the same
   * refusal for every OTHER entry point (REST filters, RLS pushdown, internal
   * calls), which is why both exist.
   */
  private uncompilableComparand(object: string, field: string, op: string, value: unknown): Error {
    const target = `'${object}.${field}'`;
    const shown = `${op} ${preview(value)}`;
    if (isFieldReference(value)) {
      return invalidFilterError(
        `[RemoteTransport] Cross-field comparison is not supported in remote mode: ${target} ${shown} ` +
          `compares a column against another column instead of against a value. The query DSL declares ` +
          `this form (spec FieldReferenceSchema) but no executor compiles it, so it is refused here ` +
          `rather than bound as the marker's JSON text — which is valid SQL that matches nothing ` +
          `(#1058). Compare against a literal, or select both columns and compare after retrieval.`,
      );
    }
    return invalidFilterError(
      `[RemoteTransport] Filter comparand ${target} ${shown} is ${describeValue(value)}, which this ` +
        `transport cannot bind. A comparison value must be a string, number, bigint, boolean, null or ` +
        `Date. Refusing rather than binding its JSON text — that compiles to valid SQL matching zero ` +
        `rows, which is indistinguishable from "no rows matched" (#1004, #1058).`,
    );
  }

  /**
   * Map camelCase field names to snake_case DB columns.
   */
  private mapSortField(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

  /**
   * Serialize a WRITTEN value for @libsql/client args.
   * - `Date` → ISO 8601 string (avoids libsql HTTP transport coercing the
   *   value to a REAL column and round-tripping it as `"<epoch>.0"`).
   * - JSON objects/arrays are stringified.
   * - booleans are kept as-is (libsql handles them).
   *
   * INSERT / UPDATE / UPSERT payloads only. A comparison value goes through
   * {@link serializeComparand}, which refuses the object forms this one
   * stringifies: on the write path an object is a JSON column's value, on the
   * filter path it is a value that cannot be compiled (#1058).
   */
  private serializeValue(value: unknown): any {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * Convert a ResultSet from @libsql/client into plain Record objects.
   */
  private mapRows(result: ResultSet): Record<string, unknown>[] {
    return result.rows.map((row) => {
      const record: Record<string, unknown> = {};
      for (const col of result.columns) {
        record[col] = (row as any)[col];
      }
      return record;
    });
  }
}
