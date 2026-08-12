// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { DriverOptions } from '@objectstack/spec/data';
// [#6520] `asciiCaseInsensitiveRegexSource` is `$icontains`' fold, defined once
// in the spec: this face hands a PATTERN to mingo rather than comparing two
// strings, so the fold has to live in the pattern source. See its docblock for
// why an `i` flag is the wrong tool.
import { canonicalAstOperator, asciiCaseInsensitiveRegexSource } from '@objectstack/spec/data';
// [#7536] `$like`/`$ilike`'s pattern language, from the spec's one definition —
// the same translation `formula` evaluates and the same pattern `driver-sql`
// hands to LIKE/GLOB, so this face cannot answer a pattern differently.
import { hasDanglingLikeEscape, likePatternToRegexSource } from '@objectstack/spec/data';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import { Logger, createLogger, nextUtcCalendarDay } from '@objectstack/core';
import { Query, Aggregator } from 'mingo';
import { assertSingleTenantPosture, assertObjectsNotTenantScoped } from './memory-tenancy-guard.js';
import { getValueByPath } from './memory-matcher.js';
import {
  assertFilterConditionShape,
  filterArrayReachedDriverError,
  filterNodeExpectedError,
  filterNodeListExpectedError,
  malformedBetweenError,
  nonBooleanNullComparandError,
  unknownFieldOperatorError,
  unknownLogicalOperatorError,
  unsupportedFilterError,
  // [#7536] The `$like`/`$ilike` comparand refusals, beside their siblings.
  likePatternComparandError,
  danglingLikeEscapeError,
} from './filter-refusal.js';
import {
  coerceTemporalValue,
  indexTemporalFields,
  type TemporalFieldKind,
} from './memory-temporal.js';

/**
 * Persistence adapter interface.
 * Matches the PersistenceAdapterSchema contract from @objectstack/spec.
 */
export interface PersistenceAdapterInterface {
  load(): Promise<Record<string, any[]> | null>;
  save(db: Record<string, any[]>): Promise<void>;
  flush(): Promise<void>;
  /** Optional: Start periodic auto-save (used by FileSystemPersistenceAdapter). */
  startAutoSave?(): void;
  /** Optional: Stop auto-save timer and flush pending writes. */
  stopAutoSave?(): Promise<void>;
}

/**
 * Configuration options for the InMemory driver.
 * Aligned with @objectstack/spec MemoryConfigSchema.
 */
export interface InMemoryDriverConfig {
  /** Optional: Initial data to populate the store */
  initialData?: Record<string, Record<string, unknown>[]>;
  /** Optional: Enable strict mode (throw on missing records) */
  strictMode?: boolean;
  /** Optional: Logger instance */
  logger?: Logger;
  /**
   * Persistence configuration. **Defaults to `false` — pure in-memory.**
   * - `false` (default) — No persistence. `new InMemoryDriver()` keeps nothing
   *   across process exits, which is what the driver's name promises.
   * - `'auto'` — Auto-detect environment (browser → localStorage, Node.js → file, serverless → disabled)
   * - `'file'` — File-system persistence with defaults (Node.js only)
   * - `'local'` — localStorage persistence with defaults (Browser only)
   * - `{ type: 'file', path?: string, autoSaveInterval?: number }` — File-system with options
   * - `{ type: 'local', key?: string }` — localStorage with options
   * - `{ type: 'auto', path?: string, key?: string, autoSaveInterval?: number }` — Auto-detect with options
   * - `{ adapter: PersistenceAdapterInterface }` — Custom adapter
   *
   * Durability is **opt-in**, as #815 specified ("默认情况下不启用持久化（纯内存，行为不变）",
   * requirement #1, with `new InMemoryDriver()` listed as the pure-memory example).
   * The `'auto'` default this driver shipped with was a drift from that accepted
   * design, and it silently wrote `.objectstack/data/memory-driver.json` into the
   * process CWD on every Node.js run — which made any suite seeded with fixed ids
   * pass once and fail on every rerun (#4065). A host that wants durability now
   * says so: `persistence: 'file'` / `'local'` / `'auto'`.
   *
   * ⚠️ In serverless environments (Vercel, AWS Lambda, Netlify, etc.),
   * auto mode disables file persistence to prevent silent data loss.
   * Supply a custom adapter for serverless deployments.
   */
  persistence?: string | false | {
    type?: 'file' | 'local' | 'auto';
    path?: string;
    key?: string;
    autoSaveInterval?: number;
    adapter?: PersistenceAdapterInterface;
  };
}

/**
 * Snapshot for in-memory transactions.
 */
interface MemoryTransaction {
  id: string;
  snapshot: Record<string, any[]>;
}

/**
 * In-Memory Driver for ObjectStack
 *
 * An implementation of the ObjectStack Driver Protocol powered by Mingo — a
 * MongoDB-compatible query and aggregation engine.
 *
 * Features:
 * - MongoDB-compatible query engine (Mingo) for filtering, projection, aggregation
 * - Full CRUD and bulk operations
 * - Aggregation pipeline support ($match, $group, $sort, $project, $unwind, etc.)
 * - Snapshot-based transactions (begin/commit/rollback)
 * - Field projection and distinct values
 * - Strict mode and initial data loading
 *
 * ## What this driver does NOT enforce
 *
 * It stores no constraints of any kind. {@link create} is a `table.push()` and
 * {@link syncSchema} only allocates an array and indexes temporal fields, so
 * there is no primary key, no uniqueness, no `NOT NULL`, no foreign key and no
 * column typing. `bulkCreate` will happily land two rows with the same `id`
 * where a SQL driver raises a constraint violation, and a read returns both.
 *
 * That makes it a WEAK oracle: code green against this driver can still be
 * broken against the SQL engines production runs on. Prefer in-memory SQLite
 * for tests — `SqlDriver` with `connection: { filename: ':memory:' }`, or
 * `SqliteWasmDriver({ filename: ':memory:' })` where no native build is wanted.
 * This driver's remaining roles are the last-resort rung of the dev step-down
 * (native better-sqlite3 → WASM SQLite → here), browser/edge runtimes where no
 * SQLite build is available, and the cross-driver read-coercion parity gate.
 *
 * The docstring said "production-ready" until #4065; the constraints above were
 * true then too, and saying so is the fix (Prime Directive #10 — never advertise
 * a capability the runtime does not deliver).
 *
 * Reference: objectql/packages/drivers/memory
 */
export class InMemoryDriver implements IDataDriver {
  readonly name = 'com.objectstack.driver.memory';
  type = 'driver';
  readonly version = '1.0.0';
  private config: InMemoryDriverConfig;
  private logger: Logger;
  private idCounters: Map<string, number> = new Map();

  /**
   * Declared temporal fields per object, populated by {@link syncSchema} —
   * this driver's equivalent of `SqlDriver.datetimeFields`/`dateFields`, and
   * the only thing that lets write and filter agree on a storage form (#4047).
   * An object absent from this map was never declared, so nothing is coerced
   * for it: the driver does not guess types from values.
   */
  private temporalFields: Map<string, Map<string, TemporalFieldKind>> = new Map();
  private transactions: Map<string, MemoryTransaction> = new Map();
  private persistenceAdapter: PersistenceAdapterInterface | null = null;

  constructor(config?: InMemoryDriverConfig) {
    // #6915 — this driver has NO row-level tenant isolation, so it refuses a
    // multi-tenant deployment outright rather than serving it unisolated.
    // Construction is the earliest seam and the one behind no escape hatch:
    // `connect()` re-checks (and is what aborts kernel bootstrap with this
    // message), but `ObjectQLEngine.init()` downgrades a connect rejection to a
    // warning under `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`, which would boot
    // unisolated again. See `memory-tenancy-guard.ts`.
    assertSingleTenantPosture();
    this.config = config || {};
    this.logger = config?.logger || createLogger({ level: 'info', format: 'pretty' });
    this.logger.debug('InMemory driver instance created');
  }

  // Duck-typed RuntimePlugin hook
  install(ctx: any) {
    this.logger.debug('Installing InMemory driver via plugin hook');
    if (ctx.engine && ctx.engine.ql && typeof ctx.engine.ql.registerDriver === 'function') {
        ctx.engine.ql.registerDriver(this);
        this.logger.info('InMemory driver registered with ObjectQL engine');
    } else {
        this.logger.warn('Could not register driver - ObjectQL engine not found in context');
    }
  }
  
