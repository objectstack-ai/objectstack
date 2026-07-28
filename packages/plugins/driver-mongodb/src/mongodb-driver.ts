// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Driver for ObjectStack
 *
 * Implements the IDataDriver contract using the official MongoDB Node.js driver.
 * Provides native document database operations with full support for
 * ObjectStack's query protocol, aggregations, transactions, and streaming.
 */

import type { QueryAST, DriverOptions } from '@objectstack/spec/data';
import type { IDataDriver } from '@objectstack/spec/contracts';
import {
  MongoClient,
  Db,
  Collection,
  ClientSession,
  type Document,
  type Filter,
  type FindOptions,
  type MongoClientOptions,
} from 'mongodb';
import { nanoid } from 'nanoid';
import { translateFilter } from './mongodb-filter.js';
import {
  buildAggregationPipeline,
  postProcessAggregation,
} from './mongodb-aggregation.js';
import { syncCollectionSchema, dropCollection } from './mongodb-schema.js';
import {
  assertSingleTenantPosture,
  assertObjectsNotTenantScoped,
} from './mongodb-tenancy-guard.js';

const DEFAULT_ID_LENGTH = 16;

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * MongoDB driver configuration.
 */
export interface MongoDBDriverConfig {
  /** MongoDB connection URI (e.g., 'mongodb://localhost:27017/mydb') */
  url: string;
  /** Database name (overrides the database in the URI) */
  database?: string;
  /** Maximum connection pool size */
  maxPoolSize?: number;
  /** Minimum connection pool size */
  minPoolSize?: number;
  /** Connection timeout in milliseconds */
  connectTimeoutMS?: number;
  /** Server selection timeout in milliseconds */
  serverSelectionTimeoutMS?: number;
  /** Additional MongoClient options */
  options?: MongoClientOptions;
}

// ── MongoDB Driver ───────────────────────────────────────────────────────────

/**
 * MongoDB Driver for ObjectStack.
 *
 * Implements the IDataDriver contract via the official MongoDB driver.
 * Uses native MongoDB queries, aggregation pipelines, and transactions.
 *
 * **Single-tenant only (#3724).** This driver implements no row-level tenant
 * isolation — it ignores `DriverOptions.tenantId`, so reads carry no tenant
 * predicate and writes are not stamped with a tenant column. Rather than serve
 * a multi-tenant deployment unisolated, it **refuses to start** in one: see
 * `mongodb-tenancy-guard.ts`, wired into the constructor + {@link connect}
 * (deployment posture) and {@link syncSchema} / {@link syncSchemasBatch}
 * (object metadata).
 */
export class MongoDBDriver implements IDataDriver {
  public readonly name: string = 'com.objectstack.driver.mongodb';
  public readonly version: string = '1.0.0';

  public readonly supports = {
    // Basic CRUD Operations
    create: true,
    read: true,
    update: true,
    delete: true,

    // Bulk Operations
    bulkCreate: true,
    bulkUpdate: true,
    bulkDelete: true,

    // Transaction & Connection Management
    transactions: true,
    savepoints: false,

    // Query Operations
    queryFilters: true,
    queryAggregations: true,
    querySorting: true,
    queryPagination: true,
    queryWindowFunctions: false,
    querySubqueries: false,
    queryCTE: false,
    joins: false,

    // Advanced Features
    fullTextSearch: true,
    jsonQuery: true,
    geospatialQuery: true,
    streaming: true,
    jsonFields: true,
    arrayFields: true,
    vectorSearch: false,

    // Schema Management
    schemaSync: true,
    batchSchemaSync: true,
    migrations: false,
    indexes: true,

    // Performance & Optimization
    connectionPooling: true,
    preparedStatements: false,
    queryCache: false,
  };

  private client: MongoClient;
  private db!: Db;
  private config: MongoDBDriverConfig;

