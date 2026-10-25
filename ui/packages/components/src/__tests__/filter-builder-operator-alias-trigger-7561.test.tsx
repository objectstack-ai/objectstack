/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The operator trigger shows a label for every spelling of the operator the
 * row actually holds (objectui#7561).
 *
 * ## The one site
 *
 * This component already resolves BOTH dialects everywhere the operator's
 * MEANING matters — `filterValueArity` folds through the spec's
 * `normalizeFilterOperator`, and so does `reconcileOperatorForField`. The one
 * place it did not was the operator `Select`'s IDENTITY comparison:
 * `value={condition.operator}` was matched LITERALLY against the mounted
 * `SelectItem`s, whose ids are the dropdown's camelCase vocabulary. A row
 * holding `greater_than` (the spec's canonical spelling) or `gt` (the spec's
 * alias table, which three catalog entries author) matched no mounted item,
 * and Radix drew a BLANK trigger over a row that went on filtering correctly.
 *
 * ⇒ The blank is NOT the vocabulary divergence. It is one site not using this
 * component's own existing normalisation. The repair routes that one
 * comparison through the same fold, and nothing else:
 *
 *   - ⛔ the mirror's accepted set is untouched;
 *   - ⛔ no id a stored filter carries is rewritten;
 *   - ⛔ no second spelling is admitted to the dropdown — the emitted
 *     vocabulary is byte-identical.
 *
 * Which vocabulary should WIN is a separate ruling and is not decided here
 * (objectui#7561's body; note direction 3 there collides with the
 * `contains` / `icontains` ruling cited on objectui#7379 — `AST_OPERATOR_MAP`
 * holds that one operator "must never be folded onto" its sibling).
 *
 * ## DIRECTION, predicted before running
 *
 * Every case in `the trigger names the operator the row holds` is RED on the
 * base tree and green after — EXCEPT the three rows marked `overlap`.
 * `equals` / `contains` / `in` are the three-member intersection of the two
 * vocabularies, so they render a label TODAY; they are carried here as the
 * OVER-REACH guard (a repair that rewrote or re-spelled the row would move
 * them) and are explicitly NOT controls — a pin built only on them could not
 * fail. The sharpest controls are `eq` / `lt` / `gt`, a THIRD spelling that
 * neither vocabulary contains.
 *
 * The four `describe`s below the table are green in BOTH directions by
 * construction: they are the boundaries the repair must not cross, so they
 * fail only for a repair that over-reaches.
 *
 * ## After objectui#9306
 *
 * The dropdown's ids are now the spec's canonical spellings, so the
 * `canonical` rows below match a mounted item literally and are no longer
 * controls. The dialect they used to stand in for — a spelling the dropdown
 * does not mount — is now the builder's own former camelCase ids (`deprecated`
 * below), which a stored filter saved before that change still carries. Those
 * rows, and the alias table, are the controls now; the trigger names them
 * because the builder folds a row's spelling at its read boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { normalizeFilterOperator } from '@objectstack/spec/ui';
import { FilterBuilder, operatorsForFieldType } from '../custom/filter-builder';