  /**
   * Capability advertisement (#4634, ADR-0049): only the bits with an engine
   * reader survive, and this driver truthfully claims none of them — the
   * engine's in-memory autonumber counter, in-memory date bucketing and
   * per-object `syncSchema()` calls are exactly what it needs. Everything the
   * old 30-bit literal declared (transactions, filters, sorting, …) is
   * expressed by the methods this class implements; the bits were read by
   * nothing and two of them were WRONG for years (`streaming: true` over a
   * full-table read — see #4484/#4634).
   */
  readonly supports = {};

  /**
   * The "Database": A map of TableName -> Array of Records
   */
  private db: Record<string, any[]> = {};
  /** Tables this driver created since connect — see {@link getSchemaSyncStats}. */
  private tablesCreatedHere: Set<string> = new Set();
  /** Tables that were already populated when this driver first synced them. */
  private tablesFoundExisting: Set<string> = new Set();

  // ===================================
  // Lifecycle
  // ===================================

  async connect() {
    // #6915 — re-checked here (not just in the constructor) because a host may
    // flip the posture between construction and connect, and because a rejection
    // from here is what `ObjectQLEngine.init()` turns into a `DriverConnectError`
    // that aborts kernel bootstrap (framework#3741).
    assertSingleTenantPosture();

    // Initialize persistence adapter if configured
    await this.initPersistence();

    // Load persisted data if available
    if (this.persistenceAdapter) {
      const persisted = await this.persistenceAdapter.load();
      if (persisted) {
        for (const [objectName, records] of Object.entries(persisted)) {
          this.db[objectName] = records;
          // Update ID counters based on persisted data
          for (const record of records) {
            if (record.id && typeof record.id === 'string') {
              // ID format: {objectName}-{timestamp}-{counter}
              const parts = record.id.split('-');
              const lastPart = parts[parts.length - 1];
              const counter = parseInt(lastPart, 10);
              if (!isNaN(counter)) {
                const current = this.idCounters.get(objectName) || 0;
                if (counter > current) {
                  this.idCounters.set(objectName, counter);
                }
              }
            }
          }
        }
        this.logger.info('InMemory Database restored from persistence', {
          tables: Object.keys(persisted).length,
        });
      }
    }

    // Load initial data if provided
    if (this.config.initialData) {
      for (const [objectName, records] of Object.entries(this.config.initialData)) {
        const table = this.getTable(objectName);
        for (const record of records) {
          const id = (record as any).id || this.generateId(objectName);
          table.push({ ...record, id });
        }
      }
      this.logger.info('InMemory Database Connected with initial data', {
        tables: Object.keys(this.config.initialData).length,
      });
    } else {
      this.logger.info('InMemory Database Connected (Virtual)');
    }

    // Start auto-save if using file adapter
    if (this.persistenceAdapter?.startAutoSave) {
      this.persistenceAdapter.startAutoSave();
    }
  }

  async disconnect() {
    // Stop auto-save and flush pending writes
    if (this.persistenceAdapter) {
      if (this.persistenceAdapter.stopAutoSave) {
        await this.persistenceAdapter.stopAutoSave();
      }
      await this.persistenceAdapter.flush();
    }

    const tableCount = Object.keys(this.db).length;
    const recordCount = Object.values(this.db).reduce((sum, table) => sum + table.length, 0);
    
    this.db = {};
    this.logger.info('InMemory Database Disconnected & Cleared', { 
      tableCount, 
      recordCount 
    });
  }

  async checkHealth() {
    this.logger.debug('Health check performed', { 
      tableCount: Object.keys(this.db).length,
      status: 'healthy' 
    });
    return true; 
  }

  // ===================================
  // Execution
  // ===================================

  async execute(command: any, params?: any[]) {
    this.logger.warn('Raw execution not supported in InMemory driver', { command });
    return null;
  }

  // ===================================
  // CRUD
  // ===================================

  async find(object: string, query: DriverQuery, options?: DriverOptions) {
    this.logger.debug('Find operation', { object, query });
    
    const table = this.getTable(object);
    let results = [...table]; // Work on copy

    // 1. Filter using Mingo
    if (query.where) {
        const mongoQuery = this.convertToMongoQuery(query.where, object);
        if (mongoQuery && Object.keys(mongoQuery).length > 0) {
          const mingoQuery = new Query(mongoQuery);
          results = mingoQuery.find(results).all();
        }
    }

    // 1.5 Aggregation & Grouping
    if (query.groupBy || (query.aggregations && query.aggregations.length > 0)) {
        results = this.performAggregation(results, query);
    }

    // 2. Sort
    if (query.orderBy) {
        const sortFields = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy];
        results = this.applySort(results, sortFields);
    }

    // 3. Pagination (Offset)
    if (query.offset) {
        results = results.slice(query.offset);
    }

    // 4. Pagination (Limit)
    //
    // PRESENCE, not truthiness (#6577). `limit: 0` means "return no records"
    // (#6485), and `0` is falsy — so `if (query.limit)` dropped the slice and
    // answered a request for NOTHING with the WHOLE table. Measured before this
    // line changed, three rows seeded: `{ limit: 0 }` returned 3, and
    // `{ limit: 0, offset: 1 }` returned 2 — the OFFSET applied and the LIMIT
    // silently did not, which is why the shape survived every paging suite.
    //
    // `offset` above is deliberately left on truthiness: `slice(0)` IS the
    // identity slice, so presence and truthiness cannot be told apart there —
    // no behaviour to fix. The #5499 freeze exception granted here is the limit
    // door only.
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    // 5. Field Projection
    if (query.fields && Array.isArray(query.fields) && query.fields.length > 0) {
      results = results.map(record => this.projectFields(record, query.fields!));
    } else {
      // Return shallow copies, never live references into the backing table.
      // `create()` already honors this contract (`return { ...newRecord }`),
      // and callers (notably the engine's read-time mutations — secret-field
      // masking, expand, afterFind hooks) mutate returned rows in place. Handing
      // back live references would corrupt the stored record on read — e.g. a
      // masked `secret:` ref overwritten with the mask, permanently losing the
      // secret. The projection branch above already produces fresh objects.
      results = results.map(record => ({ ...record }));
    }

