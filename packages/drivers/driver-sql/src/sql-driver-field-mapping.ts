// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Field mapping" section of `SqlDriver`: the bodies of
 * `mapSortField`, `orderKeysFor`, `mapAggregateFunc` moved out of
 * `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link FieldMappingHost}: exactly the
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

import type { DriverQuery } from '@objectstack/spec/contracts';
import { SQL_AGGREGATE_FUNCTIONS, refuseAggregateFunction } from './sql-driver-top-level.js';
import type { SqlAggregateLowering } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface FieldMappingHost {
  readonly logger: SqlDriver['logger'];
  readonly nondeterministicPagingWarned: SqlDriver['nondeterministicPagingWarned'];
  paginationTieBreaker: SqlDriver['paginationTieBreaker'];
}

/** The body of `SqlDriver#mapSortField`; the method's docblock there is its contract. */
export function mapSortField(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

/** The body of `SqlDriver#orderKeysFor`; the method's docblock there is its contract. */
export function orderKeysFor(this: Pick<FieldMappingHost, 'logger' | 'nondeterministicPagingWarned' | 'paginationTieBreaker'>, object: string, query: DriverQuery, opts?: { singleRowLookup?: boolean }): Array<{ field: string; direction: 'asc' | 'desc' }> {
    const keys: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
    if (Array.isArray(query.orderBy)) {
      for (const item of query.orderBy) {
        if (item.field) {
          keys.push({ field: item.field, direction: item.order === 'desc' ? 'desc' : 'asc' });
        }
      }
    }

    const paged =
      !opts?.singleRowLookup && (query.limit !== undefined || query.offset !== undefined);
    if (keys.length === 0 && !paged) return keys;

    const tieBreaker = this.paginationTieBreaker(object);
    if (tieBreaker && !keys.some((k) => k.field === tieBreaker)) {
      keys.push({ field: tieBreaker, direction: keys[keys.length - 1]?.direction ?? 'asc' });
    } else if (!tieBreaker && keys.length === 0) {
      // Paged, unsorted, and no column this driver can trust to order by: the
      // read goes out exactly as before, and its pages are not a partition.
      // Say so once per object rather than leave it to be discovered by a user
      // counting records — a guarantee the contract states as MUST, quietly
      // unavailable, is the same invisible failure it was written against.
      // (Sorted reads on such a table keep the caller's own ORDER BY, so only
      // the ties within it reshuffle; this case has nothing at all.)
      if (!this.nondeterministicPagingWarned.has(object)) {
        this.nondeterministicPagingWarned.add(object);
        this.logger.warn(
          `Paged read of '${object}' is NOT deterministic: this driver did not create the table, `
            + 'so it cannot name a unique column to order by, and the query asked for no sort of '
            + 'its own. Walking the pages may serve one row twice and never serve another. '
            + 'Give the query an `orderBy` on a unique column, or declare the '
            + 'object so this driver manages its table.',
        );
      }
    }
    return keys;
  }

/** The body of `SqlDriver#mapAggregateFunc`; the method's docblock there is its contract. */
export function mapAggregateFunc(func: string): SqlAggregateLowering {
    const lowering = SQL_AGGREGATE_FUNCTIONS.get(func);
    if (lowering !== undefined) return lowering;
    refuseAggregateFunction(func);
  }
