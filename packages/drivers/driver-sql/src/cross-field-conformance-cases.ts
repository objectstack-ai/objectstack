// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5222] Cross-path conformance corpus for `{ $field }` cross-field
 * comparison: the SAME filter, run through the in-memory evaluator
 * (`@objectstack/formula` `matchesFilterCondition`) and through SQL push-down,
 * must return the SAME rows.
 *
 * ## Why this corpus exists, and why it is not in `spec/src/data`
 *
 * #5041 measured the defect this closes: `FieldReferenceSchema` is declared,
 * `compileCelToFilter` really PRODUCES it for a field-to-field comparison in a
 * CEL permission/RLS rule, and the only implementation was the in-memory
 * evaluator — so one rule ran in memory and answered 400 the moment it was
 * pushed down. A capability that exists on one path and not the other is a
 * per-backend answer to one permission rule, which is the #3948 class; the
 * conformance obligation is therefore the WHOLE deliverable, not a nicety.
 *
 * It lives here rather than in `packages/spec/src/data/*-conformance.ts`
 * deliberately. That directory is the (driver × case-set) matrix
 * `scripts/check-driver-conformance.mjs` scores, and every case-set there
 * obliges EVERY driver to import it or carry a ledger entry. Cross-field
 * push-down is a SQL-family capability in v1 — `driver-mongodb` and
 * `driver-turso` REMOTE compile filters through their own emitters and were
 * not in this issue's scope — so promoting the corpus would enrol three
 * drivers that must then be written down as DEBT. That is "a gate that reports
 * a known red", which `filter-logic-conformance.ts` names as the thing that
 * teaches agents to discount CI's colour. Promote it when the capability
 * reaches those backends, not before.
 *
 * The module is deliberately DEPENDENCY-FREE (no spec import, no driver
 * import): `driver-sqlite-wasm`'s suite reads it across the package boundary,
 * and a fixture that drags a type graph with it would make that import a
 * build-order question.
 *
 * ## The fixture's shape is the argument
 *
 * Six rows, each pinning one cell of the comparison's truth table, and the
 * SAME cell across three storage classes — numeric, text, calendar date — so
 * every case below expects the SAME id set whichever pair it names. A
 * class-dependent answer therefore shows up as a diff between three otherwise
 * identical cases rather than as a single mystery.
 *
 * **Rows 4-6 are the load-bearing ones.** SQL is three-valued and the memory
 * evaluator is two-valued JS, and that is the one place these two paths can
 * genuinely diverge — so the fixture carries every NULL arrangement a pair of
 * columns can be in: target NULL (4), referent NULL (5), and BOTH NULL (6). A
 * corpus without row 6 would miss the case that decides `$eq`: the memory
 * evaluator answers TRUE for it (`resolveValue` yields `null`, and
 * `$eq`'s null arm reads `actual == null`), while a bare `a = b` in SQL is
 * UNKNOWN and drops the row. Every emitted predicate is therefore written
 * TOTAL — see `SqlDriver.applyCrossFieldComparison`.
 */

/** One fixture row. Every nullable column is genuinely nullable in the DDL. */
export interface CrossFieldRow {
  id: string;
  /** Numeric pair. */
  amount: number | null;
  budget: number | null;
  /** Text pair — ASCII only, so SQL collation and JS code-unit order agree. */
  stage: string | null;
  owner: string | null;
  /** Calendar-date pair (`YYYY-MM-DD` on both paths, ADR-0053 Phase 1). */
  starts_on: string | null;
  ends_on: string | null;
  /** The tenant-isolation column — referenced ONLY by the refusal cases. */
  organization_id: string;
}

/**
 * Field declarations the harnesses hand to `initObjects`. Shared so the two
 * driver suites cannot drift into fixtures that differ in a way that matters
 * (a `NOT NULL` column, or a type whose comparison class differs).
 *
 * `tags` (multiple) and `projected_total` (formula) carry no scalar column and
 * exist only to be REFUSED — see {@link CROSS_FIELD_REFUSALS}.
 */
export const CROSS_FIELD_OBJECT_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  amount: { type: 'number', name: 'amount' },
  budget: { type: 'number', name: 'budget' },
  stage: { type: 'string', name: 'stage' },
  owner: { type: 'string', name: 'owner' },
  starts_on: { type: 'date', name: 'starts_on' },
  ends_on: { type: 'date', name: 'ends_on' },
  organization_id: { type: 'text', name: 'organization_id' },
  tags: { type: 'select', name: 'tags', multiple: true },
  projected_total: { type: 'formula', name: 'projected_total' },
};

/**
 * The fixture. One row per cell of the comparison truth table, replicated
 * across all three column pairs so the expectations below are class-independent.
 *
 * | id | relation of the pair      | numeric  | text          | date            |
 * |----|---------------------------|----------|---------------|-----------------|
 * | 1  | target &gt; referent      | 10 / 5   | won / mid     | 03-05 / 03-01   |
 * | 2  | target &lt; referent      | 3 / 5    | lost / mid    | 03-01 / 03-05   |
 * | 3  | target = referent         | 7 / 7    | mid / mid     | 03-03 / 03-03   |
 * | 4  | target NULL, referent set | – / 5    | – / mid       | – / 03-05       |
 * | 5  | target set, referent NULL | 10 / –   | won / –       | 03-05 / –       |
 * | 6  | BOTH NULL                 | – / –    | – / –         | – / –           |
 */
export const CROSS_FIELD_ROWS: readonly CrossFieldRow[] = [
  { id: '1', amount: 10,   budget: 5,    stage: 'won',  owner: 'mid',  starts_on: '2026-03-05', ends_on: '2026-03-01', organization_id: 'o1' },
  { id: '2', amount: 3,    budget: 5,    stage: 'lost', owner: 'mid',  starts_on: '2026-03-01', ends_on: '2026-03-05', organization_id: 'o1' },
  { id: '3', amount: 7,    budget: 7,    stage: 'mid',  owner: 'mid',  starts_on: '2026-03-03', ends_on: '2026-03-03', organization_id: 'o1' },
  { id: '4', amount: null, budget: 5,    stage: null,   owner: 'mid',  starts_on: null,         ends_on: '2026-03-05', organization_id: 'o1' },
  { id: '5', amount: 10,   budget: null, stage: 'won',  owner: null,   starts_on: '2026-03-05', ends_on: null,         organization_id: 'o1' },
  { id: '6', amount: null, budget: null, stage: null,   owner: null,   starts_on: null,         ends_on: null,         organization_id: 'o1' },
] as const;

