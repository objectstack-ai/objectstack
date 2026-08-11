// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Driver for ObjectStack
 *
 * Implements the IDataDriver contract using the official MongoDB Node.js driver.
 * Provides native document database operations with full support for
 * ObjectStack's query protocol, aggregations, transactions, and streaming.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
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
  coerceTemporalValue,
  indexTemporalFields,
  type TemporalFieldKind,
  type TemporalFieldKindResolver,
} from './mongodb-temporal.js';
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

  /**
   * Capability advertisement (#4634, ADR-0049): only the bits with an engine
   * reader survive. This driver batches its schema DDL round-trips
   * ({@link syncSchemasBatch}), so it opts in via the one bit the engine ANDs
   * with method presence. It owns neither persistent autonumber sequences nor
   * native date bucketing here, so `autonumber`/`queryDateGranularity` stay
   * absent and the engine keeps its fallbacks. Everything the old 30-bit
   * literal declared is expressed by the methods this class implements.
   */
  public readonly supports = {
    batchSchemaSync: true,
  };

  private client: MongoClient;
  private db!: Db;
  private config: MongoDBDriverConfig;

  /**
   * Declared temporal fields per object, populated by {@link syncSchema} —
   * this driver's equivalent of `SqlDriver.datetimeFields`/`dateFields`, and
   * the only thing that lets write and filter agree on a storage form (#4047).
   * An object absent from this map was never declared, so nothing is coerced
   * for it: the driver does not guess types from values.
   */
  private temporalFields = new Map<string, Map<string, TemporalFieldKind>>();

  constructor(config: MongoDBDriverConfig) {
    // Refuse to even EXIST in a multi-tenant deployment (#3724). The check is
    // repeated in `connect()`; construction just fails earliest, before a host
    // can hand this driver to anything. (Originally the constructor was the
    // ONLY seam that failed loudly, because `ObjectQLEngine.init()` caught a
    // driver's connect rejection and booted anyway — fixed in framework#3741,
    // so `connect()` now aborts boot too.)
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

  /**
   * The projection / sort / pagination half of a read, shared by {@link find}
   * and {@link findOne} (objectstack#4419).
   *
   * It was inline in `find` only, and `findOne` translated `query.where` and
   * nothing else — so `orderBy`, `fields` and `offset` were accepted by the
   * contract and silently dropped on the way to Mongo. `findOne({ orderBy })`
   * therefore did not return the newest record; it returned whichever document
   * the collection scan reached first, which is the same
   * plausible-looking-wrong-record failure #4419 is about, one layer below the
   * engine.
   *
   * `singleRowLookup` marks the caller as `findOne`; see {@link buildSortSpec}.
   *
   * Every read path in this driver now goes through it. The one that did not —
   * `_findStream`, which hardcoded `projection: { _id: 0 }` and so dropped
   * `query.fields` on the floor — was retired with the contract method it served
   * (#4484), which subsumes that divergence rather than fixing it.
   */
  private buildFindOptions(
    query: DriverQuery,
    session: FindOptions['session'],
    opts?: { singleRowLookup?: boolean },
  ): FindOptions {
    const findOptions: FindOptions = { session };

    // Field projection
    if (query.fields && query.fields.length > 0) {
      const projection: Document = {};
      for (const field of query.fields) {
        // A `FieldNode` is a field name. Nested selection is `expand`, resolved
        // by the engine (batch `$in` queries), never by the driver — the
        // `{ field, fields, alias }` form this loop used to unwrap was removed
        // in #4196 once #4171's typing showed it had never had a producer.
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
    const sort = this.buildSortSpec(query, opts);
    if (sort) findOptions.sort = sort;

    // Pagination
    if (query.offset !== undefined) findOptions.skip = query.offset;
    if (query.limit !== undefined) findOptions.limit = query.limit;

    return findOptions;
  }

  /**
   * `limit: 0` means **return no records** (#6485) — and this is the one driver
   * where forwarding the value faithfully is not enough to say so.
   *
   * {@link buildFindOptions} already tests PRESENCE (`!== undefined`), so `0`
   * reaches the client exactly as written. The divergence is one layer lower:
   * the MongoDB Node driver DEFINES `limit: 0` as *no limit*, so a correctly
   * forwarded `0` came back as the entire collection — the same wrong answer
   * `driver-memory` gave for the opposite reason (it dropped the value; this
   * one delivers it to a reader that means something else by it).
   *
   * So the contract is answered HERE rather than delegated: the empty result is
   * returned without consulting the client at all. Two consequences worth being
   * explicit about, because both are the point rather than side effects — no
   * round trip is made for a query whose answer is already known, and no future
   * change in the upstream driver's reading of `0` can move this behaviour.
   *
   * Deliberately `=== 0` and not `<= 0`: a negative limit is not a shape the
   * contract defines, and quietly folding it into "no records" would invent an
   * answer here instead of letting the layer that owns validation give one.
   */
  private returnsNoRecords(query: DriverQuery): boolean {
    return query.limit === 0;
  }

  async find(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    if (this.returnsNoRecords(query)) return [];

    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where, this.temporalKindFor(object));
    const findOptions = this.buildFindOptions(query, session);

    const cursor = collection.find(filter, findOptions);
    const results = await cursor.toArray();
    return results as Record<string, unknown>[];
  }

  async findOne(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    // Same guard as `find()`, because this door has the same hole: `findOne`
    // hands `query.limit` to the client through the SAME `buildFindOptions`, so
    // `limit: 0` was read as "no limit" and answered with the first document —
    // a record, where the contract says none. `null` is this signature's empty
    // result. Leaving it out would have recreated, inside one driver, exactly
    // the "one query, two answers" divergence this issue is about.
    if (this.returnsNoRecords(query)) return null;

    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where, this.temporalKindFor(object));
    // `singleRowLookup`: honour the caller's ordering, impose none of our own —
    // the engine sends `limit: 1`, which is indistinguishable from "page one of
    // a walk with page size 1", and the two want opposite things
    // (objectstack#4363, and `SqlDriver.findRows` for the measured cost).
    const result = await collection.findOne(
      filter,
      this.buildFindOptions(query, session, { singleRowLookup: true }),
    );

    return result as Record<string, unknown> | null;
  }

  // `findStream` / `_findStream` were removed with the contract method in 17.0.0
  // (#4484). This was the only one of the three drivers that genuinely streamed —
  // it walked the cursor — but it was also the only read here that never reached
  // `buildFindOptions`, so `query.fields` was silently discarded on that path. With
  // no caller anywhere in either repository there was nothing to fix it for. Page
  // through `find()` with `limit`/`offset`.

  async create(object: string, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const { _id, ...rest } = data;
    const toInsert: Record<string, unknown> = { ...this.toStorageForms(object, rest) };

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

    const { _id, id: dataId, ...rawUpdate } = data;
    const updateData: Record<string, unknown> = { ...this.toStorageForms(object, rawUpdate) };
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

  async count(object: string, query?: DriverQuery, options?: DriverOptions): Promise<number> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = query?.where ? translateFilter(query.where, this.temporalKindFor(object)) : {};
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
      const doc: Record<string, unknown> = { ...this.toStorageForms(object, rest) };
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
      const { _id, id: dataId, ...rawUpdate } = data;
      const updateData: Record<string, unknown> = { ...this.toStorageForms(object, rawUpdate) };
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

  async updateMany(object: string, query: DriverQuery, data: Record<string, unknown>, options?: DriverOptions): Promise<number> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where, this.temporalKindFor(object));
    const { _id, id, ...rawUpdate } = data;
    const updateData: Record<string, unknown> = { ...this.toStorageForms(object, rawUpdate) };
    updateData.updated_at = new Date();

    const result = await collection.updateMany(
      filter,
      { $set: updateData },
      { session },
    );

    return result.modifiedCount;
  }

  async deleteMany(object: string, query: DriverQuery, options?: DriverOptions): Promise<number> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const filter = translateFilter(query.where, this.temporalKindFor(object));
    const result = await collection.deleteMany(filter, { session });
    return result.deletedCount;
  }

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  async aggregate(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    const collection = this.getCollection(object);
    const session = this.getSession(options);

    const aggregations = (query as any).aggregations || (query as any).aggregate || [];

    const pipeline = buildAggregationPipeline({
      where: query.where,
      aggregations,
      // [#6850] Was `(query as any).groupBy`. `DriverQuery` declares this key as
      // `GroupByNode[]` — a union of a bare field name and a structured
      // `{ field, dateGranularity?, alias? }` node — and this cast is what kept
      // the declaration from ever meeting the builder's `string[]` annotation at
      // `tsc`, so a structured node stringified into a `"[object Object]"`
      // `$group._id` rather than failing to compile. Both sides now spell the
      // declared type, so the next drift between them is a type error.
      //
      // The `aggregations` read above keeps its cast for now: it also carries
      // the undeclared `query.aggregate` limb that #6321 deleted from the SQL
      // faces, which is a separate convergence and not this card.
      groupBy: query.groupBy,
      orderBy: query.orderBy as Array<{ field: string; order?: string }>,
      limit: query.limit,
      offset: query.offset,
      temporalKind: this.temporalKindFor(object),
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
    // Learn which fields are temporal BEFORE any write can land, so the write
    // path and the filter path share one storage convention (#4047).
    this.temporalFields.set(object, indexTemporalFields(objectDef.fields));
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

  async explain(object: string, query: DriverQuery, _options?: DriverOptions): Promise<unknown> {
    const collection = this.getCollection(object);
    const filter = translateFilter(query.where, this.temporalKindFor(object));
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

  /**
   * The `sort` spec for a `find`, with a unique tie-breaker appended so that
   * paging is a partition of the result set rather than a series of unrelated
   * queries (objectui#3106, contract on `IDataDriver.find`).
   *
   * MongoDB is explicit that this is not free: `sort` on a non-unique key
   * combined with `skip`/`limit` "may return the same document more than once"
   * because equal keys have no defined relative order and nothing holds that
   * order steady between two executions. Page 2 repeats a row from page 1 and
   * silently drops another — with every page full, every row real, and the two
   * halves of the symptom too far apart for anyone to notice.
   *
   * A paged read with **no** `sort` is the same defect at full strength
   * (objectstack#4363), which is why this reads the whole query rather than
   * just its `orderBy`. Unsorted documents come back in natural order, and
   * natural order describes where a document currently sits in its extent — it
   * moves when the document does, so page 2 of a walk can be cut from a layout
   * page 1 no longer describes. The empty sort key is simply the case where
   * every document ties with every other, so the same `id` suffix that was
   * separating one `status` group ends up carrying the entire order.
   *
   * `id` is always present (`create()` fills it when the caller omits one), so
   * unlike the SQL driver there is no collection this cannot apply to, and
   * `syncCollectionSchema` gives every collection it provisions a unique
   * `idx_id_unique` — so a sort that ends in `id` is index-served rather than
   * a blocking in-memory sort against the 100 MB cap. It is appended in the
   * LAST requested key's direction (`1` when there is none): determinism holds
   * either way, but a same-direction suffix is the one a compound index can
   * still walk in a single pass.
   *
   * Returns `undefined` for a read that is neither sorted nor paged — nothing
   * is being sliced there, so a caller who asked for no order keeps none (the
   * contract's explicit carve-out).
   *
   * `singleRowLookup` puts {@link findOne} in that carve-out too. It arrives
   * carrying the engine's `limit: 1`, which the `paged` test below cannot tell
   * from "page one of a walk with page size 1" — but `findOne` promises *a*
   * matching record, never a position in a sequence, so there is no partition
   * to preserve and imposing an order only costs the plan the predicate earned
   * (objectstack#4363; `SqlDriver.findRows` carries the same flag and the
   * measured ~100× regression that motivated it). A caller-supplied `orderBy`
   * is still honoured, tie-breaker and all — that is the half this driver used
   * to drop entirely (objectstack#4419).
   */
  private buildSortSpec(query: DriverQuery, opts?: { singleRowLookup?: boolean }): Document | undefined {
    const sort: Document = {};
    let lastDirection: 1 | -1 = 1;
    if (Array.isArray(query.orderBy)) {
      for (const item of query.orderBy) {
        if (item.field) {
          lastDirection = item.order === 'desc' ? -1 : 1;
          sort[this.mapFieldName(item.field)] = lastDirection;
        }
      }
    }

    const requested = Object.keys(sort).length > 0;
    const paged =
      !opts?.singleRowLookup && (query.limit !== undefined || query.offset !== undefined);
    if (!requested && !paged) return undefined;

    const idKey = this.mapFieldName('id');
    if (sort[idKey] === undefined) sort[idKey] = lastDirection;
    return sort;
  }

  // ── Temporal storage form (#4047) ─────────────────────────────────────────

  /**
   * The declared-temporal-kind lookup for one object, handed to
   * {@link translateFilter} so comparands land in the field's storage form.
   * `undefined` for an undeclared object — nothing to coerce against.
   */
  private temporalKindFor(object: string): TemporalFieldKindResolver | undefined {
    const kinds = this.temporalFields.get(object);
    if (!kinds || kinds.size === 0) return undefined;
    return (field: string) => kinds.get(field);
  }

  /**
   * Put every declared temporal field of a document into its storage form —
   * the write half of the convention {@link translateFilter} reads against.
   * Applied by `create`/`update`/`bulkCreate`/`bulkUpdate`/`updateMany`, so no
   * write path can leave a value in a form the filter path cannot reach.
   *
   * The driver's own `created_at`/`updated_at` stamps already bind a `Date`;
   * this is what converts an ISO string from a REST/JSON write into the same
   * BSON Date rather than leaving the collection holding both.
   */
  private toStorageForms(object: string, data: Record<string, unknown>): Record<string, unknown> {
    const kinds = this.temporalFields.get(object);
    if (!kinds || kinds.size === 0) return data;
    let out: Record<string, unknown> | undefined;
    for (const [field, kind] of kinds) {
      if (!(field in data)) continue;
      const coerced = coerceTemporalValue(data[field], kind);
      if (coerced === data[field]) continue;
      out ??= { ...data };
      out[field] = coerced;
    }
    return out ?? data;
  }

  private extractDatabaseName(url: string): string {
    // Extract database name from mongodb:// or mongodb+srv:// connection string
    // Format: mongodb://[user:pass@]host[:port]/database[?options]
    const match = url.match(/\/\/[^/]*\/([^?/]+)/);
    if (match) return match[1];
    return 'objectstack';
  }
}