    this.logger.debug('Find completed', { object, resultCount: results.length });
    return results;
  }

  // `findStream` was removed with the contract method in 17.0.0 (#4484). Like the SQL
  // driver's, this implementation awaited `find()` in full and then yielded row by
  // row — the whole table was already in memory before the first `yield`. Nothing
  // called it. Page through `find()` with `limit`/`offset`.

  async findOne(object: string, query: DriverQuery, options?: DriverOptions) {
    this.logger.debug('FindOne operation', { object, query });
    
    const results = await this.find(object, { ...query, limit: 1 }, options);
    const result = results[0] || null;
    
    this.logger.debug('FindOne completed', { object, found: !!result });
    return result;
  }

  // The `IDataDriver.create` return type, spelled out: without it TS infers the
  // literal built below (`{ id, created_at, updated_at }`) and every OTHER
  // column of the created row vanishes from the caller's view (#4311 — the
  // driver's own tests read `.name` off a create() result and no tsc had ever
  // told them it wasn't there).
  async create(object: string, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, any>> {
    this.logger.debug('Create operation', { object, hasData: !!data });
    
    const table = this.getTable(object);
    
    const newRecord = this.toStorageForms(object, {
      id: data.id || this.generateId(object),
      ...data,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    });

    table.push(newRecord);
    this.markDirty();
    this.logger.debug('Record created', { object, id: newRecord.id, tableSize: table.length });
    return { ...newRecord };
  }

  async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions) {
    this.logger.debug('Update operation', { object, id });
    
    const table = this.getTable(object);
    const index = table.findIndex(r => r.id == id);
    
    if (index === -1) {
      if (this.config.strictMode) {
        this.logger.warn('Record not found for update', { object, id });
        throw new Error(`Record with ID ${id} not found in ${object}`);
      }
      return null;
    }

    const updatedRecord = this.toStorageForms(object, {
      ...table[index],
      ...data,
      id: table[index].id, // Preserve original ID
      created_at: table[index].created_at, // Preserve created_at
      updated_at: new Date().toISOString(),
    });
    
    table[index] = updatedRecord;
    this.markDirty();
    this.logger.debug('Record updated', { object, id });
    return { ...updatedRecord };
  }

  async upsert(object: string, data: Record<string, any>, conflictKeys?: string[], options?: DriverOptions) {
    this.logger.debug('Upsert operation', { object, conflictKeys });
    
    const table = this.getTable(object);
    let existingRecord: any = null;

    if (data.id) {
        existingRecord = table.find(r => r.id === data.id);
    } else if (conflictKeys && conflictKeys.length > 0) {
        existingRecord = table.find(r => conflictKeys.every(key => r[key] === data[key]));
    }

    if (existingRecord) {
        this.logger.debug('Record exists, updating', { object, id: existingRecord.id });
        return this.update(object, existingRecord.id, data, options);
    } else {
        this.logger.debug('Record does not exist, creating', { object });
        return this.create(object, data, options);
    }
  }

  async delete(object: string, id: string | number, options?: DriverOptions) {
    this.logger.debug('Delete operation', { object, id });
    
    const table = this.getTable(object);
    const index = table.findIndex(r => r.id == id);
    
    if (index === -1) {
      if (this.config.strictMode) {
        throw new Error(`Record with ID ${id} not found in ${object}`);
      }
      this.logger.warn('Record not found for deletion', { object, id });
      return false;
    }

    table.splice(index, 1);
    this.markDirty();
    this.logger.debug('Record deleted', { object, id, tableSize: table.length });
    return true;
  }

  async count(object: string, query?: DriverQuery, options?: DriverOptions) {
    let records = this.getTable(object);
    if (query?.where) {
        const mongoQuery = this.convertToMongoQuery(query.where, object);
        if (mongoQuery && Object.keys(mongoQuery).length > 0) {
          const mingoQuery = new Query(mongoQuery);
          records = mingoQuery.find(records).all();
        }
    }
    const count = records.length;
    this.logger.debug('Count operation', { object, count });
    return count;
  }

  // ===================================
  // Bulk Operations
  // ===================================

  async bulkCreate(object: string, dataArray: Record<string, any>[], options?: DriverOptions): Promise<Record<string, any>[]> {
    this.logger.debug('BulkCreate operation', { object, count: dataArray.length });
    const results = await Promise.all(dataArray.map(data => this.create(object, data, options)));
    this.logger.debug('BulkCreate completed', { object, count: results.length });
    return results;
  }
  
  async updateMany(object: string, query: DriverQuery, data: Record<string, any>, options?: DriverOptions): Promise<number> {
      this.logger.debug('UpdateMany operation', { object, query });
      
      const table = this.getTable(object);
      let targetRecords = table;
      
      if (query && query.where) {
          const mongoQuery = this.convertToMongoQuery(query.where, object);
          if (mongoQuery && Object.keys(mongoQuery).length > 0) {
            const mingoQuery = new Query(mongoQuery);
            targetRecords = mingoQuery.find(targetRecords).all();
          }
      }
      
      const count = targetRecords.length;
      
      for (const record of targetRecords) {
          const index = table.findIndex(r => r.id === record.id);
          if (index !== -1) {
              const updated = this.toStorageForms(object, {
                  ...table[index],
                  ...data,
                  updated_at: new Date().toISOString()
              });
              table[index] = updated;
          }
      }
      
      if (count > 0) this.markDirty();
      this.logger.debug('UpdateMany completed', { object, count });
      return count;
  }

  async deleteMany(object: string, query: DriverQuery, options?: DriverOptions): Promise<number> {
      this.logger.debug('DeleteMany operation', { object, query });
      
      const table = this.getTable(object);
      const initialLength = table.length;
      
      if (query && query.where) {
          const mongoQuery = this.convertToMongoQuery(query.where, object);
          if (mongoQuery && Object.keys(mongoQuery).length > 0) {
            const mingoQuery = new Query(mongoQuery);
            const matched = mingoQuery.find(table).all();
            const matchedIds = new Set(matched.map((r: any) => r.id));
            this.db[object] = table.filter(r => !matchedIds.has(r.id));
          } else {
            // Empty query = delete all
            this.db[object] = [];
          }
      } else {
          // No where clause = delete all
          this.db[object] = [];
      }
      
      const count = initialLength - this.db[object].length;
      if (count > 0) this.markDirty();
      this.logger.debug('DeleteMany completed', { object, count });
      return count;
  }

  // Compatibility aliases
  async bulkUpdate(object: string, updates: { id: string | number, data: Record<string, any> }[], options?: DriverOptions) {
    this.logger.debug('BulkUpdate operation', { object, count: updates.length });
    const results = await Promise.all(updates.map(u => this.update(object, u.id, u.data, options)));
    this.logger.debug('BulkUpdate completed', { object, count: results.length });
    return results;
  }

  async bulkDelete(object: string, ids: (string | number)[], options?: DriverOptions) {
    this.logger.debug('BulkDelete operation', { object, count: ids.length });
    await Promise.all(ids.map(id => this.delete(object, id, options)));
    this.logger.debug('BulkDelete completed', { object, count: ids.length });
  }

  // ===================================
  // Transaction Management
  // ===================================

  async beginTransaction() {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Deep-clone current database state as a snapshot
    const snapshot: Record<string, any[]> = {};
    for (const [table, records] of Object.entries(this.db)) {
      snapshot[table] = records.map(r => ({ ...r }));
    }

    const transaction: MemoryTransaction = { id: txId, snapshot };
    this.transactions.set(txId, transaction);
    this.logger.debug('Transaction started', { txId });
    return { id: txId };
  }

  async commit(txHandle?: unknown) {
    const txId = (txHandle as any)?.id;
    if (!txId || !this.transactions.has(txId)) {
      this.logger.warn('Commit called with unknown transaction');
      return;
    }
    // Data is already in the store; just remove the snapshot
    this.transactions.delete(txId);
    this.logger.debug('Transaction committed', { txId });
  }

  async rollback(txHandle?: unknown) {
    const txId = (txHandle as any)?.id;
    if (!txId || !this.transactions.has(txId)) {
      this.logger.warn('Rollback called with unknown transaction');
      return;
    }
    const tx = this.transactions.get(txId)!;
    // Restore the snapshot
    this.db = tx.snapshot;
    this.transactions.delete(txId);
    this.markDirty();
    this.logger.debug('Transaction rolled back', { txId });
  }

  // ===================================
  // Utility Methods
  // ===================================

  /**
   * Remove all data from the store.
   */
  async clear() {
    this.db = {};
    this.idCounters.clear();
    this.markDirty();
    this.logger.debug('All data cleared');
  }

  /**
   * Get total number of records across all tables.
   */
  getSize(): number {
    return Object.values(this.db).reduce((sum, table) => sum + table.length, 0);
  }

  /**
   * Get distinct values for a field, optionally filtered.
   */
  async distinct(object: string, field: string, query?: DriverQuery): Promise<any[]> {
    let records = this.getTable(object);
    if (query?.where) {
      const mongoQuery = this.convertToMongoQuery(query.where, object);
      if (mongoQuery && Object.keys(mongoQuery).length > 0) {
        const mingoQuery = new Query(mongoQuery);
        records = mingoQuery.find(records).all();
      }
    }
    const values = new Set<any>();
    for (const record of records) {
      const value = getValueByPath(record, field);
      if (value !== undefined && value !== null) {
        values.add(value);
      }
    }
    return Array.from(values);
  }

  /**
   * Execute a MongoDB-style aggregation pipeline using Mingo.
   * 
   * Supports all standard MongoDB pipeline stages:
   * - $match, $group, $sort, $project, $unwind, $limit, $skip
   * - $addFields, $replaceRoot, $lookup (limited), $count
   * - Accumulator operators: $sum, $avg, $min, $max, $first, $last, $push, $addToSet
   * 
   * @example
   * // Group by status and count
   * const results = await driver.aggregate('orders', [
   *   { $match: { status: 'completed' } },
   *   { $group: { _id: '$customer', totalAmount: { $sum: '$amount' } } }
   * ]);
   * 
   * @example
   * // Calculate average with filter
   * const results = await driver.aggregate('products', [
   *   { $match: { category: 'electronics' } },
   *   { $group: { _id: null, avgPrice: { $avg: '$price' } } }
   * ]);
   */
  async aggregate(object: string, pipeline: Record<string, any>[] | DriverQuery, options?: DriverOptions): Promise<any[]> {
    // ObjectQL's engine calls driver.aggregate(object, AST) with the SAME
    // DriverQuery shape find() consumes ({ where, groupBy, aggregations }) — not
    // a MongoDB pipeline. Passing that object into Mingo's Aggregator crashed
    // with "this[#pipeline].map is not a function" (the analytics fallback path
    // on in-memory environments). Detect the AST shape and serve it through the
    // SAME filtering + performAggregation path find() uses; a real pipeline
    // array keeps the Mingo behavior unchanged.
    //
    // BOTH arms of the union have live producers, so neither may be retired:
    // the pipeline arm is fed by `memory-analytics.ts` (`this.driver.aggregate(
    // tableName, pipeline)`), the AST arm by objectql's engine and
    // `@objectstack/verify`'s date-bucket parity probe.
    if (!Array.isArray(pipeline)) {
      const query = pipeline;
      this.logger.debug('Aggregate operation (QueryAST)', {
        object,
        groupBy: (query as any).groupBy,
        aggregations: (query as any).aggregations?.length ?? 0,
      });
      let results = this.getTable(object).map((r) => ({ ...r }));
      if (query.where) {
        const mongoQuery = this.convertToMongoQuery(query.where, object);
        if (mongoQuery && Object.keys(mongoQuery).length > 0) {
          results = new Query(mongoQuery).find(results).all() as Record<string, any>[];
        }
      }
      return this.performAggregation(results, query);
    }

    this.logger.debug('Aggregate operation', { object, stageCount: pipeline.length });

    const records = this.getTable(object).map(r => ({ ...r }));
    const aggregator = new Aggregator(pipeline);
    const results = aggregator.run(records);

    this.logger.debug('Aggregate completed', { object, resultCount: results.length });
    return results;
  }

  // ===================================
  // Query Conversion (ObjectQL → MongoDB)
  // ===================================

  /**
   * Convert ObjectQL filter format to MongoDB query format for Mingo.
   *
   * Supports:
   * 1. AST Comparison Node: { type: 'comparison', field, operator, value }
   * 2. AST Logical Node: { type: 'logical', operator: 'and'|'or', conditions: [...] }
   * 3. MongoDB Format: { field: value } or { field: { $eq: value } } (passthrough)
   *
   * The legacy ARRAY format (`[['field','op',value], 'and', […]]`) is no longer
   * one of them — see {@link filterArrayReachedDriverError} and #5158. It was a
   * second filter compiler for a shape the spec never declared on `where`, and
   * both doors into the runtime now lower `FilterArray` through
   * `parseFilterAST` before a driver is reached.
   */
  private convertToMongoQuery(filters?: any, object?: string): Record<string, any> {
    if (!filters) return {};

    if (Array.isArray(filters)) {
      // `[]` still means "no filter" — unchanged.
      if (filters.length === 0) return {};
      throw filterArrayReachedDriverError(filters);
    }

    // AST node format (ObjectQL QueryAST)
    if (typeof filters === 'object') {
      if (filters.type === 'comparison') {
        return this.convertConditionToMongo(filters.field, filters.operator, filters.value, object) || {};
      }
      if (filters.type === 'logical') {
        const conditions = filters.conditions?.map((c: any) => this.convertToMongoQuery(c, object)) || [];
        if (conditions.length === 0) return {};
        if (conditions.length === 1) return conditions[0];
        const op = filters.operator === 'or' ? '$or' : '$and';
        return { [op]: conditions };
      }
      // MongoDB/FilterCondition format: { field: value } or { field: { $op: value } }
      // [#5324/#5328] Shape first, then translate — the SAME gate the reference
      // matcher runs (`filter-refusal.ts`), so the two faces cannot answer one
      // filter differently again. It must run before `normalizeFilterCondition`
      // and not inside it: the translator recurses per key and would therefore
      // refuse or not refuse depending on where in the tree it gave up.
      assertFilterConditionShape(filters, 'filter');
      // Translate non-standard operators ($contains, $notContains, etc.) to Mingo-compatible format
      return this.normalizeFilterCondition(filters, object);
    }

    // A truthy non-object, non-array `where` emits no predicate. Pre-existing
    // behaviour on a shape only a cast can produce; untouched by #5158, which
    // is about the array dialect.
    return {};
  }

  /**
   * Convert a single ObjectQL condition to MongoDB operator format.
   */
  private convertConditionToMongo(field: string, operator: string, value: any, object?: string): Record<string, any> | null {
    const store = (v: any) => this.toStorageForm(object, field, v);
    // Fold every accepted spelling of one comparison onto a single infix form,
    // so this switch has one case per comparison rather than one per spelling —
    // `VALID_AST_OPERATORS` accepts `>`, `gt`, `greater_than`, `greaterthan` and
    // `after` for the same thing. A private alias list here is what let this
    // driver and driver-sql accept different vocabularies. #3948.
    const canonical = canonicalAstOperator(operator);
    switch (canonical) {
      case '=': case '==':
        return { [field]: store(value) };
      case '!=': case '<>':
        return { [field]: { $ne: store(value) } };
      case '>':
        return { [field]: { $gt: store(value) } };
      case '>=':
        return { [field]: { $gte: store(value) } };
      case '<':
        return { [field]: { $lt: store(value) } };
      case '<=': {
        // A bare-day upper bound means "through that whole day" (#4042, the
        // driver-sql twin is #3777): `<= 2026-07-28` on an ISO-timestamp value
        // compiles half-open (`< 2026-07-29`), which is also order-equivalent
        // to `<=` for plain `YYYY-MM-DD` date values — so no field-type lookup
        // is needed, exactly the argument the preview evaluator uses.
        const nextDay = nextUtcCalendarDay(value);
        return { [field]: nextDay != null ? { $lt: store(nextDay) } : { $lte: store(value) } };
      }
      case 'in':
        return { [field]: { $in: store(value) } };
      case 'nin': case 'not_in': case 'notin': case 'not in':
        return { [field]: { $nin: store(value) } };
      // [#6682] The `$contains` family is case-SENSITIVE (#4706 Q2 = A), here
      // and on every other spelling of it in this file. The `i` flag these four
      // arms used to carry was the FULL Unicode fold — wider even than the
      // ASCII-only boundary `$icontains` is held to (Q1 = A) — so a filter
      // returned rows it excludes, which on an RLS read scope is over-reach
      // rather than a loose filter (#3948). `escapeRegex` stays: the comparand
      // was always literal, and that half was never the defect.
      case 'contains':
        return { [field]: { $regex: new RegExp(this.escapeRegex(value)) } };
      // [#7536] `like` / `ilike` are NOT `contains`, and sharing this arm with
      // it was the memory-face twin of the wire defect #7536 closed: the
      // comparand was regex-ESCAPED (so a caller's `%` matched a literal percent
      // sign) and matched as a SUBSTRING (so a wildcard-free pattern matched
      // anywhere in the value). Both readings answer a query nobody wrote.
      //
      // Now the same pattern translation the `$`-spelling takes one method over,
      // so this driver answers one filter one way whichever door it came
      // through (#3948).
      case 'like': case 'ilike': {
        if (typeof value !== 'string') throw likePatternComparandError(field, canonical, value);
        if (hasDanglingLikeEscape(value)) throw danglingLikeEscapeError(field, canonical, value);
        return {
          [field]: { $regex: new RegExp(likePatternToRegexSource(value, canonical === 'ilike')) },
        };
      }
      case 'notcontains': case 'not_contains':
        return { [field]: { $not: { $regex: new RegExp(this.escapeRegex(value)) } } };
      case 'startswith': case 'starts_with':
        return { [field]: { $regex: new RegExp(`^${this.escapeRegex(value)}`) } };
      case 'endswith': case 'ends_with':
        return { [field]: { $regex: new RegExp(`${this.escapeRegex(value)}$`) } };
      // Null / empty predicates. These are in `VALID_AST_OPERATORS` and were
      // absent here, so every one of them fell to `default: return null` and was
      // dropped — `is_null` narrowed nothing instead of matching null rows.
      // Alias sets and semantics mirror driver-sql's `whereNull`/`whereNotNull`
      // arms so both backends accept the same vocabulary. In a document store
      // `{field: null}` matches null AND missing, and `$ne: null` excludes both,
      // which is the right analogue of SQL IS [NOT] NULL. #3948.
      case 'is_null': case 'isnull': case 'is_empty': case 'isempty': case 'empty':
        return { [field]: null };
      case 'is_not_null': case 'isnotnull':
      case 'is_not_empty': case 'isnotempty': case 'not_empty': case 'notempty':
      case 'is_set': case 'set':
        return { [field]: { $ne: null } };
      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          // Bare-day max → half-open, inheriting `<=`'s whole-day rule (#4042).
          const nextDay = nextUtcCalendarDay(value[1]);
          return {
            [field]: nextDay != null
              ? { $gte: store(value[0]), $lt: store(nextDay) }
              : { $gte: store(value[0]), $lte: store(value[1]) },
          };
        }
        // [#5328] One condition, one wording — the same refusal the
        // FilterCondition `$between` arm raises. They used to differ, which is
        // how a caller reading two messages could believe they had hit two
        // different problems.
        throw malformedBetweenError(field, value, `filter.${field}.between`);
      default:
        // Was `return null`, which the caller dropped — so an operator this
        // driver cannot express narrowed nothing instead of erroring. driver-sql
        // already threw on the same input; the two backends disagreed. #3948.
        throw unsupportedFilterError(
          `Unsupported filter operator "${operator}" on field "${field}". ` +
            `Supported operators: =, !=, <, <=, >, >=, in, nin, between, contains, ` +
            `not_contains, starts_with, ends_with (see @objectstack/spec VALID_AST_OPERATORS).`,
        );
    }
  }

  /**
   * Normalize a FilterCondition object by converting non-standard $-prefixed
   * operators ($contains, $notContains, $startsWith, $endsWith, $between, $null)
   * to Mingo-compatible equivalents ($regex, $gte/$lte, null checks).
   *
   * [#5324/#5328] TRANSLATION ONLY. Every shape decision — the operator
   * vocabulary, `$between`'s arity, what may sit in a node position — was made
   * by `assertFilterConditionShape` before this ran, on the whole tree at once.
   * The refusals still written here are the totality floor a translator owes
   * itself (`driver-sql` keeps its emitter's `default: throw` beside
   * `reduceFilterNode` for the same reason): unreachable through
   * `convertToMongoQuery`, and the honest answer if this method is ever called
   * from somewhere new.
   */
  private normalizeFilterCondition(filter: Record<string, any>, object?: string, path = 'filter'): Record<string, any> {
    const result: Record<string, any> = {};
    const extraAndConditions: Record<string, any>[] = [];

    for (const key of Object.keys(filter)) {
      const value = filter[key];
      const here = `${path}.${key}`;
      // Recurse into logical operators
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value)) throw filterNodeListExpectedError(key, value, here);
        result[key] = value.map((child: any, i: number) => this.normalizeFilterCondition(child, object, `${here}[${i}]`));
        continue;
      }
      if (key === '$not') {
        // [#5324] The whole point of the issue. `$not` is a declared combinator
        // (spec `LOGICAL_OPERATORS`), `driver-sql` compiles it, `memory-matcher`
        // evaluates it, and `cel-to-filter` EMITS it — a CEL `!expr` in an RLS
        // read scope lowers to `{ $not: {…} }`. Passing it through unchanged
        // meant mingo received a document-level `$not`, which MongoDB does not
        // have: `unknown top level operator: $not`, uncoded, on every query
        // carrying a negated scope.
        //
        // `$nor` with one operand IS the document-level negation in MongoDB, and
        // is what `driver-mongodb` rewrites to for the identical reason (#4405).
        // It is also NULL-safe by construction, which is the semantics #5146
        // ruled canonical: a row whose field is null or missing does not satisfy
        // the inner condition, so `$nor` admits it — the same answer this
        // package's matcher and `@objectstack/formula` give, and the one
        // driver-sql was rewritten to match.
        //
        // At most one `$not` per node (it is one object key), so this never
        // overwrites a sibling `$nor`, and an input `$nor` cannot reach here —
        // the shape gate refuses undeclared combinators.
        if (!value || typeof value !== 'object') throw filterNodeExpectedError(value, here);
        result.$nor = [this.normalizeFilterCondition(value, object, here)];
        continue;
      }
      if (key.startsWith('$')) throw unknownLogicalOperatorError(key, here);
      // Field-level: value may be primitive (implicit eq) or operator object
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp)) {
        // A field spec with no `$` keys is a nested-object COMPARAND, not an
        // operator map — mingo compares it structurally, `driver-mongodb` says
        // so explicitly, and the matcher deep-equals it. Handing it to the
        // operator translator would read its field names as operators.
        if (!Object.keys(value).some((k) => k.startsWith('$'))) {
          result[key] = value;
          continue;
        }
        const normalized = this.normalizeFieldOperators(value, this.temporalKind(object, key), key, here);
        // Handle multiple regex conditions on the same field (e.g. $startsWith + $endsWith)
        if (normalized._multiRegex) {
          const regexConditions: Record<string, any>[] = normalized._multiRegex;
          delete normalized._multiRegex;
          // Each regex becomes its own { field: { $regex: ... } } inside $and
          for (const rc of regexConditions) {
            extraAndConditions.push({ [key]: { ...normalized, ...rc } });
          }
        } else {
          result[key] = normalized;
        }
      } else {
        // Implicit equality — still a comparand, so it takes the storage form.
        result[key] = this.toStorageForm(object, key, value);
      }
    }

    // Merge extra $and conditions from multi-regex fields
    if (extraAndConditions.length > 0) {
      const existing = result.$and;
      const andArray = Array.isArray(existing) ? existing : [];
      // Include the rest of result as a condition too
      if (Object.keys(result).filter(k => k !== '$and').length > 0) {
        const rest = { ...result };
        delete rest.$and;
        andArray.push(rest);
      }
      andArray.push(...extraAndConditions);
      return { $and: andArray };
    }

    return result;
  }

  /**
   * Convert non-standard field operators to Mingo-compatible format.
   * When multiple regex-producing operators appear on the same field
   * (e.g. $startsWith + $endsWith), they are combined via $and.
   *
   * `field` and `path` are carried only so a refusal can name the position it
   * refused — the vocabulary itself is enforced one level up (#5324).
   */
  private normalizeFieldOperators(ops: Record<string, any>, kind?: TemporalFieldKind, field = '<field>', path = 'filter'): Record<string, any> {
    const store = (v: any) => coerceTemporalValue(v, kind);
    const result: Record<string, any> = {};
    const regexConditions: Record<string, any>[] = [];

    for (const op of Object.keys(ops)) {
      const val = ops[op];
      switch (op) {
        // [#6682] Case-SENSITIVE, the same four arms as the AST spelling one
        // method up (`convertConditionToMongo`) and for the same reason — see
        // the note there. The comparand stays `escapeRegex`-literal; only the
        // Unicode-folding `i` flag is gone.
        case '$contains':
          regexConditions.push({ $regex: new RegExp(this.escapeRegex(val)) });
          break;
        case '$notContains':
          result.$not = { $regex: new RegExp(this.escapeRegex(val)) };
          break;
        case '$startsWith':
          regexConditions.push({ $regex: new RegExp(`^${this.escapeRegex(val)}`) });
          break;
        case '$endsWith':
          regexConditions.push({ $regex: new RegExp(`${this.escapeRegex(val)}$`) });
          break;
        // [#6520] `$icontains` — case-insensitive over ASCII and NOTHING else.
        //
        // Note what this arm does NOT do: it never passes the `i` flag. That
        // flag is the FULL Unicode fold, so it would match `CAFÉ` against
        // `café` — the answer the SQL family cannot give (SQLite folds ASCII
        // only) and therefore the one the protocol forbids (#4706 Q1 = A). The
        // fold instead lives in the pattern SOURCE, one `[Aa]` class per ASCII
        // letter, built by the spec's shared `asciiCaseInsensitiveRegexSource` —
        // the same source `driver-mongodb` binds, so the two document-shaped
        // faces fold identically.
        //
        // [#6682] The neighbours above carried that flag until this operator's
        // sibling family was made case-exact; the two are still not the same
        // mechanism, and this arm's pattern-source fold is the only one on this
        // face that survives. A bare `new RegExp(v)` beside a bare
        // `new RegExp(escapeRegex(v))` is the shape to keep: this arm folds in
        // the SOURCE, the family does not fold at all.
        case '$icontains':
          regexConditions.push({ $regex: new RegExp(asciiCaseInsensitiveRegexSource(val)) });
          break;
        // [#7536] `$like` / `$ilike` — the caller's OWN pattern, anchored to the
        // whole value. `likePatternToRegexSource` is the spec's one translation
        // of that language, the same one `formula` evaluates and the same
        // pattern `driver-sql` hands to `LIKE` / `GLOB`.
        //
        // Two things this arm must NOT copy from its neighbours above. It does
        // not `escapeRegex` the comparand — a `%` here is the caller's wildcard,
        // and escaping it back into a literal IS the wire defect #7536 closed,
        // reproduced one layer down. And it does not pass the `i` flag: the
        // `$ilike` fold is ASCII-only and lives in the pattern source, for the
        // reason the `$icontains` arm above spells out at length.
        case '$like':
        case '$ilike':
          // The comparand's shape was settled by `assertFieldConstraintShape`
          // on the whole tree before this ran (the #5324/#5328 discipline every
          // arm here follows), so `val` is a string with no dangling escape.
          // The re-check is the totality floor a translator owes itself, the
          // same one `driver-sql`'s emitter keeps beside its own gate.
          if (typeof val !== 'string') throw likePatternComparandError(field, op, val, path);
          if (hasDanglingLikeEscape(val)) throw danglingLikeEscapeError(field, op, val, path);
          regexConditions.push({
            $regex: new RegExp(likePatternToRegexSource(val, op === '$ilike')),
          });
          break;
        case '$between': {
          // [#5328] The arm used to be CONDITIONAL — a comparand that was not a
          // two-element array skipped it and wrote nothing, so the field
          // normalised to `{}` and mingo read that as "matches no row". The
          // range simply vanished, and no one was told. The shape gate refuses
          // it now; this throw is the totality floor.
          if (!Array.isArray(val) || val.length !== 2) throw malformedBetweenError(field, val, `${path}.$between`);
          result.$gte = store(val[0]);
          // Bare-day max → half-open, inheriting `$lte`'s whole-day rule (#4042).
          const betweenNextDay = nextUtcCalendarDay(val[1]);
          if (betweenNextDay != null) result.$lt = store(betweenNextDay);
          else result.$lte = store(val[1]);
          break;
        }
        case '$lte': {
          // A bare-day upper bound means "through that whole day" (#4042; the
          // driver-sql twin is #3777). Order-equivalent to `<=` for plain
          // `YYYY-MM-DD` values, so it applies without a field-type lookup.
          const nextDay = nextUtcCalendarDay(val);
          if (nextDay != null) result.$lt = store(nextDay);
          else result.$lte = store(val);
          break;
        }
        case '$null':
          // $null: true → field is null, $null: false → field is not null
          // Use $eq/$ne null for Mingo compatibility
          //
          // [#5347] The arm used to be a two-branch `if/else` on `val === true`,
          // so EVERY non-boolean comparand fell to the `else` and compiled
          // `$ne: null` — IS NOT NULL. `driver-sql` hung its default on the
          // opposite side (`opValue === false` → IS NULL) and the reference
          // matcher on neither (the constraint vanished), so one declared
          // operator had three readings. The shape gate refuses a non-boolean
          // now; this throw is the totality floor, the same one `$between`
          // keeps beside it.
          if (typeof val !== 'boolean') throw nonBooleanNullComparandError(field, val, `${path}.$null`);
          if (val === true) {
            result.$eq = null;
          } else {
            result.$ne = null;
          }
          break;
        // Value comparisons take the field's storage form (#4047); the null /
        // existence predicates above are value-independent and must not.
        case '$eq': case '$ne': case '$gt': case '$gte': case '$lt':
        case '$in': case '$nin':
          result[op] = store(val);
          break;
        // Evaluated by mingo under the same name. `$exists` is a presence
        // predicate, not a comparand, so it does not take the field's storage
        // form (#4047).
        //
        // [#5702] `$regex` and `$options` were passed through here too, on the
        // same line, for the same "not a comparand" reason. Both are RETIRED
        // (#4706) and refused by the shape gate before this method runs, so the
        // arm is gone rather than left as an unreachable third name — an
        // evaluation arm for a refused operator is exactly what let this
        // driver's two faces answer one `$regex` differently for so long.
        case '$exists':
          result[op] = val;
          break;
        default:
          // [#5324] Was `result[op] = val` — a GENERIC passthrough that handed
          // every unrecognised `$op` to mingo, which answered with a bare
          // `MingoError` (no `code`, no `status`) and so escaped the ADR-0112
          // envelope as a 500-shaped body. The vocabulary gate refuses these
          // before translation; this throw is the totality floor.
          throw unknownFieldOperatorError(op, field, path);
      }
    }

    // Merge regex conditions: single → inline, multiple → wrap with $and
    if (regexConditions.length === 1) {
      Object.assign(result, regexConditions[0]);
    } else if (regexConditions.length > 1) {
      // Cannot have multiple $regex on one object; promote to top-level $and.
      // _multiRegex is an internal sentinel consumed by normalizeFilterCondition().
      result._multiRegex = regexConditions;
    }

    return result;
  }

  /**
   * Escape special regex characters for safe literal matching.
   */
  private escapeRegex(str: string): string {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ===================================
  // Aggregation Logic
  // ===================================

  private performAggregation(records: any[], query: DriverQuery): any[] {
    const { groupBy, aggregations } = query;
    const groups: Map<string, any[]> = new Map();

    const normalizeGroupBy = (node: any): { field: string; alias: string } => {
      if (typeof node === 'string') return { field: node, alias: node };
      return { field: node.field, alias: node.alias ?? node.field };
    };

    // 1. Group records
    if (groupBy && groupBy.length > 0) {
        for (const record of records) {
            // Create a composite key from group values
            const keyParts = groupBy.map(node => {
                const { field } = normalizeGroupBy(node);
                const val = getValueByPath(record, field);
                return val === undefined || val === null ? 'null' : String(val);
            });
            const key = JSON.stringify(keyParts);
            
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(record);
        }
    } else {
        groups.set('all', records);
    }

    // 2. Compute aggregates for each group
    const resultRows: any[] = [];
    
    for (const [_key, groupRecords] of groups.entries()) {
        const row: any = {};
        
        // A. Add Group fields to row (if groupBy exists)
        if (groupBy && groupBy.length > 0) {
             if (groupRecords.length > 0) {
                const firstRecord = groupRecords[0];
                for (const node of groupBy) {
                     const { field, alias } = normalizeGroupBy(node);
                     this.setValueByPath(row, alias, getValueByPath(firstRecord, field));
                }
             }
        }
        
        // B. Compute Aggregations
        if (aggregations) {
            for (const agg of aggregations) {
                 const value = this.computeAggregate(groupRecords, agg);
                 row[agg.alias] = value;
            }
        }
        
        resultRows.push(row);
    }
    
    return resultRows;
  }
  
  private computeAggregate(records: any[], agg: any): any {
      const { function: func, field } = agg;
      
      const values = field ? records.map(r => getValueByPath(r, field)) : [];
      
      switch (func) {
          case 'count':
              if (!field || field === '*') return records.length;
              return values.filter(v => v !== null && v !== undefined).length;
              
          case 'sum':
          case 'avg': {
              const nums = values.filter(v => typeof v === 'number');
              const sum = nums.reduce((a, b) => a + b, 0);
              if (func === 'sum') return sum;
              return nums.length > 0 ? sum / nums.length : null;
          }
              
          case 'min': {
              // Handle comparable values
              const valid = values.filter(v => v !== null && v !== undefined);
              if (valid.length === 0) return null;
              // Works for numbers and strings
              return valid.reduce((min, v) => (v < min ? v : min), valid[0]);
          }

          case 'max': {
              const valid = values.filter(v => v !== null && v !== undefined);
              if (valid.length === 0) return null;
              return valid.reduce((max, v) => (v > max ? v : max), valid[0]);
          }

          // [#6814] Distinct NON-NULL values — what `COUNT(DISTINCT col)`
          // computes on SQLite, PostgreSQL and MySQL alike, what objectql's
          // fallback computes (`in-memory-aggregation.ts`, the same expression
          // written the same way on purpose) and what `AGGREGATION_CASES` says
          // (2 over `AGGREGATION_ROWS`).
          //
          // This arm was ABSENT, so a function the Query Protocol declares and
          // every SQL face lowers (#6409) fell to `default: return null` and
          // `aggregate()` resolved with `{ n: null }` — no error, no log, no
          // refusal. A wrong ANSWER rather than a wrong number, and the
          // `default:`-arm shape the `aggregation-lockstep` guard exists to stop
          // one layer up, reached here through a different door (#4157).
          //
          // The null exclusion is the half a `new Set(values).size` would miss:
          // it answers one HIGHER on any nullable column (3 where the standard
          // says 2), which is exactly the divergence #6814's driver-mongodb half
          // fixed on `$addToSet`. `undefined` is excluded beside `null` for the
          // same reason the neighbours above exclude it — a missing key and an
          // explicit null are one state in SQL, and this store has both.
          case 'count_distinct':
              return new Set(values.filter(v => v !== null && v !== undefined)).size;

          default:
              return null;
      }
  }

  private setValueByPath(obj: any, path: string, value: any) {
      const parts = path.split('.');
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!current[part]) current[part] = {};
          current = current[part];
      }
      current[parts[parts.length - 1]] = value;
  }

  // ===================================
  // Schema Management
  // ===================================

  async syncSchema(object: string, schema: any, options?: DriverOptions) {
    // #6915 — metadata-level half of the tenancy guard: an object asking for
    // row-level isolation cannot get it here, so the table is never allocated.
    assertObjectsNotTenantScoped([{ object, schema }]);
    if (!this.db[object]) {
      this.db[object] = [];
      this.tablesCreatedHere.add(object);
      this.logger.info('Created in-memory table', { object });
    } else if (!this.tablesCreatedHere.has(object)) {
      // Present without us having made it: a persistence adapter restored it,
      // or fixtures seeded it before any schema was declared. Either way the
      // store did not start empty here. A re-sync of a table we created this
      // boot is not that, and is ignored. See {@link getSchemaSyncStats}.
      this.tablesFoundExisting.add(object);
    }
    // Learn the object's temporal fields, then converge the rows ALREADY in the
    // table (#4047). Both halves matter: the map is what the write and filter
    // paths consult from here on, and the retroactive pass is what catches rows
    // this driver never wrote — `initialData` fixtures and anything a
    // persistence adapter restored, both of which land before any schema is
    // declared. It is the in-memory analogue of `backfillCanonicalDatetimes`
    // (ADR-0053 D-B3) and, like it, is idempotent.
    const kinds = indexTemporalFields(schema?.fields);
    this.temporalFields.set(object, kinds);
    if (kinds.size > 0) {
      const table = this.db[object];
      for (let i = 0; i < table.length; i++) {
        const converged = this.toStorageForms(object, table[i]);
        if (converged !== table[i]) table[i] = converged;
      }
    }
  }

  async dropTable(object: string, options?: DriverOptions) {
    if (this.db[object]) {
      const recordCount = this.db[object].length;
      delete this.db[object];
      this.logger.info('Dropped in-memory table', { object, recordCount });
    }
  }

  /**
   * Tables created vs found since connect — the `IDataDriver.getSchemaSyncStats`
   * contract. An in-memory store is normally born empty on every boot, so
   * `existing === 0 && created > 0` is the common case here; a store a
   * persistence adapter restored reports `existing > 0` and vouches for
   * nothing (#3438 / ADR-0104).
   */
  getSchemaSyncStats(): { created: number; existing: number } {
    return { created: this.tablesCreatedHere.size, existing: this.tablesFoundExisting.size };
  }

  // ===================================
  // Helpers
  // ===================================

  // ── Temporal storage form (#4047) ─────────────────────────────────────────

  /** The declared temporal kind of `field` on `object`, if any. */
  private temporalKind(object: string | undefined, field: string): TemporalFieldKind | undefined {
    if (!object) return undefined;
    return this.temporalFields.get(object)?.get(field);
  }

  /** Put one filter comparand into the storage form of its field. */
  private toStorageForm(object: string | undefined, field: string, value: any): any {
    return coerceTemporalValue(value, this.temporalKind(object, field));
  }

  /**
   * [#5373] {@link toStorageForm}, for the analytics (cube) face.
   *
   * That face compiles its own `where` (`memory-analytics.ts`) and must compare
   * against the same stored bytes this driver wrote, so it needs the same
   * comparand rule — and the rule is keyed on the DECLARED field kind
   * (`temporalFields`, populated by `syncSchema`), which only the driver holds.
   * The alternative was for the analytics face to re-derive a temporal form from
   * the value's shape, and a second implementation of this rule is precisely the
   * in-package divergence #5240 ruled against: mingo compares cross-type as
   * never-equal, so the two faces would answer one `where` with different rows
   * the moment the two derivations disagreed.
   *
   * Deliberately narrow — one comparand, no filter semantics — so it exposes the
   * convention without exposing the filter pipeline.
   */
  filterComparandStorageForm(object: string | undefined, field: string, value: unknown): unknown {
    return this.toStorageForm(object, field, value);
  }

  /**
   * [#5374] The pattern a `$contains` / `$notContains` comparand becomes — the
   * substring rule itself, for the analytics (cube) face.
   *
   * Same reasoning as {@link filterComparandStorageForm} one method up, on the
   * other half of what a `contains` predicate needs. This driver's rule is
   * `escapeRegex` and NO flags ({@link normalizeFieldOperators}): the comparand
   * is a LITERAL substring, matched case-EXACTLY. The analytics face has to
   * build a `$regex` too, and every byte of that rule it re-derives is a way for
   * the two faces to answer one `where` differently — which is what happened
   * before this method existed. That face emitted a bare `{$regex: value}`:
   *   - unescaped, so `{name: {$contains: 'a.p'}}` matched `alpha` through the
   *     regex `.`, where `find()` matched nothing; and
   *   - case-SENSITIVE, where `find()` folded and matched more rows.
   *
   * [#6682] That second divergence is now closed from the OTHER side, and this
   * method is where it closed: the rule lost its `i` flag rather than the
   * analytics face gaining one. `find()` was the face that was wrong — the `i`
   * flag folded the whole Unicode range, so the `$contains` family returned rows
   * the filter excludes (#4706 Q2 = A), and this driver's own reference matcher
   * (`memory-matcher.ts`, `String.includes`) had been answering case-exactly the
   * whole time. One operator, one answer, three faces (#5374).
   *
   * Note what does NOT come through here: `$icontains`. Its ASCII-only fold
   * lives in the pattern SOURCE (`asciiCaseInsensitiveRegexSource`), which the
   * analytics face binds directly — so this method is the `$contains` family's
   * rule alone, and taking the flag off it cannot move the ASCII boundary.
   *
   * Returning the built `RegExp` rather than a source string is deliberate: a
   * string leaves the flags for the caller to re-choose, which is the half that
   * drifted.
   *
   * Deliberately narrow — one comparand in, one pattern out, no filter semantics
   * — so it exposes the convention without exposing the filter pipeline.
   */
  filterSubstringPattern(value: unknown): RegExp {
    return new RegExp(this.escapeRegex(value as string));
  }

  /**
   * Put every declared temporal field of a record into its storage form — the
   * write half of the convention the filter path reads against. Returns the
   * input unchanged (same reference) when nothing needed converting, so the
   * common non-temporal case allocates nothing.
   */
  private toStorageForms<T extends Record<string, any>>(object: string, record: T): T {
    const kinds = this.temporalFields.get(object);
    if (!kinds || kinds.size === 0) return record;
    let out: Record<string, any> | undefined;
    for (const [field, kind] of kinds) {
      if (!(field in record)) continue;
      const coerced = coerceTemporalValue(record[field], kind);
      if (coerced === record[field]) continue;
      out ??= { ...record };
      out[field] = coerced;
    }
    return (out as T) ?? record;
  }

  /**
   * Apply manual sorting (Mingo sort has CJS build issues).
   */
  private applySort(records: any[], sortFields: any[]): any[] {
    const sorted = [...records];
    for (let i = sortFields.length - 1; i >= 0; i--) {
      const sortItem = sortFields[i];
      let field: string;
      let direction: string;
      if (typeof sortItem === 'object' && !Array.isArray(sortItem)) {
        field = sortItem.field;
        direction = sortItem.order || sortItem.direction || 'asc';
      } else if (Array.isArray(sortItem)) {
        [field, direction] = sortItem;
      } else {
        continue;
      }
      sorted.sort((a, b) => {
        const aVal = getValueByPath(a, field);
        const bVal = getValueByPath(b, field);
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (aVal < bVal) return direction === 'desc' ? 1 : -1;
        if (aVal > bVal) return direction === 'desc' ? -1 : 1;
        return 0;
      });
    }
    return sorted;
  }

  /**
   * Project specific fields from a record.
   */
  private projectFields(record: any, fields: string[]): any {
    const result: any = {};
    for (const field of fields) {
      const value = getValueByPath(record, field);
      if (value !== undefined) {
        result[field] = value;
      }
    }
    // Always include id if not explicitly listed
    if (!fields.includes('id') && record.id !== undefined) {
      result.id = record.id;
    }
    return result;
  }

  private getTable(name: string) {
    if (!this.db[name]) {
      this.db[name] = [];
    }
    return this.db[name];
  }

  private generateId(objectName?: string) {
    const key = objectName || '_global';
    const counter = (this.idCounters.get(key) || 0) + 1;
    this.idCounters.set(key, counter);
    const timestamp = Date.now();
    return `${key}-${timestamp}-${counter}`;
  }

  // ===================================
  // Persistence
  // ===================================

  /**
   * Mark the database as dirty, triggering persistence save.
   */
  private markDirty(): void {
    if (this.persistenceAdapter) {
      this.persistenceAdapter.save(this.db);
    }
  }

  /**
   * Flush pending persistence writes to ensure data is safely stored.
   */
  async flush(): Promise<void> {
    if (this.persistenceAdapter) {
      await this.persistenceAdapter.flush();
    }
  }

  /**
   * Detect whether the current runtime is a browser environment.
   * Checks for window, document AND a functional localStorage to avoid
   * false positives in Node.js runtimes that partially polyfill globals.
   */
  private isBrowserEnvironment(): boolean {
    const g = globalThis as any;
    return typeof g.window !== 'undefined'
      && typeof g.document !== 'undefined'
      && typeof g.localStorage?.setItem === 'function';
  }

  /**
   * Detect whether the current runtime is a serverless/edge environment.
   *
   * Checks well-known environment variables set by serverless platforms:
   * - `VERCEL` / `VERCEL_ENV` — Vercel Functions / Edge
   * - `AWS_LAMBDA_FUNCTION_NAME` — AWS Lambda
   * - `NETLIFY` — Netlify Functions
   * - `FUNCTIONS_WORKER_RUNTIME` — Azure Functions
   * - `K_SERVICE` — Google Cloud Run / Cloud Functions
   * - `FUNCTION_TARGET` — Google Cloud Functions (Node.js)
   * - `DENO_DEPLOYMENT_ID` — Deno Deploy
   *
   * Returns `false` when `process` or `process.env` is unavailable
   * (e.g. browser or edge runtimes without a Node.js process object).
   */
  private isServerlessEnvironment(): boolean {
    if (typeof globalThis.process === 'undefined' || !globalThis.process.env) {
      return false;
    }
    const env = globalThis.process.env;
    return !!(
      env.VERCEL ||
      env.VERCEL_ENV ||
      env.AWS_LAMBDA_FUNCTION_NAME ||
      env.NETLIFY ||
      env.FUNCTIONS_WORKER_RUNTIME ||
      env.K_SERVICE ||
      env.FUNCTION_TARGET ||
      env.DENO_DEPLOYMENT_ID
    );
  }

  private static readonly SERVERLESS_PERSISTENCE_WARNING =
    'Serverless environment detected — file-system persistence is disabled in auto mode. ' +
    'Data will NOT be persisted across function invocations. ' +
    'Set persistence: false to silence this warning, or provide a custom adapter ' +
    '(e.g. Upstash Redis, Vercel KV) via persistence: { adapter: yourAdapter }.';

  /**
   * Initialize the persistence adapter based on configuration.
   *
   * **Persistence is opt-in.** An omitted `persistence` means none — the driver
   * is pure in-memory, matching its name and #815's requirement #1. Ask for
   * durability explicitly with `'auto'` / `'file'` / `'local'` / a custom adapter.
   *
   * In serverless environments (Vercel, AWS Lambda, etc.), `'auto'` disables
   * file-system persistence and emits a warning; supply a custom adapter for
   * serverless-safe durability.
   */
  private async initPersistence(): Promise<void> {
    const persistence = this.config.persistence ?? false;
    if (persistence === false) return;

    if (typeof persistence === 'string') {
      if (persistence === 'auto') {
        if (this.isBrowserEnvironment()) {
          const { LocalStoragePersistenceAdapter } = await import('./persistence/local-storage-adapter.js');
          this.persistenceAdapter = new LocalStoragePersistenceAdapter();
          this.logger.debug('Auto-detected browser environment, using localStorage persistence');
        } else if (this.isServerlessEnvironment()) {
          this.logger.warn(InMemoryDriver.SERVERLESS_PERSISTENCE_WARNING);
        } else {
          const { FileSystemPersistenceAdapter } = await import('./persistence/file-adapter.js');
          this.persistenceAdapter = new FileSystemPersistenceAdapter();
          this.logger.debug('Auto-detected Node.js environment, using file persistence');
        }
      } else if (persistence === 'file') {
        const { FileSystemPersistenceAdapter } = await import('./persistence/file-adapter.js');
        this.persistenceAdapter = new FileSystemPersistenceAdapter();
      } else if (persistence === 'local') {
        const { LocalStoragePersistenceAdapter } = await import('./persistence/local-storage-adapter.js');
        this.persistenceAdapter = new LocalStoragePersistenceAdapter();
      } else {
        throw new Error(`Unknown persistence type: "${persistence}". Use 'file', 'local', or 'auto'.`);
      }
    } else if ('adapter' in persistence && persistence.adapter) {
      this.persistenceAdapter = persistence.adapter;
    } else if ('type' in persistence) {
      if (persistence.type === 'auto') {
        if (this.isBrowserEnvironment()) {
          const { LocalStoragePersistenceAdapter } = await import('./persistence/local-storage-adapter.js');
          this.persistenceAdapter = new LocalStoragePersistenceAdapter({
            key: persistence.key,
          });
          this.logger.debug('Auto-detected browser environment, using localStorage persistence');
        } else if (this.isServerlessEnvironment()) {
          this.logger.warn(InMemoryDriver.SERVERLESS_PERSISTENCE_WARNING);
        } else {
          const { FileSystemPersistenceAdapter } = await import('./persistence/file-adapter.js');
          this.persistenceAdapter = new FileSystemPersistenceAdapter({
            path: persistence.path,
            autoSaveInterval: persistence.autoSaveInterval,
          });
          this.logger.debug('Auto-detected Node.js environment, using file persistence');
        }
      } else if (persistence.type === 'file') {
        const { FileSystemPersistenceAdapter } = await import('./persistence/file-adapter.js');
        this.persistenceAdapter = new FileSystemPersistenceAdapter({
          path: persistence.path,
          autoSaveInterval: persistence.autoSaveInterval,
        });
      } else if (persistence.type === 'local') {
        const { LocalStoragePersistenceAdapter } = await import('./persistence/local-storage-adapter.js');
        this.persistenceAdapter = new LocalStoragePersistenceAdapter({
          key: persistence.key,
        });
      }
    }

    if (this.persistenceAdapter) {
      this.logger.debug('Persistence adapter initialized');
    }
  }
}