/** One conformance case: a filter, and the ids BOTH paths must return. */
export interface CrossFieldCase {
  /** Stable identifier, usable as a test name. */
  name: string;
  filter: unknown;
  /** Ids of matching rows, ascending. */
  expected: string[];
  /** Why the case is here — surfaced in failure output. */
  note?: string;
}

/**
 * The supported arm: shapes that MUST compile and MUST agree with the memory
 * evaluator, row for row.
 *
 * The per-class triples are generated rather than written out three times, so
 * a case cannot be added to one class and forgotten in the others — the
 * class-independence claim above is only worth something if it is total.
 */
const COMPARISON_EXPECTATIONS: ReadonlyArray<{ op: string; expected: string[]; note?: string }> = [
  { op: '$gt', expected: ['1'], note: 'Both sides must have a value — `evalOp` requires `actual != null && v != null`, and the emitted SQL says so explicitly rather than relying on UNKNOWN.' },
  { op: '$gte', expected: ['1', '3'], note: 'The equal row joins the strictly-greater one; the NULL rows stay out.' },
  { op: '$lt', expected: ['2'] },
  { op: '$lte', expected: ['2', '3'], note: 'On the DATE pair this also pins the calendar-day rule: memory `lteBound` reads `<= day` as `< next day`, which is the same answer as SQL `<=` when both sides are day-granular text.' },
  { op: '$eq', expected: ['3', '6'], note: 'Row 6 is the case a naive `a = b` gets WRONG: both columns NULL matches in memory (`resolveValue` → null, so `$eq` takes its `actual == null` arm) and is UNKNOWN in three-valued SQL.' },
  { op: '$ne', expected: ['1', '2', '4', '5'], note: 'The exact complement of `$eq` over all six rows — the two together partition the fixture, which is what makes both answers total rather than merely plausible.' },
];

const CLASS_PAIRS: ReadonlyArray<{ label: string; target: string; ref: string }> = [
  { label: 'numeric', target: 'amount', ref: 'budget' },
  { label: 'text', target: 'stage', ref: 'owner' },
  { label: 'date', target: 'starts_on', ref: 'ends_on' },
];

export const CROSS_FIELD_CASES: readonly CrossFieldCase[] = [
  // ── The six scalar operators, on each storage class ───────────────────────
  ...CLASS_PAIRS.flatMap(({ label, target, ref }) =>
    COMPARISON_EXPECTATIONS.map(({ op, expected, note }) => ({
      name: `${op} on the ${label} pair (${target} ${op} $field:${ref})`,
      filter: { [target]: { [op]: { $field: ref } } },
      expected,
      note,
    })),
  ),

  // ── Self-reference: the totality control ─────────────────────────────────
  //
  // A column compared to ITSELF has one answer that cannot be argued with, so
  // it catches a predicate that is merely well-formed. `$eq` must match every
  // row INCLUDING the ones where the column is NULL, and `$ne` must match
  // none — if either NULL row goes missing from the first or appears in the
  // second, the predicate is UNKNOWN somewhere rather than total.
  {
    name: 'a column equals itself on every row, NULLs included',
    filter: { amount: { $eq: { $field: 'amount' } } },
    expected: ['1', '2', '3', '4', '5', '6'],
    note: 'Three-valued `amount = amount` drops rows 4 and 6; the memory evaluator matches them.',
  },
  {
    name: 'a column differs from itself on no row',
    filter: { amount: { $ne: { $field: 'amount' } } },
    expected: [],
    note: 'The complement of the case above, and the direction that FAILS OPEN if the null arms are wrong — a `$ne` that admits the NULL rows would widen an RLS scope.',
  },

  // ── Combinator nesting, including De Morgan over a total predicate ────────
  {
    name: '$not of a cross-field $gt returns exactly the rows $gt does not',
    filter: { $not: { amount: { $gt: { $field: 'budget' } } } },
    expected: ['2', '3', '4', '5', '6'],
    note: '#5146 made `$not` NULL-safe by totalising its leaves; a cross-field leaf is total by construction, so the negation is the exact complement — including the NULL rows the JS evaluator returns.',
  },
  {
    name: '$not of a cross-field $eq returns exactly the rows $eq does not',
    filter: { $not: { amount: { $eq: { $field: 'budget' } } } },
    expected: ['1', '2', '4', '5'],
    note: 'Row 6 (both NULL) must be EXCLUDED here — it satisfies the inner `$eq`. A guard that treated a NULL target as failing the operator would wrongly re-admit it.',
  },
  {
    name: 'two cross-field operators on one field AND within the constraint',
    filter: { amount: { $gte: { $field: 'budget' }, $ne: { $field: 'budget' } } },
    expected: ['1'],
    note: 'Everything inside ONE filter object ANDs, at every depth — the same rule `filter-logic-conformance` pins for literals.',
  },
  {
    name: 'a cross-field comparison ANDs with a literal predicate on another field',
    filter: { amount: { $gt: { $field: 'budget' } }, stage: 'won' },
    expected: ['1'],
  },
  {
    name: '$or of two cross-field branches',
    filter: { $or: [{ amount: { $lt: { $field: 'budget' } } }, { amount: { $eq: { $field: 'budget' } } }] },
    expected: ['2', '3', '6'],
  },
  {
    name: '$or of a cross-field branch and a literal branch',
    filter: { $or: [{ amount: { $gt: { $field: 'budget' } } }, { stage: 'lost' }] },
    expected: ['1', '2'],
  },
  {
    name: '$and of a cross-field branch and a literal branch',
    filter: { $and: [{ amount: { $gte: { $field: 'budget' } } }, { $not: { stage: 'won' } }] },
    expected: ['3'],
    note: 'Row 1 is `won` and drops out; row 3 survives. Also exercises a NULL-safe literal `$not` beside a cross-field conjunct.',
  },
  {
    name: '$not over a $or of cross-field branches (De Morgan)',
    filter: {
      $not: {
        $or: [
          { amount: { $gt: { $field: 'budget' } } },
          { amount: { $eq: { $field: 'budget' } } },
        ],
      },
    },
    expected: ['2', '4', '5'],
    note: 'The complement of {1} ∪ {3,6}. A guard hoisted to the top of the `$not` instead of sitting on each leaf re-admits rows here — the failure #5146 wrote its rewrite to avoid.',
  },
  {
    name: 'a cross-field comparison nested two combinators deep',
    filter: { $or: [{ $and: [{ amount: { $gt: { $field: 'budget' } } }, { stage: 'won' }] }, { stage: 'lost' }] },
    expected: ['1', '2'],
  },
] as const;

