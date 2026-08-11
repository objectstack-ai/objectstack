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
 * The refusal arm — the boundary of v1, and the half of this issue that is a
 * SECURITY surface rather than a capability one.
 *
 * Every entry must throw `INVALID_FILTER` / 400 (ADR-0112) on BOTH SQL
 * drivers. `messageIncludes` pins the part of the wording a caller needs to
 * act on; the tests assert the envelope regardless.
 *
 * Read this table together with {@link CROSS_FIELD_CASES}: what makes the
 * refusals defensible is that the supported arm above is proven equivalent, so
 * the line between them is drawn at "cannot be proven equivalent", not at
 * "was not attempted".
 */
export interface CrossFieldRefusalCase {
  name: string;
  filter: unknown;
  /** Substrings the refusal message must contain. */
  messageIncludes: string[];
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
    messageIncludes: ['dotted path', 'same-table'],
    note: 'Maintainer ruling (2026-08-06) point 1 = A: no JOIN planning (disproportionate) and no alias-qualified columns (no alias contract). The memory evaluator DOES walk the path, so this is a deliberate, loudly-reported asymmetry rather than a silent one.',
  },
  {
    name: 'a dotted path is refused even when its head names a real column',
    filter: { amount: { $gt: { $field: 'budget.nested' } } },
    messageIncludes: ['dotted path'],
    note: 'The refusal is on the SHAPE, not on whether the first segment happens to resolve — otherwise the check would depend on data the compiler cannot see.',
  },

  // ── Ruling 2: declared-only enumeration ──────────────────────────────────
  {
    name: 'an undeclared column is refused at compile time',
    filter: { amount: { $gt: { $field: 'no_such_column' } } },
    messageIncludes: ['not a declared field'],
    note: 'The `$field` value lands in a SQL IDENTIFIER position. cloud#1051: letting it through unchecked is dismantling the guard rail — and a compile-time refusal is what makes AI-authored metadata wrong at authoring time rather than in the database.',
  },
  {
    name: 'an undeclared TARGET field is refused too',
    filter: { no_such_column: { $gt: { $field: 'budget' } } },
    messageIncludes: ['not a declared field'],
    note: 'A comparison is one surface — validating only the referent would leave half of it unchecked, and the type-class rule below needs both declarations anyway.',
  },

  // ── Ruling 2, the security half: the tenant-isolation column ─────────────
  {
    name: 'the tenant-isolation column is refused as the REFERENT',
    filter: { stage: { $eq: { $field: 'organization_id' } } },
    messageIncludes: ['tenant-isolation column'],
    note: 'The named ruling. A comparison against the isolation column is a privilege-escalation comparison surface: it lets a filter probe the tenant boundary the driver injects rather than being scoped by it.',
  },
  {
    name: 'the tenant-isolation column is refused as the TARGET',
    filter: { organization_id: { $eq: { $field: 'stage' } } },
    messageIncludes: ['tenant-isolation column'],
    note: 'Closed because the operands of `=` COMMUTE — a ban that a swap of the two sides walks around is not a ban. Ruling names the referent; this is the same surface spelled backwards.',
  },

  // ── The conformance boundary: comparison CLASS ───────────────────────────
  {
    name: 'a TEXT column compared to a numeric column is refused (the measured divergence)',
    filter: { stage: { $gt: { $field: 'amount' } } },
    messageIncludes: ['stored as'],
    note: 'THE case that proves the class check is load-bearing, and it is directional. Measured with the check disabled: SQLite answers rows 1,2,3,5 — it orders by STORAGE CLASS first, so every TEXT sorts above every INTEGER — while the in-memory evaluator answers NONE, because JS coerces `"won" > 10` to a NaN comparison. Four rows of difference on one filter.',
  },
  {
    name: 'a numeric column compared to a text column is refused (the mirrored spelling)',
    filter: { amount: { $gt: { $field: 'stage' } } },
    messageIncludes: ['stored as'],
    note: 'The mirror of the case above, and measured to AGREE (both answer nothing) — kept in the refusal arm anyway, because a guard that admitted exactly the pairings one fixture measured as agreeing would be a rule about this data rather than about the types.',
  },
  {
    name: 'a date column compared to a text column is refused',
    filter: { starts_on: { $gt: { $field: 'stage' } } },
    messageIncludes: ['stored as'],
    note: 'Both are TEXT physically, so this one WOULD have compiled — and measured, both paths agree. It is refused because they agree by lexicographic accident rather than by any temporal reading, which is also why the class check reads declared TYPES rather than physical affinity.',
  },
  {
    name: 'a numeric column compared to a date column is refused',
    filter: { amount: { $gt: { $field: 'starts_on' } } },
    messageIncludes: ['stored as'],
  },

  // ── Columns with no scalar stored form ──────────────────────────────────
  {
    name: 'a multi-valued (JSON) column is refused as the referent',
    filter: { amount: { $gt: { $field: 'tags' } } },
    messageIncludes: ['no scalar stored'],
    note: 'A JSON column holds a serialized array; SQL comparison operators have no element-wise reading of it, and #7398 already refuses the scalar operators on such a column for a value comparand.',
  },
  {
    name: 'a formula (virtual) column is refused as the referent',
    filter: { amount: { $gt: { $field: 'projected_total' } } },
    messageIncludes: ['no scalar stored'],
    note: 'A formula field is virtual — `createColumn` emits no column at all, so there is nothing to reference. Declared-only enumeration alone would have ADMITTED it, which is why the class check is a second gate rather than a restatement of the first.',
  },

  // ── List positions — refused, and NOT merely unimplemented ──────────────
  //
  // The memory evaluator does not resolve a `{ $field }` INSIDE a list either:
  // `resolveValue` returns an array unchanged, so `$in`/`$nin` compare against
  // the raw reference OBJECT (never equal to a stored value) and `$between`
  // orders against it. There is therefore no correct in-memory semantics for
  // SQL to be equivalent TO — refusing is the only answer that is not a guess,
  // and the spec's declaration of `FieldReferenceSchema` in the `$between`
  // endpoints is filed as its own finding rather than being resolved here.
  {
    name: 'a $field member of an $in list is refused',
    filter: { amount: { $in: [{ $field: 'budget' }, 1] } },
    messageIncludes: ['index 0'],
    note: 'Before #5041 this did not even crash: it compiled, ran, and returned ZERO ROWS. The index is named because it is the only thing distinguishing the bad member from its legitimate neighbours.',
  },
  {
    name: 'a $field member of a $nin list is refused',
    filter: { amount: { $nin: [{ $field: 'budget' }] } },
    messageIncludes: ['index 0'],
    note: 'The $nin direction is the dangerous one — a lost member drops an EXCLUSION the caller wrote, widening the result set.',
  },
  {
    name: 'a $field lower bound of a $between is refused',
    filter: { amount: { $between: [{ $field: 'budget' }, 100] } },
    messageIncludes: ['index 0'],
  },
  {
    name: 'a $field upper bound of a $between is refused',
    filter: { amount: { $between: [0, { $field: 'budget' }] } },
    messageIncludes: ['index 1'],
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
    messageIncludes: ['$field'],
    note: 'v1 refusal: a column-side LIKE pattern cannot be metacharacter-escaped portably, and an unescaped one is the `%`-matches-every-row bypass.',
  },
  {
    name: '$contains against a field reference is refused',
    filter: { stage: { $contains: { $field: 'owner' } } },
    messageIncludes: ['$field'],
  },
  {
    name: '$endsWith against a field reference is refused',
    filter: { stage: { $endsWith: { $field: 'owner' } } },
    messageIncludes: ['$field'],
  },
  {
    name: '$notContains against a field reference is refused',
    filter: { stage: { $notContains: { $field: 'owner' } } },
    messageIncludes: ['$field'],
  },
  {
    name: '$icontains against a field reference is refused',
    filter: { stage: { $icontains: { $field: 'owner' } } },
    messageIncludes: ['$field'],
  },
] as const;
