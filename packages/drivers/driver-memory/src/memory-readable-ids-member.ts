// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3] The member test a composed `ReadableIds` leaf compiles to in
 * this driver: the readable parent ids are hashed ONCE, when the query
 * compiles, and each row is then one lookup.
 *
 * ## Why (#23679)
 *
 * `convertToMongoQuery` rewrites a composed leaf into the ids of every
 * readable parent row (`readableParentIds`), with no cap. Handed to mingo as a
 * plain `$in`, that list was re-hashed for every row tested: mingo's `$in`
 * runs `intersection([value, list])` per document, and `intersection` builds a
 * hash map of the WHOLE list on each call. A read over R child rows under N
 * readable parents therefore made R × N hash inserts. On the E3 conformance
 * fixture (2,700 rows, 2,400 readable parents) that was about 950 ms of mingo
 * per read, against 0.8 ms for one prebuilt set. The E3 pins make two and three
 * such reads per test, so under CI's per-core worker share they crossed
 * vitest's 5 s default and turned `main`'s hourly full run red.
 *
 * ## Scope: the D3 leaf only
 *
 * Every other `$in` keeps mingo's own operator. Only a list `readableParentIds`
 * produced is marked ({@link markReadableIdsList}), and only a marked list is
 * lowered to {@link READABLE_IDS_MEMBER_OP}. The mark is object identity, held
 * in a `WeakSet`, so it cannot be written in a filter. The operator name is
 * not authorable either: the shape gate, which runs before the lowering,
 * refuses a field operator it does not declare.
 *
 * ## The answers are mingo's `$in`
 *
 * {@link readableIdsMember} is mingo's `$in` predicate with the loop-invariant
 * work moved out of the per-document closure, and nothing else changed: the
 * same `resolve` with `unwrapArray`, the same nil rule (a nil value matches
 * only a literal `null` member), the same structural `HashMap` membership
 * `intersection` asks, and the same fallback that tests string values against
 * RegExp members. `memory-readable-ids-hashed-once.test.ts` holds both
 * halves: the answers equal mingo's `$in` over a case matrix, and the
 * hash-insert count of a composed-leaf read is linear.
 *
 * ## How mingo finds the operator
 *
 * mingo's `Query` merges a caller's context into its default one, and a name
 * the default does not have is added (an existing name would win, which is why
 * this is a new name and not a replacement `$in`). {@link Query} passes that
 * context on every construction, and mingo hands the same options to the
 * sub-queries it builds for `$and`, `$or` and `$nor`, so a leaf under any
 * combinator resolves too. A filter that reached mingo without it would fail
 * loudly (`unknown query operator`), never answer silently.
 */

import { Context, Query as MingoQuery } from 'mingo';
import { HashMap, ensureArray, isNil, isRegExp, isString, resolve } from 'mingo/util';
import type { AnyObject, Criteria, Options } from 'mingo/types';
import { $in as mingoIn } from 'mingo/operators/query';

/** The private mingo operator a marked `ReadableIds` list lowers to. */
export const READABLE_IDS_MEMBER_OP = '$readableIdsMember';

const readableIdsLists = new WeakSet<object>();

/** Mark a list `readableParentIds` produced, so the lowering knows it is the D3 leaf's. */
export function markReadableIdsList<T extends unknown[]>(list: T): T {
  readableIdsLists.add(list);
  return list;
}

/** Whether `value` is a list {@link markReadableIdsList} marked. */
export function isReadableIdsList(value: unknown): value is unknown[] {
  return Array.isArray(value) && readableIdsLists.has(value);
}

/**
 * mingo's `$in`, with the list hashed once when the query compiles. The
 * returned closure is the per-document test.
 */
export const readableIdsMember: typeof mingoIn = (selector, value, options) => {
  if (!Array.isArray(value)) return mingoIn(selector, value, options);
  const list: unknown[] = value;
  const members = HashMap.init();
  for (const member of list) members.set(member, true);
  const nullIsMember = list.some((member) => member === null);
  const patterns = list.filter(isRegExp);
  const resolveOptions = { unwrapArray: true };
  return (doc) => {
    const lhs = resolve(doc, selector, resolveOptions);
    if (isNil(lhs)) return nullIsMember;
    const values = ensureArray(lhs);
    if (values.some((v) => members.has(v))) return true;
    return patterns.length > 0 && values.some((v) => isString(v) && patterns.some((re) => re.test(v)));
  };
};

const READABLE_IDS_CONTEXT = Context.init({ query: { [READABLE_IDS_MEMBER_OP]: readableIdsMember } });

/** mingo's `Query`, able to compile {@link READABLE_IDS_MEMBER_OP}. Every other operator is mingo's. */
export class Query<T = AnyObject> extends MingoQuery<T> {
  constructor(condition: Criteria<T>, options?: Partial<Options>) {
    super(condition, { ...options, context: READABLE_IDS_CONTEXT });
  }
}