/**
 * [#7597] The AUTHORING arm: the same conformance obligation, entered through
 * the array sugar a caller actually writes rather than through the lowered
 * `FilterCondition` object.
 *
 * ## Why the corpus needed a second entrance
 *
 * Every case above is a hand-written `FilterCondition`. That is the shape a
 * DRIVER sees, and it is not the shape anyone AUTHORS: the ObjectUI client, the
 * `FilterBuilder` and every stored view carry the array triple
 * `['amount', '=', { $field: 'budget' }]`, which `parseFilterAST`
 * (`@objectstack/spec`, the single lowering sink per #5158) turns into one of
 * the objects above. A corpus that only enters at the object skips that sink —
 * and the sink is exactly where #7597 was: the four EQUALITY spellings dropped
 * the operator, because implicit equality (`{ field: comparand }`) is right for
 * a literal and produces `{ amount: { $field: 'budget' } }` for a reference —
 * a field spec whose only key is `$field`, which no backend reads as an
 * equality. `['amount', '>', ref]` kept its operator and worked; `['amount',
 * '=', ref]` silently matched nothing. One intent, two spellings, two fates.
 *
 * So these cases assert TWO things per row, and the pair is the point:
 * `loweredTo` pins what the sink produces (a lowering regression fails here,
 * in the conformance suite, rather than in a spec unit test nobody reads
 * beside the driver), and `expected` holds the lowered filter to the same
 * both-paths-same-rows rule as every case above.
 *
 * The `>` control rides along deliberately: it is the spelling that ALWAYS
 * worked, so a run where the equality rows pass and the control fails means
 * the harness moved, not the fix.
 */
export interface CrossFieldAuthoredCase {
  name: string;
  /** The authored filter ARRAY, exactly as a client sends it. */
  authored: unknown;
  /** What `parseFilterAST` must lower it to. */
  loweredTo: unknown;
  /** Ids of matching rows, ascending — for the LOWERED filter, on both paths. */
  expected: string[];
  note?: string;
}

/**
 * The four `$eq` spellings `AST_OPERATOR_MAP` carries (`=`, `==`, `equals`,
 * `eq`), which is the whole set the sink folds into implicit equality — all
 * four were bare before #7597, so all four are pinned.
 */
const EQUALITY_SPELLINGS: readonly string[] = ['=', '==', 'equals', 'eq'];

export const CROSS_FIELD_AUTHORED_CASES: readonly CrossFieldAuthoredCase[] = [
  // ── The equality spellings, on each storage class ────────────────────────
  //
  // Replicated across the three class pairs for the same reason the object
  // cases are: the lowering is class-blind, so a class-dependent answer here
  // would be a driver fact showing up in an authoring test.
  ...CLASS_PAIRS.flatMap(({ label, target, ref }) =>
    EQUALITY_SPELLINGS.map((op) => ({
      name: `['${target}', '${op}', { $field: '${ref}' }] on the ${label} pair`,
      authored: [target, op, { $field: ref }],
      loweredTo: { [target]: { $eq: { $field: ref } } },
      expected: ['3', '6'],
      note: 'The `$eq` row set of the object corpus above — row 3 (equal) and row 6 (both NULL, which the memory evaluator matches and the emitted SQL is written TOTAL to match too).',
    })),
  ),

  // ── The control: the spelling that never lost its operator ───────────────
  {
    name: "['amount', '>', { $field: 'budget' }] still lowers to $gt",
    authored: ['amount', '>', { $field: 'budget' }],
    loweredTo: { amount: { $gt: { $field: 'budget' } } },
    expected: ['1'],
    note: 'Untouched by #7597 and asserted anyway: if this moves, the harness moved rather than the lowering.',
  },

  // ── The sugar's own structures, carrying a reference leaf ────────────────
  {
    name: 'a legacy flat array ANDs an equality reference with a literal',
    authored: [['amount', '=', { $field: 'budget' }], ['stage', '=', 'mid']],
    loweredTo: { $and: [{ amount: { $eq: { $field: 'budget' } } }, { stage: 'mid' }] },
    expected: ['3'],
    note: 'Row 6 drops out on the literal conjunct — which also pins that the LITERAL comparand keeps its implicit-equality lowering (`{ stage: "mid" }`, not `{ stage: { $eq: "mid" } }`). The fix branches on the comparand, not on the operator.',
  },
  {
    name: 'an explicit `or` node carries an equality reference branch',
    authored: ['or', ['amount', '=', { $field: 'budget' }], ['stage', '=', 'lost']],
    loweredTo: { $or: [{ amount: { $eq: { $field: 'budget' } } }, { stage: 'lost' }] },
    expected: ['2', '3', '6'],
    note: 'The lowering is applied at the comparison leaf, so nesting cannot route around it.',
  },
] as const;

