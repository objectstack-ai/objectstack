/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#8815 — a HALF-FILLED `between` must never be persisted.
 *
 * The sibling of objectui#4155, one arity over. That issue made this fold agree
 * with the live query about the unfilled row; both then asked the question with
 * the same shape-blind predicate:
 *
 * ```ts
 * value == null || value === '' || (Array.isArray(value) && value.length === 0)
 * ```
 *
 * Correct for `scalar` and `list`, wrong for `pair`. A `between` row with only
 * the start typed is `["2024-01-01", ""]` — an array of length 2 — so both
 * halves agreed it was complete. They were agreed and both wrong, which is the
 * failure mode a shared predicate is supposed to prevent and a COPIED one does
 * not: the two sides matched because the copy matched, not because either was
 * right.
 *
 * Persisting it is the worse half of the damage. The live query at least fails
 * in front of the user who typed it; a stored half-range makes the view refuse
 * (`400 INVALID_FILTER`) for EVERY user on every later read, with nothing in the
 * panel to explain it — the same shape objectui#4155 closed, arriving through
 * the operator's arity instead of through an empty string.
 *
 * The spec does not catch it either. `ViewFilterRuleSchema` on
 * `@objectstack/spec` 17.0.0 ACCEPTS `['2024-01-01', '']` — it counts two slots
 * and does not ask what is in them — while refusing a scalar or a one-element
 * array. So authoring validation is green on exactly the shape that fails at
 * query time, which is why the producer has to refuse it.
 *
 * SUITE DIRECTION, predicted before running: RED against `origin/main`'s fold on
 * every half-filled case (it returns the rule verbatim, empty bound and all),
 * green on the paired and value-less cases both before and after.
 */
import { describe, it, expect } from 'vitest';
import { ViewFilterRuleSchema } from '@objectstack/spec/ui';
import { foldFilterGroupToSpecRules } from './viewFilterFold';

const group = (value: unknown) => ({
    id: 'root',
    logic: 'and' as const,
    conditions: [{ id: 'c1', field: 'declare_date', operator: 'between', value }],
});

describe('foldFilterGroupToSpecRules — `between` needs both bounds', () => {
    it('persists a complete range', () => {
        const result = foldFilterGroupToSpecRules(group(['2024-01-01', '2024-03-01']));
        expect(result).toEqual({
            ok: true,
            rules: [
                { field: 'declare_date', operator: 'between', value: ['2024-01-01', '2024-03-01'] },
            ],
        });
    });

    it('the persisted range is a rule the spec accepts', () => {
        const result = foldFilterGroupToSpecRules(group(['2024-01-01', '2024-03-01']));
        if (!result.ok) throw new Error('fold refused a complete range');
        // Asserted against the schema itself rather than a hand-written shape:
        // what "well-formed" means here is the spec's answer, not this file's.
        const parsed = ViewFilterRuleSchema.safeParse(result.rules[0]);
        expect(parsed.success).toBe(true);
    });

    it.each([
        ['upper bound missing', ['2024-01-01', '']],
        ['lower bound missing', ['', '2024-03-01']],
        ['both bounds missing', ['', '']],
        ['nothing filled in', []],
    ])('drops the row when %s', (_name, value) => {
        expect(foldFilterGroupToSpecRules(group(value))).toEqual({ ok: true, rules: [] });
    });

    it('drops only the half-filled range, keeping the complete rules beside it', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root',
            logic: 'and' as const,
            conditions: [
                { id: 'c1', field: 'stage', operator: 'equals', value: 'won' },
                { id: 'c2', field: 'declare_date', operator: 'between', value: ['2024-01-01', ''] },
            ],
        });
        expect(result).toEqual({
            ok: true,
            rules: [{ field: 'stage', operator: 'equals', value: 'won' }],
        });
    });

    it('keeps a bound of 0 — a real bound, not an empty one', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root',
            logic: 'and' as const,
            conditions: [{ id: 'c1', field: 'amount', operator: 'between', value: [0, 100] }],
        });
        expect(result).toEqual({
            ok: true,
            rules: [{ field: 'amount', operator: 'between', value: [0, 100] }],
        });
    });

    it('leaves the scalar and list families reading exactly as they did', () => {
        // The change is scoped to `pair`. A red here means it reached further.
        expect(
            foldFilterGroupToSpecRules({
                id: 'root',
                logic: 'and' as const,
                conditions: [
                    { id: 'c1', field: 'stage', operator: 'equals', value: '' },
                    { id: 'c2', field: 'kind', operator: 'in', value: [] },
                    { id: 'c3', field: 'name', operator: 'equals', value: 'acme' },
                    { id: 'c4', field: 'kind', operator: 'in', value: ['a'] },
                ],
            }),
        ).toEqual({
            ok: true,
            rules: [
                { field: 'name', operator: 'equals', value: 'acme' },
                { field: 'kind', operator: 'in', value: ['a'] },
            ],
        });
    });
});
