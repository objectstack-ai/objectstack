// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the Filter Protocol's **text operators** —
 * the single standard every filter backend is checked against for case
 * folding, literal comparands, and the retired `$regex`.
 *
 * ## Why this is a SEPARATE table from `FILTER_LOGIC_CASES`
 *
 * `filter-logic-conformance.ts` writes down three rules about itself, and this
 * table exists because #5701 needed all three left intact:
 *
 * 1. **Scope.** That table's header says, of its own contents: *"Nothing here
 *    exercises null handling, dates, numeric coercion, `LIKE` escaping, or case
 *    sensitivity — those legitimately differ between a SQL engine and a JS
 *    matcher, and folding them in would make the table unpassable rather than
 *    more useful. Keep it that way."* `LIKE` escaping and case sensitivity are
 *    precisely this table's subject. They stopped "legitimately differing" when
 *    #4706 ruled a single answer for them — but the logic table's rule is still
 *    right for the logic table.
 * 2. **Timing.** *"A red row here does not enforce a ruling, it just turns
 *    another lane's unfinished work into this table's failure … Add the rows in
 *    the PR that closes the gap, not before."* The `check-driver-conformance`
 *    gate judges a case-set by IMPORT, so adding rows to a case-set five suites
 *    already drive turns those suites red immediately. A NEW case-set nobody
 *    imports yet is instead five DEBT ledger rows — measured, tracked, and
 *    `main` stays green.
 * 3. **Shape.** *"`FilterLogicCase` has no way to spell 'this filter must be
 *    REJECTED' — `expected` is a row-id list, and an empty list means 'matched
 *    nothing', which is precisely the FALSE answer the ruling did NOT take.
 *    Enrolling this case needs the shape extended first (an `expectRejection`
 *    discriminant, or a sibling table) — deliberately not invented here."*
 *    This is that sibling table, and {@link FilterTextCase} is that
 *    discriminant. #5240's `{ field: {} }` family can adopt the shape from here
 *    without reopening the logic table.
 *
 * ## Status: the SQL family answers this table; the ledger counts the rest
 *
 * This is the contract half of the #4706 ruling (#5701). What this section
 * said when the table landed — `$icontains` "implemented by nobody", the
 * `$contains` family's case-sensitivity "honoured by two of five backends",
 * "every driver carries a measured DEBT row" pointing at #5702 — was true in
 * the #5701 era and has since been falsified by #5702 (closed 2026-08-08) and
 * #6518 (re-verified 2026-08 by EXECUTING every face, #6993 — a text scan
 * undercounts here, because `driver-sqlite-wasm` inherits its compiler and
 * carries no case arm of its own):
 *
 * - `driver-sql`, `driver-sqlite-wasm` (inherited, on the sql.js engine) and
 *   `driver-turso` (both transports) answer `$icontains` and answer the
 *   `$contains` family case-exactly; their suites import this whole table,
 *   which is what `scripts/check-driver-conformance.mjs` counts as coverage.
 * - `driver-memory` and `driver-mongodb` ANSWER `$icontains` since #6520 — on
 *   all three of driver-memory's faces — with the same ASCII-only fold, so the
 *   first four rows of this table are satisfied everywhere.
 * - `driver-mongodb` answers the `$contains` family case-exactly since #6682,
 *   and its suite (`mongodb-filter-text-conformance.test.ts`) imports this
 *   whole table — every row, rejections included — so its DEBT row is gone.
 * - `driver-memory` answers it too since #6682's second half: the `i` flag came
 *   off all nine sites on its query path and off `filterSubstringPattern`, the
 *   shared rule its analytics face borrows, so the two folding faces moved onto
 *   the reference matcher's already-case-exact answer rather than the other way
 *   round. `memory-filter-text-conformance.test.ts` imports this whole table and
 *   runs it on every face, and that DEBT row is gone with it.
 *
 * So the ledger is EMPTY: all five drivers import this table. The ledger is
 * RECONCILED against the imports on every run, so read the open set THERE rather
 * than trusting a count written in prose here — this paragraph is the thing that
 * goes stale, which is why the gate and not the prose is the authority.
 *
 * Rule 2 above still governs any future gap: the rows join a driver's suite
 * in the PR that closes it, not before.
 *
 * The `$regex` rejection cases carried a further ordering constraint when
 * this table landed: `plugin-auth`'s ObjectQL adapter still emitted
 * `{ field: { $regex: value } }` on the authentication path, so a backend
 * enrolling them early would have broken sign-in. That constraint is history
 * rather than advice now — #5710 flipped the producer to `$contains` (the
 * whole-repo re-scan finding no other live producer is recorded in
 * `driver-memory/src/filter-refusal.ts`), and the refusal sites print
 * `RETIRED_FILTER_OPERATORS`' prescriptions (re-verified 2026-08, #6993; the
 * per-face envelope census lives on that table's own docblock).
 *
 * ## What belongs here
 *
 * Text-operator semantics that every backend must agree on: which characters
 * fold, which characters are literal, which spellings are refused — and, since
 * #14079, what a text operator answers over a stored value that is NOT a
 * string. Anything whose answer legitimately differs per backend does not
 * belong — the same bar the logic table sets, applied to a different axis.
 *
 * ## A stored value that is not a string (#14079, maintainer ruling 2026-09-05)
 *
 * Measured on `origin/main` before this section existed, one filter over one
 * numeric column answered FOUR ways: `driver-memory`'s reference matcher said
 * NO to `$contains` AND to `$notContains` for the same row (a `typeof` test
 * standing in for the predicate); its live mingo path, every other JS face
 * and mongo's string-only `$regex` type-gated (`$contains` NO, `$notContains`
 * YES); the SQLite family COERCED the number to text in its storage class's
 * spelling (REAL renders `5` as `'5.0'`, so `$endsWith: '5'` was NO and
 * `$contains: '.0'` was YES — answers to a query nobody wrote); and live
 * Postgres REFUSED at query time with SQLSTATE 42883, a 500.
 *
 * The ruling took the type-gate (option A): a stored value that is not a
 * string never satisfies a positive text operator (`$contains` /
 * `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) and
 * satisfies `$notContains` — complementarity holds, on every face. Coercion was
 * refused on the measurement (unpassable on SQLite REAL without CAST rewrites),
 * and a declared-type door that refuses the filter before any backend runs
 * (option C) is deferred to its own decision card, not rejected — the rows
 * here are what every face answers whether or not such a door is ever built.
 *
 * The JS faces answer off the VALUE. A SQL compiler cannot see the value at
 * compile time, so it answers off the DECLARED type — the column classes in
 * `NON_TEXT_STORED_VALUE_TYPES` (`field-value.zod.ts`) compile the positive
 * operators to a never-true predicate and `$notContains` to an always-true one,
 * which is what makes Postgres's runtime 500 the declared answer instead of a
 * dialect accident. `$like` / `$ilike` follow the same rule but are pinned on
 * the faces that answer them rather than here: this table is a driver's
 * enrolment (rule 2 above), and `driver-mongodb` refuses those two operators.
 *
 * @see FILTER_LOGIC_CASES — combinator semantics, the sibling standard.
 * @see NON_TEXT_STORED_VALUE_TYPES — the column classes the SQL faces type-gate by.
 * @see https://github.com/objectstack-ai/objectstack/issues/4706 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/5701 (this table)
 * @see https://github.com/objectstack-ai/objectstack/issues/5702 (the SQL family — landed)
 * @see https://github.com/objectstack-ai/objectstack/issues/6520 ($icontains on the JS faces — landed)
 * @see https://github.com/objectstack-ai/objectstack/issues/6682 (the $contains family — mongodb and memory both landed)
 * @see https://github.com/objectstack-ai/objectstack/issues/14079 (a stored value that is not a string)
 */

import { parseFilterAST, type FilterCondition } from './filter.zod';

/**
 * A row in the conformance fixture: one text column, and — since #14079 — one
 * column that is NOT text.
 *
 * `name` carries every case about folding and literalness. `score` exists for
 * exactly one class of case: a text operator aimed at a stored value that is
 * not a string, which no fixture of strings can see (a `typeof` guard and the
 * predicate give the same answer while the value IS a string — negation is
 * what separates them). It is deliberately a NUMBER rather than a boolean or a
 * date: a number is stored as a non-string on every backend the platform runs
 * (REAL/INTEGER, a JS number, a BSON double), where a date's stored form is a
 * dialect question (ADR-0053) this table does not rule on.
 */
export interface FilterTextRow {
  id: string;
  name: string;
  /** A stored NUMBER — never a string, on any backend. */
  score: number;
}

/**
 * The fixture. Every row exists to make one wrong answer VISIBLE, in pairs:
 *
 * | pair | rows | the mistake it catches |
 * |---|---|---|
 * | ASCII case | 1, 2 | a fold that does not happen (`$icontains`), or one that happens when it must not (`$contains`) |
 * | non-ASCII case | 3, 4 | a fold WIDER than ASCII — the boundary #4706 Q1 pinned |
 * | `%` | 5, 6 | a comparand `%` reaching SQL as a LIKE wildcard |
 * | `_` / `.` | 7, 8, 9 | a comparand `_` reaching SQL as a wildcard, or `.` reaching a regex engine |
 * | `score` (not a string) | all nine | a backend that COERCES a stored number to text and searches it, or one whose `typeof` guard answers NO to an operator and to its negation (#14079) |
 *
 * Each pair is deliberately near-identical apart from the one character under
 * test, so a case that matches the wrong member of a pair returns visibly wrong
 * ids rather than the same count by luck.
 *
 * The `score` values are chosen so that a coercing backend answers a VISIBLY
 * non-empty set to the positive cases (seven of nine values render with a `5`
 * in them; every value renders with a trailing `0` on a SQLite REAL column and
 * five of nine on an INTEGER one), and so that a `0` is among them — a guard
 * written as a truthiness test would drop that row.
 */
export const FILTER_TEXT_ROWS: readonly FilterTextRow[] = [
  { id: '1', name: 'ACME Corp', score: 5 },
  { id: '2', name: 'acme corp', score: 50 },
  { id: '3', name: 'CAFÉ', score: 0 },
  { id: '4', name: 'café', score: 15 },
  { id: '5', name: '100% match', score: 100 },
  { id: '6', name: '100X match', score: 105 },
  { id: '7', name: 'a_b', score: 25 },
  { id: '8', name: 'axb', score: 250 },
  { id: '9', name: 'a.b', score: 500 },
] as const;

/** Fields every case carries, whatever its verdict. */
interface FilterTextCaseBase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /** The filter under test. */
  readonly filter: FilterCondition;
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/** A case whose filter must be EVALUATED, matching exactly {@link expected}. */
export interface FilterTextRowsCase extends FilterTextCaseBase {
  readonly expectRejection?: false;
  /** Ids of matching rows, ascending. */
  readonly expected: readonly string[];
}

/**
 * A case whose filter must be REFUSED.
 *
 * This is the discriminant `filter-logic-conformance.ts` deliberately did not
 * invent (its rule 3, quoted in this file's header). It exists because
 * `expected: []` cannot express it: an empty row list means "evaluated, matched
 * nothing", which is a FALSE answer — and for a retired operator, answering
 * FALSE is exactly the silent wrong answer the retirement is meant to end. A
 * suite must distinguish "returned no rows" from "refused to run".
 */
export interface FilterTextRejectionCase extends FilterTextCaseBase {
  readonly expectRejection: true;
  /**
   * The ADR-0112 error code the refusal must carry. A refusal outside the
   * envelope reaches the client as a 500-shaped body for a 400-class mistake,
   * which is the half of #5324 that the refusal itself does not fix.
   */
  readonly code: 'INVALID_FILTER';
  /**
   * Substrings the refusal message must contain, checked case-sensitively.
   *
   * Always includes the rejected spelling and, where one exists, the
   * REPLACEMENT — a rejection that does not name what to write instead sends
   * the author to the docs, and the whole point of `RETIRED_FILTER_OPERATORS`
   * is that the error carries the prescription (AGENTS.md, Post-Task Checklist
   * step 3).
   */
  readonly mustMention: readonly string[];
}

/** One conformance case: evaluated to a row list, or refused. */
export type FilterTextCase = FilterTextRowsCase | FilterTextRejectionCase;

/**
 * The cases. Ordered by what they pin: the ASCII fold, its boundary, comparand
 * literalness, the case-sensitive family, then the refusals.
 */
export const FILTER_TEXT_CASES: readonly FilterTextCase[] = [
  // ── `$icontains` folds ASCII case, in both directions ──────────────────────
  {
    name: '$icontains matches an upper-case row from a lower-case comparand',
    filter: { name: { $icontains: 'acme' } },
    expected: ['1', '2'],
    note: 'The fold has to run on BOTH sides — comparing a folded comparand against a raw column matches only row 2.',
  },
  {
    name: '$icontains matches a lower-case row from an upper-case comparand',
    filter: { name: { $icontains: 'ACME' } },
    expected: ['1', '2'],
  },

  // ── The ASCII-ONLY boundary (#4706 Q1 = A) ─────────────────────────────────
  //
  // These two are the contract itself, not an edge case. A backend folding the
  // whole Unicode range (JS `toLowerCase()`, mongo's `$options: 'i'`) answers
  // ['3','4'] to BOTH, and is wrong on both — not because Unicode folding is
  // worse, but because SQLite cannot do it, so a protocol that promised it
  // would be promising what three of five backends cannot deliver.
  {
    name: 'ASCII-only: a lower-case non-ASCII comparand does NOT match its upper-case row',
    filter: { name: { $icontains: 'café' } },
    expected: ['4'],
    note: 'É does not fold to é. Row 3 (CAFÉ) must NOT match. A Unicode-folding backend returns [3,4] and fails here.',
  },
  {
    name: 'ASCII-only: an upper-case non-ASCII comparand does NOT match its lower-case row',
    filter: { name: { $icontains: 'CAFÉ' } },
    expected: ['3'],
    note: 'The mirror of the case above — the ASCII letters fold, É does not, so exactly one row survives each direction.',
  },

  // ── The comparand is LITERAL: no LIKE wildcards, no regex metacharacters ───
  //
  // The escaping discipline is `applyLike`'s (driver-sql), and #5589's dialect
  // matrix is why it is pinned per character rather than once.
  {
    name: '$icontains treats % as a literal character, not a LIKE wildcard',
    filter: { name: { $icontains: '100%' } },
    expected: ['5'],
    note: 'An unescaped comparand compiles to LIKE \'%100%%\', which also matches row 6 (100X match).',
  },
  {
    name: 'icontains (the infix/view spelling, #8934) lowers to $icontains — % stays a LITERAL through that door too',
    // Computed THROUGH the lowering on purpose: today this case is byte-equal
    // at runtime to the one above, and that is the point. If the infix spelling
    // is ever folded onto `$ilike` instead (the boundary #8934 rules out), the
    // raw-pattern reading of `100%` also matches row 6 (`100X match`) and this
    // case goes red on every backend that runs this table — the fold is caught
    // where it executes, not only in the spec's own suite.
    filter: parseFilterAST(['name', 'icontains', '100%']) as FilterCondition,
    expected: ['5'],
    note: 'The three authoring dialects declare ONE capability (#8934): the infix door must reach the same escaped-substring operator the $ dialect names directly, never the raw-pattern $ilike.',
  },
  {
    name: '$icontains treats _ as a literal character, not a single-character wildcard',
    filter: { name: { $icontains: 'a_b' } },
    expected: ['7'],
    note: 'An unescaped _ matches any one character, so LIKE \'%a_b%\' also returns rows 8 (axb) and 9 (a.b).',
  },
  {
    name: '$icontains treats . as a literal character, not a regex metacharacter',
    filter: { name: { $icontains: 'a.b' } },
    expected: ['9'],
    note: 'This is the `$regex` defect restated as a requirement: on a regex-evaluating backend "a.b" also matched rows 7 and 8.',
  },
  {
    name: '$contains treats _ as a literal character too',
    filter: { name: { $contains: 'a_b' } },
    expected: ['7'],
    note: 'The literal-comparand rule is the operator family\'s, not `$icontains`\'s alone.',
  },

  // ── The `$contains` family is CASE-SENSITIVE (#4706 Q2 = A) ────────────────
  //
  // Supersedes `filter.zod.ts`\'s former "Case sensitivity should be handled at
  // backend level". "The SQL family\'s LIKE and mongo\'s hardcoded `$options: 'i'`
  // are #5702\'s work" was the score when these rows landed and has since split
  // (re-measured 2026-08, #6993, by executing each face): #6518 made the SQL
  // family case-exact (GLOB on the SQLite dialects), so those three drivers
  // answer these rows today, and #6682 took mongo\'s hardcoded `$options: 'i'`
  // off all four arms, so `translateFilter` now lowers `$contains` to a bare
  // `$regex` and that driver answers them too. #6682\'s second half then took
  // the same flag off driver-memory\'s query path and off the rule its analytics
  // face borrows, which was the last folding face on the platform. (`formula`
  // and driver-memory\'s reference matcher measured case-exact both then and
  // now — they are what the other faces were moved onto.)
  {
    name: '$contains is case-SENSITIVE — a lower-case comparand misses the upper-case row',
    filter: { name: { $contains: 'acme' } },
    expected: ['2'],
    note: 'Row 1 (ACME Corp) must NOT match. SQLite\'s LIKE folds ASCII — the defect #6518 replaced with GLOB on the SQLite dialects; a JS backend\'s equivalent is a RegExp carrying the `i` flag, which #6682 took off the last two. A backend returning both here has regressed to one of them.',
  },
  {
    name: '$contains is case-SENSITIVE — an upper-case comparand misses the lower-case row',
    filter: { name: { $contains: 'ACME' } },
    expected: ['1'],
  },
  {
    name: '$startsWith is case-SENSITIVE',
    filter: { name: { $startsWith: 'ACME' } },
    expected: ['1'],
  },
  {
    name: '$endsWith is case-SENSITIVE',
    filter: { name: { $endsWith: 'corp' } },
    expected: ['2'],
    note: 'Row 1 ends with "Corp" — a folding backend returns both and cannot be told apart from a working one by count alone.',
  },
  {
    name: '$notContains is case-SENSITIVE, and negation does not widen it',
    filter: { name: { $notContains: 'acme' } },
    expected: ['1', '3', '4', '5', '6', '7', '8', '9'],
    note: 'Row 1 is EXCLUDED from the negation only if the positive form excluded it — the case rule has to hold under $not too.',
  },

  // ── A stored value that is NOT a string (#14079, ruled 2026-09-05) ────────
  //
  // Every `score` is a number, so every positive text operator answers NO for
  // every row and `$notContains` answers YES for every row — complementarity.
  // The header's "A stored value that is not a string" section carries the
  // measurement these rows replace. Two wrong answers to keep apart:
  //
  //   - COERCE: `String(5)` is `'5'`, so `$contains: '5'` returns rows 1, 2, 4,
  //     6, 7, 8 and 9 — and on a SQLite REAL column `5` renders `'5.0'`, so
  //     `$endsWith: '0'` returns ALL NINE there and five elsewhere. A coercing
  //     backend answers a query nobody wrote, in a spelling the storage class
  //     chose.
  //   - A TYPE TEST IN PLACE OF THE PREDICATE: `typeof value !== 'string' ⇒
  //     false` on `$notContains` answers NO to an operator AND to its negation
  //     for the same row (rows 1–9 vanish from the negation) — the reference
  //     matcher's measured answer before #14079.
  {
    name: '$contains never matches a stored value that is not a string',
    filter: { score: { $contains: '5' } },
    expected: [],
    note: 'A number cannot contain a substring. A coercing backend returns [1,2,4,6,7,8,9]; live Postgres used to refuse this at query time (SQLSTATE 42883), which the type-gated compile turns into this declared answer.',
  },
  {
    name: '$startsWith never matches a stored value that is not a string',
    filter: { score: { $startsWith: '5' } },
    expected: [],
    note: 'A coercing backend returns [1,2,9].',
  },
  {
    name: '$endsWith never matches a stored value that is not a string',
    filter: { score: { $endsWith: '0' } },
    expected: [],
    note: 'The storage-class tell: a coercing SQLite REAL column returns ALL NINE (every value renders `…0.0`), an INTEGER column returns [2,3,5,8,9]. The declared answer depends on neither.',
  },
  {
    name: '$icontains never matches a stored value that is not a string',
    filter: { score: { $icontains: '5' } },
    expected: [],
    note: 'The fold has nothing to fold: the guard on the COLUMN VALUE is the same one `$contains` carries, applied before the fold rather than instead of it.',
  },
  {
    name: '$notContains is satisfied by every stored value that is not a string — complementarity holds',
    filter: { score: { $notContains: '5' } },
    expected: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    note: 'The card\'s cell. A value that cannot contain the substring satisfies "does not contain" — the answer the live mingo path, formula, having, mongo and the analytics face already gave, and the one the reference matcher answered NO to. A coercing backend returns [3,5].',
  },

  // ── Refusals ──────────────────────────────────────────────────────────────
  {
    name: '$regex is REFUSED, and the refusal names $icontains',
    filter: { name: { $regex: 'ac.*' } },
    expectRejection: true,
    code: 'INVALID_FILTER',
    mustMention: ['$regex', '$icontains'],
    note: 'Not `expected: []`. Answering zero rows is what driver-memory already did for an invalid pattern — the silent wrong answer #4706 retired the operator over.',
  },
  {
    name: '$regex with $options is REFUSED as one mistake, not two',
    filter: { name: { $regex: '^acme', $options: 'i' } },
    expectRejection: true,
    code: 'INVALID_FILTER',
    mustMention: ['$regex', '$options', '$icontains'],
    note: 'The exact shape plugin-auth\'s adapter used to emit, and the one `$icontains` replaces one-for-one. #5710 flipped that producer before any backend enrolled this case (re-verified 2026-08, #6993). "One mistake" is about the AUTHOR\'s fix being single (write $icontains), not about the message naming one key: it must name BOTH retired spellings, or an author who fixes only $regex trips the dangling-$options refusal on the next attempt.',
  },
  {
    name: 'a dangling $options with no $regex is REFUSED',
    filter: { name: { $options: 'i' } },
    expectRejection: true,
    code: 'INVALID_FILTER',
    mustMention: ['$options', '$icontains'],
    note: 'It was a modifier, never a predicate: on its own it constrained nothing, so accepting it silently widens.',
  },
  {
    name: 'an empty $icontains comparand is REFUSED',
    filter: { name: { $icontains: '' } },
    expectRejection: true,
    code: 'INVALID_FILTER',
    mustMention: ['$icontains'],
    note: 'Every row contains the empty substring, so evaluating it is a predicate that constrains nothing — the widening #5240 refused `{ field: {} }` over, one level in.',
  },
  {
    name: 'a non-string $icontains comparand is REFUSED',
    filter: { name: { $icontains: 42 } },
    expectRejection: true,
    code: 'INVALID_FILTER',
    mustMention: ['$icontains'],
    note: 'Coercing 42 to "42" would answer a query nobody wrote; the declared comparand type is string.',
  },
] as const;
