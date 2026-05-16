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
      if (
        error.message &&
        (error.message.includes('no such column') ||
          (error.message.includes('column') && error.message.includes('does not exist')))
      ) {
        return [];
      }
      throw error;
    }
  }

  async findOne(object: string, query: any): Promise<Record<string, unknown> | null> {
    // When called with a string/number id fall back gracefully
    if (typeof query === 'string' || typeof query === 'number') {
      await this.ensureConnected();
      const result = await this.client!.execute({
        sql: `SELECT * FROM "${object}" WHERE "id" = ? LIMIT 1`,
        args: [query],
      });
      const rows = this.mapRows(result);
      return rows[0] || null;
    }

    if (query && typeof query === 'object') {
      const results = await this.find(object, { ...query, limit: 1 });
      return results[0] || null;
    }

    return null;
  }

  async *findStream(object: string, query: any): AsyncGenerator<Record<string, unknown>> {
    const results = await this.find(object, query);
    for (const row of results) {
      yield row;
    }
  }

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

    const { whereClauses, args: whereArgs } = this.buildWhereSQL(query?.where);
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

    const { whereClauses, args } = this.buildWhereSQL(query?.where);
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

    const { whereClauses, args: whereArgs } = this.buildWhereSQL(query?.where);
    let sql = `UPDATE "${object}" SET ${setClauses}`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args: [...setValues, ...whereArgs] });
    return result.rowsAffected;
  }

  async deleteMany(object: string, query: any): Promise<number> {
    await this.ensureConnected();

    const { whereClauses, args } = this.buildWhereSQL(query?.where);
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
    const { whereClauses, args: whereArgs } = this.buildWhereSQL(query.where);
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
   * Build WHERE clause from MongoDB-style filter object.
   */
  private buildWhereSQL(filters: any): { whereClauses: string; args: any[] } {
    if (!filters || (typeof filters === 'object' && Object.keys(filters).length === 0)) {
      return { whereClauses: '', args: [] };
    }

    const clauses: string[] = [];
    const args: any[] = [];

    if (typeof filters === 'object' && !Array.isArray(filters)) {
      for (const [key, value] of Object.entries(filters)) {
        if (key === '$and' && Array.isArray(value)) {
          const subClauses: string[] = [];
          for (const sub of value) {
            const { whereClauses: sc, args: sa } = this.buildWhereSQL(sub);
            if (sc) {
              subClauses.push(`(${sc})`);
              args.push(...sa);
            }
          }
          if (subClauses.length > 0) {
            clauses.push(`(${subClauses.join(' AND ')})`);
          }
        } else if (key === '$or' && Array.isArray(value)) {
          const subClauses: string[] = [];
          for (const sub of value) {
            const { whereClauses: sc, args: sa } = this.buildWhereSQL(sub);
            if (sc) {
              subClauses.push(`(${sc})`);
              args.push(...sa);
            }
          }
          if (subClauses.length > 0) {
            clauses.push(`(${subClauses.join(' OR ')})`);
          }
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Field-level operators: { age: { $gt: 18 } }
          const field = `"${this.mapSortField(key)}"`;
          for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
            switch (op) {
              case '$eq':
                clauses.push(`${field} = ?`);
                args.push(this.serializeValue(opValue));
                break;
              case '$ne':
                clauses.push(`${field} <> ?`);
                args.push(this.serializeValue(opValue));
                break;
              case '$gt':
                clauses.push(`${field} > ?`);
                args.push(this.serializeValue(opValue));
                break;
              case '$gte':
                clauses.push(`${field} >= ?`);
                args.push(this.serializeValue(opValue));
                break;
              case '$lt':
                clauses.push(`${field} < ?`);
                args.push(this.serializeValue(opValue));
                break;
              case '$lte':
                clauses.push(`${field} <= ?`);
                args.push(this.serializeValue(opValue));
                break;
              case '$in': {
                const inVals = opValue as any[];
                const ph = inVals.map(() => '?').join(', ');
                clauses.push(`${field} IN (${ph})`);
                args.push(...inVals.map((v: any) => this.serializeValue(v)));
                break;
              }
              case '$nin': {
                const ninVals = opValue as any[];
                const ph = ninVals.map(() => '?').join(', ');
                clauses.push(`${field} NOT IN (${ph})`);
                args.push(...ninVals.map((v: any) => this.serializeValue(v)));
                break;
              }
              case '$contains':
                clauses.push(`${field} LIKE ?`);
                args.push(`%${opValue}%`);
                break;
              default:
                clauses.push(`${field} = ?`);
                args.push(this.serializeValue(opValue));
            }
          }
        } else {
          // Simple equality: { name: 'Alice' }
          const field = `"${this.mapSortField(key)}"`;
          clauses.push(`${field} = ?`);
          args.push(this.serializeValue(value));
        }
      }
    }

    return {
      whereClauses: clauses.join(' AND '),
      args,
    };
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
   * Serialize a value for @libsql/client args.
   * - `Date` → ISO 8601 string (avoids libsql HTTP transport coercing the
   *   value to a REAL column and round-tripping it as `"<epoch>.0"`).
   * - JSON objects/arrays are stringified.
   * - booleans are kept as-is (libsql handles them).
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
