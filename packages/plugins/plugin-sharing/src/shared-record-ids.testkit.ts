// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 plan step 6] The share-grant leaf for this package's hand-written
 * engine doubles.
 *
 * From the switch on, the read and bulk-write scopes carry the share arm as
 * `{ id: { $in: SharedRecordIds.read(object, user) } }` (or `.write`), a
 * branded leaf where an id list used to be. A double whose `$in` arm calls
 * `.includes` on its comparand cannot read it, and a double that quietly
 * treated it as "no member" would green a scope that admits nothing. So a
 * double resolves it here, over its OWN `sys_record_share` rows, under the
 * leaf's own fixed inner read (`fixedInnerReadOf`): the predicate is the
 * leaf's description, ⛔ never restated in a test.
 *
 * `.testkit.ts`, not `.test.ts`: it holds no assertions and is not collected
 * as a suite. It is imported only by tests, so tsup (entry `src/index.ts`)
 * never bundles it into `dist`.
 */

import { fixedInnerReadOf, isFixedReadLeaf } from '@objectstack/spec/data';

/** A row as the doubles store it. */
type Row = Record<string, unknown>;

/**
 * The members `{ $in: comparand }` admits in a double: the array as given, or,
 * for a fixed-read leaf, the ids its fixed inner read denotes over `shareRows`
 * (the double's `sys_record_share` table): every row whose `equals` columns
 * match and whose `memberOf` columns hold one of the listed values, its
 * projected column kept when it is neither null nor empty, as each evaluator
 * keeps it. Anything else is a comparand the double cannot read, and throws,
 * as the engine's comparand door refuses it.
 */
export function inMembers(comparand: unknown, shareRows: readonly Row[] | undefined): readonly unknown[] {
  if (Array.isArray(comparand)) return comparand;
  if (!isFixedReadLeaf(comparand)) {
    throw new TypeError('test double: a `$in` comparand that is neither a list nor a fixed-read leaf');
  }
  const read = fixedInnerReadOf(comparand);
  const ids: string[] = [];
  for (const row of shareRows ?? []) {
    if (!Object.entries(read.equals).every(([column, value]) => row[column] === value)) continue;
    if (!Object.entries(read.memberOf).every(([column, values]) => values.includes(String(row[column])))) continue;
    const id = row[read.column];
    if (id == null || id === '') continue;
    ids.push(String(id));
  }
  return ids;
}
