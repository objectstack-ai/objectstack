/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#5159 — the list toolbar PUT a FilterBuilder `FilterGroup` into
 * the view's `filter`, where `ListViewSchema.filter` declares
 * `z.array(ViewFilterRuleSchema)`. The server answered 422 `invalid_union`.
 *
 * These tests pin the producer-side fold: the shape that reaches the wire, the
 * loud refusal for shapes that cannot fold losslessly, and — with the spec's
 * own schema — that the folded body is actually accepted.
 */
import { describe, it, expect } from 'vitest';
import { ListViewSchema } from '@objectstack/spec/ui';
import { foldFilterGroupToSpecRules, FILTER_FOLD_REFUSAL_KEYS } from './viewFilterFold';

/**
 * The body objectstack#5159 captured off the wire, verbatim: one click of
 * `Filter → Add filter` on `/_console/apps/showcase_app/showcase_task`.
 * Replay variant ① — the shape that must never be emitted again.
 *
 * objectui#4155 amended what this folds TO. The captured row is incomplete — a
 * column with no value yet — and the fold now drops it, because the live query
 * never applied it and persisting it replaced the source-declared view filter.
 * The variant-③ shape assertions below therefore run on a COMPLETE row; the
 * captured body's own verdict (an empty rule list) is pinned in
 * `viewFilterFold.emptyValue.test.ts`.
 */
const CAPTURED_TOOLBAR_GROUP = {
    id: 'root',
    logic: 'and',
    conditions: [
        { id: '712135fb-58c5-4be4-a611-1925181509b0', field: 'title', operator: 'equals', value: '' },
    ],
};

/** The same body once the user has actually typed a value into that row. */
const COMPLETED_TOOLBAR_GROUP = {
    id: 'root',
    logic: 'and',
    conditions: [
        { id: '712135fb-58c5-4be4-a611-1925181509b0', field: 'title', operator: 'equals', value: 'draft' },
    ],
};

describe('foldFilterGroupToSpecRules — flat AND group → ViewFilterRule[]', () => {
    it('#5159: folds the captured toolbar body to replay variant ③ (declared keys only)', () => {
        const result = foldFilterGroupToSpecRules(COMPLETED_TOOLBAR_GROUP);
        expect(result.ok).toBe(true);
        expect(result.ok && result.rules).toEqual([
            { field: 'title', operator: 'equals', value: 'draft' },
        ]);
    });

    it('#4155: the captured body itself — an unfinished row — persists nothing', () => {
        expect(foldFilterGroupToSpecRules(CAPTURED_TOOLBAR_GROUP)).toEqual({ ok: true, rules: [] });
    });

    it('#5159: what is emitted is an ARRAY — never the FilterGroup object (variant ①)', () => {
        const result = foldFilterGroupToSpecRules(COMPLETED_TOOLBAR_GROUP);
        expect(result.ok).toBe(true);
        const rules = result.ok ? result.rules : null;
        expect(Array.isArray(rules)).toBe(true);
        // The three keys that made the group a group are gone from the wire.
        expect(rules).not.toHaveProperty('logic');
        expect(rules).not.toHaveProperty('conditions');
        expect(JSON.stringify(rules)).not.toContain('"logic"');
    });

    it('#5114/#5159: strips the builder-minted row `id` — the read path regenerates it', () => {
        const result = foldFilterGroupToSpecRules(COMPLETED_TOOLBAR_GROUP);
        expect(result.ok && result.rules[0]).not.toHaveProperty('id');
        // Declared vocabulary only.
        expect(result.ok && Object.keys(result.rules[0])).toEqual(['field', 'operator', 'value']);
    });

    it('folds several conditions in order', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root',
            logic: 'and',
            conditions: [
                { id: 'a', field: 'status', operator: 'equals', value: 'open' },
                { id: 'b', field: 'amount', operator: 'greaterThan', value: 100 },
            ],
        });
        expect(result.ok && result.rules).toEqual([
            { field: 'status', operator: 'equals', value: 'open' },
            { field: 'amount', operator: 'greater_than', value: 100 },
        ]);
    });

    it('normalizes the builder camelCase vocabulary onto the spec canon', () => {
        const builderOperators = [
            'equals', 'notEquals', 'contains', 'notContains',
            'isEmpty', 'isNotEmpty', 'greaterThan', 'lessThan',
            'greaterOrEqual', 'lessOrEqual', 'before', 'after', 'between',
            'in', 'notIn', 'startsWith', 'endsWith', 'isNull', 'isNotNull',
        ];
        // `'x'` is filler for every operator whose value is a SCALAR, which is
        // all of them but one: `between` takes a `[min, max]` pair, and since
        // objectstack#8815 the fold drops a range that is not filled in — a bare
        // scalar included. Giving it a real pair keeps this test asserting what
        // it is named for (camelCase → canonical SPELLING) instead of quietly
        // depending on a malformed range surviving the fold. Not a workaround
        // for the guard: `ViewFilterRuleSchema` refuses `between: 'x'` outright,
        // so the row this fixture used to produce was never spec-valid.
        const valueFor = (operator: string) =>
            operator === 'between' ? ['x', 'y'] : 'x';
        const result = foldFilterGroupToSpecRules({
            id: 'root',
            logic: 'and',
            conditions: builderOperators.map((operator, i) => ({
                id: `c${i}`, field: 'f', operator, value: valueFor(operator),
            })),
        });
        expect(result.ok).toBe(true);
        expect(result.ok && result.rules.map(r => r.operator)).toEqual([
            'equals', 'not_equals', 'contains', 'not_contains',
            'is_empty', 'is_not_empty', 'greater_than', 'less_than',
            'greater_than_or_equal', 'less_than_or_equal', 'before', 'after', 'between',
            'in', 'not_in', 'starts_with', 'ends_with', 'is_null', 'is_not_null',
        ]);
    });

    it('passes an operator the spec does not know through VERBATIM (server rejects, we do not coerce)', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'and',
            conditions: [{ id: 'a', field: 'f', operator: 'sounds_like', value: 'x' }],
        });
        // NOT silently rewritten to `equals` — the spec enum is the judge.
        expect(result.ok && result.rules[0].operator).toBe('sounds_like');
    });

    it('drops the blank row `Add filter` inserts before a column is picked', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'and',
            conditions: [
                { id: 'a', field: '', operator: 'equals', value: '' },
                { id: 'b', field: 'title', operator: 'equals', value: 'x' },
            ],
        });
        expect(result.ok && result.rules).toEqual([{ field: 'title', operator: 'equals', value: 'x' }]);
    });

    it('omits `value` entirely when the row carries none (unary operators)', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'and',
            conditions: [{ id: 'a', field: 'archived_at', operator: 'isEmpty' }],
        });
        expect(result.ok && result.rules).toEqual([{ field: 'archived_at', operator: 'is_empty' }]);
        expect(result.ok && 'value' in result.rules[0]).toBe(false);
    });
});