/**
 * The refusal arm — the boundary of v1, and the half of this issue that is a
 * SECURITY surface rather than a capability one.
 *
 * Every entry must throw `INVALID_FILTER` / 400 (ADR-0112) on BOTH SQL
 * drivers. `diagnosticIncludes` pins the wording that says WHICH ruling bit;
 * the tests assert the envelope regardless.
 *
 * [#7929, maintainer ruling 2026-08-12] That wording moved. It used to be
 * `messageIncludes` — substrings of the message the CALLER receives — and the
 * rename is the change, not a tidy-up: those sentences name the two columns of
 * the comparison, and on a read-scope refusal both were written by an
 * administrator whose policy the tenant never saw. The refusal now answers the
 * caller with an operand-free sentence and puts this text in the server log, so
 * these fragments are asserted against the LOGGED diagnostic. A test that finds
 * one of them in `error.message` is finding the disclosure this card closed.
 *
 * Read this table together with {@link CROSS_FIELD_CASES}: what makes the
 * refusals defensible is that the supported arm above is proven equivalent, so
 * the line between them is drawn at "cannot be proven equivalent", not at
 * "was not attempted".
 */
export interface CrossFieldRefusalCase {
  name: string;
  filter: unknown;
  /**
   * Substrings the SERVER-LOG diagnostic must contain (#7929) — never the
   * caller-visible message, which names no operand at all.
   */
  diagnosticIncludes: string[];
  /**
   * Why the shape is refused — surfaced in failure output. Optional because
   * several entries are one spelling of a reason the entry above them states
   * in full (the string-operator family, the `$between` endpoints); repeating
   * it per row would make the table read as five reasons where there is one.
   */
  note?: string;
}

export const CROSS_FIELD_REFUSALS: readonly CrossFieldRefusalCase[] = [
  // ── Ruling 1: same-table columns ONLY ─────────────────────────────────────
  {
    name: 'a dotted relation path is refused',
    filter: { amount: { $gt: { $field: 'account.budget' } } },
    diagnosticIncludes: ['dotted path', 'same-table'],
    note: 'Maintainer ruling (2026-08-06) point 1 = A: no JOIN planning (disproportionate) and no alias-qualified columns (no alias contract). The memory evaluator DOES walk the path, so this is a deliberate, loudly-reported asymmetry rather than a silent one.',
  },
  {
    name: 'a dotted path is refused even when its head names a real column',
    filter: { amount: { $gt: { $field: 'budget.nested' } } },
    diagnosticIncludes: ['dotted path'],
    note: 'The refusal is on the SHAPE, not on whether the first segment happens to resolve — otherwise the check would depend on data the compiler cannot see.',
  },

  // ── Ruling 2: declared-only enumeration ──────────────────────────────────
  {
    name: 'an undeclared column is refused at compile time',
    filter: { amount: { $gt: { $field: 'no_such_column' } } },
    diagnosticIncludes: ['not a declared field'],
    note: 'The `$field` value lands in a SQL IDENTIFIER position. cloud#1051: letting it through unchecked is dismantling the guard rail — and a compile-time refusal is what makes AI-authored metadata wrong at authoring time rather than in the database.',
  },
  {
    name: 'an undeclared TARGET field is refused too',
    filter: { no_such_column: { $gt: { $field: 'budget' } } },
    diagnosticIncludes: ['not a declared field'],
    note: 'A comparison is one surface — validating only the referent would leave half of it unchecked, and the type-class rule below needs both declarations anyway.',
  },

  // ── Ruling 2, the security half: the tenant-isolation column ─────────────
  {
    name: 'the tenant-isolation column is refused as the REFERENT',
    filter: { stage: { $eq: { $field: 'organization_id' } } },
    diagnosticIncludes: ['tenant-isolation column'],
    note: 'The named ruling. A comparison against the isolation column is a privilege-escalation comparison surface: it lets a filter probe the tenant boundary the driver injects rather than being scoped by it.',
  },
  {
    name: 'the tenant-isolation column is refused as the TARGET',
    filter: { organization_id: { $eq: { $field: 'stage' } } },
    diagnosticIncludes: ['tenant-isolation column'],
    note: 'Closed because the operands of `=` COMMUTE — a ban that a swap of the two sides walks around is not a ban. Ruling names the referent; this is the same surface spelled backwards.',
  },

  // ── The conformance boundary: comparison CLASS ───────────────────────────
  {
    name: 'a TEXT column compared to a numeric column is refused (the measured divergence)',
    filter: { stage: { $gt: { $field: 'amount' } } },
    diagnosticIncludes: ['stored as'],
    note: 'THE case that proves the class check is load-bearing, and it is directional. Measured with the check disabled: SQLite answers rows 1,2,3,5 — it orders by STORAGE CLASS first, so every TEXT sorts above every INTEGER — while the in-memory evaluator answers NONE, because JS coerces `"won" > 10` to a NaN comparison. Four rows of difference on one filter.',
  },
  {
    name: 'a numeric column compared to a text column is refused (the mirrored spelling)',
    filter: { amount: { $gt: { $field: 'stage' } } },
    diagnosticIncludes: ['stored as'],
    note: 'The mirror of the case above, and measured to AGREE (both answer nothing) — kept in the refusal arm anyway, because a guard that admitted exactly the pairings one fixture measured as agreeing would be a rule about this data rather than about the types.',
  },
  {
    name: 'a date column compared to a text column is refused',
    filter: { starts_on: { $gt: { $field: 'stage' } } },
    diagnosticIncludes: ['stored as'],
    note: 'Both are TEXT physically, so this one WOULD have compiled — and measured, both paths agree. It is refused because they agree by lexicographic accident rather than by any temporal reading, which is also why the class check reads declared TYPES rather than physical affinity.',
  },
  {
    name: 'a numeric column compared to a date column is refused',
    filter: { amount: { $gt: { $field: 'starts_on' } } },
    diagnosticIncludes: ['stored as'],
  },

  // ── Columns with no scalar stored form ──────────────────────────────────
  {
    name: 'a multi-valued (JSON) column is refused as the referent',
    filter: { amount: { $gt: { $field: 'tags' } } },
    diagnosticIncludes: ['no scalar stored'],
    note: 'A JSON column holds a serialized array; SQL comparison operators have no element-wise reading of it, and #7398 already refuses the scalar operators on such a column for a value comparand.',
  },
  {
    name: 'a formula (virtual) column is refused as the referent',
    filter: { amount: { $gt: { $field: 'projected_total' } } },
    diagnosticIncludes: ['no scalar stored'],
    note: 'A formula field is virtual — `createColumn` emits no column at all, so there is nothing to reference. Declared-only enumeration alone would have ADMITTED it, which is why the class check is a second gate rather than a restatement of the first.',
  },

  // ── List positions — refused, and NOT merely unimplemented ──────────────
  //
  // The memory evaluator does not resolve a `{ $field }` INSIDE a list either:
  // `resolveValue` returns an array unchanged, so `$in`/`$nin` compare against
  // the raw reference OBJECT (never equal to a stored value) and `$between`
  // orders against it. There is therefore no correct in-memory semantics for
  // SQL to be equivalent TO — refusing is the only answer that is not a guess.
  //
  // #7596 closed the other half: the spec no longer DECLARES these positions.
  // `FieldReferenceSchema` is out of both `$between` endpoint unions and
  // `$in`/`$nin` rule the member out by name (maintainer ruling 2026-08-11,
  // ADR-0049 declared = enforced), so an authored filter is now refused at the
  // schema door with a message naming the scalar-comparison alternative.
  //
  // These four cases stay, verbatim and unweakened. The schema door is not on
  // every path to a driver — `find()` takes a `where` object that no face
  // re-validates against `FieldOperatorsSchema` (see #7596's report), and a
  // permission filter assembled in code never passes it at all. A driver that
  // trusted the declaration would answer these shapes with a silent zero-row
  // result, which is exactly what #5041 found here in the first place.
  {
    name: 'a $field member of an $in list is refused',
    filter: { amount: { $in: [{ $field: 'budget' }, 1] } },
    diagnosticIncludes: ['index 0'],
    note: 'Before #5041 this did not even crash: it compiled, ran, and returned ZERO ROWS. The index is named because it is the only thing distinguishing the bad member from its legitimate neighbours.',
  },
  {
    name: 'a $field member of a $nin list is refused',
    filter: { amount: { $nin: [{ $field: 'budget' }] } },
    diagnosticIncludes: ['index 0'],
    note: 'The $nin direction is the dangerous one — a lost member drops an EXCLUSION the caller wrote, widening the result set.',
  },
  {
    name: 'a $field lower bound of a $between is refused',
    filter: { amount: { $between: [{ $field: 'budget' }, 100] } },
    diagnosticIncludes: ['index 0'],
  },
  {
    name: 'a $field upper bound of a $between is refused',
    filter: { amount: { $between: [0, { $field: 'budget' }] } },
    diagnosticIncludes: ['index 1'],
  },

  // ── String operators — refused in v1, and the reason is a filter bypass ──
  //
  // In memory the referenced value is matched as a LITERAL substring. Compiled
  // to SQL it becomes the TEXT of a LIKE pattern, so any `%` / `_` / `\`
  // STORED in the referenced column would act as a WILDCARD — the P0
  // filter-bypass class `applyLike` escapes literal comparands to prevent.
  // Escaping a column-side value needs a per-dialect REPLACE chain that has
  // not been proven, so v1 refuses. Recorded as a decision, not an omission.
  {
    name: '$startsWith against a field reference is refused',
    filter: { stage: { $startsWith: { $field: 'owner' } } },
    diagnosticIncludes: ['$field'],
    note: 'v1 refusal: a column-side LIKE pattern cannot be metacharacter-escaped portably, and an unescaped one is the `%`-matches-every-row bypass.',
  },
  {
    name: '$contains against a field reference is refused',
    filter: { stage: { $contains: { $field: 'owner' } } },
    diagnosticIncludes: ['$field'],
  },
  {
    name: '$endsWith against a field reference is refused',
    filter: { stage: { $endsWith: { $field: 'owner' } } },
    diagnosticIncludes: ['$field'],
  },
  {
    name: '$notContains against a field reference is refused',
    filter: { stage: { $notContains: { $field: 'owner' } } },
    diagnosticIncludes: ['$field'],
  },
  {
    name: '$icontains against a field reference is refused',
    filter: { stage: { $icontains: { $field: 'owner' } } },
    diagnosticIncludes: ['$field'],
  },
] as const;

