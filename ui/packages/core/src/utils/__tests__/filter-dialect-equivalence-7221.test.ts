/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One authored view filter, two lowered dialects — do they select the same rows?
 * The MEASUREMENT objectui#7221 asked for, recorded so the answer cannot drift.
 *
 * objectui#7210 watched one page load of a `type: 'gantt'` list view put two
 * filters on the wire from one authored filter:
 *
 * ```
 * paged      [["visible_from","is_not_null"],["due_date","is_not_null"]]
 * unbounded  ["and",["visible_from","isnotnull",null],["due_date","isnotnull",null]]
 * ```
 *
 * objectui#7221 filed the obvious question — nobody had checked that
 * `['and', A, B]` and `[A, B]` select the same rows through every adapter — and
 * asked for a measurement rather than a repair. This file is the `ValueDataSource`
 * half of that measurement; `data-objectstack/src/filter-dialect-wire-7221.test.ts`
 * is the wire half.
 *
 * ## The answer, in one line — and what became of it
 *
 * MEASURED (objectui#7221, this file as filed): on the card's own filter the two
 * dialects agreed — and they agreed because `matchesASTFilter` evaluated NEITHER
 * of them. Changing the operator to one the in-memory matcher implemented parted
 * them: the flat dialect applied no filter at all while the `and`-wrapped one
 * filtered correctly. So the equivalence the card hoped to establish did NOT hold
 * in general, and the case it was observed on was the accidentally-benign one.
 *
 * REPAIRED (objectui#7349): the matcher now reads the flat implicit-AND array —
 * at top level and as a child of `and` / `or` — and implements the null-ness
 * operators, so the two dialects select the same rows for the right reason. The
 * two `it.fails` cases below became plain `it` in that PR, and the row sets in
 * sections 2 and 3 were RE-MEASURED against the repaired matcher. Each one keeps
 * its pre-repair number in a comment, because those numbers are the evidence
 * objectui#7221's severity was graded on.
 *
 * ## What the flat dialect used to be inert against
 *
 * `matchesASTFilter` (`../../adapters/ValueDataSource.ts`) recognised exactly two
 * node shapes: a logical `['and'|'or', ...children]` head, and a THREE-element
 * comparison `[field, operator, value]`. A legacy flat array of condition nodes —
 * `[[…], […]]`, the implicit-AND shape `toFilterNode` returns for a lone source —
 * matched neither, so it reached the closing `return true` and every row passed.
 * The same fall-through swallowed it as a CHILD of an `and`, which is the shape
 * `ElementDataSourceGate` produces from two surviving sources.
 *
 * Two separate reasons the card's own filter was inert, and both are recorded
 * below: the flat shape was unread AS A SHAPE, and `is_not_null` / `isnotnull`
 * were unimplemented AS OPERATORS (the `switch` had no null-ness arm, so its
 * `default` returned true for the wrapped dialect too).
 *
 * ## Reading a red in this file
 *
 * A case going red means the measured behaviour moved — re-measure before
 * changing the expectation. Note the change of status the repair brought: the two
 * equivalence assertions are now plain `it`, so they are a CONTRACT rather than
 * an observation, and a red there is a regression of objectui#7349.
 *
 * The vocabulary the repair taught the matcher is pinned separately, in
 * `../../adapters/__tests__/ValueDataSource.astFilterVocabulary.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { toFilterNode, mergeFilterNodes } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

/** The authored view filter of the card, as a spec `ViewFilterRule[]`. */
const AUTHORED_RULES = [
  { field: 'visible_from', operator: 'is_not_null' },
  { field: 'due_date', operator: 'is_not_null' },
];

/**
 * Dialect A — the flat, implicit-AND array. What `buildEffectiveFilter` forwards
 * when the authored filter is the only surviving source, and byte-for-byte the
 * `paged` filter objectui#7210 saw.
 */
const DIALECT_A = [
  ['visible_from', 'is_not_null'],
  ['due_date', 'is_not_null'],
];

/**
 * Dialect B — the `and`-wrapped, 3-tuple form, byte-for-byte the `unbounded`
 * filter objectui#7210 saw. Measured provenance (see the wire pin): this is what
 * `@object-ui/data-objectstack` produces from an UNLOWERED `ViewFilterRule[]`,
 * not what `mergeFilterNodes` produces — the `null` slot is `entry.value` being
 * `undefined` and surviving `JSON.stringify` as `null`.
 */
const DIALECT_B = [
  'and',
  ['visible_from', 'isnotnull', null],
  ['due_date', 'isnotnull', null],
];

// ---------------------------------------------------------------------------
// 1. Lowering — what `mergeFilterNodes` actually produces
// ---------------------------------------------------------------------------

describe('objectui#7221 — the lowering, measured rather than assumed', () => {
  it('lowers a ViewFilterRule[] to 2-tuples, inventing no value slot', () => {
    // The card guessed the rules might become 3-tuples with a `null` value slot.
    // They do not: `viewFilterRuleToNode` emits a value only when the rule
    // carries one, and the spec's own canonical spelling `is_not_null` survives.
    expect(toFilterNode(AUTHORED_RULES)).toEqual(DIALECT_A);
  });

  it('passes the already-lowered array through unchanged', () => {
    expect(toFilterNode(DIALECT_A)).toEqual(DIALECT_A);
  });

  it('returns a lone surviving source as-is, so one source reaches the wire FLAT', () => {
    expect(mergeFilterNodes(AUTHORED_RULES)).toEqual(DIALECT_A);
    expect(mergeFilterNodes(undefined, AUTHORED_RULES)).toEqual(DIALECT_A);
    expect(mergeFilterNodes(DIALECT_A, undefined)).toEqual(DIALECT_A);
  });

  it('wraps the authored array WHOLE as one child — one source, not one per rule', () => {
    // This is the shape `ElementDataSourceGate` hands the gantt when both the
    // element's own filter and the composed view/binding filter survive. The
    // authored array stays a single nested child; it is NOT spread.
    expect(mergeFilterNodes(DIALECT_A, ['owner', '=', 'me'])).toEqual([
      'and',
      DIALECT_A,
      ['owner', '=', 'me'],
    ]);
  });

  it('never produces dialect B — that spelling is not this function’s', () => {
    // Two surviving sources or one, the `isnotnull` spelling and the `null` value
    // slot never appear. The card attributed dialect B to `mergeFilterNodes`;
    // the measurement puts it at the adapter instead.
    const twoSources = JSON.stringify(mergeFilterNodes(AUTHORED_RULES, ['owner', '=', 'me']));
    const oneSource = JSON.stringify(mergeFilterNodes(AUTHORED_RULES));
    expect(twoSources).not.toContain('isnotnull');
    expect(oneSource).not.toContain('isnotnull');
    expect(JSON.stringify(DIALECT_B)).toContain('isnotnull');
  });
});

// ---------------------------------------------------------------------------
// 2. Row sets — the card's own filter, every edge value
// ---------------------------------------------------------------------------

/** One row per edge value, plus a row that carries no keys at all. */
const EDGE_VALUES: Array<readonly [string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['empty-string', ''],
  ['zero', 0],
  ['false', false],
  ['NaN', NaN],
  ['array', []],
  ['object', {}],
  ['real', '2026-01-01'],
];

const EDGE_ROWS: Array<Record<string, unknown>> = [
  ...EDGE_VALUES.map(([id, value]) => ({ id, visible_from: value, due_date: value })),
  { id: 'missing-key' },
];

const ALL_EDGE_IDS = EDGE_ROWS.map((r) => r.id as string);

/**
 * What both dialects keep once the null-ness operators are IMPLEMENTED
 * (objectui#7349): every edge value that is neither `null` nor `undefined`
 * survives `is_not_null` — `''`, `0` and `false` included, since the operator
 * asks about PRESENCE and not about truthiness — while the `null` row, the
 * `undefined` row and the row carrying no such key are excluded.
 *
 * RE-MEASURED (objectui#9175): `NaN` is now KEPT, and the move is in the clone
 * rather than in the matcher. `ValueDataSource`'s constructor used to
 * deep-clone its items with `JSON.parse(JSON.stringify(items))`, and
 * `JSON.stringify` writes `NaN` as `null` — so by the time any filter ran, that
 * row genuinely held `null` and `is_not_null` excluded it. The round-trip was
 * an accident of the clone, not a reading of the operator; this file said so
 * when it first recorded the exclusion, and objectui#9175 replaced the clone
 * with `structuredClone`. `NaN` reaches the matcher as `NaN`, which is neither
 * `null` nor `undefined`, so the PRESENCE operator keeps it. The old row set is
 * kept in this comment because it is the evidence the exclusion was never the
 * operator's doing.
 *
 *   before objectui#9175  ['empty-string', 'zero', 'false', 'array', 'object', 'real']
 *   after                 the same, plus 'NaN'
 *
 * The `undefined` row and the `missing-key` row are still both excluded, but no
 * longer for one shared reason: the round-trip used to DELETE an `undefined`
 * value's key, collapsing the two rows into the same shape. `structuredClone`
 * keeps the key with its `undefined` value, so the two rows now differ — and
 * `is_not_null` answers NO to both, which is what the operator is for.
 */
const PRESENT_EDGE_IDS = ['empty-string', 'zero', 'false', 'NaN', 'array', 'object', 'real'];

async function selectedIds(
  filter: unknown,
  rows: Array<Record<string, unknown>> = EDGE_ROWS,
): Promise<string[]> {
  const ds = new ValueDataSource({ items: rows });
  const result = await ds.find('tasks', { $filter: filter as any });
  return result.data.map((r) => r.id as string);
}

describe('objectui#7221 — row sets through ValueDataSource, the card’s filter', () => {
  it('dialect A excludes exactly the rows the filter exists to exclude', async () => {
    // BEFORE objectui#7349 this was ALL_EDGE_IDS: a flat array was not a shape
    // `matchesASTFilter` read, so nothing was excluded — not the null row, not
    // the row that has no such key.
    expect(await selectedIds(DIALECT_A)).toEqual(PRESENT_EDGE_IDS);
  });

  it('dialect B selects the same rows — and now for the same reason', async () => {
    // BEFORE objectui#7349 this was ALL_EDGE_IDS too, but for a DIFFERENT reason
    // than dialect A: path B's shape WAS read (`and` recurses, each child is a
    // 3-element comparison node) and it was the OPERATOR that was unimplemented —
    // the `switch` had no `isnotnull` arm and its `default` returned true.
    expect(await selectedIds(DIALECT_B)).toEqual(PRESENT_EDGE_IDS);
  });

  it('so the two dialects agree here — now at the SAME APPLIED filter', async () => {
    expect(await selectedIds(DIALECT_A)).toEqual(await selectedIds(DIALECT_B));
  });

  it('and they no longer agree at "no filter applied", which is what changed', async () => {
    // `ALL_EDGE_IDS` was the measured answer for BOTH dialects before
    // objectui#7349, so naming it here keeps the regression visible: a return
    // of the fall-through to `true` takes exactly this shape. The repaired
    // matcher only ever EXCLUDES rows, so the kept set stays a subset.
    expect(await selectedIds(DIALECT_A)).not.toEqual(ALL_EDGE_IDS);
    expect(await selectedIds(DIALECT_B)).not.toEqual(ALL_EDGE_IDS);
    expect(PRESENT_EDGE_IDS.every((id) => ALL_EDGE_IDS.includes(id))).toBe(true);
  });

  it('the null-ness operators never read their value slot, in any spelling', async () => {
    // The card asked specifically whether the matcher reads the value slot for
    // the null-ness operators. It does not — and since objectui#7349 that is a
    // real answer rather than an artefact of never reaching the value at all.
    // Filler, `null`, or an absent slot: same rows.
    //
    // BEFORE objectui#7349 every line below was `['null-row', 'real-row']` —
    // the whole set, i.e. no filter applied in any spelling.
    const rows = [
      { id: 'null-row', visible_from: null },
      { id: 'real-row', visible_from: '2026-01-01' },
    ];
    const onlyReal = ['real-row'];
    expect(await selectedIds(['visible_from', 'isnotnull', null], rows)).toEqual(onlyReal);
    expect(await selectedIds(['visible_from', 'isnotnull', 'FILLER'], rows)).toEqual(onlyReal);
    expect(await selectedIds(['visible_from', 'is_not_null'], rows)).toEqual(onlyReal);
    expect(await selectedIds(['and', ['visible_from', 'isnotnull', null]], rows)).toEqual(onlyReal);
  });
});

// ---------------------------------------------------------------------------
// 3. Row sets — where the two dialects part
// ---------------------------------------------------------------------------

/** Three rows and an operator pair `matchesASTFilter` genuinely implements. */
const CONTROL_ROWS = [
  { id: 'a', role: 'admin', age: 30 },
  { id: 'b', role: 'user', age: 25 },
  { id: 'c', role: 'admin', age: 20 },
];

/** Dialect A's shape, carrying operators the matcher implements. */
const CONTROL_A = [
  ['role', '=', 'admin'],
  ['age', '>', 24],
];

/** Dialect B's shape, same two conditions. */
const CONTROL_B = ['and', ['role', '=', 'admin'], ['age', '>', 24]];

/** The gate's two-source output: an authored array nested inside an `and`. */
const CONTROL_GATE_TWO_SOURCE = ['and', CONTROL_A, ['id', '!=', 'zzz']];

/** The same three conditions with nothing nested — what the gate would emit if it spread. */
const CONTROL_GATE_FLATTENED = ['and', ['role', '=', 'admin'], ['age', '>', 24], ['id', '!=', 'zzz']];

describe('objectui#7221 — the dialects on an operator the matcher implements', () => {
  it('dialect A’s shape applies the filter — one row of three', async () => {
    // BEFORE objectui#7349: ['a', 'b', 'c'] — no filter applied at all.
    expect(await selectedIds(CONTROL_A, CONTROL_ROWS)).toEqual(['a']);
  });

  it('a single-rule flat array filters too — it was the SHAPE, not the count', async () => {
    // BEFORE objectui#7349: ['a', 'b', 'c'].
    expect(await selectedIds([['role', '=', 'admin']], CONTROL_ROWS)).toEqual(['a', 'c']);
  });

  it('dialect B’s shape filters correctly — one row of three', async () => {
    expect(await selectedIds(CONTROL_B, CONTROL_ROWS)).toEqual(['a']);
  });

  it('the gate’s two-source shape keeps its nested authored rules', async () => {
    // BEFORE objectui#7349 only the sibling tuple child was evaluated and the
    // nested flat child was swallowed by the fall-through, so the first line
    // was ['a', 'b', 'c'] while the second was already ['a'].
    expect(await selectedIds(CONTROL_GATE_TWO_SOURCE, CONTROL_ROWS)).toEqual(['a']);
    expect(await selectedIds(CONTROL_GATE_FLATTENED, CONTROL_ROWS)).toEqual(['a']);
  });

  it(
    'the two dialects select the same rows — repaired — objectui#7349',
    async () => {
      // Was `it.fails`: dialect A returned a,b,c while dialect B returned a.
      // objectui#7349 taught `matchesASTFilter` to read the flat form, so both
      // return a and this is now an ordinary passing contract.
      expect(await selectedIds(CONTROL_A, CONTROL_ROWS))
        .toEqual(await selectedIds(CONTROL_B, CONTROL_ROWS));
    },
  );

  it(
    'nesting an authored array under `and` preserves its rules — repaired — objectui#7349',
    async () => {
      // The gate's own output versus the same conditions unnested. Was
      // `it.fails`; the nested child is evaluated since objectui#7349.
      expect(await selectedIds(CONTROL_GATE_TWO_SOURCE, CONTROL_ROWS))
        .toEqual(await selectedIds(CONTROL_GATE_FLATTENED, CONTROL_ROWS));
    },
  );
});
