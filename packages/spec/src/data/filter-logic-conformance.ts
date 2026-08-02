// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the Filter Protocol's **logical combinators**
 * — the single source of truth every filter backend is checked against.
 *
 * ## Why this exists
 *
 * `FilterCondition` is evaluated by five independent implementations, and they
 * had drifted:
 *
 * | Backend | Where |
 * |---|---|
 * | SQL compiler | `driver-sql` `applyFilterCondition` |
 * | In-memory matcher | `driver-memory` `memory-matcher` |
 * | Record-at-a-time evaluator | `formula` `matchesFilterCondition` (RLS write-side `check`) |
 * | Read-scope SQL lowering | `service-analytics` `read-scope-sql` |
 * | MongoDB query translator | `driver-mongodb` `translateFilter` |
 *
 * #3774 said "four" and enrolled four: `translateFilter` was missed, not
 * excluded, and ran unchecked against this standard until #4405 — the one
 * backend whose target language has no document-level `$not` at all, so a
 * negation leaves it as `$nor`. `driver-sqlite-wasm` runs the table too; it
 * *inherits* the SQL compiler, so what its suite adds is the sql.js engine
 * executing the compiled predicate rather than a sixth way of building one.
 *
 * In #3774 the SQL compiler OR-ed the contents *within* a `$or` branch instead
 * of AND-ing them, so every `$or` filter matched more rows than it should —
 * including read-visibility filters. The other three were correct, but nothing
 * held them to a shared standard, so the divergence was invisible until someone
 * ran a real query. These cases are that standard: each backend has a thin test
 * that feeds {@link FILTER_LOGIC_ROWS} through its own evaluator and asserts the
 * ids in {@link FilterLogicCase.expected}.
 *
 * Third-party driver authors can use the same table to check a new backend.
 *
 * ## Deliberate scope
 *
 * **Logical combinator semantics only** — `$and` / `$or` / `$not`, and the rule
 * they hang off:
 *
 *   > Everything inside ONE filter object is AND-ed, at every nesting depth —
 *   > both its field keys and the operators of a single field. A `$or` array
 *   > OR-s its BRANCHES; it does not change how the contents within a branch
 *   > combine.
 *
 * The predicates are deliberately boring: string equality, `$in`, `$ne`, `$gte`
 * / `$lt` on lexicographic strings. Nothing here exercises null handling, dates,
 * numeric coercion, `LIKE` escaping, or case sensitivity — those legitimately
 * differ between a SQL engine and a JS matcher, and folding them in would make
 * the table unpassable rather than more useful. Keep it that way: a case belongs
 * here only if **every** backend must agree on it.
 */

import type { FilterCondition } from './filter.zod';

/** A row in the conformance fixture. All columns are plain strings. */
export interface FilterLogicRow {
  id: string;
  /** 2x2 truth table over (a, b) — see {@link FILTER_LOGIC_ROWS}. */
  a: string;
  b: string;
  /** Constant across every row; a predicate on it never changes a result. */
  c: string;
  /** Record-scope columns, for the shapes read scopes are actually written in. */
  owner: string;
  status: string;
  parent_object: string;
  parent_id: string;
}

/**
 * The fixture. Rows 1-4 are the 2x2 truth table over `(a, b)` — every
 * combination appears exactly once, so a wrongly-OR-ed pair of predicates always
 * shows up as extra ids rather than by luck of the data. Rows 5-8 carry the
 * record-scope columns used by the read-scope cases.
 */
export const FILTER_LOGIC_ROWS: readonly FilterLogicRow[] = [
  { id: '1', a: 'x',  b: 'y',  c: 'z', owner: 'u1', status: 'active',   parent_object: 'case', parent_id: 'c1' },
  { id: '2', a: 'x',  b: 'zz', c: 'z', owner: 'u1', status: 'archived', parent_object: 'case', parent_id: 'c2' },
  { id: '3', a: 'qq', b: 'y',  c: 'z', owner: 'u2', status: 'active',   parent_object: 'todo', parent_id: 't1' },
  { id: '4', a: 'qq', b: 'zz', c: 'z', owner: 'u2', status: 'archived', parent_object: 'todo', parent_id: 'c1' },
] as const;

/** One conformance case: a filter and the ids it must match, in id order. */
export interface FilterLogicCase {
  /** Stable identifier, usable as a test name. */
  name: string;
  filter: FilterCondition;
  /** Ids of matching rows, ascending. */
  expected: string[];
  /** Why the case is here — surfaced in failure output. */
  note?: string;
}

/**
 * The cases. Ordered from the core rule outward: keys within a branch, then
 * operators within a key, then combinator nesting, then the shapes that occur
 * in real read scopes.
 */
