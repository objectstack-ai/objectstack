// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Bulk & Batch Operations" section of `SqlDriver`: the
 * bodies of `bulkCreate`, `bulkUpdate`, `updateMany`, `rotatedUpdateById`,
 * `count` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link BulkOperationsHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time (the builder factory as a bound reference),
 * so a subclass override or an instance spy is still the one reached; fields
 * and accessors go as GETTERS, read when the body reads them, as they were on
 * the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { AUTONUMBER_COLLISION_RETRIES, DEFAULT_ID_LENGTH, isUnresolvableColumnError } from './sql-driver-top-level.js';
import type { AutoNumberReservation } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface BulkOperationsHost {
  applyFilters: SqlDriver['applyFilters'];
  applyTenantScope: SqlDriver['applyTenantScope'];
  applyWriteColumnMap: SqlDriver['applyWriteColumnMap'];
  auditMissingTenant: SqlDriver['auditMissingTenant'];
  autoNumberCounterKey: SqlDriver['autoNumberCounterKey'];
  backendStatementFault: SqlDriver['backendStatementFault'];
  collidingAutoNumberReservations: SqlDriver['collidingAutoNumberReservations'];
  fillAutoNumberFields: SqlDriver['fillAutoNumberFields'];
  formatInput: SqlDriver['formatInput'];
  formatOutput: SqlDriver['formatOutput'];
  getBuilder: SqlDriver['getBuilder'];
  injectTenantOnInsert: SqlDriver['injectTenantOnInsert'];
  readonly insertReturnsStoredRows: SqlDriver['insertReturnsStoredRows'];
  keepSuppliedUpdatedAt: SqlDriver['keepSuppliedUpdatedAt'];
  readonly knex: SqlDriver['knex'];
  readBackInsertedRows: SqlDriver['readBackInsertedRows'];
  resyncSequenceToDataMax: SqlDriver['resyncSequenceToDataMax'];
  rotationShardsOf: SqlDriver['rotationShardsOf'];
  rotationWriteTarget: SqlDriver['rotationWriteTarget'];
  stampInsertTimestamps: SqlDriver['stampInsertTimestamps'];
  stampsUpdatedAt: SqlDriver['stampsUpdatedAt'];
  unresolvableFilterColumnRefusal: SqlDriver['unresolvableFilterColumnRefusal'];
  update: SqlDriver['update'];
  updateWithPresumedTimestamp: SqlDriver['updateWithPresumedTimestamp'];
  updatedAtStamp: SqlDriver['updatedAtStamp'];
  updatedAtStampIsPresumed: SqlDriver['updatedAtStampIsPresumed'];
}