describe('foldFilterGroupToSpecRules — empty conditions', () => {
    // Current UX contract: clearing every row must CLEAR the stored filter, so
    // the fold yields `[]` — which `z.array(ViewFilterRuleSchema).optional()`
    // accepts and which reads back as "no filter". It is not a refusal.
    it('an empty group folds to an empty rule list (clears the stored filter)', () => {
        expect(foldFilterGroupToSpecRules({ id: 'root', logic: 'and', conditions: [] }))
            .toEqual({ ok: true, rules: [] });
    });

    it('a group whose only rows are blank folds to an empty rule list', () => {
        expect(foldFilterGroupToSpecRules({
            id: 'root', logic: 'and',
            conditions: [{ id: 'a', field: '', operator: 'equals', value: '' }],
        })).toEqual({ ok: true, rules: [] });
    });

    it('null / undefined fold to an empty rule list', () => {
        expect(foldFilterGroupToSpecRules(null)).toEqual({ ok: true, rules: [] });
        expect(foldFilterGroupToSpecRules(undefined)).toEqual({ ok: true, rules: [] });
    });
});

describe('foldFilterGroupToSpecRules — loud refusal, never a silent downgrade (A1)', () => {
    it("refuses `logic: 'or'` over two conditions instead of writing them as AND", () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root',
            logic: 'or',
            conditions: [
                { id: 'a', field: 'status', operator: 'equals', value: 'open' },
                { id: 'b', field: 'status', operator: 'equals', value: 'blocked' },
            ],
        });
        expect(result).toEqual({ ok: false, reason: 'or_logic' });
        // The refusal reaches the user through a translated string, not a
        // console throw: the toolbar surfaces this key as a toast.
        expect(FILTER_FOLD_REFUSAL_KEYS.or_logic).toBe('console.objectView.filterOrNotSavable');
    });

    it('refuses OR however many conditions there are beyond one', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'or',
            conditions: [
                { id: 'a', field: 'a', operator: 'equals', value: 1 },
                { id: 'b', field: 'b', operator: 'equals', value: 2 },
                { id: 'c', field: 'c', operator: 'equals', value: 3 },
            ],
        });
        expect(result.ok).toBe(false);
    });

    it("folds `logic: 'or'` over ONE condition — OR and AND select the same records there", () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'or',
            conditions: [{ id: 'a', field: 'status', operator: 'equals', value: 'open' }],
        });
        expect(result).toEqual({ ok: true, rules: [{ field: 'status', operator: 'equals', value: 'open' }] });
    });

    it("folds `logic: 'or'` over blank rows only (nothing to downgrade)", () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'or',
            conditions: [{ id: 'a', field: '', operator: 'equals', value: '' }],
        });
        expect(result).toEqual({ ok: true, rules: [] });
    });

    it('refuses a nested group — a flat rule array cannot express it', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root',
            logic: 'and',
            conditions: [
                { id: 'a', field: 'status', operator: 'equals', value: 'open' },
                { id: 'g1', logic: 'or', conditions: [{ id: 'b', field: 'x', operator: 'equals', value: 1 }] },
            ],
        });
        expect(result).toEqual({ ok: false, reason: 'nested_group' });
        expect(FILTER_FOLD_REFUSAL_KEYS.nested_group).toBe('console.objectView.filterNestedNotSavable');
    });

    it('refuses a nested AND group too — nesting, not the logic word, is the problem', () => {
        const result = foldFilterGroupToSpecRules({
            id: 'root', logic: 'and',
            conditions: [{ id: 'g1', logic: 'and', conditions: [] }],
        });
        expect(result).toEqual({ ok: false, reason: 'nested_group' });
    });

    it('every refusal reason has a user-readable key — no reason can surface untranslated', () => {
        const reasons: Array<keyof typeof FILTER_FOLD_REFUSAL_KEYS> = ['or_logic', 'nested_group'];
        for (const reason of reasons) {
            expect(FILTER_FOLD_REFUSAL_KEYS[reason]).toMatch(/^console\.objectView\./);
        }
    });
});

