// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the Filter Protocol's **logical combinators**
 * — the single source of truth every filter backend is checked against.
 *
 * ## Why this exists
 *
 * `FilterCondition` is evaluated by SEVEN independent implementations, and they
 * had drifted:
 *
 * | Backend | Where |
 * |---|---|
 * | SQL compiler | `driver-sql` `applyFilterCondition` |
 * | In-memory matcher | `driver-memory` `memory-matcher` |
 * | Record-at-a-time evaluator | `formula` `matchesFilterCondition` (RLS write-side `check`) |
 * | Read-scope SQL lowering | `service-analytics` `read-scope-sql` |
 * | MongoDB query translator | `driver-mongodb` `translateFilter` |
 * | Turso REMOTE filter compiler | `driver-turso` `RemoteTransport.buildWhereSQL` |
 * | Cube filter lowering | `service-analytics` `filter-normalizer` |
 *
 * The count has been wrong twice, in the same direction, and both corrections
 * cost a real divergence first. #3774 said "four" and enrolled four:
 * `translateFilter` was missed, not excluded, and ran unchecked against this
 * standard until #4405 — the one backend whose target language has no
 * document-level `$not` at all, so a negation leaves it as `$nor`. Then the
 * header said "five" while two more had already been enrolled as harnesses:
 * `RemoteTransport.buildWhereSQL` and `filter-normalizer` are each a hand-written
 * emitter with its own operator vocabulary and its own combinator nesting, and
 * #5298 measured both answering the NULL family differently from the other five.
 *
 * The lesson is worth more than the number: "does a suite for it exist" is not
 * the same question as "is it an independent implementation". `driver-sqlite-wasm`
 * and `driver-turso` LOCAL run the table too and are NOT on this list — both
 * *inherit* `SqlDriver`, so what their suites add is a real engine executing the
 * compiled predicate rather than another way of building one. Turso REMOTE is on
 * the list precisely because it inherits nothing, which is also why it is the
 * backend this table keeps catching (#5590, #5769, #5903).
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
 * / `$lt` on lexicographic strings. Dates, numeric coercion, `LIKE` escaping and
 * case sensitivity are still out — those legitimately differ between a SQL
 * engine and a JS matcher, and folding them in would make the table unpassable
 * rather than more useful. Keep it that way: a case belongs here only if
 * **every** backend must agree on it.
 *
 * **Null handling is IN, as of #5298** — it used to be excluded by the same
 * sentence, on the assumption that a three-valued SQL engine and a two-valued JS
 * matcher could not be held to one answer. Two rulings removed that assumption:
 * #5146 made `$not` NULL-safe and #5298 did the same for the non-negated
 * `$ne` / `$nin` / `$notContains`, so "the column has no value" now has ONE
 * cross-backend answer and belongs to the standard like any other. The
 * {@link FilterLogicRow.d} column carries it, and the four `d`-column cases
 * below enforce it on every backend.
 *
 * ## Case families that are RULED but not yet enrolled
 *
 * The one family left was ruled by the maintainer and is implemented in some
 * backends. It is not in the table yet — a red row here does not enforce a
 * ruling, it just turns another lane's unfinished work into this table's
 * failure, and the family still has a blocker standing, named below. Add the
 * rows in the PR that closes the gap, not before.
 *
 * Two families have GRADUATED out of this note, and how they did is the note's
 * own instruction manual. Family 1 — the boolean identities of the empty
 * combinators — went first: the #5322 ruling took the identity reduction, both
 * analytics compilers aligned, and its four rows moved into
 * {@link FILTER_LOGIC_CASES}. Family 2 — NULL-safe negation, `$not` (#5146) and
 * `$ne`/`$nin`/`$notContains` (#5298), one family and not two because the second
 * ruling extended the first — followed it in #5903, and is worth a sentence
 * because of the shape of its blocker list rather than its content. It stood at
 * two backends: `service-analytics`'s `filter-normalizer` (the Cube face)
 * answered `['2']` for `$ne` while already answering `$not` correctly, and
 * `driver-turso` REMOTE answered `['2']` for both. #5977 cleared the first by
 * emitting the guard as tree STRUCTURE, so all three compilers of that tree
 * agreed; #5903 cleared the second, and the two rows enrolled with it.
 *
 * `driver-turso` remote is the one to remember, and the reason the pre-#5298
 * version of this note was WRONG where it said "every surface answers this
 * family the same way — no backend blocker remains". `TursoDriver` extends
 * `SqlDriver`, so local mode inherited #5146 for free; remote mode compiles
 * filters in `RemoteTransport.buildWhereSQL`, an independent emitter that
 * inherited none of it. One driver, two answers, chosen by connection mode —
 * exactly what this table exists to catch, and exactly what it could not see
 * while the fixture had no nullable column. The lesson generalises past this
 * family: enrolment is what makes a ruling enforceable, and a "no blocker
 * remains" written from a reading of the backend LIST rather than from a
 * measurement is the sentence that hides the next one.
 *
 * The family numbering of the one that remains is kept as its historical id.
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

/**
 * A row in the conformance fixture. Every column is a plain string except
 * {@link FilterLogicRow.d}, which is nullable — see below.
 */
export interface FilterLogicRow {
  id: string;
  /** 2x2 truth table over (a, b) — see {@link FILTER_LOGIC_ROWS}. */
  a: string;
  b: string;
  /** Constant across every row; a predicate on it never changes a result. */
  c: string;
  /**
   * [#5298] The NULL-bearing column — the fixture's only one, and the whole
   * reason the null family could not be enrolled before it existed.
   *
   * Rows 1-2 carry a value (`v1`, `v2`), rows 3-4 are NULL. Harnesses MUST
   * declare it nullable in their DDL / schema: a `NOT NULL` column, or a seed
   * that substitutes `''` for `null`, turns every case below green for the
   * wrong reason — the divergence these cases exist to catch is exactly what a
   * row with no value does, so a fixture without one measures nothing.
   *
   * Deliberately a separate column rather than nulling part of `a`/`b`: the
   * (a, b) truth table is what makes a wrongly-OR-ed pair of predicates show up
   * as extra ids, and punching a hole in it would weaken every combinator case
   * to pay for the null cases.
   */
  d: string | null;
  /** Record-scope columns, for the shapes read scopes are actually written in. */
  owner: string;
  status: string;
  parent_object: string;
  parent_id: string;
}

/**
 * The fixture. Rows 1-4 are the 2x2 truth table over `(a, b)` — every
 * combination appears exactly once, so a wrongly-OR-ed pair of predicates always
 * shows up as extra ids rather than by luck of the data. The same four rows
 * carry the record-scope columns used by the read-scope cases, and (since
 * #5298) the nullable `d`: valued on rows 1-2, NULL on rows 3-4, so a filter
 * that silently drops no-value rows loses exactly half the table.
 */
export const FILTER_LOGIC_ROWS: readonly FilterLogicRow[] = [
  { id: '1', a: 'x',  b: 'y',  c: 'z', d: 'v1',  owner: 'u1', status: 'active',   parent_object: 'case', parent_id: 'c1' },
  { id: '2', a: 'x',  b: 'zz', c: 'z', d: 'v2',  owner: 'u1', status: 'archived', parent_object: 'case', parent_id: 'c2' },
  { id: '3', a: 'qq', b: 'y',  c: 'z', d: null,  owner: 'u2', status: 'active',   parent_object: 'todo', parent_id: 't1' },
  { id: '4', a: 'qq', b: 'zz', c: 'z', d: null,  owner: 'u2', status: 'archived', parent_object: 'todo', parent_id: 'c1' },
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

  // ── Boolean identities of the empty combinators (#5322 ruling) ────────────
  {
    name: 'empty $and is TRUE — the AND identity',
    filter: { $and: [] },
    expected: ['1', '2', '3', '4'],
    note: '#5322: a conjunction of zero conditions constrains nothing.',
  },
  {
    name: 'empty $or is FALSE — the OR identity',
    filter: { $or: [] },
    expected: [],
    note: '#5322/#5134: a disjunction of zero conditions matches nothing. Fail-closed for an RLS scope — a disjunct list that loops to zero items hides every row instead of exposing the table.',
  },
  {
    name: 'a {} branch is a TRUE disjunct and absorbs its $or',
    filter: { $or: [{ a: 'x' }, {}] },
    expected: ['1', '2', '3', '4'],
    note: '#5322: collapsing to the surviving branches instead compiles `a = x` — a silently NARROWED scope (#5297).',
  },
  {
    name: '$not of {} is FALSE — NOT TRUE',
    filter: { $not: {} },
    expected: [],
    note: '#5322: emitting nothing for it runs the query UNSCOPED — on an RLS lowering that is a permission bypass (#5297).',
  },

  // ── NULL / no-value semantics (#5146, #5298) ──────────────────────────────
  //
  // Rows 3 and 4 have no `d`. The `$null` partition at the bottom of this
  // section is what makes that true of every harness: a fixture that quietly
  // stored `''` instead of NULL, or a `NOT NULL` column that rejected the seed,
  // fails THERE rather than by turning one of the two cases here green for the
  // wrong reason. Read the four together — a no-value row is either inside the
  // negation or outside it, and the partition says which rows are which.
  //
  // The family completed here in #5903, the PR that made `driver-turso` REMOTE
  // answer them: it was the last backend of eleven still returning `['2']`, and
  // until it did, enrolling these two rows would have been a gate that reports a
  // known red — which teaches every agent reading CI to discount the colour.
  {
    name: '$ne returns the rows with no value',
    filter: { d: { $ne: 'v1' } },
    expected: ['2', '3', '4'],
    note: '#5298: "not v1" is true of a row whose d is absent. A three-valued `d <> ?` drops rows 3-4 — half the table, silently.',
  },
  {
    name: '$not returns the rows with no value',
    filter: { $not: { d: 'v1' } },
    expected: ['2', '3', '4'],
    note: '#5146: the same ruling reached through the combinator. `NOT (NULL = ?)` is UNKNOWN, so an unguarded negation drops rows 3-4 — and on a CEL `!expr` read scope that is one permission rule admitting different row sets per backend.',
  },
  {
    name: '$null true selects exactly the no-value rows',
    filter: { d: { $null: true } },
    expected: ['3', '4'],
    note: 'The control for the two above: it pins WHICH rows have no value, so a case that returns 2-4 cannot be passing because the seed lost a value it should have kept.',
  },
  {
    name: '$null false selects exactly the valued rows',
    filter: { d: { $null: false } },
    expected: ['1', '2'],
    note: 'The complement, so `$null` is pinned as a partition of the table rather than one half of one. Together with the row-count control this makes a NOT NULL fixture column fail loudly instead of quietly passing everything.',
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