  constructor(config: MongoDBDriverConfig) {
    // Refuse to even EXIST in a multi-tenant deployment (#3724). The check is
    // repeated in `connect()`, but construction is the only seam guaranteed to
    // fail loudly: `ObjectQLEngine.init()` catches a driver's connect rejection
    // and logs it, then boots anyway ("may recover via lazy reconnection"), so
    // a connect-only guard would degrade from "refuses to start" to "starts,
    // then throws at query time".
    assertSingleTenantPosture();

    this.config = config;
    const clientOptions: MongoClientOptions = {
      maxPoolSize: config.maxPoolSize ?? 10,
      minPoolSize: config.minPoolSize ?? 1,
      connectTimeoutMS: config.connectTimeoutMS ?? 10_000,
      serverSelectionTimeoutMS: config.serverSelectionTimeoutMS ?? 5_000,
      ...(config.options as MongoClientOptions),
    };
    this.client = new MongoClient(config.url, clientOptions);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async connect(): Promise<void> {
    // Fail before a socket is opened: this driver cannot isolate tenants, so a
    // multi-tenant deployment must never get a usable connection out of it.
    // Re-checked here (not just in the constructor) because a host may flip the
    // posture between construction and boot.
    assertSingleTenantPosture();

    await this.client.connect();
    const dbName = this.config.database || this.extractDatabaseName(this.config.url);
    this.db = this.client.db(dbName);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  getPoolStats() {
    // MongoDB driver doesn't expose pool stats in a simple way
    return undefined;
  }

  // ===========================================================================
  // Raw Execution
  // ===========================================================================

  async execute(command: unknown, _parameters?: unknown[], options?: DriverOptions): Promise<unknown> {
    const session = this.getSession(options);
    if (typeof command === 'object' && command !== null) {
      return await this.db.command(command as Document, { session });
    }
    return command;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  async find(object: string, query: QueryAST, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where);
    const findOptions: FindOptions = { session };

    // Field projection
    if (query.fields && query.fields.length > 0) {
      const projection: Document = {};
      for (const field of query.fields) {
        projection[field] = 1;
      }
      // Always include `id`, never include `_id`
      projection.id = 1;
      projection._id = 0;
      findOptions.projection = projection;
    } else {
      findOptions.projection = { _id: 0 };
    }

    // Sorting
    if (query.orderBy && Array.isArray(query.orderBy)) {
      const sort: Document = {};
      for (const item of query.orderBy) {
        if (item.field) {
          sort[this.mapFieldName(item.field)] = item.order === 'desc' ? -1 : 1;
        }
      }
      findOptions.sort = sort;
    }

    // Pagination
    if (query.offset !== undefined) findOptions.skip = query.offset;
    if (query.limit !== undefined) findOptions.limit = query.limit;

    const cursor = collection.find(filter, findOptions);
    const results = await cursor.toArray();
    return results as Record<string, unknown>[];
  }

  async findOne(object: string, query: QueryAST, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where);
    const result = await collection.findOne(filter, {
      session,
      projection: { _id: 0 },
    });

    return result as Record<string, unknown> | null;
  }

  findStream(object: string, query: QueryAST, options?: DriverOptions): AsyncGenerator<Record<string, unknown>> {
    return this._findStream(object, query, options);
  }

  private async *_findStream(object: string, query: QueryAST, options?: DriverOptions): AsyncGenerator<Record<string, unknown>> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where);
    const findOptions: FindOptions = {
      session,
      projection: { _id: 0 },
    };

    if (query.orderBy && Array.isArray(query.orderBy)) {
      const sort: Document = {};
      for (const item of query.orderBy) {
        if (item.field) {
          sort[this.mapFieldName(item.field)] = item.order === 'desc' ? -1 : 1;
        }
      }
      findOptions.sort = sort;
    }

    if (query.offset !== undefined) findOptions.skip = query.offset;
    if (query.limit !== undefined) findOptions.limit = query.limit;

    const cursor = collection.find(filter, findOptions);