/**
 * [#7929] Every column name a {@link CROSS_FIELD_REFUSALS} entry can put in its
 * operands — the list a CALLER-VISIBLE refusal message must contain none of.
 *
 * The corpus's own filters are the source: the declared columns of
 * {@link CROSS_FIELD_OBJECT_FIELDS} that appear on either side of a refused
 * comparison, plus the three names that are refused precisely because the
 * object does NOT declare them. Both sides matter — on a read-scope refusal the
 * administrator wrote the target column as surely as the referenced one, so a
 * check that watched only the `$field` value would pass a message still naming
 * half the policy.
 *
 * `id` is deliberately absent. No refusal case references it, and a two-letter
 * substring search over English prose reports a disclosure for words like
 * "considered" — an assertion that fails for reasons unrelated to what it
 * claims is worse than no assertion. Add a name here when a case adds one.
 */
export const CROSS_FIELD_OPERAND_NAMES: readonly string[] = [
  'amount',
  'budget',
  'stage',
  'owner',
  'starts_on',
  'ends_on',
  'organization_id',
  'tags',
  'projected_total',
  'account.budget',
  'budget.nested',
  'no_such_column',
];

// ═══════════════════════════════════════════════════════════════════════════
// [#14104] `addDays` — a whole-day offset on the referenced column
// ═══════════════════════════════════════════════════════════════════════════
//
// The ruling (2026-09-02, option A): `FieldReferenceSchema` gains `addDays`,
// an integer literal of any sign or a nested `{ $field }` reference to a
// numeric column, so a dataset measure can say "completed by its deadline,
// where the deadline is a stored date plus a grace period held in another
// column" — `completed_at <= due_date + grace_days`. The NULL semantics are
// stated in words and pinned here on BOTH paths, in the shape #5146 used for
// `$not`: a NULL offset column contributes ZERO days; a NULL referenced
// column makes the comparison FALSE for every operator (`$ne` included), so
// `$not` re-admits it.
//
// A second fixture rather than more columns on the first: the offset arm's
// truth table has THREE inputs (target, referenced base, offset) and the
// interesting cells are the NULL arrangements of each, which the six-row
// fixture above cannot carry without disturbing every expectation it pins.
// Two temporal pairs — a `date` pair and a `datetime` pair on the same
// calendar days at a fixed time of day — so every case below expects the SAME
// id set whichever pair it names: a class-dependent answer (a `date()` that
// dropped the time, a `strftime` that changed the text shape) shows up as a
// diff between two otherwise identical cases.

