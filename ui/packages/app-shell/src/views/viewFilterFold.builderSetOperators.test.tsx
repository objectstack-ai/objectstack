/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The whole chain, with nothing stubbed: the real `FilterBuilder` produces a
 * row, the real `foldFilterGroupToSpecRules` folds it, and the real
 * `ViewFilterRuleSchema` parses the result (objectui#3958, objectstack#6227).
 *
 * Why it lives HERE and not beside the component: this is the only package that
 * can see all three. `@object-ui/components` cannot import the fold (`app-shell`
 * depends on it, not the reverse), so its own tests can only mirror what the
 * fold does — which is exactly the kind of restatement that drifts. This file
 * is the one place the mirror is checked against the original.
 *
 * It also carries the READ-ONLY finding about the fold itself: the fold needed
 * NO change for this card. It normalizes the operator and carries `value`
 * through verbatim, so the value shape it persists is decided entirely by the
 * builder — which is why the fix belongs at the producer (AGENTS.md
 * contract-first) and not as a coercion here. The `in`-with-a-scalar case below
 * is the proof: fold it and the spec still refuses it, because the fold never
 * had the information to repair it.
 *
 * DIRECTION, predicted before running: the two "builder output parses" cases
 * are RED on `origin/main` (the builder emits a scalar there) and green after.
 * The "a scalar under `in` is refused after folding" case is green in BOTH
 * directions on purpose — it is what makes the other two mean something.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ViewFilterRuleSchema } from '@objectstack/spec/ui';
import { FilterBuilder } from '@object-ui/components';
import { foldFilterGroupToSpecRules } from './viewFilterFold';

// `stage` is a `select` column with no static `options` — the bucket whose
// dropdown offers `in` / `notIn`, and the one whose value input fell through to
// the single-value box because there were no options to draw checkboxes from.
const FIELDS = [
  { value: 'stage', label: 'Stage', type: 'select' },
  { value: 'closed_at', label: 'Closed at', type: 'date' },
];

function renderBuilder(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
  const utils = render(
    <FilterBuilder fields={FIELDS as any} value={value as any} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

/** Fold the group the builder last emitted, exactly as the toolbar's save does. */
function foldLast(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the builder never called onChange').toBeGreaterThan(0);
  const result = foldFilterGroupToSpecRules(calls[calls.length - 1][0]);
  expect(result.ok, `the fold refused the group: ${JSON.stringify(result)}`).toBe(true);
  return (result as { ok: true; rules: unknown[] }).rules;
}

async function pickOperator(label: string) {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[1], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the operator dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

describe('FilterBuilder -> foldFilterGroupToSpecRules -> ViewFilterRuleSchema', () => {
  it('the row a user builds with `in` on a plain column is one the spec accepts', () => {
    const { onChange, getByTestId } = renderBuilder({
      field: 'stage',
      operator: 'in',
      value: [],
    });
    const input = getByTestId('filter-multi-value-stage').querySelector('input')!;
    fireEvent.change(input, { target: { value: 'won' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const rules = foldLast(onChange);
    expect(rules).toEqual([{ field: 'stage', operator: 'in', value: ['won'] }]);
    for (const rule of rules) {
      const parsed = ViewFilterRuleSchema.safeParse(rule);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('switching a filled scalar row into `in` still persists something the spec accepts', async () => {
    const { onChange } = renderBuilder({ field: 'stage', operator: 'equals', value: 'won' });
    await pickOperator('In');

    const rules = foldLast(onChange);
    expect(rules).toEqual([{ field: 'stage', operator: 'in', value: ['won'] }]);
    expect(ViewFilterRuleSchema.safeParse(rules[0]).success).toBe(true);
  });

  it('an untouched `in` row is DROPPED, not persisted as an empty predicate', async () => {
    // `[]` is a legal `in` value the spec accepts, but a row the user never
    // filled in is not a filter — the fold's existing incomplete-row rule
    // (objectui#4155) already reads `[]` as missing, and the re-shaping makes
    // an untouched row arrive in exactly that shape instead of as `''`.
    const { onChange } = renderBuilder({ field: 'stage', operator: 'equals', value: '' });
    await pickOperator('In');
    expect(foldLast(onChange)).toEqual([]);
  });

  it('a `between` row folds to a two-bound range the spec accepts', () => {
    const { onChange, getByTestId } = renderBuilder({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', ''],
    });
    const inputs = getByTestId('filter-range-closed_at').querySelectorAll('input');
    fireEvent.change(inputs[1], { target: { value: '2024-12-31' } });

    const rules = foldLast(onChange);
    expect(rules).toEqual([
      { field: 'closed_at', operator: 'between', value: ['2024-01-01', '2024-12-31'] },
    ]);
    expect(ViewFilterRuleSchema.safeParse(rules[0]).success).toBe(true);
  });

  it('the fold cannot repair a scalar under `in` — which is why the producer had to', () => {
    // The shape the builder used to emit, handed to the fold directly. It
    // survives the fold verbatim (the fold normalizes the OPERATOR, never the
    // value) and the spec refuses it. Green before and after this change: it
    // states why the fix is at the producer, and it is what makes the cases
    // above discriminating rather than tautological.
    const folded = foldFilterGroupToSpecRules({
      id: 'root',
      logic: 'and',
      conditions: [{ id: 'c1', field: 'stage', operator: 'in', value: 'won' }],
    });
    expect(folded).toEqual({ ok: true, rules: [{ field: 'stage', operator: 'in', value: 'won' }] });
    const parsed = ViewFilterRuleSchema.safeParse((folded as any).rules[0]);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].message).toMatch(/requires an ARRAY/);
  });
});