const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'stage', label: 'Stage', type: 'select', options: [{ value: 'won', label: 'Won' }] },
];

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted out of the JSX for the reason PR #4762's suite states: the
  // builder re-seeds its internal state when the `value` prop's IDENTITY
  // changes, so an inline literal would undo the interaction under test.
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
  const utils = render(
    <FilterBuilder fields={FIELDS as never} value={value as never} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

/** What the operator trigger DISPLAYS. Blank is the symptom this card is about. */
function operatorTriggerText() {
  return screen.getAllByRole('combobox')[1].textContent;
}

/**
 * One row per spelling a stored filter can reach this builder carrying.
 *
 * `dialect` is load-bearing for reading a failure, not decoration:
 *   - `canonical` — `@objectstack/spec`'s snake_case set, what the mirror
 *     (`FilterOperatorSchema`) accepts and what `foldFilterGroupToSpecRules`
 *     persists;
 *   - `alias` — the spec's alias table (`eq` / `lt` / `gt` / `ne` / `nin`), the
 *     THIRD spelling. ⚠️ It was authored by three schema-catalog entries when
 *     this pin was written; objectui#6939's remainder rewrote those to the
 *     canonical members, so the dialect now reaches this builder from STORED
 *     filters rather than from the corpus — which is the reason the row stays
 *     here rather than following the corpus;
 *   - `deprecated` — the dropdown's own camelCase ids BEFORE objectui#9306,
 *     now the spec's deprecated alias form (plus `containsCaseInsensitive`,
 *     which the spec's table lacks and the builder folds itself);
 *   - `overlap` — the three ids both vocabularies share. NOT controls.
 *
 * Since objectui#9306 the `canonical` rows are the dropdown's own ids too.
 */
const SPELLINGS: ReadonlyArray<{
  operator: string;
  field: string;
  label: string;
  dialect: 'canonical' | 'deprecated' | 'alias' | 'overlap';
}> = [
  // The three-member overlap — green before AND after. Over-reach guard only.
  { operator: 'equals', field: 'title', label: 'Equals', dialect: 'overlap' },
  { operator: 'contains', field: 'title', label: 'Contains', dialect: 'overlap' },
  { operator: 'in', field: 'stage', label: 'In', dialect: 'overlap' },

  // The spec's canonical snake_case set — the mirror accepts these and the
  // trigger drew nothing for them.
  { operator: 'not_equals', field: 'title', label: 'Does not equal', dialect: 'canonical' },
  { operator: 'not_contains', field: 'title', label: 'Does not contain', dialect: 'canonical' },
  { operator: 'starts_with', field: 'title', label: 'Starts with', dialect: 'canonical' },
  { operator: 'ends_with', field: 'title', label: 'Ends with', dialect: 'canonical' },
  { operator: 'is_empty', field: 'title', label: 'Is empty', dialect: 'canonical' },
  { operator: 'is_not_empty', field: 'title', label: 'Is not empty', dialect: 'canonical' },
  { operator: 'is_null', field: 'title', label: 'Is null', dialect: 'canonical' },
  { operator: 'is_not_null', field: 'title', label: 'Is not null', dialect: 'canonical' },
  { operator: 'greater_than', field: 'amount', label: 'Greater than', dialect: 'canonical' },
  { operator: 'less_than', field: 'amount', label: 'Less than', dialect: 'canonical' },
  {
    operator: 'greater_than_or_equal',
    field: 'amount',
    label: 'Greater than or equal',
    dialect: 'canonical',
  },
  {
    operator: 'less_than_or_equal',
    field: 'amount',
    label: 'Less than or equal',
    dialect: 'canonical',
  },
  { operator: 'not_in', field: 'stage', label: 'Not in', dialect: 'canonical' },

  // The alias table — the sharpest controls, because neither vocabulary
  // contains them and no fix that merely swapped one set for the other could
  // make them render.
  { operator: 'eq', field: 'title', label: 'Equals', dialect: 'alias' },
  { operator: 'ne', field: 'title', label: 'Does not equal', dialect: 'alias' },
  { operator: 'lt', field: 'amount', label: 'Less than', dialect: 'alias' },
  { operator: 'gt', field: 'amount', label: 'Greater than', dialect: 'alias' },
  { operator: 'lte', field: 'amount', label: 'Less than or equal', dialect: 'alias' },
  { operator: 'gte', field: 'amount', label: 'Greater than or equal', dialect: 'alias' },
  { operator: 'nin', field: 'stage', label: 'Not in', dialect: 'alias' },

  // The dropdown's former camelCase ids — what a filter stored before
  // objectui#9306 carries (objectui#9306).
  { operator: 'notEquals', field: 'title', label: 'Does not equal', dialect: 'deprecated' },
  {
    operator: 'containsCaseInsensitive',
    field: 'title',
    label: 'Contains (ignore case)',
    dialect: 'deprecated',
  },
  { operator: 'notContains', field: 'title', label: 'Does not contain', dialect: 'deprecated' },
  { operator: 'startsWith', field: 'title', label: 'Starts with', dialect: 'deprecated' },
  { operator: 'endsWith', field: 'title', label: 'Ends with', dialect: 'deprecated' },
  { operator: 'isEmpty', field: 'title', label: 'Is empty', dialect: 'deprecated' },
  { operator: 'isNotEmpty', field: 'title', label: 'Is not empty', dialect: 'deprecated' },
  { operator: 'isNull', field: 'title', label: 'Is null', dialect: 'deprecated' },
  { operator: 'isNotNull', field: 'title', label: 'Is not null', dialect: 'deprecated' },
  { operator: 'greaterThan', field: 'amount', label: 'Greater than', dialect: 'deprecated' },
  { operator: 'lessThan', field: 'amount', label: 'Less than', dialect: 'deprecated' },
  {
    operator: 'greaterOrEqual',
    field: 'amount',
    label: 'Greater than or equal',
    dialect: 'deprecated',
  },
  { operator: 'lessOrEqual', field: 'amount', label: 'Less than or equal', dialect: 'deprecated' },
  { operator: 'notIn', field: 'stage', label: 'Not in', dialect: 'deprecated' },
];

describe('objectui#7561 — the trigger names the operator the row holds', () => {
  it.each(SPELLINGS)(
    '$dialect `$operator` on `$field` draws "$label"',
    ({ operator, field, label }) => {
      renderRow({ field, operator, value: '' });
      expect(operatorTriggerText()).toBe(label);
    },
  );

  it('the controls can actually fire — the table is not all overlap', () => {
    // The instrument standard this suite is held to: a pin built only on the
    // three-member overlap renders a label before ANY fix and therefore
    // measures nothing. Both non-overlap dialects must be represented, and
    // the alias family must be present in its own right.
    const dialects = SPELLINGS.map((s) => s.dialect);
    expect(dialects.filter((d) => d === 'canonical').length).toBeGreaterThanOrEqual(10);
    expect(dialects.filter((d) => d === 'alias').length).toBeGreaterThanOrEqual(5);
    expect(dialects.filter((d) => d === 'deprecated').length).toBeGreaterThanOrEqual(10);
    // …and every control spelling really is outside the dropdown's own
    // vocabulary, so none of them could have matched a mounted item literally.
    // Since objectui#9306 the canonical rows ARE the dropdown's vocabulary, so
    // they sit on the inside with the overlap.
    const dropdownIds = new Set(operatorsForFieldType('text').concat(
      operatorsForFieldType('number'), operatorsForFieldType('select'),
    ).map((op) => op.value));
    for (const s of SPELLINGS) {
      if (s.dialect === 'overlap' || s.dialect === 'canonical') {
        expect(dropdownIds.has(s.operator), s.operator).toBe(true);
      } else {
        expect(dropdownIds.has(s.operator), s.operator).toBe(false);
      }
    }
  });
});

describe('objectui#7561 — ⛔ the repair does not rewrite what the row carries', () => {
  it.each(['gt', 'greater_than', 'greaterThan'])('a row spelled `%s` is not migrated on render', (operator) => {
    // The boundary the triage seat drew: fixing the BLANK must not rewrite the
    // id any stored filter carries. Rendering is not an edit, so the component
    // must not call back at all. objectui#9306 folds the spelling at the
    // builder's read boundary, but only into its own state — the canonical id
    // reaches the host with the author's next edit, never on render.
    const { onChange } = renderRow({ field: 'amount', operator, value: '5' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an operator NO spelling of the vocabulary folds onto still draws blank', async () => {
    // The over-reach control, and it can fire: a repair that mounted the raw
    // id as its own option (the shape objectui#4874 uses for the VALUE select)
    // would print `totally_unknown` here instead of nothing.
    expect(normalizeFilterOperator('totally_unknown')).toBe('totally_unknown');
    renderRow({ field: 'title', operator: 'totally_unknown', value: '' });
    expect(operatorTriggerText()).toBe('');
    // …and the dropdown did not grow an entry for it.
    fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
    const options = await waitFor(() => screen.getAllByRole('option'));
    expect(options.map((o) => o.textContent)).not.toContain('totally_unknown');
  });
});

describe('objectui#7561 — ⛔ the dropdown still emits its own vocabulary', () => {
  it('the mounted options are exactly the bucket ids, in order', () => {
    // ⛔ "Do not change the spellings the dropdown emits." The mounted set is
    // the emitted set, so pinning the labels pins the emission.
    //
    // The order is `defaultOperators`' declaration order filtered by the
    // bucket — NOT the bucket array's own order (`operatorsForFieldType`
    // filters the declaration list). Recorded from the base tree, less the
    // `Is null` / `Is not null` pair objectui#11810 stopped offering on a
    // number column: there they match exactly what `Is empty` / `Is not empty`
    // match (`filter-builder-empty-null-pair-11810.test.tsx`).
    renderRow({ field: 'amount', operator: 'gt', value: '5' });
    fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
    return waitFor(() => {
      const shown = screen.getAllByRole('option').map((o) => o.textContent);
      expect(shown).toEqual([
        'Equals',
        'Does not equal',
        'Is empty',
        'Is not empty',
        'Greater than',
        'Less than',
        'Greater than or equal',
        'Less than or equal',
      ]);
    });
  });

  it('picking an operator writes the DROPDOWN id, never the row\'s old dialect', async () => {
    const { onChange } = renderRow({ field: 'amount', operator: 'gt', value: '5' });
    fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
    const option = await waitFor(() => {
      const found = screen.getAllByRole('option').find((o) => o.textContent === 'Less than');
      expect(found, 'no "Less than" option in the dropdown').toBeTruthy();
      return found!;
    });
    fireEvent.click(option);
    const calls = onChange.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // `less_than`, the builder's own id (the protocol's, since objectui#9306)
    // — NOT `lt`, the row's old dialect, and NOT the retired `lessThan`.
    expect(calls[calls.length - 1][0].conditions[0].operator).toBe('less_than');
  });
});
