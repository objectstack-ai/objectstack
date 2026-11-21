// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 plan step 6] The share-grant leaf for this package's engine
 * doubles.
 *
 * From the switch on, plugin-sharing's read and bulk-write scopes carry the
 * share arm as `{ id: { $in: SharedRecordIds.read(object, user) } }` (or
 * `.write`), a branded leaf where an id list used to be. A double whose `$in`
 * arm calls `.includes` on its comparand cannot read it, and an evaluator such
 * as `matchesFilterCondition` reads it as a list with no member, which greens
 * a scope that admits nothing. So a double resolves it here, over its OWN
 * `sys_record_share` rows, under the leaf's own fixed inner read
 * (`fixedInnerReadOf`): the predicate is the leaf's description, ⛔ never
 * restated in a test.
 *
 * Resolved once per statement, before any row is matched, as a driver's
 * semi-join is part of the one statement: a double whose share table is down
 * (its rows' `filter` throws) fails the statement on that fault, whichever arm
 * a row would have matched. A leaf anywhere but an `$in` comparand is one the
 * engine refuses, and throws here.
 *
 * `.testkit.ts`, not `.test.ts`: it holds no assertions and is not collected
 * as a suite, and it is imported only by tests.
 */

import { fixedInnerReadOf, isFixedReadLeaf, type FixedReadLeaf } from '@objectstack/spec/data';

/** A row as the doubles store it. */
type Row = Record<string, unknown>;

/** The rows a double holds for `table`, or `undefined` for one it does not hold. */
export type InMemoryRowsOf = (table: string) => readonly Row[] | undefined;

/**
 * The ids `leaf`'s fixed inner read denotes over the double's rows: every row
 * of its table whose `equals` columns match and whose `memberOf` columns hold
 * one of the listed values, its projected column kept when it is neither null
 * nor empty, as each evaluator keeps it.
 */
export function fixedReadLeafMembers(leaf: FixedReadLeaf, rowsOf: InMemoryRowsOf): string[] {
  const read = fixedInnerReadOf(leaf);
  const held = (rowsOf(read.table) ?? []).filter((row) =>
    Object.entries(read.equals).every(([column, value]) => row[column] === value)
    && Object.entries(read.memberOf).every(([column, values]) => values.includes(String(row[column]))));
  return held.map((row) => row[read.column]).filter((id) => id != null && id !== '').map(String);
}

/**
 * `where` with every `$in` comparand that is a fixed-read leaf replaced by its
 * members, copy-on-write: a subtree holding no leaf is returned by reference.
 */
export function resolveFixedReadLeavesInMemory<T>(where: T, rowsOf: InMemoryRowsOf): T {
  const walk = (value: unknown, underIn: boolean): unknown => {
    if (isFixedReadLeaf(value)) {
      if (!underIn) throw new TypeError('test double: a fixed-read leaf outside an `$in` comparand (the engine refuses it)');
      return fixedReadLeafMembers(value, rowsOf);
    }
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      let out: unknown[] | undefined;
      value.forEach((item, i) => {
        const next = walk(item, false);
        if (next !== item) (out ??= [...value])[i] = next;
      });
      return out ?? value;
    }
    let out: Row | undefined;
    for (const key of Object.keys(value)) {
      const item = (value as Row)[key];
      const next = walk(item, key === '$in');
      if (next !== item) (out ??= { ...(value as Row) })[key] = next;
    }
    return out ?? value;
  };
  return walk(where, false) as T;
}
