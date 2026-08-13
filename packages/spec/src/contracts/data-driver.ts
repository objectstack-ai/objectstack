// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { DriverOptions, DriverCapabilities } from '../data/driver.zod.js';
import type { QueryAST } from '../data/query.zod.js';

/**
 * DriverQuery — the query AST as a **driver** receives it: {@link QueryAST}
 * minus its top-level `object`.
 *
 * Every {@link IDataDriver} method that takes a query already takes the object
 * name as its FIRST argument, so requiring the AST to carry it again asked the
 * caller to state one fact twice — and gave that fact two places to disagree.
 * Both layers above the driver already pay for the ambiguity: the engine orders
 * its keys deliberately (`{ ...query, object }`, objectql `engine.ts`) so a
 * stray `query.object` cannot overwrite the resolved name, and the wire layer
 * refuses a mismatch with a named 400 (`QUERY_OBJECT_MISMATCH`,
 * metadata-protocol `protocol.ts`). Below the driver boundary the redundancy
 * was paid for in blanket casts instead: a direct caller holding only a `where`
 * could not name a type for it, reached for `as any`, and lost `where`'s type
 * checking along with the object name — which is how an operator the filter
 * dialect did not have (`$like`, undeclared then; #7536 has since made it a
 * real one) survived compilation and reached the runtime
 * (objectstack#5181, cloud#1053, cloud#1030).
 *
 * What this deliberately does NOT drop is the `object` inside an `expand`
 * entry: those values stay full `QueryAST`, and there the key names the
 * RELATED object — a fact no argument carries, so it is not redundant.
 *
 * Compatibility runs in both directions, and neither side is forced to move:
 * - **Callers** may still hand over a whole `QueryAST` value. It carries every
 *   property this type requires, and TypeScript admits the extra one on any
 *   value that is not a fresh literal. What is newly rejected is precisely the
 *   redundancy: a literal written inline at the call site that spells `object`.
 * - **Implementations** that still declare `query: QueryAST` keep compiling,
 *   because method parameters are compared bivariantly. What they may no
 *   longer do is READ `query.object` — a caller is now free to omit it, so the
 *   declaration would be lying about a value that is `undefined` at runtime.
 *   No driver in this repository reads it; the object name arrives as argument
 *   one, which is the whole point.
 *
 * [#8220] **Provenance crosses this boundary ON the `where` tree, not beside
 * it.** A `where` subtree may carry the filter-subtree provenance mark
 * (`data/filter-subtree-provenance.ts`) under its declared symbol key, stamped
 * by a read-scope merge boundary to say who authored that subtree. This type
 * deliberately grows no `provenance` slot for it: the merge produces one tree
 * whose ARMS differ in provenance, so a positional slot out here would break
 * the moment any layer re-shaped the filter — while the in-tree mark travels
 * by reference and is dropped by exactly the operations (copy, serialize,
 * rewrite) after which no attestation could be trusted anyway. A driver that
 * consumes it MUST fail closed: unmarked or ambiguous reads as policy-authored
 * (withhold), never as the author's.
 */
export type DriverQuery = Omit<QueryAST, 'object'>;

/**
 * IDataDriver - Comprehensive Database Driver Interface
 * 
 * Pure TypeScript interface for all storage adapters (Postgres, Mongo, Excel, Salesforce).
 * Mirrors the capabilities described in `data/driver.zod.ts` (DriverInterfaceSchema) but
 * expressed as a TypeScript interface for type-safe implementation contracts.
 * 
 * This is the contract that all ObjectStack database drivers MUST implement.
 * Use `DriverCapabilitiesSchema` / `DriverConfigSchema` from `data/driver.zod.ts` for
 * runtime capability detection and configuration validation.
 * 
 * @see DriverCapabilitiesSchema for runtime capability flags
 * @see DriverConfigSchema for driver configuration validation
 */
export interface IDataDriver {
  /** Driver unique name (e.g., 'postgresql', 'mongodb', 'rest_api') */
  readonly name: string;

  /** Driver version */
  readonly version: string;

  /** Capabilities descriptor */
  readonly supports: DriverCapabilities;

  // ===========================================================================
  // Lifecycle Management
  // ===========================================================================

  /** Initialize connection pool or authenticate */
  connect(): Promise<void>;

  /** Close connections and cleanup resources */
  disconnect(): Promise<void>;

  /** Check connection health */
  checkHealth(): Promise<boolean>;

  /** Get connection pool statistics (optional) */
  getPoolStats?(): { total: number; idle: number; active: number; waiting: number } | undefined;

  // ===========================================================================
  // Raw Execution (Escape Hatch)
  // ===========================================================================