export const FILTER_LOGIC_CASES: readonly FilterLogicCase[] = [
  // ── Keys within one object AND, at every depth ────────────────────────────
  {
    name: 'multi-key $or branch ANDs its own keys',
    filter: { $or: [{ a: 'x', b: 'y' }] },
    expected: ['1'],
    note: '#3774: compiled to `a = x OR b = y`, matching 1,2,3.',
  },
  {
    name: 'each $or branch ANDs independently',
    filter: { $or: [{ a: 'x', b: 'y' }, { a: 'qq', b: 'zz' }] },
    expected: ['1', '4'],
  },
  {
    name: 'top-level multi-key ANDs',
    filter: { a: 'x', b: 'y' },
    expected: ['1'],
  },
  {
    name: 'a $or AND-s with a sibling top-level key',
    filter: { $or: [{ a: 'x' }, { b: 'y' }], b: 'zz' },
    expected: ['2'],
  },

  // ── Operators within one field AND ────────────────────────────────────────
  {
    name: 'multiple operators on one field AND within a branch',
    filter: { $or: [{ a: { $ne: 'qq', $eq: 'x' }, b: 'y' }] },
    expected: ['1'],
    note: '#3774: a single-key branch is miscompilable too — the operator map is looped with the same flag.',
  },
  {
    name: 'an abutting $gte/$lt window ANDs its bounds',
    filter: { $or: [{ b: { $gte: 'y', $lt: 'z' } }] },
    expected: ['1', '3'],
    note: 'The multi-tier scheduled-flow window pattern. OR-ing the bounds matches every row.',
  },

  // ── Combinator nesting ────────────────────────────────────────────────────
  {
    name: '$and branch OR-s against a sibling multi-key branch',
    filter: { $or: [{ $and: [{ a: 'x' }, { b: 'y' }] }, { a: 'qq', b: 'zz' }] },
    expected: ['1', '4'],
  },
  {
    name: 'multi-key branch OR-s against a sibling $and branch',
    filter: { $or: [{ a: 'x', b: 'y' }, { $and: [{ a: 'qq' }, { b: 'zz' }] }] },
    expected: ['1', '4'],
  },
  {
    name: '$and ANDs with a key that FOLLOWS it in the same branch',
    filter: { $or: [{ c: 'nope' }, { $and: [{ a: 'qq' }], b: 'y' }] },
    expected: ['3'],
    note: 'Key order must not matter; this ordering and the next must agree.',
  },
  {
    name: '$and ANDs with a key that PRECEDES it in the same branch',
    filter: { $or: [{ c: 'nope' }, { b: 'y', $and: [{ a: 'qq' }] }] },
    expected: ['3'],
  },
  {
    name: 'keys AND inside a $or nested in a $or branch',
    filter: { $or: [{ $or: [{ a: 'x', b: 'zz' }] }] },
    expected: ['2'],
  },
  {
    name: 'a $or nested under a top-level $and',
    filter: { $and: [{ $or: [{ a: 'x' }, { b: 'y' }] }, { b: 'y' }] },
    expected: ['1', '3'],
  },
  {
    name: '$not ANDs with its sibling keys inside a branch',
    filter: { $or: [{ c: 'nope' }, { $not: { a: 'x' }, b: 'zz' }] },
    expected: ['4'],
  },
  {
    name: 'single-key $or branches stay a plain OR',
    filter: { $or: [{ a: 'x' }, { b: 'y' }] },
    expected: ['1', '2', '3'],
    note: 'The control: the shape that was always correct must stay correct.',
  },

  // ── Shapes read scopes are actually written in ────────────────────────────
  {
    name: 'read scope: own AND active, OR another owner\'s row',
    filter: { $or: [{ owner: 'u1', status: 'active' }, { owner: 'u2', status: 'active' }] },
    expected: ['1', '3'],
    note: 'Widening here returns rows the scope excludes — an unauthorized read, not a wrong count.',
  },
  {
    name: 'read scope: owner $in AND status',
    filter: { $or: [{ owner: { $in: ['u1'] }, status: 'active' }, { owner: 'u2', status: 'archived' }] },
    expected: ['1', '4'],
  },
  {
    name: 'read scope: parent type paired with its own id list',
    filter: {
      $or: [
        { parent_object: 'case', parent_id: { $in: ['c1'] } },
        { parent_object: 'todo', parent_id: { $in: ['t1'] } },
      ],
    },
    expected: ['1', '3'],
    note: 'Row 4 is parent_object=todo with parent_id=c1 — it matches neither pairing, and is the row a widened compile leaks.',
  },
] as const;
