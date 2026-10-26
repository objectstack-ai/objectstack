// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Knex } from 'knex';

/**
 * The conflict clause of `SqlDriver.upsert`'s statement, or none.
 *
 * `columnsToMerge` is what the merge leg may write: every payload column that
 * is not insert-only, or — when that is empty — the conflict-target columns the
 * payload carries, a provable no-op (a conflict means those columns matched).
 * When BOTH are empty there is nothing the merge leg may write, so the
 * statement is a plain INSERT with no conflict clause, and a collision surfaces
 * as the driver's own unique-violation error.
 *
 * ⛔ Never a bare `merge()` here: knex compiles it to merge-ALL on every dialect
 * (`do update set` / `on duplicate key update` over EVERY inserted column), the
 * inverse of the insert-only set the merge leg exists to respect. ⛔ Nor
 * `ignore()`: knex lowers it on MySQL to `insert ignore`, which swallows
 * unrelated errors and drops the conflict target.
 *
 * Kept free of the driver so its compiled SQL is checkable per dialect with no
 * server at all (`toSQL()`).
 */
export function withUpsertConflictClause(
  insertion: Knex.QueryBuilder,
  mergeKeys: readonly string[],
  columnsToMerge: readonly string[],
): { statement: Knex.QueryBuilder; merges: boolean } {
  if (columnsToMerge.length === 0) return { statement: insertion, merges: false };
  return { statement: insertion.onConflict([...mergeKeys]).merge([...columnsToMerge]), merges: true };
}