/** The body of `SqlDriver#bulkCreate`; the method's docblock there is its contract. */
export async function bulkCreate(this: Pick<BulkOperationsHost, 'applyWriteColumnMap' | 'auditMissingTenant' | 'autoNumberCounterKey' | 'collidingAutoNumberReservations' | 'fillAutoNumberFields' | 'formatInput' | 'formatOutput' | 'getBuilder' | 'injectTenantOnInsert' | 'insertReturnsStoredRows' | 'readBackInsertedRows' | 'resyncSequenceToDataMax' | 'rotationWriteTarget' | 'stampInsertTimestamps'>, object: string, data: any[], options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // Same client-side id assignment as create() (id/_id normalization,
    // nanoid fallback when neither is supplied) — a row missing an id must
    // not be silently inserted with a NULL primary key just because the
    // engine batched it into an array. This path used to be rarely
    // exercised; framework#2678 made it the common case for seed/import.
    const rows = data.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const { _id, ...rest } = row;
      const toInsert: Record<string, any> = { ...rest };
      if (_id !== undefined && toInsert.id === undefined) {
        toInsert.id = _id;
      } else if (toInsert.id === undefined) {
        toInsert.id = nanoid(DEFAULT_ID_LENGTH);
      }
      return toInsert;
    });
    this.auditMissingTenant(object, 'bulkCreate', options, rows);
    for (const row of rows) {
      if (row && typeof row === 'object') this.injectTenantOnInsert(object, row, options);
    }

    // #6943. A stale counter costs this path more than it costs `create()`.
    // Each row reserves its own number in its own committed transaction, and
    // then the whole batch goes in as ONE insert — so a single colliding row
    // does not burn one number, it burns every number the batch reserved and
    // fails the whole request. Measured on `main` @ `c8ff269` (counter at 10,
    // rows 11–39 landed by a bypass path): a 3-row `bulkCreate` threw, wrote
    // ZERO rows and moved `last_value` 10 → 13; the next call moved it 13 → 16
    // and threw again. And the exposure is the worst available, because
    // framework#2678 made this the common path for seed/import — which is
    // precisely what *creates* the staleness (`isSystem` replay and
    // `preserveAudit` import keep their explicit numbers and never enter
    // `fillAutoNumberFields`, #5495/#5503).
    //
    // ## Batch semantics are deliberately NOT changed
    //
    // The card anticipated a decision about partial success and transaction
    // boundaries. Measurement dissolves it: `insert(rows[])` is a SINGLE
    // statement (`… select … union all select …` on SQLite, multi-row VALUES
    // elsewhere), so the batch is ALREADY all-or-nothing — the failed batch
    // above left the table exactly as it found it. Re-issuing and retrying the
    // WHOLE batch therefore preserves the existing contract byte for byte: no
    // partial success is introduced, no transaction is opened, no sibling-
    // rollback question arises because siblings already fail together.
    // Rejected instead:
    //   - **Per-row retry inside the batch** (the shape the card sketched).
    //     It requires splitting the one statement into N to learn which row
    //     failed, which INVENTS partial success where none exists, costs N
    //     round-trips on the hot seed/import path, and is what the engine's
    //     own #6806 note warns about ("re-writing the batch could DUPLICATE
    //     the rows that did land"). Nothing lands here, so nothing can.
    //   - **Wrapping the batch in a driver-opened transaction.** It would move
    //     the boundary the card was worried about, for no gain (the statement
    //     is already atomic), and it defeats the reservation model: each
    //     `getNextSequenceValue` commits on purpose, which is what makes a
    //     forward-only re-seed meaningful. On SQLite (pool max 1) it is also
    //     the deadlock `ensureSequencesTable` documents.
    //   - **Re-seed but do not re-issue** (what the engine does at #6806).
    //     Correct there, because the engine cannot know whether an arbitrary
    //     driver applied the batch partially. Inside THIS driver that is
    //     measurably false, so the caller can be handed a successful batch
    //     instead of an error it has to retry itself.
    //   - **Blanket retry on any unique violation.** Rejected for #5495's
    //     reason: it silently eats the caller's own 409.
    const mayRetry = options?.transaction === undefined;
    // What each row currently holds, ACROSS attempts. A retry regenerates only
    // the fields it cleared, so `fillAutoNumberFields` reports only those; a
    // value kept from the previous pass is still a live reservation and has to
    // stay described here, or a second collision on a counter that did not go
    // stale the first time would find nothing to route and rethrow blind.
    const reservationsPerRow: AutoNumberReservation[][] = rows.map(() => []);
    for (let attempt = 0; ; attempt++) {
      // Reserve a persistent sequence value for each row's autonumber
      // field(s) — the engine no longer pre-fills these (see #1603).
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || typeof row !== 'object') continue;
        const reissued = await this.fillAutoNumberFields(object, row, options);
        if (reissued.length === 0) continue;
        const replaced = new Set(reissued.map((r) => r.field));
        reservationsPerRow[i] = [...reservationsPerRow[i].filter((r) => !replaced.has(r.field)), ...reissued];
      }

      // Same write-side marshaling as create() (#2735): JSON-typed and
      // object-valued fields must be serialized per row before they reach the
      // knex binder — the raw batch used to hand `{lat, lng}` objects straight
      // to SQLite ("Wrong API use: tried to bind a value of an unknown type"),
      // silently failing the whole seed batch. Timestamp stamping runs on the
      // FORMATTED copy, mirroring create().
      const formattedRows = rows.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const formatted = this.applyWriteColumnMap(object, this.formatInput(object, row));
        this.stampInsertTimestamps(object, formatted);
        return formatted;
      });
      const builder = this.getBuilder(this.rotationWriteTarget(object) ?? object, options);

      try {
        if (this.insertReturnsStoredRows) {
          const result = await builder.insert(formattedRows).returning('*');
          // Read-back parity with create(): JSON columns come back as their stored
          // strings from `returning('*')` — decode them so batch callers see the
          // same shapes single-insert callers do.
          return Array.isArray(result)
            ? result.map((r) => this.formatOutput(object, r))
            : result;
        }
        await builder.insert(formattedRows);
      } catch (error) {
        if (!mayRetry || attempt >= AUTONUMBER_COLLISION_RETRIES) throw error;
        const colliding = await this.collidingAutoNumberReservations(error, reservationsPerRow.flat(), options);
        if (colliding.length === 0) throw error;

        // Re-seed each stale counter ONCE, not once per row that drew from it:
        // the scan is identical for every row sharing a counter and the update
        // is forward-only, so the repeats are pure cost.
        const stale = new Set<string>();
        for (const reservation of colliding) {
          const key = this.autoNumberCounterKey(reservation);
          if (stale.has(key)) continue;
          stale.add(key);
          await this.resyncSequenceToDataMax(reservation);
        }

        // Re-issue EVERY row drawn from a stale counter — including rows whose
        // own value did not collide. This is where the batch genuinely differs
        // from `create()`, which keeps a non-colliding value to avoid burning a
        // second number. Keeping them here is unsound: a batch that straddles
        // the seeded range (say the counter is at 10, rows 11–39 exist, and the
        // batch reserved 11–70) has its low rows collide and its high rows not,
        // and regenerating only the low ones hands them numbers ABOVE the kept
        // ones — an intra-batch duplicate this driver would have created
        // itself. Counters that did NOT go stale keep their values, so another
        // tenant's rows in the same batch are undisturbed.
        for (let i = 0; i < rows.length; i++) {
          for (const reservation of reservationsPerRow[i]) {
            if (stale.has(this.autoNumberCounterKey(reservation))) delete rows[i][reservation.field];
          }
        }
        continue;
      }

      // [#21227] Reached only when the INSERT landed and answered no rows (the
      // MySQL family answered `[insertId]`: one element for the whole batch,
      // which the engine's one-result-per-row guard then refused after every
      // row had been stored). ONE read for the batch, by the ids written, in
      // the written order. Outside the try for the reason `create` gives.
      return this.readBackInsertedRows(
        object,
        this.rotationWriteTarget(object) ?? object,
        rows,
        options,
      );
    }
  }

