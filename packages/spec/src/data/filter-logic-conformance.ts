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
 *
 * ## Three case families that are RULED but not yet enrolled
 *
 * All three were ruled by the maintainer and are implemented in some backends.
 * None is in the table yet — a red row here does not enforce a ruling, it just
 * turns another lane's unfinished work into this table's failure, and each
 * family still has one blocker standing, named per family below. Family 1 is
 * recorded with what was actually measured against `main` at `175d789`;
 * families 2 and 3 were re-measured at this PR's 2026-08-05 sync against
 * `cdfbee2f0`, so the next author does not have to re-measure. Add the rows in
 * the PR that closes the gap, not before.
 *
 * ### 1. Boolean identities of the empty combinators (#5239)
 *
 * `{ $and: [] }` = TRUE / all rows, `{ $or: [] }` = FALSE / **zero** rows,
 * `{ $or: [{ a: 'x' }, {}] }` = all rows (`{}` is a TRUE disjunct),
 * `{ $not: {} }` = FALSE / zero rows.
 *
 * | backend | `$and:[]` | `$or:[]` | `$or:[{a},{}]` | `$not:{}` |
 * |---|---|---|---|---|
 * | `formula` | all | zero | all | zero |
 * | `driver-memory` | all | zero | all | zero |
 * | `driver-sql` (#5134/PR #5243) | all | zero | all | zero |
 * | `driver-sqlite-wasm` | all | zero | all | zero |
 * | `driver-mongodb` (#5239) | all | zero | all | zero |
 * | `read-scope-sql` | **THROWS** | **THROWS** | **rows 1,2** | **whole table** |
 * | analytics `filter-normalizer` | **THROWS** | **THROWS** | **rows 1,2** | **whole table** |
 *
 * The two analytics backends do not merely lag: they hold the OPPOSITE
 * position, in writing. `read-scope-sql.ts` and `filter-normalizer.ts` both
 * refuse an empty `$and`/`$or` fail-closed ("An empty combinator has no
 * defensible reading — dropping it widens the query, and treating it as 'match
 * nothing' silently empties a chart"), and `read-scope-sql.test.ts` pins that
 * throw. "Reject loudly" is a defensible answer — it is the one #5240 took for
 * `{ field: {} }` — but it is not the same answer as "reduce to the identity",
 * and one of the two has to give. That is a contract ruling, so it is escalated
 * rather than guessed at: **#5322**.
 *
 * ### 2. NULL-safe `$not` (#5146)
 *
 * A row whose column is NULL does not satisfy the negated condition and IS
 * returned. Landed in `driver-sql` via PR #5296; `driver-memory`, `formula`,
 * `driver-sqlite-wasm` and `driver-mongodb` already agreed; `read-scope-sql`
 * was aligned by #5326 (closing #5297) and `filter-normalizer` by #5335
 * (closing #5325), so as of the 2026-08-05 sync (`cdfbee2f0`) every surface
 * answers this family the same way — no backend blocker remains.
 *
 * What still keeps it out of the table is the fixture: every column of
 * {@link FILTER_LOGIC_ROWS} is non-null by construction, so a NULL-bearing
 * column has to be added here AND declared in all seven harnesses that seed
 * it. That is the whole remaining work item, and it is why this family is not
 * a one-line addition.
 *
 * ### 3. `{ field: {} }` — a field constrained by zero operators (#5240)
 *
 * Ruled **REJECT** (`INVALID_FILTER`), and since gated: #5327 landed the
 * refusal on `driver-sql` (top level AND inside combinators),
 * `driver-sqlite-wasm`, `driver-memory` (both filter surfaces) and `formula`,
 * one wording, `INVALID_FILTER` / 400. As of the 2026-08-05 sync
 * (`cdfbee2f0`) `driver-mongodb` is the one backend still ANSWERING it — an
 * exact-match on an empty document — tracked by #5376. What blocks enrolment
 * is the table's own shape: {@link FilterLogicCase} has no way to spell "this
 * filter must be REJECTED" — `expected` is a row-id list, and an empty list
 * means "matched nothing", which is precisely the FALSE answer the ruling did
 * NOT take. Enrolling this case needs the shape extended first (an
 * `expectRejection` discriminant, or a sibling table) — deliberately not
 * invented here. The case lands with that extension, alongside the
 * schema-side narrowing that stays with the spec lane.
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
