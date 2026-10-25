/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The value-input gate reads the operator through the same fold the rest of
 * this component already uses, so BOTH spellings of one value-less operator
 * draw the SAME row (objectui#9302).
 *
 * ## The one site
 *
 * `needsValueInput` did a raw `has()` against
 * `VALUELESS_FILTER_BUILDER_OPERATORS`, whose members are this builder's six
 * camelCase dropdown ids. A row carrying the spec's canonical spelling
 * (`is_null`) missed the set and was treated as value-taking, so it drew a
 * value box next to a trigger that reads `Is null` — two spellings of ONE
 * operator drawing two different rows.
 *
 * This is the same CLASS as objectui#7561 and not the same site: that card
 * repaired the operator trigger's identity comparison, this is the value-input
 * gate. The component already imports `normalizeFilterOperator` and already
 * folds through it in `filterValueArity` and `reconcileOperatorForField`, so
 * the repair is one more site joining a fold this file already performs.
 *
 * ## What the repair deliberately does NOT do (the PM ruling on this card)
 *
 *   - ⛔ the EXPORTED set is not widened. Its stated job is *which rows this
 *     builder leaves value-less* — a fact about the dropdown's own six ids —
 *     and two other layers read it: `plugin-list`'s `convertFilterGroupToAST`
 *     (what the live grid QUERIES) and `app-shell`'s
 *     `foldFilterGroupToSpecRules` (what a saved view PERSISTS, documented as
 *     this set PLUS the canonical spellings only that layer sees). Widening
 *     here would make another layer's deliberate compensation redundant by
 *     side effect, in a file nobody is editing.
 *   - ⛔ no row's stored `operator` is rewritten; rendering is not an edit.
 *   - ⛔ no second spelling joins the dropdown; the emitted vocabulary is
 *     unchanged.
 *
 * ⛔ Out of scope, and untouched here: WHICH operator vocabulary wins
 * (objectui#7561's open question, filed as decision card objectui#9306). It
 * carries a hard constraint recorded on objectui#7379 — `AST_OPERATOR_MAP`
 * holds that `contains` / `icontains` "must never be folded onto" each other,
 * "That is a semantic boundary, not two spellings of one thing." The boundary
 * guard below pins that the fold this repair routes through does not cross it.
 *
 * ## DIRECTION, predicted before running
 *
 * On the unmodified tree every spelling of a value-less operator that is NOT
 * literally a member of the exported set is RED — each draws 1 value input
 * where 0 is required. ⛔ That population is not written down here: the derived
 * table below walks `VIEW_FILTER_OPERATORS` and `VIEW_FILTER_OPERATOR_ALIASES`
 * and `--reporter=verbose` names each row it measured. Writing the count down
 * is what went wrong the first time — the literal table named the canonical
 * spellings and missed the all-lowercase alias rows, which move exactly the
 * same way and had nothing pinning them — the first pass of this pin, on the
 * branch that adds it, made exactly that mistake.
 *
 * Everything else is GREEN in both directions and is carried for a named
 * reason, not for coverage:
 *
 *   - the six DROPDOWN ids draw 0 today and must keep drawing 0 — the
 *     over-reach guard. A repair that folded only one direction, or that
 *     replaced the set's members with canonical spellings, moves these;
 *   - `equals` is the FIRING CONTROL. It really does take a value and must
 *     draw exactly 1 both before and after. Without it "0 inputs everywhere"
 *     and a broken renderer are the same reading;
 *   - `exists` / `notExists` are builder-only ids with no canonical twin in
 *     the spec's vocabulary, so the fold returns them verbatim. They pin that
 *     routing the lookup through the fold did not drop the two members that
 *     have nothing to fold to.
 *
 * ## After objectui#9306
 *
 * The dropdown's ids — and so the exported set's members — are now the
 * canonical spellings, and the former camelCase ids are the deprecated alias
 * form a stored filter may still carry. The gate is unchanged (it folds the
 * row's spelling before the lookup), so the table below reads the same; only
 * which spelling plays "the dropdown's own id" and which plays "the other
 * spelling" swapped. The rows are relabelled to say so.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  normalizeFilterOperator,
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
} from '@objectstack/spec/ui';
import {
  FilterBuilder,
  VALUELESS_FILTER_BUILDER_OPERATORS,
} from '../custom/filter-builder';

/** One `text` column — the card's reproduction shape. */
const FIELDS = [{ value: 'title', label: 'Title', type: 'text' }];

/**
 * One condition row. `value: ''` is the seed `addCondition` writes and what a
 * row still carries after the operator dropdown is changed, i.e. the exact
 * state the panel holds while the user edits.
 *
 * The `value` prop is hoisted out of the JSX because the builder re-seeds its
 * internal state when that prop's IDENTITY changes.
 */
function renderRow(operator: string, extraOperators: readonly string[] = []) {
  const onChange = vi.fn();
  const value = {
    id: 'root',
    logic: 'and',
    conditions: [{ id: 'c1', field: 'title', operator, value: '' }],
  };
  const utils = render(
    <FilterBuilder
      fields={FIELDS as never}
      value={value as never}
      onChange={onChange}
      extraOperators={extraOperators}
    />,
  );
  return { ...utils, onChange };
}

/**
 * The value input is the only `<input>` the row draws — the field and operator
 * pickers are Radix selects, i.e. buttons. Counting elements rather than
 * matching a placeholder keeps this independent of the active locale.
 */
const valueInputCount = (container: HTMLElement) => container.querySelectorAll('input').length;

/** What the operator trigger DISPLAYS — the label the stray box contradicts. */
const operatorTriggerText = () => screen.getAllByRole('combobox')[1].textContent;

/**
 * The card's acceptance table, measured through the real `FilterBuilder`.
 *
 * `dialect` is load-bearing for reading a failure, not decoration:
 *   - `dropdown` — one of this builder's own ids, i.e. a member of the
 *     exported set: the spec's canonical spelling since objectui#9306. 0
 *     inputs: the over-reach guard;
 *   - `deprecated` — the dropdown's former camelCase id for the SAME operator,
 *     which a filter stored before objectui#9306 carries. Not a member of the
 *     exported set, so it draws 0 only because the gate folds: the firing
 *     cases (before objectui#9302 it was the canonical spelling that played
 *     this part);
 *   - `control` — really does take a value. 1 input in both directions.
 */
const ROWS: ReadonlyArray<{
  operator: string;
  label: string;
  inputs: number;
  dialect: 'dropdown' | 'deprecated' | 'control';
  /** `OPT_IN_OPERATORS` ids the consumer must grant before they are mounted. */
  extraOperators?: readonly string[];
}> = [
  { operator: 'isNull', label: 'Is null', inputs: 0, dialect: 'deprecated' },
  { operator: 'is_null', label: 'Is null', inputs: 0, dialect: 'dropdown' },
  { operator: 'isNotNull', label: 'Is not null', inputs: 0, dialect: 'deprecated' },
  { operator: 'is_not_null', label: 'Is not null', inputs: 0, dialect: 'dropdown' },
  { operator: 'isEmpty', label: 'Is empty', inputs: 0, dialect: 'deprecated' },
  { operator: 'is_empty', label: 'Is empty', inputs: 0, dialect: 'dropdown' },
  { operator: 'isNotEmpty', label: 'Is not empty', inputs: 0, dialect: 'deprecated' },
  { operator: 'is_not_empty', label: 'Is not empty', inputs: 0, dialect: 'dropdown' },
  // No canonical twin exists for these two — the spec's vocabulary has no
  // `exists` member and its alias table deliberately has no row for one.
  //
  // They are `OPT_IN_OPERATORS` (objectui#4736), so a consumer that does not
  // grant them never mounts their `SelectItem` and the trigger reads blank.
  // Granting them here is what makes this a reading about the value gate
  // rather than about the opt-in gate — measured: without the grant the
  // trigger is `''`, which is the documented opt-in behaviour and not a defect.
  {
    operator: 'exists',
    label: 'Is set',
    inputs: 0,
    dialect: 'dropdown',
    extraOperators: ['exists', 'notExists'],
  },
  {
    operator: 'notExists',
    label: 'Is not set',
    inputs: 0,
    dialect: 'dropdown',
    extraOperators: ['exists', 'notExists'],
  },
  // THE FIRING CONTROL, in the same render as the rest.
  { operator: 'equals', label: 'Equals', inputs: 1, dialect: 'control' },
];

/**
 * ## The DERIVED table — the instrument, not a second literal list
 *
 * `ROWS` above is a hand-written table, and a hand-written table is exactly how
 * a spelling goes unmeasured: the first pass of this pin, on the branch that
 * adds it, named four canonical rows and stopped there, while the repair moves
 * every spelling the spec publishes for those operators. So the row set below
 * is not listed — it is re-derived on every run from the two published tables,
 * and whatever they hold on the day of the run is what gets measured.
 *
 *   - `VIEW_FILTER_OPERATORS` — the spec's canonical vocabulary. Intersected
 *     with the exported set folded onto it, this yields the canonical spellings
 *     THIS builder leaves value-less. Nothing here decides which those are; the
 *     builder's own export does, and the fold carries it across.
 *   - `VIEW_FILTER_OPERATOR_ALIASES` — every other spelling the spec accepts
 *     for one of those canonical members. The camelCase rows of this table
 *     were the builder's own dropdown ids until objectui#9306 and are the
 *     deprecated spellings a stored filter may still carry; the rest (today:
 *     the all-lowercase rows) are spellings no literal table here ever named.
 *
 * ⛔ Do not replace this with the list it currently produces. The count is not
 * written down anywhere in this file on purpose — `--reporter=verbose` names
 * each case it ran, and the guards below fail rather than run zero cases.
 */
const foldedExportedSet: ReadonlySet<string> = new Set(
  [...VALUELESS_FILTER_BUILDER_OPERATORS].map(normalizeFilterOperator),
);

/** The canonical spellings this builder leaves value-less — derived, not listed. */
const CANONICAL_VALUELESS: readonly string[] = (
  VIEW_FILTER_OPERATORS as readonly string[]
).filter((op) => foldedExportedSet.has(op));

/**
 * The dropdown id that folds onto a canonical spelling — that row's TWIN, and
 * the anchor each derived case is read against. `exists` / `notExists` have no
 * canonical member to fold to, so they never appear here; they stay in `ROWS`.
 */
const dropdownTwin = (canonical: string): string | undefined =>
  [...VALUELESS_FILTER_BUILDER_OPERATORS].find(
    (id) => normalizeFilterOperator(id) === canonical,
  );

/** Every spelling the spec publishes for one of those operators. */
const SPEC_SPELLINGS: ReadonlyArray<{
  spelling: string;
  canonical: string;
  dialect: 'canonical' | 'alias(dropdown id)' | 'alias';
}> = [
  ...CANONICAL_VALUELESS.map(
    (canonical) => ({ spelling: canonical, canonical, dialect: 'canonical' }) as const,
  ),
  ...Object.entries(VIEW_FILTER_OPERATOR_ALIASES)
    .filter(([, canonical]) => CANONICAL_VALUELESS.includes(canonical))
    .map(([spelling, canonical]) => ({
      spelling,
      canonical: canonical as string,
      dialect: VALUELESS_FILTER_BUILDER_OPERATORS.has(spelling)
        ? ('alias(dropdown id)' as const)
        : ('alias' as const),
    })),
];

describe('objectui#9302 — every spelling the spec publishes for these operators, derived', () => {
  it.each(SPEC_SPELLINGS)(
    '$dialect `$spelling` folds to `$canonical` and draws its twin row with 0 value inputs',
    ({ spelling, canonical }) => {
      const twin = dropdownTwin(canonical);
      expect(twin, `no dropdown id folds onto \`${canonical}\``).toBeDefined();

      // The twin is this reading's anchor, so read it first and refuse a
      // degenerate one: a BLANK trigger, or one echoing the raw id, would make
      // "draws the same row" vacuously true for every spelling at once.
      const twinRender = renderRow(twin as string);
      const twinTrigger = operatorTriggerText();
      expect(twinTrigger, `the twin \`${twin}\` drew a blank trigger`).toMatch(/\S/);
      expect(twinTrigger, `the twin \`${twin}\` echoed its raw id`).not.toBe(twin);
      expect(valueInputCount(twinRender.container)).toBe(0);
      cleanup();

      const { container } = renderRow(spelling);
      expect(operatorTriggerText()).toBe(twinTrigger);
      expect(
        valueInputCount(container),
        `the builder drew ${valueInputCount(container)} value input(s) for "${spelling}" `
          + `but the row reads "${twinTrigger}". Two spellings of one operator must draw one row`,
      ).toBe(0);
    },
  );

  it('⛔ the derived table is not vacuous, and it reaches past the literal one', () => {
    // An `it.each` over an empty or mis-derived array runs ZERO cases and is
    // green, so the derivation is guarded here rather than trusted. These are
    // FLOORS, deliberately not a census — they fail when the derivation breaks
    // and stay quiet when the spec grows a spelling (which is the point).
    expect(CANONICAL_VALUELESS.length).toBeGreaterThanOrEqual(4);
    expect(SPEC_SPELLINGS.length).toBeGreaterThan(CANONICAL_VALUELESS.length);

    // Every canonical row has a twin to be read against and at least one alias,
    // so no canonical is measured alone and no case silently skips its anchor.
    for (const canonical of CANONICAL_VALUELESS) {
      expect(dropdownTwin(canonical), canonical).toBeDefined();
      expect(
        SPEC_SPELLINGS.filter((r) => r.dialect !== 'canonical' && r.canonical === canonical).length,
        canonical,
      ).toBeGreaterThanOrEqual(1);
    }

    // The instrument reaches spellings `ROWS` never named — the gap this pin's
    // own first pass left. Without this the derived table could quietly shrink
    // to the literal one and still be green.
    const literal = new Set(ROWS.map((r) => r.operator));
    const beyond = SPEC_SPELLINGS.filter((r) => !literal.has(r.spelling));
    expect(beyond.length, 'the derived table adds nothing over the literal one').toBeGreaterThanOrEqual(4);

    // …and it never drifts BEHIND it: every literal row the spec knows is
    // derived too, so the two tables cannot disagree about a shared spelling.
    const derived = new Set(SPEC_SPELLINGS.map((r) => r.spelling));
    for (const op of literal) {
      const specKnows =
        (VIEW_FILTER_OPERATORS as readonly string[]).includes(op)
        || Object.prototype.hasOwnProperty.call(VIEW_FILTER_OPERATOR_ALIASES, op);
      if (specKnows && foldedExportedSet.has(normalizeFilterOperator(op))) {
        expect(derived.has(op), op).toBe(true);
      }
    }
  });
});

describe('objectui#9302 — one operator, one row, whichever spelling it arrives in', () => {
  it.each(ROWS)(
    '$dialect `$operator` draws "$label" and $inputs value input(s)',
    ({ operator, label, inputs, extraOperators }) => {
      const { container } = renderRow(operator, extraOperators);
      // Read the trigger in the same render: a row that draws no value input
      // under a BLANK trigger is a different (and worse) outcome than the one
      // this card asks for, and only reading both can tell them apart.
      expect(operatorTriggerText()).toBe(label);
      expect(
        valueInputCount(container),
        `the builder drew ${valueInputCount(container)} value input(s) for "${operator}" `
          + `but the row reads "${label}". Two spellings of one operator must draw one row`,
      ).toBe(inputs);
    },
  );

  it('the firing cases really can fire — they are outside the exported set', () => {
    // The instrument standard: a table built only on spellings the raw `has()`
    // already matched would be green before ANY fix and would measure nothing.
    //
    // Read off the DERIVED table, not a literal one, so the answer to "which
    // rows actually fire" comes from the published tables too. The firing rows
    // are exactly those the raw `has()` could not match literally — today that
    // is every canonical member plus every alias that is not itself a dropdown
    // id (the first pass of this pin saw only half of them).
    const firing = SPEC_SPELLINGS.filter(
      (r) => !VALUELESS_FILTER_BUILDER_OPERATORS.has(r.spelling),
    );
    expect(firing.length).toBeGreaterThan(CANONICAL_VALUELESS.length);
    for (const row of firing) {
      // Not a member — so the raw lookup could not have matched it literally…
      expect(VALUELESS_FILTER_BUILDER_OPERATORS.has(row.spelling), row.spelling).toBe(false);
      // …and it folds ONTO a member, which is what makes the repair reach it.
      expect(foldedExportedSet.has(normalizeFilterOperator(row.spelling)), row.spelling).toBe(true);
    }
    // …and the control is in neither, which is why it keeps its input.
    expect(VALUELESS_FILTER_BUILDER_OPERATORS.has('equals')).toBe(false);
    expect(normalizeFilterOperator('equals')).toBe('equals');
    expect(foldedExportedSet.has(normalizeFilterOperator('equals'))).toBe(false);
  });
});

describe('objectui#9302 — ⛔ the repair moves nothing but the gate', () => {
  it('the EXPORTED set keeps its dropdown-only membership', () => {
    // Acceptance criterion 3: the set states what the DROPDOWN draws, one id
    // per operator, and is not widened with other spellings — the gate folds
    // instead. Since objectui#9306 the dropdown's ids are the canonical
    // spellings, so the six members are those; the deprecated camelCase ids
    // are NOT members (a second spelling in a published set is exactly the
    // second vocabulary that ruling refuses). It fails for a repair that
    // widened the export instead of folding at the gate.
    expect([...VALUELESS_FILTER_BUILDER_OPERATORS].sort()).toEqual([
      'exists',
      'is_empty',
      'is_not_empty',
      'is_not_null',
      'is_null',
      'notExists',
    ]);
  });

  it.each(['is_null', 'isNull'])('a row spelled `%s` is not migrated on render', (operator) => {
    // Rendering is not an edit. A "repair" that rewrote the stored id to the
    // dropdown's spelling would also make the table above green, and would be
    // the wrong fix — it changes what a saved view carries.
    const { onChange } = renderRow(operator);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an unknown operator still draws a value input', () => {
    // The gate's default must stay "takes a value". A fold that swallowed
    // unknown spellings into the value-less set would hide the input on a row
    // nobody can then fill in — the objectui#4744 failure, inverted.
    expect(normalizeFilterOperator('totally_unknown')).toBe('totally_unknown');
    const { container } = renderRow('totally_unknown');
    expect(valueInputCount(container)).toBe(1);
  });
});

describe('objectui#9302 — ⛔ the fold does not cross the `contains` boundary', () => {
  it('`contains` and `icontains` are not folded onto each other', () => {
    // objectui#7379 / objectstack#7536: `AST_OPERATOR_MAP` holds that these
    // "must never be folded onto" each other — "That is a semantic boundary,
    // not two spellings of one thing." The gate now routes through
    // `normalizeFilterOperator`, so pin that this fold leaves the boundary
    // standing. A seat that folds those two has broken a ruling, not fixed a
    // bug. Green in both directions by construction — a boundary guard, not a
    // control.
    expect(normalizeFilterOperator('contains')).toBe('contains');
    expect(normalizeFilterOperator('icontains')).toBe('icontains');
    expect(normalizeFilterOperator('contains')).not.toBe(normalizeFilterOperator('icontains'));
    // …and neither is value-less under either spelling, so the gate this card
    // repairs never had an opinion about them.
    for (const op of ['contains', 'icontains', 'containsCaseInsensitive']) {
      expect(VALUELESS_FILTER_BUILDER_OPERATORS.has(op)).toBe(false);
      expect(
        new Set([...VALUELESS_FILTER_BUILDER_OPERATORS].map(normalizeFilterOperator)).has(
          normalizeFilterOperator(op),
        ),
      ).toBe(false);
    }
  });
});