/** The body of `SqlDriver#bulkUpdate`; the method's docblock there is its contract. */
export async function bulkUpdate(this: Pick<BulkOperationsHost, 'knex' | 'update'>, object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // An empty batch issues no statement, exactly as before: a BEGIN/COMMIT
    // pair — and the pool checkout behind it — buys nothing for zero rows.
    if (updates.length === 0) return [];

    const applyAll = async (scoped: DriverOptions): Promise<Record<string, any>[]> => {
      const results: Record<string, any>[] = [];
      for (const { id, data } of updates) {
        const updated = await this.update(object, id, data, scoped);
        if (updated) results.push(updated);
      }
      return results;
    };

    // The `(caller's transaction) ?? this.knex` runner idiom this file already
    // uses (see {@link collidingAutoNumberReservations}); here the choice of
    // runner is also the choice between a transaction and a savepoint.
    const runner: Knex | Knex.Transaction = (options?.transaction as Knex.Transaction | undefined) ?? this.knex;
    return runner.transaction(async (trx) => applyAll({ ...options, transaction: trx }));
  }

/** The body of `SqlDriver#updateMany`; the method's docblock there is its contract. */
export async function updateMany(this: Pick<BulkOperationsHost, 'applyFilters' | 'applyTenantScope' | 'applyWriteColumnMap' | 'auditMissingTenant' | 'formatInput' | 'getBuilder' | 'keepSuppliedUpdatedAt' | 'rotationShardsOf' | 'stampsUpdatedAt' | 'updateWithPresumedTimestamp' | 'updatedAtStamp' | 'updatedAtStampIsPresumed'>, object: string, query: DriverQuery, data: any, options?: DriverOptions): Promise<number> {
    this.auditMissingTenant(object, 'updateMany', options);

    // `data ?? {}` keeps the nullish tolerance this door already had on the
    // stamping line below: a null payload normalises to "no keys", which emits
    // the same stamp-only statement `main` emitted for it, instead of newly
    // throwing inside `formatInput`.
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data ?? {}));

    // Read from `formatted` rather than the caller's `data`, exactly as
    // {@link update} and {@link rotatedUpdateById} do. On an external object
    // whose columnMap remaps `updated_at` the two spellings disagree, and this
    // door must reach the SAME decision those two reach rather than a private one.
    const stamping = this.stampsUpdatedAt(object) && !this.keepSuppliedUpdatedAt(formatted, options);
    // Untouched when nothing is stamped, so a timestamp-less object's statement
    // is byte-identical to the one `main` emits.
    const payload = stamping ? { ...formatted, updated_at: this.updatedAtStamp() } : formatted;
    // A rotation-managed object is recorded in `tablesWithTimestamps` by
    // `initObjects` before `ensureRotation` runs, so it is never in the
    // speculative state — the same property `rotatedUpdateById` relies on. The
    // speculative path below therefore only ever sees the single-target loop.
    const presumed = stamping && this.updatedAtStampIsPresumed(object);

    let total = 0;
    for (const target of this.rotationShardsOf(object) ?? [object]) {
      // One definition of the statement, so the speculative attempt, the fenced
      // retry and the plain path cannot drift in WHERE or tenant scope.
      const issue = (candidate: Record<string, any>, issueOptions?: DriverOptions): Promise<number> => {
        const builder = this.getBuilder(target, issueOptions);
        this.applyTenantScope(builder, object, issueOptions);
        if (query.where) this.applyFilters(builder, query.where, issueOptions);
        return builder.update(candidate) as unknown as Promise<number>;
      };
      total +=
        (presumed
          ? await this.updateWithPresumedTimestamp(object, payload, options, issue)
          : await issue(payload, options)) || 0;
    }
    return total;
  }