/** One offset-fixture row. Every nullable column is genuinely nullable in the DDL. */
export interface CrossFieldOffsetRow {
  id: string;
  /** Calendar-date pair (`YYYY-MM-DD` on both paths). */
  completed_on: string | null;
  due_on: string | null;
  /** Instant pair — the same calendar days at 12:00:00.000Z. */
  completed_at: string | null;
  due_at: string | null;
  /** The offset column: whole days of grace, NULL for "no grace". */
  grace_days: number | null;
  /** Non-temporal columns — referenced ONLY by the refusal cases. */
  title: string | null;
  amount: number | null;
  budget: number | null;
  start_time: string | null;
  end_time: string | null;
  organization_id: string;
}

export const CROSS_FIELD_OFFSET_OBJECT_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  completed_on: { type: 'date', name: 'completed_on' },
  due_on: { type: 'date', name: 'due_on' },
  completed_at: { type: 'datetime', name: 'completed_at' },
  due_at: { type: 'datetime', name: 'due_at' },
  grace_days: { type: 'number', name: 'grace_days' },
  title: { type: 'text', name: 'title' },
  amount: { type: 'number', name: 'amount' },
  budget: { type: 'number', name: 'budget' },
  start_time: { type: 'time', name: 'start_time' },
  end_time: { type: 'time', name: 'end_time' },
  organization_id: { type: 'text', name: 'organization_id' },
};

const noon = (day: string | null): string | null => (day === null ? null : `${day}T12:00:00.000Z`);

/**
 * The offset fixture. `completed` is the TARGET, `due` the referenced BASE,
 * `grace_days` the OFFSET; March 2026 throughout, so `-3` from the 1st crosses
 * a month boundary (February has 28 days in 2026).
 *
 * | id | completed | due   | grace | due + grace | reading                                   |
 * |----|-----------|-------|-------|-------------|-------------------------------------------|
 * | 1  | 03-05     | 03-01 | 2     | 03-03       | late by two days                          |
 * | 2  | 03-03     | 03-01 | 2     | 03-03       | on the last day of grace (equality)       |
 * | 3  | 03-01     | 03-05 | 0     | 03-05       | early; zero grace                          |
 * | 4  | 03-05     | 03-01 | NULL  | 03-01       | NULL grace = zero days: late              |
 * | 5  | NULL      | 03-01 | 2     | 03-03       | never completed, deadline exists          |
 * | 6  | 03-05     | NULL  | 2     | —           | NO DEADLINE: every comparison is false    |
 * | 7  | NULL      | NULL  | NULL  | —           | nothing at all                            |
 * | 8  | 03-10     | 03-01 | -3    | 02-26       | negative grace tightens the deadline      |
 * | 9  | 02-27     | 03-01 | -3    | 02-26       | inside the plain due date, outside -3     |
 */
const OFFSET_DAYS: ReadonlyArray<Omit<CrossFieldOffsetRow, 'completed_at' | 'due_at'>> = [
  { id: '1', completed_on: '2026-03-05', due_on: '2026-03-01', grace_days: 2,    title: 'a', amount: 10,   budget: 5,    start_time: '09:00:00', end_time: '17:00:00', organization_id: 'o1' },
  { id: '2', completed_on: '2026-03-03', due_on: '2026-03-01', grace_days: 2,    title: 'b', amount: 3,    budget: 5,    start_time: '09:00:00', end_time: '17:00:00', organization_id: 'o1' },
  { id: '3', completed_on: '2026-03-01', due_on: '2026-03-05', grace_days: 0,    title: 'c', amount: 7,    budget: 7,    start_time: '09:00:00', end_time: '17:00:00', organization_id: 'o1' },
  { id: '4', completed_on: '2026-03-05', due_on: '2026-03-01', grace_days: null, title: 'd', amount: null, budget: 5,    start_time: null,       end_time: '17:00:00', organization_id: 'o1' },
  { id: '5', completed_on: null,         due_on: '2026-03-01', grace_days: 2,    title: 'e', amount: 10,   budget: null, start_time: '09:00:00', end_time: null,       organization_id: 'o1' },
  { id: '6', completed_on: '2026-03-05', due_on: null,         grace_days: 2,    title: 'f', amount: null, budget: null, start_time: null,       end_time: null,       organization_id: 'o1' },
  { id: '7', completed_on: null,         due_on: null,         grace_days: null, title: null, amount: 1,   budget: 1,    start_time: '09:00:00', end_time: '09:00:00', organization_id: 'o1' },
  { id: '8', completed_on: '2026-03-10', due_on: '2026-03-01', grace_days: -3,   title: 'h', amount: 2,    budget: 1,    start_time: '09:00:00', end_time: '17:00:00', organization_id: 'o1' },
  { id: '9', completed_on: '2026-02-27', due_on: '2026-03-01', grace_days: -3,   title: 'i', amount: 2,    budget: 1,    start_time: '09:00:00', end_time: '17:00:00', organization_id: 'o1' },
];

export const CROSS_FIELD_OFFSET_ROWS: readonly CrossFieldOffsetRow[] = OFFSET_DAYS.map((row) => ({
  ...row,
  completed_at: noon(row.completed_on),
  due_at: noon(row.due_on),
}));

const OFFSET_PAIRS: ReadonlyArray<{ label: string; target: string; base: string }> = [
  { label: 'date', target: 'completed_on', base: 'due_on' },
  { label: 'datetime', target: 'completed_at', base: 'due_at' },
];

/** `{ $field: base, addDays: offset }` — the shape the ruling spelled. */
const shifted = (base: string, offset: unknown) => ({ $field: base, addDays: offset });
const GRACE = { $field: 'grace_days' } as const;

/**
 * The offset expectations, per operator and offset spelling. Each entry is
 * generated for BOTH temporal pairs (`completed_on`/`due_on` and
 * `completed_at`/`due_at`) so the class-independence claim is total, the
 * discipline {@link CROSS_FIELD_CASES} keeps for its three pairs.
 *
 * Rows 6 and 7 (no deadline) are in NO positive set and in EVERY `$not` set —
 * that pair of facts is the NULL-base ruling. Row 4 (NULL grace) sits wherever
 * a zero offset would put it — that is the NULL-offset ruling.
 */