describe('the folded body is what the spec actually accepts (replay-matrix closure)', () => {
    /** A minimal view body that is valid apart from whatever `filter` carries. */
    const viewBody = (filter: unknown) => ({
        name: 'default', label: 'All', type: 'grid',
        columns: ['title'],
        filter,
    });

    it('the fixture itself is valid without a filter — the assertions below isolate `filter`', () => {
        const parsed = ListViewSchema.safeParse(viewBody(undefined));
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    // Replay variant ① — the FilterGroup object the toolbar used to PUT.
    it('#5159 variant ①: the raw FilterGroup is REJECTED by ListViewSchema, on `filter`', () => {
        const parsed = ListViewSchema.safeParse(viewBody(CAPTURED_TOOLBAR_GROUP));
        expect(parsed.success).toBe(false);
        // The 422 the browser saw. Pin that it is `filter` that fails, so this
        // cannot pass because some unrelated key drifted out of the fixture.
        const paths = (parsed as any).error.issues.map((i: any) => i.path.join('.'));
        expect(paths).toContain('filter');
    });

    // Replay variant ② — flat rule list, but still carrying the builder's row
    // `id`. The issue's matrix recorded this as ACCEPTED against a server
    // running framework `main` (PR #5154 tolerates the undeclared key). It is
    // NOT accepted by the spec objectui itself pins: `ViewFilterRuleSchema` is
    // a `strictObject` over `{field, operator, value}` only. So stripping `id`
    // is not merely the tidier at-rest shape — under this pin it is required,
    // and a fold that kept the id would trade a 422 `invalid_union` for a 422
    // `unrecognized_keys`. This pins the measurement behind that decision; if a
    // later spec bump declares `id`, this test is the one that says so.
    it('#5159 variant ②: a rule keeping the builder `id` is REJECTED, on `filter.0`', () => {
        const withId = { id: '712135fb-58c5-4be4-a611-1925181509b0', field: 'title', operator: 'equals', value: '' };
        const parsed = ListViewSchema.safeParse(viewBody([withId]));
        expect(parsed.success).toBe(false);
        const issues = (parsed as any).error.issues;
        expect(issues.map((i: any) => i.path.join('.'))).toContain('filter.0');
        expect(issues.map((i: any) => i.code)).toContain('unrecognized_keys');
    });

    // …and the fold is what keeps us out of variant ②.
    it('the fold strips the `id` that variant ② proves the spec rejects', () => {
        const folded = foldFilterGroupToSpecRules(COMPLETED_TOOLBAR_GROUP);
        expect(folded.ok).toBe(true);
        // Non-vacuous: there IS a rule, and it carries no `id`.
        expect(folded.ok && folded.rules.length).toBe(1);
        expect(folded.ok && folded.rules.every((r) => !('id' in r))).toBe(true);
    });

    // Replay variant ③ — what the fold now emits.
    it('#5159 variant ③: the folded rule array is ACCEPTED by ListViewSchema', () => {
        const folded = foldFilterGroupToSpecRules(COMPLETED_TOOLBAR_GROUP);
        expect(folded.ok).toBe(true);
        const parsed = ListViewSchema.safeParse(viewBody(folded.ok ? folded.rules : undefined));
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    it('an empty rule list (filters cleared) is ACCEPTED by ListViewSchema', () => {
        const parsed = ListViewSchema.safeParse(viewBody([]));
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    it('every builder operator the fold normalizes survives ListViewSchema', () => {
        const folded = foldFilterGroupToSpecRules({
            id: 'root', logic: 'and',
            conditions: [
                { id: '1', field: 'a', operator: 'startsWith', value: 'x' },
                { id: '2', field: 'b', operator: 'isNull' },
                { id: '3', field: 'c', operator: 'greaterOrEqual', value: 5 },
                { id: '4', field: 'd', operator: 'notIn', value: ['x', 'y'] },
            ],
        });
        expect(folded.ok).toBe(true);
        const parsed = ListViewSchema.safeParse(viewBody(folded.ok ? folded.rules : undefined));
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });
});