/** The body of `SqlDriver#rotatedUpdateById`; the method's docblock there is its contract. */
export async function rotatedUpdateById(this: Pick<BulkOperationsHost, 'applyTenantScope' | 'applyWriteColumnMap' | 'formatInput' | 'formatOutput' | 'getBuilder' | 'keepSuppliedUpdatedAt' | 'stampsUpdatedAt' | 'updatedAtStamp'>, object: string, shards: string[], id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data));
    // [commit 479fba50d] One definition of the decision, shared with {@link update}. No
    // fallback is threaded here, and that is a property of the path rather than
    // an omission: `rotationShardsOf` returns shards only once `ensureRotation`
    // has run, and `initObjects` records the stronger `tablesWithTimestamps`
    // fact on the line immediately before that call — so on this path the
    // answer can never come from the declared-shape presumption, and there is
    // nothing speculative to recover from.
    //
    // [#24835] Stamped into a FRESH object, for the reason {@link update} gives:
    // `formatted` may be the caller's own `data`.
    const payload = this.stampsUpdatedAt(object) && !this.keepSuppliedUpdatedAt(formatted, options)
      ? { ...formatted, updated_at: this.updatedAtStamp() }
      : formatted;
    for (const shard of shards) {
      const builder = this.getBuilder(shard, options).where('id', id);
      this.applyTenantScope(builder, object, options);
      const count = await builder.update(payload);
      if (count > 0) {
        const readback = this.getBuilder(shard, options).where('id', id);
        this.applyTenantScope(readback, object, options);
        const updated = await readback.first();
        return this.formatOutput(object, updated) || null;
      }
    }
    return null;
  }

/** The body of `SqlDriver#count`; the method's docblock there is its contract. */
export async function count(this: Pick<BulkOperationsHost, 'applyFilters' | 'applyTenantScope' | 'backendStatementFault' | 'getBuilder' | 'unresolvableFilterColumnRefusal'>, object: string, query?: DriverQuery, options?: DriverOptions): Promise<number> {
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

    if (query?.where) {
      this.applyFilters(builder, query.where, options);
    }

    // [#8790] `count()` has no recovery ladder and needs none — it carries no
    // projection and no ORDER BY, so the only clause an unresolvable column can
    // be in is the WHERE, which is the one clause {@link SqlDriver.findRows}'
    // ladder may not drop either. What it needs is the ladder's *terminal*: the
    // same `INVALID_FILTER` / 400, naming the same column, so the two halves of
    // one list view stop answering one predicate two different ways. Before
    // this, the dialect error travelled out untouched — `SQLITE_ERROR`, no
    // `status`, bound literals inlined in the message.
    let result: { count: number }[];
    try {
      result = await builder.count<{ count: number }[]>('* as count');
    } catch (error) {
      if (isUnresolvableColumnError(error)) {
        throw this.unresolvableFilterColumnRefusal(object, error, query?.where);
      }
      // [#8931] The terminal catch-all — see {@link SqlDriver.backendStatementFault}.
      throw this.backendStatementFault(object, error);
    }
    if (result && result.length > 0) {
      const row: any = result[0];
      return Number(row.count ?? row['count(*)'] ?? 0);
    }
    return 0;
  }