const OFFSET_EXPECTATIONS: ReadonlyArray<{
  name: string;
  build: (target: string, base: string) => unknown;
  expected: string[];
  note?: string;
}> = [
  // ── The ruling's driving shape: on time, with a column offset ─────────────
  {
    name: '$lte with a COLUMN offset — completed <= due + grace_days',
    build: (target, base) => ({ [target]: { $lte: shifted(base, GRACE) } }),
    expected: ['2', '3'],
    note: 'The `duly` shape. Row 2 lands exactly on the last day of grace (equality inside `<=`); row 4 has NULL grace and reads as zero days, so its 03-05 completion is late against 03-01; rows 6 and 7 have no deadline and are FALSE; row 9 was inside its plain due date but a -3 grace pulls the deadline back to 02-26.',
  },
  {
    name: '$lte with a LITERAL offset of 5 days',
    build: (target, base) => ({ [target]: { $lte: shifted(base, 5) } }),
    expected: ['1', '2', '3', '4', '9'],
    note: 'A literal binds where the column would be. Rows 5, 6, 7 stay out (NULL on a side); row 8 (03-10) misses 03-06.',
  },
  {
    name: '$lte with a NEGATIVE literal offset (-1) — the only subtraction there is',
    build: (target, base) => ({ [target]: { $lte: shifted(base, -1) } }),
    expected: ['3', '9'],
    note: 'No `subDays`: a negative integer subtracts. Row 9 (02-27) is on or before 02-28; row 2 (03-03) is not.',
  },
  {
    name: '$lte with a literal offset of 0 — the offset-free control',
    build: (target, base) => ({ [target]: { $lte: shifted(base, 0) } }),
    expected: ['3', '9'],
    note: 'Must equal the bare `{ $field }` case below on every non-NULL row: zero days is no shift. (The NULL rows agree too for an ORDERING; only `$eq`/`$ne` read the NULL rows differently between the bare and the offset arm.)',
  },
  {
    name: 'positive control — the bare reference, no offset, on this fixture',
    build: (target, base) => ({ [target]: { $lte: { $field: base } } }),
    expected: ['3', '9'],
    note: 'The bare cross-field arm, unchanged by the offset: if this moves, the harness moved rather than the offset.',
  },

  // ── The other five operators, with the column offset ──────────────────────
  {
    name: '$lt with a COLUMN offset',
    build: (target, base) => ({ [target]: { $lt: shifted(base, GRACE) } }),
    expected: ['3'],
    note: 'Row 2 sits exactly on the deadline and drops out of the strict form.',
  },
  {
    name: '$gt with a COLUMN offset — late',
    build: (target, base) => ({ [target]: { $gt: shifted(base, GRACE) } }),
    expected: ['1', '4', '8', '9'],
    note: 'The "late" count of the issue. Row 4 is late because NULL grace is zero grace; row 9 is late because negative grace moved the deadline to 02-26.',
  },
  {
    name: '$gte with a COLUMN offset',
    build: (target, base) => ({ [target]: { $gte: shifted(base, GRACE) } }),
    expected: ['1', '2', '4', '8', '9'],
  },
  {
    name: '$eq with a COLUMN offset — completed on the last day of grace exactly',
    build: (target, base) => ({ [target]: { $eq: shifted(base, GRACE) } }),
    expected: ['2'],
    note: 'THE cell that separates the offset arm from the bare one: row 7 (everything NULL) MATCHES a bare `$eq: { $field }` (both-NULL agree) and must NOT match here — a NULL deadline makes the comparison false, by the ruling, rather than NULL-equals-NULL by SQL.',
  },
  {
    name: '$ne with a COLUMN offset',
    build: (target, base) => ({ [target]: { $ne: shifted(base, GRACE) } }),
    expected: ['1', '3', '4', '5', '8', '9'],
    note: 'NOT the complement of `$eq`: rows 6 and 7 have no deadline and are false on BOTH polarities. Row 5 (never completed, deadline exists) IS in the set — the target keeps its ordinary reading, `null != deadline`.',
  },
  {
    name: '$eq with a LITERAL offset of 2',
    build: (target, base) => ({ [target]: { $eq: shifted(base, 2) } }),
    expected: ['2'],
  },
  {
    name: '$ne with a LITERAL offset of 2',
    build: (target, base) => ({ [target]: { $ne: shifted(base, 2) } }),
    expected: ['1', '3', '4', '5', '8', '9'],
  },

  // ── The NULL-base ruling, stated on its own — target and base swapped ──────
  {
    name: 'a NULL referenced column is FALSE even when the target has a value (roles swapped)',
    build: (target, base) => ({ [base]: { $lte: shifted(target, 10) } }),
    expected: ['1', '2', '3', '4', '8', '9'],
    note: '`due <= completed + 10`. Rows 5 and 7 have no `completed` (the referenced base now) and are false; row 6 has no `due` (the target) and fails the ordering as any NULL target does.',
  },
  {
    name: '$ne against a NULL referenced column is FALSE too, while a NULL target satisfies it (roles swapped)',
    build: (target, base) => ({ [base]: { $ne: shifted(target, 10) } }),
    expected: ['1', '2', '3', '4', '6', '8', '9'],
    note: 'Row 6 (NULL target `due`, real base `completed`) is IN — `null != deadline` — and rows 5 and 7 (NULL base) are OUT. The asymmetry is the ruling, not an accident of three-valued logic.',
  },

  // ── `$not` — the predicate is total, so the negation is its exact complement ─
  {
    name: '$not of $lte with a COLUMN offset — the "late or no deadline" set',
    build: (target, base) => ({ $not: { [target]: { $lte: shifted(base, GRACE) } } }),
    expected: ['1', '4', '5', '6', '7', '8', '9'],
    note: 'The complement of {2, 3} over all nine rows. Rows 6 and 7 are re-admitted: the comparison was FALSE for them, not NULL, so `NOT` makes it true — the same shape the NULL-safe `$not` rewrite pins for literal leaves.',
  },
  {
    name: '$not of $eq with a COLUMN offset',
    build: (target, base) => ({ $not: { [target]: { $eq: shifted(base, GRACE) } } }),
    expected: ['1', '3', '4', '5', '6', '7', '8', '9'],
  },
  {
    name: '$not of $ne with a COLUMN offset — re-admits exactly the no-deadline rows and the equal one',
    build: (target, base) => ({ $not: { [target]: { $ne: shifted(base, GRACE) } } }),
    expected: ['2', '6', '7'],
    note: 'A guard that made a NULL base NULL (rather than FALSE) would lose rows 6 and 7 here under `NOT`; a guard hoisted above the leaf would lose them the other way.',
  },

  // ── Combinators ───────────────────────────────────────────────────────────
  {
    name: '$or of an offset comparison and a literal null predicate',
    build: (target, base) => ({ $or: [{ [target]: { $lte: shifted(base, GRACE) } }, { [target]: null }] }),
    expected: ['2', '3', '5', '7'],
  },
  {
    name: 'an offset comparison ANDs with a literal predicate on the offset column',
    build: (target, base) => ({ [target]: { $lte: shifted(base, GRACE) }, grace_days: { $gt: 0 } }),
    expected: ['2'],
    note: 'Row 3 is on time but has zero grace; the conjunction drops it. Everything inside one filter object ANDs.',
  },
  {
    name: 'an offset comparison two combinators deep',
    build: (target, base) => ({
      $and: [{ $or: [{ [target]: { $gt: shifted(base, GRACE) } }, { [target]: null }] }, { $not: { grace_days: null } }],
    }),
    expected: ['1', '5', '8', '9'],
    note: 'Late (1, 4, 8, 9) or never completed (5, 7), minus the NULL-grace rows (4, 7).',
  },
];

