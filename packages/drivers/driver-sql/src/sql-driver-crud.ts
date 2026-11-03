// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "CRUD — IDataDriver core" section of `SqlDriver`: the
 * bodies of `create`, `readBackInsertedRows`, `sequenceKeyHash` moved out of
 * `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link CrudHost}: exactly the
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
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import {
  AUTONUMBER_COLLISION_RETRIES, DEFAULT_ID_LENGTH, insertedRowsNotReadBackError,
} from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface CrudHost {
  applyTenantScope: SqlDriver['applyTenantScope'];
  applyWriteColumnMap: SqlDriver['applyWriteColumnMap'];
  auditMissingTenant: SqlDriver['auditMissingTenant'];
  collidingAutoNumberReservations: SqlDriver['collidingAutoNumberReservations'];
  decorateHashShadowDuplicate: SqlDriver['decorateHashShadowDuplicate'];
  fillAutoNumberFields: SqlDriver['fillAutoNumberFields'];
  formatInput: SqlDriver['formatInput'];
  formatOutput: SqlDriver['formatOutput'];
  getBuilder: SqlDriver['getBuilder'];
  injectTenantOnInsert: SqlDriver['injectTenantOnInsert'];
  readonly insertReturnsStoredRows: SqlDriver['insertReturnsStoredRows'];
  readBackInsertedRows: SqlDriver['readBackInsertedRows'];
  remoteColumn: SqlDriver['remoteColumn'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  resyncSequenceToDataMax: SqlDriver['resyncSequenceToDataMax'];
  rotationWriteTarget: SqlDriver['rotationWriteTarget'];
  stampInsertTimestamps: SqlDriver['stampInsertTimestamps'];
}

/** The body of `SqlDriver#create`; the method's docblock there is its contract. */
export async function create(this: Pick<CrudHost, 'applyWriteColumnMap' | 'auditMissingTenant' | 'collidingAutoNumberReservations' | 'decorateHashShadowDuplicate' | 'fillAutoNumberFields' | 'formatInput' | 'formatOutput' | 'getBuilder' | 'injectTenantOnInsert' | 'insertReturnsStoredRows' | 'readBackInsertedRows' | 'resyncSequenceToDataMax' | 'rotationWriteTarget' | 'stampInsertTimestamps'>, object: string, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown>> {
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
          const result = await builder.insert(formatted).returning('*');
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

/** The body of `SqlDriver#readBackInsertedRows`; the method's docblock there is its contract. */
export async function readBackInsertedRows(this: Pick<CrudHost, 'applyTenantScope' | 'formatOutput' | 'getBuilder' | 'remoteColumn' | 'resolveTenantField'>, object: string, writeTable: string, written: Record<string, any>[], options?: DriverOptions): Promise<Record<string, unknown>[]> {
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

/** The body of `SqlDriver#sequenceKeyHash`; the method's docblock there is its contract. */
export function sequenceKeyHash(object: string, tenantId: string, field: string, scope: string): string {
    return createHash('sha256')
      .update(`${object}\u001f${tenantId}\u001f${field}\u001f${scope}`)
      .digest('hex');
  }
