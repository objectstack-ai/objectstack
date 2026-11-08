// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "CRUD — IDataDriver core" section of `SqlDriver`: the
 * bodies of `find`, `findRows`, `findOne`, `create`, `readBackInsertedRows`,
 * `ensureSequencesTable`, `sequenceKeyHash` moved out of `sql-driver.ts` whole
 * by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link CrudFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link CrudHost}: exactly the `SqlDriver`
 * members they read, private ones included. Every stub hands its body, by a
 * `.call`, the same host: `crudHost` in `sql-driver-facet-hosts.ts`, built once
 * per driver by the class's static block. Methods go as closures that call them
 * on the driver at call time, so a subclass override or an instance spy is
 * still the one reached; fields and accessors go as GETTERS, read when the body
 * reads them, as they were on the class, and a field a body assigns goes with a
 * SETTER that assigns it on the driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import {
  AUTONUMBER_COLLISION_RETRIES, DEFAULT_ID_LENGTH, SEQUENCES_TABLE, insertedRowsNotReadBackError,
  isUnresolvableColumnError,
} from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link CrudFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface CrudHost {
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  applyWriteColumnMap: SqlDriver['applyWriteColumnMap'];
  assertBareKnexSafe: SqlDriver['assertBareKnexSafe'];
  auditMissingTenant: SqlDriver['auditMissingTenant'];
  backendStatementFault: SqlDriver['backendStatementFault'];
  collidingAutoNumberReservations: SqlDriver['collidingAutoNumberReservations'];
  createSequencesTable: SqlDriver['createSequencesTable'];
  decorateHashShadowDuplicate: SqlDriver['decorateHashShadowDuplicate'];
  ensureSequencesKeyHashShape: SqlDriver['ensureSequencesKeyHashShape'];
  fillAutoNumberFields: SqlDriver['fillAutoNumberFields'];
  findRows: SqlDriver['findRows'];
  formatInput: SqlDriver['formatInput'];
  formatOutput: SqlDriver['formatOutput'];
  getBuilder: SqlDriver['getBuilder'];
  injectTenantOnInsert: SqlDriver['injectTenantOnInsert'];
  readonly insertReturnsStoredRows: SqlDriver['insertReturnsStoredRows'];
  readonly isMssql: SqlDriver['isMssql'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly knex: SqlDriver['knex'];
  mapSortField: SqlDriver['mapSortField'];
  orderKeysFor: SqlDriver['orderKeysFor'];
  primeMssqlPagingKey: SqlDriver['primeMssqlPagingKey'];
  readBackInsertedRows: SqlDriver['readBackInsertedRows'];
  remoteColumn: SqlDriver['remoteColumn'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  resyncSequenceToDataMax: SqlDriver['resyncSequenceToDataMax'];
  rotationWriteTarget: SqlDriver['rotationWriteTarget'];
  sequencesHasKeyHash: SqlDriver['sequencesHasKeyHash'];
  sequencesTableEnsurePromise: SqlDriver['sequencesTableEnsurePromise'];
  sequencesTableReady: SqlDriver['sequencesTableReady'];
  stampInsertTimestamps: SqlDriver['stampInsertTimestamps'];
  unresolvableFilterColumnRefusal: SqlDriver['unresolvableFilterColumnRefusal'];
}

/** The bodies of the "CRUD — IDataDriver core" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class CrudFacet {
  /** The body of `SqlDriver#find`; the method's docblock there is its contract. */
  static async find(this: Pick<CrudHost, 'findRows'>, object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    return this.findRows(object, query, options);
  }

  /**
   * The body of {@link find}, shared with {@link findOne}.
   *
   * `singleRowLookup` marks the caller as `findOne` rather than a page, and the
   * only thing it changes is that no ordering is imposed on an unsorted read
   * (objectstack#4363). `findOne` reaches here as `limit: 1`, which is
   * indistinguishable from "page one of a walk with page size 1" — and the two
   * want opposite things:
   *
   * - The paged read needs a total order, or its pages are not a partition.
   * - `findOne` needs the plan its predicate earned. `ORDER BY id LIMIT 1` is
   *   the shape that makes a planner abandon the predicate's own index and walk
   *   the primary key applying a filter instead, because at `LIMIT 1` that
   *   looks like it will stop early. Measured on Postgres 16 over 2M rows,
   *   `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms (~100×) and swapped
   *   `ticket_owner_idx` for `ticket_pkey`; at `LIMIT 5` and up the planner
   *   keeps the right index and pays only a top-N sort (~2 ms). Nothing is
   *   bought for that: `findOne` promises *a* matching record, never a position
   *   in a sequence, so there is no partition to preserve.
   *
   * `MongoDBDriver.findOne` carries the same flag into its own `buildSortSpec`,
   * so both drivers now read a `findOne` the same way: honour the caller's
   * `orderBy`, impose nothing when there is none. (Mongo used to translate
   * `where` and drop `orderBy` outright — an earlier version of this comment
   * cited that as agreement, which it was not; objectstack#4419.) The
   * obligation the contract states is on `find`, and this keeps it there.
   */
  static async findRows(this: Pick<CrudHost, 'applyFilters' | 'applyTenantScope' | 'backendStatementFault' | 'formatOutput' | 'getBuilder' | 'isMssql' | 'mapSortField' | 'orderKeysFor' | 'primeMssqlPagingKey' | 'remoteColumn' | 'unresolvableFilterColumnRefusal'>, object: string, query: DriverQuery, options?: DriverOptions, singleRowLookup = false): Promise<any[]> {
    // [#31327] On SQL Server a federated object's paging key is read from the
    // remote catalog before the ORDER BY is decided (`primeMssqlPagingKey`).
    if (this.isMssql) await this.primeMssqlPagingKey(object);
    // The whole ORDER BY, decided once: the caller's keys plus whatever this
    // driver has to add to make a paged read deterministic. Derived out here
    // rather than inside `buildBase` so the recovery ladder below can ask
    // whether the statement HAS a sort to drop, instead of asking whether the
    // caller supplied one — since #4363 those are different questions.
    const orderKeys = this.orderKeysFor(object, query, { singleRowLookup });

    // Build everything EXCEPT the SELECT list, so the unknown-column retry
    // below can rebuild without re-deriving where/order/pagination.
    const buildBase = (opts?: { withOrderBy?: boolean }) => {
      const withOrderBy = opts?.withOrderBy !== false;
      const b = this.getBuilder(object, options);
      this.applyTenantScope(b, object, options);

      // WHERE
      if (query.where) {
        this.applyFilters(b, query.where, options);
      }

      // ORDER BY
      if (withOrderBy) {
        for (const key of orderKeys) {
          b.orderBy(this.remoteColumn(object, key.field, this.mapSortField(key.field)), key.direction);
        }
      }
      // [#31327] SQL Server rejects `OFFSET n ROWS` without an ORDER BY (a
      // syntax error, not a reshuffle). When nothing above ordered the read —
      // a keyless federated table, or the #3821 rung that dropped the sort —
      // `(SELECT NULL)` is the order that changes nothing but the statement's
      // validity; the nondeterministic-paging warning has already been given.
      if (this.isMssql && query.offset && !(withOrderBy && orderKeys.length > 0)) {
        b.orderByRaw('(SELECT NULL)');
      }

      // PAGINATION
      if (this.isMssql && query.limit === 0) {
        // [#31327] `FETCH NEXT 0 ROWS` is an error on SQL Server ("must be
        // greater than zero"), where every other dialect answers `LIMIT 0`
        // with no rows. Without the offset knex compiles `SELECT TOP (0)`,
        // which is the same empty answer — and an offset into no rows is no
        // rows.
        b.limit(0);
        return b;
      }
      if (query.offset !== undefined) b.offset(query.offset);
      if (query.limit !== undefined) b.limit(query.limit);

      return b;
    };

    const builder = buildBase();

    // SELECT
    if (Array.isArray(query.fields) && query.fields.length > 0) {
      builder.select(query.fields.map((f) => this.mapSortField(f)));
    } else {
      builder.select('*');
    }

    let results: any[];
    try {
      results = await builder;
    } catch (error: any) {
      if (isUnresolvableColumnError(error)) {
        // A `$select` projection naming a column the table lacks (e.g. a
        // generic list view auto-requesting `status`/`due_date`/`image` on an
        // object without them) makes the WHOLE query fail. Swallowing that
        // into an empty result — the old behavior — reads to the UI as "no
        // records exist" even though rows are there: a silent data-loss
        // footgun. When the failure came from the projection, retry once
        // selecting all columns so the real rows still come back; the unknown
        // field is simply absent from each row (it never existed). The
        // engine's unknown-field filter is the first line of defense, but it
        // only fires when the object's schema is populated in the registry —
        // this driver backstop holds even when it isn't (notably the cloud
        // multi-tenant runtime, where the projection otherwise zeroes the list).
        //
        // An unknown ORDER BY column is the same footgun one clause over
        // (objectstack#3821): a client that sorts by a field the table lacks
        // used to get an empty page with a non-zero `total` — "the rows are
        // there but none are shown". Rows matter more than their order, so
        // drop the sort and return them unordered rather than nothing. Ladder:
        // projection first (it is the likelier culprit and the cheaper thing
        // to lose), then the sort, then give up.
        //
        // [#8790, maintainer ruling 2026-08-15] Where the ladder STOPS is the
        // other half of the same argument. Every rung is built from
        // `buildBase()`, which always re-applies `query.where` — so the ladder
        // can drop a projection and can drop a sort, but it can never drop the
        // clause that failed when the unresolvable column is in the WHERE.
        // Both rungs then raise the same error and the method used to fall to
        // `return []`. That terminal is now a refusal: rows matter more than
        // their order, but nothing matters more than the predicate, because
        // answering without it returns records the caller excluded. See
        // {@link unresolvableFilterColumnError}. The two recoveries above are
        // deliberately untouched — the ruling narrows the terminal only.
        const retries: Array<() => any> = [];
        if (query.fields) retries.push(() => buildBase().select('*'));
        if (orderKeys.length > 0) {
          retries.push(() => buildBase({ withOrderBy: false }).select('*'));
        }
        results = [];
        let recovered = false;
        // The error to NAME the column from. The last rung is the one that has
        // dropped everything droppable, so a column still unresolved there is
        // the caller's WHERE — naming it from the ORIGINAL error would name the
        // projection column on a query whose projection the ladder just fixed.
        let lastError: unknown = error;
        for (const retry of retries) {
          try {
            results = await retry();
            recovered = true;
            break;
          } catch (retryError) {
            // Try the next, broader fallback.
            lastError = retryError;
          }
        }
        if (!recovered) throw this.unresolvableFilterColumnRefusal(object, lastError, query.where);
      } else {
        // [#8931] The terminal catch-all — see
        // {@link SqlDriver.backendStatementFault}. This is the `find` half of
        // the exit `count` spells below; both halves must answer one condition
        // one way, which is the invariant #8790 established on this path and
        // this ruling extends to every condition the ladder does not recover.
        throw this.backendStatementFault(object, error);
      }
    }

    if (!Array.isArray(results)) {
      return [];
    }

    // formatOutput is dialect-agnostic for `Field.date` (ADR-0053 Phase 1);
    // its json/boolean deserialisation stays SQLite-gated internally. Run it
    // for every dialect so reads match `findOne` and date columns come back
    // as `YYYY-MM-DD`.
    for (const row of results) {
      this.formatOutput(object, row);
    }
    return results;
  }

  /** The body of `SqlDriver#findOne`; the method's docblock there is its contract. */
  static async findOne(this: Pick<CrudHost, 'findRows'>, object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    if (!query || typeof query !== 'object') return null;
    const results = await this.findRows(object, { ...query, limit: 1 }, options, true);
    return results[0] || null;
  }

  /** The body of `SqlDriver#create`; the method's docblock there is its contract. */
  static async create(this: Pick<CrudHost, 'applyWriteColumnMap' | 'auditMissingTenant' | 'collidingAutoNumberReservations' | 'decorateHashShadowDuplicate' | 'fillAutoNumberFields' | 'formatInput' | 'formatOutput' | 'getBuilder' | 'injectTenantOnInsert' | 'insertReturnsStoredRows' | 'isMssql' | 'readBackInsertedRows' | 'resyncSequenceToDataMax' | 'rotationWriteTarget' | 'stampInsertTimestamps'>, object: string, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown>> {
    const { _id, ...rest } = data;
    const toInsert = { ...rest };

    if (_id !== undefined && toInsert.id === undefined) {
      toInsert.id = _id;
    } else if (toInsert.id === undefined) {
      toInsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    this.auditMissingTenant(object, 'create', options, [toInsert]);
    this.injectTenantOnInsert(object, toInsert, options);

    // #5495. The autonumber counter is bootstrapped from the data table exactly
    // once, so any row that lands by a path bypassing `fillAutoNumberFields`
    // leaves it permanently behind `MAX` — and every create then collided,
    // burned a number and failed the request until it had ground past the
    // seeded range one 409 at a time. Re-seed and retry instead, but ONLY when
    // the collision is provably this counter's; see
    // {@link collidingAutoNumberReservations} for how that is decided and why
    // it cannot be decided from the error text alone.
    //
    // Retrying is confined to the no-caller-transaction case on purpose. Inside
    // a caller's transaction there is nothing to repair here — the sequence
    // UPDATE shares that transaction and rolls back with the refused INSERT, so
    // no number is burned (measured) — and there is something to break: on
    // Postgres a constraint failure aborts the whole transaction, so a retry
    // issued on it could not succeed anyway. The caller owns that retry.
    const mayRetry = options?.transaction === undefined;
    for (let attempt = 0; ; attempt++) {
      const reservations = await this.fillAutoNumberFields(object, toInsert, options);

      // Rotation (ADR-0057 P2): the base name is a read-only view — new rows
      // land in the current shard.
      const builder = this.getBuilder(this.rotationWriteTarget(object) ?? object, options);
      const formatted = this.applyWriteColumnMap(object, this.formatInput(object, toInsert));
      this.stampInsertTimestamps(object, formatted);

      try {
        if (this.insertReturnsStoredRows) {
          // [#31327] On SQL Server `OUTPUT inserted.*` without `INTO` is refused
          // on a table with an enabled trigger (error 334) — routine on an ERP
          // table. knex's `includeTriggerModifications` routes the OUTPUT through
          // a temp table, which SQL Server accepts on every table.
          const result = await (this.isMssql
            ? builder.insert(formatted).returning('*', { includeTriggerModifications: true })
            : builder.insert(formatted).returning('*'));
          return this.formatOutput(object, result[0]);
        }
        await builder.insert(formatted);
      } catch (error) {
        // #11627: on a table whose UNIQUE index is carried by a hash shadow,
        // `ER_DUP_ENTRY` quotes a binary digest and names the shadow index, so
        // neither the operator nor this driver can read WHICH value conflicted
        // — and a genuine duplicate is indistinguishable from a (near-
        // impossible) digest collision. Resolve it by reading the source
        // columns back, on the failure path only, and re-throw the SAME error
        // carrying whichever answer is true. Returns the error untouched when
        // this is not a shadow conflict.
        const shadowed = await this.decorateHashShadowDuplicate(
          this.rotationWriteTarget(object) ?? object,
          formatted,
          error,
        );
        if (!mayRetry || attempt >= AUTONUMBER_COLLISION_RETRIES) throw shadowed;
        const colliding = await this.collidingAutoNumberReservations(error, reservations, options);
        if (colliding.length === 0) throw shadowed;
        for (const reservation of colliding) {
          await this.resyncSequenceToDataMax(reservation);
          // Clear only what collided, so the next pass regenerates exactly
          // those fields. A reservation that did NOT collide keeps its value
          // rather than burning a second number for nothing.
          delete toInsert[reservation.field];
        }
        continue;
      }

      // [#21227] Reached only when the INSERT landed and answered no rows. The
      // read sits OUTSIDE the try on purpose: a fault in it is not an insert
      // failure, so it must never reach the collision re-seed above, whose
      // retry would re-issue a write that already landed.
      const [stored] = await this.readBackInsertedRows(
        object,
        this.rotationWriteTarget(object) ?? object,
        [toInsert],
        options,
      );
      return stored;
    }
  }

  /**
   * [#21227] Read back the rows an INSERT on this call just wrote, by the ids
   * it wrote: what `create` and `bulkCreate` answer on a dialect whose INSERT
   * answers no rows ({@link insertReturnsStoredRows}).
   *
   * One row per written row, in the written order (`IN (…)` promises no
   * order), each through `formatOutput()`, the same presentation
   * `returning('*')` gets on the other dialects and `update`'s own read-back
   * gets on every dialect.
   *
   * # The read key: the written id, which this driver always holds
   *
   * Every row reaches the INSERT carrying the id this driver gave it: the
   * caller's `id`, else its `_id`, else a nanoid minted in `create` /
   * `bulkCreate` before the statement is built. The id is never asked of the
   * database, so no insert id is read: the managed `id` column is a
   * `varchar(255)` PRIMARY KEY with no AUTO_INCREMENT, and the insert id
   * MySQL reports for it is `0`. The column is resolved through
   * {@link remoteColumn}, so an external object whose `columnMap` renames
   * `id` is read by its physical column, as its INSERT was written.
   *
   * # The table: the write target
   *
   * The table the statement wrote, a rotation shard included, so the read
   * looks where the row landed rather than at the base name.
   *
   * # Tenant scope: the tenants the rows were WRITTEN under
   *
   * Routed through {@link applyTenantScope} like every read door in this class
   * (`check:tenant-chokepoint`), scoped as `upsert`'s identity probe
   * (`assertMergeLandedOnSuppliedIdentity`) scopes its own read: to the tenant
   * each row was written under. On an ordinary tenanted call that is the
   * caller's org, which `injectTenantOnInsert` stamped. On an admin write that
   * names a tenant in the row data (a documented authority: explicit values
   * are never overwritten), a read scoped to the caller's ACTIVE org would miss
   * a row that really landed. A batch may name several tenants, so the scope is
   * their union through `tenantIds`, which `applyTenantScope` already compiles
   * as `IN (…)`; the caller's own `tenantIds` membership set is replaced, not
   * widened. A row written with no tenant is no tenant's, and no tenant scope
   * reaches it (ADR-0131 D1), so the rows' union scopes the read only when
   * every row carries one. Otherwise the call's own options decide, and a call
   * with no tenant leaves a row unstamped only because it carries none:
   * `injectTenantOnInsert` fills every absent column on a call that does. With
   * no tenant field, or no tenant on the call, `applyTenantScope` leaves the
   * read unscoped by its own contract. The ids are this call's own and `id` is
   * the PRIMARY KEY, so the read cannot answer a row this call did not write,
   * in any organization.
   *
   * # A row that is not there
   *
   * Refused with {@link insertedRowsNotReadBackError}, never answered with the
   * payload: see that function for why.
   */
  static async readBackInsertedRows(this: Pick<CrudHost, 'applyTenantScope' | 'formatOutput' | 'getBuilder' | 'remoteColumn' | 'resolveTenantField'>, object: string, writeTable: string, written: Record<string, any>[], options?: DriverOptions): Promise<Record<string, unknown>[]> {
    if (written.length === 0) return [];
    const idColumn = this.remoteColumn(object, 'id', 'id');
    const tenantField = this.resolveTenantField(object);
    const writtenTenants = tenantField
      ? [
          ...new Set(
            written
              .map((row) => row[tenantField])
              .filter((value) => value !== undefined && value !== null && value !== '')
              .map(String),
          ),
        ]
      : [];
    const everyRowCarriesTenant =
      tenantField !== null
      && written.every((row) => row[tenantField] !== undefined && row[tenantField] !== null && row[tenantField] !== '');
    const scopeOptions: DriverOptions = everyRowCarriesTenant
      ? { ...options, tenantId: writtenTenants[0], tenantIds: writtenTenants }
      : { ...options };
    const builder = this.getBuilder(writeTable, options);
    this.applyTenantScope(builder, object, scopeOptions);
    const stored: Record<string, any>[] = await builder.whereIn(
      idColumn,
      written.map((row) => row.id),
    );
    const byId = new Map<string, Record<string, any>>();
    for (const row of stored) byId.set(String(row[idColumn]), row);
    const missing = written.filter((row) => !byId.has(String(row.id))).map((row) => row.id);
    if (missing.length > 0) throw insertedRowsNotReadBackError(object, missing, written.length);
    return written.map((row) => this.formatOutput(object, byId.get(String(row.id))));
  }

  /** The body of `SqlDriver#ensureSequencesTable`; the method's docblock there is its contract. */
  static async ensureSequencesTable(this: Pick<CrudHost, 'assertBareKnexSafe' | 'createSequencesTable' | 'ensureSequencesKeyHashShape' | 'isSqlite' | 'knex' | 'sequencesHasKeyHash' | 'sequencesTableEnsurePromise' | 'sequencesTableReady'>, parentTrx?: Knex.Transaction): Promise<void> {
    if (this.sequencesTableReady) return;
    if (this.sequencesTableEnsurePromise) {
      await this.sequencesTableEnsurePromise;
      return;
    }
    // Which connection runs the DDL below. Normally a fresh pooled connection
    // (`this.knex`), because `initObjects` pre-creates the table outside any data
    // transaction. This lazy path is the fallback (e.g. an external object, or a
    // consumer that writes without `initObjects`). If we are already inside the
    // caller's transaction AND the pool can only ever hand out one connection
    // (SQLite, pool max=1), that connection is busy with the open transaction —
    // a bare `this.knex` here would block forever acquiring a second one and then
    // fail with a Knex acquire-timeout (the reported batch/autonumber deadlock).
    // Run the DDL on the caller's own transaction instead; SQLite permits DDL
    // inside a transaction. We deliberately do NOT route DDL through `parentTrx`
    // on MySQL, where DDL implicitly commits the caller's transaction; there the
    // pool has room (max=5) for a fresh connection to create the table safely.
    // The 5 is `buildSqlPool`'s — service-datasource's
    // `default-datasource-driver-factory.ts` gives every datasource it composes
    // `{min:0,max:5}` unless one declares its own `pool` — not knex's roomier
    // `poolDefaults()` of `{min:2,max:10}`, which the factory never reaches.
    const runner: Knex | Knex.Transaction = parentTrx && this.isSqlite ? parentTrx : this.knex;
    // If we are about to run DDL on a fresh pooled connection while a SQLite
    // transaction holds the only one, fail fast with a clear message instead of
    // dead-locking. This catches the "caller opened a transaction but did not
    // thread it through as parentTrx" regression at the call site (dev/test only).
    if (runner === this.knex) this.assertBareKnexSafe('ensureSequencesTable');
    this.sequencesTableEnsurePromise = (async () => {
      const exists = await runner.schema.hasTable(SEQUENCES_TABLE);
      if (!exists) {
        try {
          await this.createSequencesTable(SEQUENCES_TABLE, runner);
          this.sequencesHasKeyHash = true;
        } catch (err: any) {
          // Race or cross-process create — re-check existence; ignore
          // "already exists" errors from any dialect.
          const stillMissing = !(await runner.schema.hasTable(SEQUENCES_TABLE));
          if (stillMissing) throw err;
          // A racing creator may have used an older schema. Migrate in place.
          await this.ensureSequencesKeyHashShape(runner);
        }
      } else {
        // Pre-existing table may predate the `key_hash`/`scope` shape. Migrate.
        await this.ensureSequencesKeyHashShape(runner);
      }
      // Cache "ready" only when the DDL ran on a durable connection. If it rode
      // the caller's transaction (the SQLite in-tx fallback above), the table is
      // commit-conditional — a rollback would drop it — so leave the flag unset
      // and re-verify (a cheap `hasTable`) on the next write rather than trusting
      // a stale process-level flag. `initObjects` sets it durably up front, so
      // the hot path is unaffected.
      if (runner === this.knex) this.sequencesTableReady = true;
    })();
    try {
      await this.sequencesTableEnsurePromise;
    } finally {
      this.sequencesTableEnsurePromise = null;
    }
  }

  /** The body of `SqlDriver#sequenceKeyHash`; the method's docblock there is its contract. */
  static sequenceKeyHash(object: string, tenantId: string, field: string, scope: string): string {
    return createHash('sha256')
      .update(`${object}\u001f${tenantId}\u001f${field}\u001f${scope}`)
      .digest('hex');
  }
}