  /**
   * Execute a raw command/query native to the driver.
   * 
   * @param command - Raw command (SQL string, shell command, or API payload)
   * @param parameters - Bound parameters for safe execution
   * @param options - Driver options (transaction context, timeout)
   * @returns Raw result from the driver
   */
  execute(command: unknown, parameters?: unknown[], options?: DriverOptions): Promise<unknown>;

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Find multiple records matching the structured query.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   *
   * **Paged reads MUST be deterministic.** Whenever `limit`/`offset` are used
   * to walk the result set, the driver MUST produce a total order — reading
   * page after page visits every matching row exactly once. The obligation
   * covers a paged read whatever its `orderBy`, including none at all, and it
   * holds across the whole walk rather than within one response.
   *
   * Two shapes break it, and they are the same defect at different strengths:
   *
   * - **A sort key that does not identify a row** (`orderBy: status`). No
   *   backend promises rows with equal keys keep the same relative arrangement
   *   between two queries — on MongoDB, `sort` + `skip`/`limit` on a non-unique
   *   key may return one document twice and never return another.
   * - **No `orderBy` at all**, which is the degenerate case of the first: every
   *   row ties with every other, so the *entire* page boundary is arbitrary.
   *   SQL leaves row order to the plan, and MongoDB's natural order moves when
   *   a document does.
   *
   * Drivers close both by ordering on a unique column of their own — appended
   * to a requested `orderBy`, or standing alone when there is none. Which
   * column, and whether the table has one at all, is the driver's knowledge,
   * which is why the obligation sits here and not in the query engine. A driver
   * that cannot name one is not free to reshuffle: it must return rows in an
   * order its own storage holds steady between reads (`driver-memory`), or the
   * guarantee is simply unavailable on that table and the driver says so.
   *
   * The failure this rules out is invisible in any single response: every page
   * is full, every row is real and belongs, and the duplicate sits several
   * screens away from the omission. Checked by the shared `PAGINATION_CASES`
   * and `PAGINATION_UNORDERED_CASES` fixtures
   * (`data/pagination-conformance.ts`) — a driver ships with those cases
   * running against it.
   *
   * Deliberately NOT covered: an **unpaged** read with no `orderBy`. Nothing is
   * being sliced, so no caller can be shown a partial view of the set, and
   * imposing an order there would change plan selection for the majority of
   * reads to buy nothing (objectstack#4363).
   */
  find(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]>;

  // `findStream` was removed in 17.0.0 (#4484, ADR-0049 enforce-or-remove). It was a
  // REQUIRED method promising reads "optimized for large datasets to avoid memory
  // overflow" that nothing in either repository ever called — and two of its three
  // implementations awaited `find()` in full before yielding, so the one guarantee it
  // existed to make was the one it inverted. Large reads go through `find()` with
  // `limit`/`offset`, whose paged-read determinism IS enforced (see above and
  // `data/pagination-conformance.ts`). A real cursor-based read should be
  // reintroduced with the caller that needs it, not ahead of one.

  /**
   * Find a single record by query.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   *
   * The paged-read guarantee on {@link find} does **not** extend here, and the
   * distinction is deliberate rather than an oversight. This method promises
   * *a* matching record, never a position in a sequence, so there is no
   * partition for a second call to be inconsistent with. Engines reach a driver
   * with `limit: 1`, which is shaped exactly like page one of a walk — and a
   * driver that read it that way would impose an ORDER BY on the single hottest
   * read in the system, for which `ORDER BY <key> LIMIT 1` is the classic shape
   * that makes a planner abandon the predicate's own index. A driver that wants
   * a deterministic single-row read should be handed an `orderBy`, which is a
   * thing the caller can express (objectstack#4363).
   */
  findOne(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown> | null>;

  /**
   * Create a new record.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  create(object: string, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>>;

  /**
   * Update an existing record by ID.
   * MUST return `id` as string. MUST NOT return implementation details like `_id`.
   */
  update(object: string, id: string | number, data: Record<string, unknown>, options?: DriverOptions): Promise<Record<string, unknown>>;

  /**
   * Upsert (Update or Insert) a record.
   */
  upsert(object: string, data: Record<string, unknown>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, unknown>>;

  /**
   * Delete a record by ID.
   * @returns True if deleted, false if not found.
   */
  delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean>;

  /**
   * Count records matching a query.
   */
  count(object: string, query?: DriverQuery, options?: DriverOptions): Promise<number>;

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /** Create multiple records in a single batch */
  bulkCreate(object: string, dataArray: Record<string, unknown>[], options?: DriverOptions): Promise<Record<string, unknown>[]>;

  /** Update multiple records in a single batch */
  bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, unknown> }>, options?: DriverOptions): Promise<Record<string, unknown>[]>;

  /** Delete multiple records in a single batch */
  bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void>;

  /** Update multiple records matching a query (optional) */
  updateMany?(object: string, query: DriverQuery, data: Record<string, unknown>, options?: DriverOptions): Promise<number>;

  /** Delete multiple records matching a query (optional) */
  deleteMany?(object: string, query: DriverQuery, options?: DriverOptions): Promise<number>;

  // ===========================================================================
  // Temporal Storage Convention (ADR-0053 D-A1/D-A2, #3912)
  // ===========================================================================
  //
  // A driver is the single source of truth for how a `Field.date` /
  // `Field.datetime` / `Field.time` value is physically stored on its
  // dialect. Any surface
  // that builds queries OUTSIDE the driver's own find()/filter path — the
  // analytics native-SQL strategy today, any future raw-query strategy — must
  // route its temporal comparands AND its column references through these two
  // hooks rather than re-deriving the storage form from the value's textual
  // shape (the drift that produced #3912).
  //
  // The two hooks are a pair on purpose: #3912's lesson is that coercing the
  // comparand alone is NOT sufficient on a dialect whose stored form can
  // diverge from the bound form — the column side of the comparison has to be
  // normalised by the same authority. A driver that implements one without
  // the other reintroduces half the bug, so implement both or neither.
  //
  // Both are optional with identity semantics: a driver whose storage form IS
  // the wire form (memory, mongo) simply omits them, and callers treat
  // "absent" exactly like "returns the input unchanged".

  /**
   * Coerce a filter comparand to the on-disk storage form of `field` on
   * `objectName` — e.g. an ISO instant for a canonical-text datetime column,
   * `YYYY-MM-DD` text for a `Field.date`, canonical `HH:MM:SS[.fff]` text
   * for a `Field.time` (#3994), a dialect-spelled datetime literal
   * where the dialect cannot parse ISO-8601. Non-temporal fields and
   * uninterpretable values are returned unchanged.
   */
  temporalFilterValue?(objectName: string, field: string, value: unknown): unknown;

  /**
   * The companion for the LEFT side of the same comparison: given the SQL the
   * caller was going to emit for the column (an already-quoted, possibly
   * qualified reference), return the SQL it must emit instead so the column
   * reads in the same storage form {@link temporalFilterValue} coerces the
   * comparand into. Returns `columnSql` verbatim for every column that needs
   * no normalisation — which is every column on a fully-converged database.
   */
  temporalFilterColumnSql?(objectName: string, field: string, columnSql: string): string;

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  /**
   * Begin a new database transaction.
   * @returns A transaction handle to pass via `options.transaction`.
   */
  beginTransaction(options?: { isolationLevel?: string }): Promise<unknown>;

  /** Commit the transaction */
  commit(transaction: unknown): Promise<void>;

  /** Rollback the transaction */
  rollback(transaction: unknown): Promise<void>;

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  /**
   * Synchronize the database schema with the Object definition.
   * Idempotent: creates tables if missing, adds columns, updates indexes.
   */
  syncSchema(object: string, schema: unknown, options?: DriverOptions): Promise<void>;

  /**
   * Batch-synchronize multiple object schemas with fewer round-trips.
   *
   * Drivers that set `supports.batchSchemaSync = true` MUST implement this.
   * The engine calls it once with all `{ object, schema }` pairs instead
   * of calling `syncSchema()` N times, reducing network overhead for
   * remote drivers.
   */
  syncSchemasBatch?(schemas: Array<{ object: string; schema: unknown }>, options?: DriverOptions): Promise<void>;

  /**
   * Register a federated (external) object's read metadata WITHOUT running DDL
   * (ADR-0015). For datasources with `schemaMode !== 'managed'`, the schema is
   * owned by the remote database, so `syncSchema()`/`initObjects()` (which run
   * DDL) are forbidden. Drivers that support federation implement this to record
   * the physical remote table (`external.remoteName` / `remoteSchema`) and the
   * per-object read-coercion metadata so queries resolve to the remote table.
   * Optional: drivers that don't support federation simply omit it (the engine
   * skips external objects for them).
   */
  registerExternalObject?(schema: unknown): void | Promise<void>;

  /**
   * What this driver's schema synchronisation has DONE since `connect()`:
   * how many tables it created, and how many it found already present.
   *
   * The pair answers a question no other surface can: **was this datastore
   * empty when the process reached it?** `existing === 0 && created > 0` means
   * every table here was made by this boot — nothing preceded it, so no row
   * written by an earlier version can exist. That is an observation of
   * creating a store, not an inference from finding one that looks empty, and
   * it is what lets a fresh deployment attest data migrations it can never
   * need (ADR-0104's 2026-07-30 addendum, #3438).
   *
   * Counts tables the driver actually inspected: deferred DDL (`os migrate
   * plan`) and skipped sync leave both at zero, which reads as "cannot say"
   * and keeps the conservative posture. A table that existed and was rebuilt
   * counts as `existing` — it was here before us.
   *
   * Optional and purely observational; drivers that omit it simply cannot
   * vouch for a store's newness.
   */
  getSchemaSyncStats?(): { created: number; existing: number };

  /** Drop the underlying table or collection (destructive) */
  dropTable(object: string, options?: DriverOptions): Promise<void>;

  /**
   * Reclaim free space after bulk deletions (ADR-0057 §3.4). SQLite issues
   * `PRAGMA incremental_vacuum` (pairs with the `auto_vacuum=INCREMENTAL`
   * connect-time default); engines with their own background reclamation
   * (Postgres autovacuum) may no-op. Optional — the LifecycleService calls
   * it best-effort after every sweep that deleted rows.
   */
  reclaimSpace?(options?: DriverOptions): Promise<void>;

  /**
   * Analyze query performance.
   * Returns execution plan without executing the query (optional).
   */
  explain?(object: string, query: DriverQuery, options?: DriverOptions): Promise<unknown>;
}
