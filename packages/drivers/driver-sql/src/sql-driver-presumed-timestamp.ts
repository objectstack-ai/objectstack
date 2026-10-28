// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 21] The presumed-timestamp update of `SqlDriver`:
 * `updateWithPresumedTimestamp`, the UPDATE whose `updated_at` stamp is a
 * presumption and that recovers, once per table, when the column turns out not
 * to be there, and `resolveUpdatedAtColumnPresence`, the catalog question that
 * recovery asks. They moved out of `sql-driver.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same savepoint fence inside a caller transaction, the same
 * `columnInfo()` probe, the same `present` / `absent` settling and the same
 * warning.
 *
 * What did NOT move, and why:
 *
 *  - Both methods' docblocks stay on the class: they are the contract, and the
 *    published `dist/*.d.ts` carries them with the methods.
 *  - The callers stay: `update` and `updateMany` hand the presumed-timestamp
 *    update the `issue` callback that owns the WHERE and the tenant scope.
 *  - `updatedAtStampIsPresumed`, `stampsUpdatedAt` and the other readers of
 *    `updatedAtColumnState` stay; the state map itself stays a class field.
 *  - `attemptWithoutPoisoning` is the sequence-counter path's fence too, and
 *    subclasses may override it; the body reaches it through the host.
 *
 * ## How the moved bodies reach the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps both
 * methods, because the published `dist/*.d.ts` lists their names and
 * positions, and because an instance spy or a subclass method of the same name
 * must still be the one `update` reaches. Each method is now one literal of
 * exactly the {@link PresumedTimestampHost} members its body reads, plus a
 * `.call`. Methods go as closures that call them on the driver at call time,
 * so `updateWithPresumedTimestamp` still reaches `resolveUpdatedAtColumnPresence`
 * through the driver, and a subclass override or an instance spy of either is
 * still the one it reaches; `knex`, `logger`, `physicalTableByObject`,
 * `physicalSchemaByObject` and `updatedAtColumnState` go as GETTERS, so each
 * is read when the body reads it, as it was on the class.
 *
 * The module imports `sql-driver.ts` for a type only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module, so the
 * published surface does not move.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import type { Knex } from 'knex';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error. See
 * the module header for which members are getters.
 */
export interface PresumedTimestampHost {
  attemptWithoutPoisoning: SqlDriver['attemptWithoutPoisoning'];
  readonly knex: SqlDriver['knex'];
  readonly logger: SqlDriver['logger'];
  readonly physicalSchemaByObject: SqlDriver['physicalSchemaByObject'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
  resolveUpdatedAtColumnPresence: SqlDriver['resolveUpdatedAtColumnPresence'];
  readonly updatedAtColumnState: SqlDriver['updatedAtColumnState'];
}

/** The body of `SqlDriver#resolveUpdatedAtColumnPresence`; the method's docblock there is its contract. */
export async function resolveUpdatedAtColumnPresence(this: Pick<PresumedTimestampHost, 'knex' | 'physicalSchemaByObject' | 'physicalTableByObject'>, object: string, trx?: Knex.Transaction): Promise<boolean | null> {
  const physical = this.physicalTableByObject[object] ?? object;
  const runner = trx ?? this.knex;
  let builder = runner(physical);
  const remoteSchema = this.physicalSchemaByObject[object];
  if (remoteSchema) builder = builder.withSchema(remoteSchema);
  let info: Record<string, unknown>;
  try {
    info = (await builder.columnInfo()) as Record<string, unknown>;
  } catch {
    // The probe itself failed — we learned nothing, so we may not claim the
    // column is absent. The caller rethrows the write's own error.
    return null;
  }
  const columns = Object.keys(info ?? {});
  if (columns.length === 0) return null;
  return columns.includes('updated_at');
}

/** The body of `SqlDriver#updateWithPresumedTimestamp`; the method's docblock there is its contract. */
export async function updateWithPresumedTimestamp(this: Pick<PresumedTimestampHost, 'attemptWithoutPoisoning' | 'logger' | 'resolveUpdatedAtColumnPresence' | 'updatedAtColumnState'>, object: string, formatted: Record<string, any>, options: DriverOptions | undefined, issue: (payload: Record<string, any>, options?: DriverOptions) => Promise<number>): Promise<number> {
  const unstamped = (): Record<string, any> => {
    const { updated_at: _dropped, ...rest } = formatted;
    return rest;
  };
  const settleAbsent = (): void => {
    this.updatedAtColumnState.set(object, 'absent');
    this.logger.warn(
      `[sql-driver] '${object}' has no physical 'updated_at' column, so this driver will not ` +
        'stamp one on update. The object is registered as managed, whose schema this ' +
        "driver's own DDL would give `created_at`/`updated_at` — a table migrated out-of-band " +
        'without them will keep a stale "last modified" for every consumer that reads it ' +
        '(list-view sorts, delta sync, cache invalidation, audit). Add the column, or accept ' +
        'that it is not tracked here.',
    );
  };

  const parentTrx = options?.transaction as Knex.Transaction | undefined;
  if (parentTrx) {
    const attempt = await this.attemptWithoutPoisoning(parentTrx, (scoped) =>
      issue(formatted, { ...options, transaction: scoped }),
    );
    if (attempt.ok) {
      this.updatedAtColumnState.set(object, 'present');
      return attempt.value;
    }
    const present = await this.resolveUpdatedAtColumnPresence(object, parentTrx);
    if (present !== false) throw attempt.error;
    settleAbsent();
    return issue(unstamped(), options);
  }

  try {
    const affected = await issue(formatted, options);
    this.updatedAtColumnState.set(object, 'present');
    return affected;
  } catch (error) {
    const present = await this.resolveUpdatedAtColumnPresence(object);
    if (present !== false) throw error;
    settleAbsent();
    return issue(unstamped(), options);
  }
}
