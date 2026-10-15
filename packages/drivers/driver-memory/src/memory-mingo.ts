// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mingo `Query` and `Aggregator` this driver evaluates every filter and
 * pipeline with: mingo's own operator set, except that `$in` hashes its list
 * ONCE per compiled query instead of once per document tested.
 *
 * ## Why (#23679)
 *
 * mingo's `$in` predicate runs `intersection([value, list])` for every
 * document it tests, and `intersection` builds a hash map of the WHOLE list on
 * each call, so a read over R rows with an N-member list costs R × N hash
 * inserts. [ADR-0139 D3] made N unbounded on this driver: `convertToMongoQuery`
 * rewrites a composed `ReadableIds` leaf into the ids of every readable parent
 * row. Measured on the E3 conformance fixture (2,700 child rows, 2,400 readable
 * parents): about 950 ms of mingo per read, against 0.8 ms for the same member
 * test over one prebuilt set. The E3 pins make two and three such reads per
 * test, so under CI's per-core worker share they crossed vitest's 5 s default
 * and turned `main`'s hourly full run red.
 *
 * ## The semantics are mingo's
 *
 * {@link compiledIn} is mingo's `$in` predicate with the loop-invariant work
 * hoisted out of the per-document closure, and nothing else changed: the same
 * `resolve` with `unwrapArray`, the same nil rule (a nil value matches only a
 * literal `null` member), the same structural `HashMap` membership
 * `intersection` asks, and the same fallback that tests string values against
 * the list's RegExp members. A comparand that is not an array goes to mingo's
 * own `$in` unchanged, so whatever mingo does with it stays mingo's.
 * `memory-in-list-hashed-once.test.ts` holds both halves: the answers equal
 * mingo's over a case matrix, and the hash-insert count is linear.
 *
 * ## Why a whole context, not an added operator
 *
 * mingo's public `Query` and `Aggregator` merge a caller's context UNDER their
 * default one (`Context.from(CONTEXT, custom)`, where an operator already
 * present wins), so a replacement `$in` passed through `options.context` is
 * silently ignored. The base classes take the context as given, so this module
 * builds the same default operator set from mingo's published namespaces and
 * replaces `$in` alone.
 */

import { Context } from 'mingo';
import { Query as MingoQuery } from 'mingo/query';
import { Aggregator as MingoAggregator } from 'mingo/aggregator';
import * as accumulatorOperators from 'mingo/operators/accumulator';
import * as expressionOperators from 'mingo/operators/expression';
import * as pipelineOperators from 'mingo/operators/pipeline';
import * as projectionOperators from 'mingo/operators/projection';
import * as queryOperators from 'mingo/operators/query';
import * as windowOperators from 'mingo/operators/window';
import { HashMap, ensureArray, isNil, isRegExp, isString, resolve } from 'mingo/util';
import type { AnyObject, Options } from 'mingo/types';

const mingoIn = queryOperators.$in;

/**
 * mingo's `$in`, with the list hashed once when the query compiles. The
 * returned closure is the per-document test.
 */
export const compiledIn: typeof mingoIn = (selector, value, options) => {
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

const MEMORY_MINGO_CONTEXT = Context.init({
  accumulator: accumulatorOperators,
  expression: expressionOperators,
  pipeline: pipelineOperators,
  projection: projectionOperators,
  query: { ...queryOperators, $in: compiledIn },
  window: windowOperators,
});

/** mingo's `Query` over {@link MEMORY_MINGO_CONTEXT}: its `$in` hashes the list once. */
export class Query<T = AnyObject> extends MingoQuery<T> {
  constructor(condition: ConstructorParameters<typeof MingoQuery<T>>[0], options?: Partial<Options>) {
    super(condition, { ...options, context: MEMORY_MINGO_CONTEXT });
  }
}

/** mingo's `Aggregator` over {@link MEMORY_MINGO_CONTEXT}, so a `$match` stage's `$in` does too. */
export class Aggregator extends MingoAggregator {
  constructor(pipeline: AnyObject[], options?: Partial<Options>) {
    super(pipeline, { ...options, context: MEMORY_MINGO_CONTEXT });
  }
}