export const CROSS_FIELD_OFFSET_CASES: readonly CrossFieldCase[] = OFFSET_PAIRS.flatMap(({ label, target, base }) =>
  OFFSET_EXPECTATIONS.map(({ name, build, expected, note }) => ({
    name: `[addDays] ${name} — on the ${label} pair (${target} / ${base})`,
    filter: build(target, base),
    expected,
    note,
  })),
);

/**
 * The offset refusal arm. Every entry must throw `INVALID_FILTER` / 400 on
 * both SQL drivers, operands withheld from the caller, the naming half in the
 * server log — exactly {@link CROSS_FIELD_REFUSALS}' contract. The offset
 * rides the four #5222 rulings (same-table, declared-only, tenant column
 * forbidden, comparison class) and adds two of its own: day arithmetic applies
 * to a `date` or `datetime` column only, and the offset column is numeric.
 */
export const CROSS_FIELD_OFFSET_REFUSALS: readonly CrossFieldRefusalCase[] = [
  {
    name: '[addDays] an offset on a NUMERIC pair is refused — day arithmetic has no meaning on a number',
    filter: { amount: { $gt: shifted('budget', 1) } },
    diagnosticIncludes: ['addDays', 'date or datetime'],
  },
  {
    name: '[addDays] an offset on a TIME pair is refused — a wall clock has no calendar day to shift',
    filter: { start_time: { $lte: shifted('end_time', 1) } },
    diagnosticIncludes: ['addDays', 'date or datetime'],
  },
  {
    name: '[addDays] a date target against a datetime base is still a cross-class refusal',
    filter: { completed_on: { $lte: shifted('due_at', 1) } },
    diagnosticIncludes: ['stored as'],
    note: 'The class rule is checked BEFORE the offset is read: the offset never widens what compiles.',
  },
  {
    name: '[addDays] a TEXT offset column is refused',
    filter: { completed_on: { $lte: shifted('due_on', { $field: 'title' }) } },
    diagnosticIncludes: ['addDays', 'not a numeric column'],
  },
  {
    name: '[addDays] a DOTTED offset path is refused — same-table columns only, on the offset too',
    filter: { completed_on: { $lte: shifted('due_on', { $field: 'duty.grace_days' }) } },
    diagnosticIncludes: ['addDays', 'dotted path'],
    note: 'The memory evaluator WALKS `duty.grace_days`; SQL push-down refuses it under the 2026-08-06 same-table ruling, loudly — the same deliberate asymmetry the bare reference has.',
  },
  {
    name: '[addDays] an undeclared offset column is refused at compile time',
    filter: { completed_on: { $lte: shifted('due_on', { $field: 'no_such_offset' }) } },
    diagnosticIncludes: ['addDays', 'not a declared field'],
  },
  {
    name: '[addDays] the tenant-isolation column is refused as the offset',
    filter: { completed_on: { $lte: shifted('due_on', { $field: 'organization_id' }) } },
    diagnosticIncludes: ['tenant-isolation column'],
    note: 'A third position for the same privilege-escalation surface; closed like the other two.',
  },
  {
    name: '[addDays] a fractional literal is refused — whole days only',
    filter: { completed_on: { $lte: shifted('due_on', 1.5) } },
    diagnosticIncludes: ['addDays', 'not an integer'],
  },
  {
    name: '[addDays] a string literal is refused — a number is a number',
    filter: { completed_on: { $lte: shifted('due_on', '5') } },
    diagnosticIncludes: ['addDays', 'neither an integer'],
  },
  {
    name: '[addDays] an offset object without $field is refused',
    filter: { completed_on: { $lte: shifted('due_on', { days: 5 }) } },
    diagnosticIncludes: ['addDays', 'neither an integer'],
  },
];

/**
 * [#7929] The operand names the offset refusals can put in a diagnostic — the
 * caller-visible message must contain none of them (see
 * {@link CROSS_FIELD_OPERAND_NAMES} for why `id` is absent).
 */
export const CROSS_FIELD_OFFSET_OPERAND_NAMES: readonly string[] = [
  'completed_on',
  'due_on',
  'completed_at',
  'due_at',
  'grace_days',
  'title',
  'amount',
  'budget',
  'start_time',
  'end_time',
  'organization_id',
  'duty.grace_days',
  'no_such_offset',
];