    for await (const doc of cursor) {
      yield doc as Record<string, unknown>;
    }
  }

  async create(object: string, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const { _id, ...rest } = data;
    const toInsert: Record<string, unknown> = { ...rest };

    // Assign ID
    if (toInsert.id === undefined) {
      toInsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    // Timestamps
    const now = new Date();
    if (toInsert.created_at === undefined) toInsert.created_at = now;
    if (toInsert.updated_at === undefined) toInsert.updated_at = now;

    await collection.insertOne(toInsert as Document, { session });

    // Return without _id
    const { _id: insertedId, ...result } = toInsert as any;
    return result;
  }

  async update(object: string, id: string | number, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const { _id, id: dataId, ...updateData } = data;
    updateData.updated_at = new Date();

    await collection.updateOne(
      { id: String(id) },
      { $set: updateData },
      { session },
    );

    const updated = await collection.findOne(
      { id: String(id) },
      { session, projection: { _id: 0 } },
    );

    return (updated as Record<string, unknown>) || { id: String(id), ...updateData };
  }

  async upsert(object: string, data: Record<string, unknown>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, unknown>> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const { _id, ...rest } = data;
    const toUpsert: Record<string, unknown> = { ...rest };

    if (toUpsert.id === undefined) {
      toUpsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    const now = new Date();
    toUpsert.updated_at = now;

    // Build filter from conflict keys
    const mergeKeys = conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'];
    const filter: Filter<Document> = {};
    for (const key of mergeKeys) {
      if (toUpsert[key] !== undefined) {
        filter[key] = toUpsert[key];
      }
    }

    await collection.updateOne(
      filter,
      {
        $set: toUpsert,
        $setOnInsert: { created_at: now },
      },
      { upsert: true, session },
    );

    const result = await collection.findOne(
      { id: toUpsert.id },
      { session, projection: { _id: 0 } },
    );

    return (result as Record<string, unknown>) || toUpsert;
  }

  async delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const result = await collection.deleteOne({ id: String(id) }, { session });
    return result.deletedCount > 0;
  }

  async count(object: string, query?: QueryAST, options?: DriverOptions): Promise<number> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = query?.where ? translateFilter(query.where) : {};
    return await collection.countDocuments(filter, { session });
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  async bulkCreate(object: string, dataArray: Record<string, unknown>[], options?: DriverOptions): Promise<Record<string, unknown>[]> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const now = new Date();
    const docs = dataArray.map((data) => {
      const { _id, ...rest } = data;
      const doc: Record<string, unknown> = { ...rest };
      if (doc.id === undefined) doc.id = nanoid(DEFAULT_ID_LENGTH);
      if (doc.created_at === undefined) doc.created_at = now;
      if (doc.updated_at === undefined) doc.updated_at = now;
      return doc;
    });

    await collection.insertMany(docs as Document[], { session });

    // Return without _id
    return docs.map(({ _id, ...rest }) => rest as Record<string, unknown>);
  }

  async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, unknown> }>, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const now = new Date();
    const bulkOps = updates.map(({ id, data }) => {
      const { _id, id: dataId, ...updateData } = data;
      updateData.updated_at = now;
      return {
        updateOne: {
          filter: { id: String(id) },
          update: { $set: updateData },
        },
      };
    });

    await collection.bulkWrite(bulkOps, { session });

    // Fetch updated docs
    const ids = updates.map((u) => String(u.id));
    const results = await collection.find(
      { id: { $in: ids } },
      { session, projection: { _id: 0 } },
    ).toArray();

    return results as Record<string, unknown>[];
  }

  async bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    await collection.deleteMany(
      { id: { $in: ids.map(String) } },
      { session },
    );
  }

  async updateMany(object: string, query: QueryAST, data: Record<string, unknown>, options?: DriverOptions): Promise<number> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where);
    const { _id, id, ...updateData } = data;
    updateData.updated_at = new Date();

    const result = await collection.updateMany(
      filter,
      { $set: updateData },
      { session },
    );

    return result.modifiedCount;
  }

  async deleteMany(object: string, query: QueryAST, options?: DriverOptions): Promise<number> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where);
    const result = await collection.deleteMany(filter, { session });
    return result.deletedCount;
  }

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  async aggregate(object: string, query: QueryAST, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const aggregations = (query as any).aggregations || (query as any).aggregate || [];

    const pipeline = buildAggregationPipeline({
      where: query.where,
      aggregations,
      groupBy: (query as any).groupBy,
      orderBy: query.orderBy as Array<{ field: string; order?: string }>,
      limit: query.limit,
      offset: query.offset,
    });

    const results = await collection.aggregate(pipeline, { session }).toArray();
    return postProcessAggregation(results, aggregations) as Record<string, unknown>[];
  }

  // ===========================================================================
  // Transactions
  // ===========================================================================

  async beginTransaction(_options?: { isolationLevel?: string }): Promise<ClientSession> {
    const session = this.client.startSession();
    session.startTransaction();
    return session;
  }

  async commit(transaction: unknown): Promise<void> {
    const session = transaction as ClientSession;
    await session.commitTransaction();
    await session.endSession();
  }

  async rollback(transaction: unknown): Promise<void> {
    const session = transaction as ClientSession;
    await session.abortTransaction();
    await session.endSession();
  }

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  async syncSchema(object: string, schema: unknown, _options?: DriverOptions): Promise<void> {
    // An object asking for row-level tenant isolation gets none here (#3724) —
    // refuse rather than materialise a collection that silently mixes tenants.
    assertObjectsNotTenantScoped([{ object, schema }]);

    const objectDef = schema as { name: string; fields?: Record<string, any> };
    await syncCollectionSchema(this.db, object, objectDef);
  }

  async syncSchemasBatch(schemas: Array<{ object: string; schema: unknown }>, options?: DriverOptions): Promise<void> {
    // Pre-scan so the failure names every tenant-scoped object at once instead
    // of surfacing them one boot at a time.
    assertObjectsNotTenantScoped(schemas);

    for (const { object, schema } of schemas) {
      await this.syncSchema(object, schema, options);
    }
  }

  async dropTable(object: string, _options?: DriverOptions): Promise<void> {
    await dropCollection(this.db, object);
  }

  // ===========================================================================
  // Query Plan Analysis
  // ===========================================================================

  async explain(object: string, query: QueryAST, _options?: DriverOptions): Promise<unknown> {
    const collection = this.getCollection(object);
    const filter = translateFilter(query.where);
    const explanation = await collection.find(filter).explain('executionStats');
    return explanation;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /** Get the underlying Db instance for advanced usage. */
  getDb(): Db {
    return this.db;
  }

  /** Get the underlying MongoClient for advanced usage. */
  getClient(): MongoClient {
    return this.client;
  }

  private getCollection(name: string): Collection<Document> {
    return this.db.collection(name);
  }

  private getSession(options?: DriverOptions): ClientSession | undefined {
    return options?.transaction as ClientSession | undefined;
  }

  private mapFieldName(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

  private extractDatabaseName(url: string): string {
    // Extract database name from mongodb:// or mongodb+srv:// connection string
    // Format: mongodb://[user:pass@]host[:port]/database[?options]
    const match = url.match(/\/\/[^/]*\/([^?/]+)/);
    if (match) return match[1];
    return 'objectstack';
  }
}
