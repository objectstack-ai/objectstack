/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * FilterBuilder → `@objectstack/spec` view filter, the WRITE direction.
 *
 * The FilterBuilder (`@object-ui/components`) speaks a grouped dialect —
 * `{ id, logic, conditions }` with a per-row `id`. Its operator ids are the
 * spec's own canonical spellings since objectui#9306 (they were camelCase
 * before, and a group read from older storage may still carry those).
 * `@objectstack/spec`'s `ListViewSchema.filter` / `ViewTab.filter` declare
 * `z.array(ViewFilterRuleSchema)`: a FLAT list of `{ field, operator, value }`.
 * Persisting the builder's group verbatim is a type error the server rejects
 * with a `invalid_union` 422 — objectstack#5159, reproduced in a real browser
 * on the list toolbar's `Filter → Add filter → save`.
 *
 * Contract-first (AGENTS.md #0.1): the producer folds, the spec is untouched.
 * Widening `ListViewSchema.filter` to `union([rule[], FilterGroup])` would put
 * two shapes in storage and force every reader to accept both — the exact debt
 * this repo keeps paying down.
 *
 * The READ direction lives in `@object-ui/plugin-view`
 * (`config/view-config-utils.ts`: `parseSpecFilter` / `toFilterGroup`); this is
 * its missing half, extracted from the Studio inspector's `FilterBuilderField`
 * (`metadata-admin/widgets.tsx`) which had the only copy, so the runtime
 * toolbar and Studio now fold through ONE function rather than two dialects.
 */

import { normalizeFilterOperator } from '@objectstack/spec/ui';
import type { ViewFilterRule } from '@objectstack/spec/ui';
import { VALUELESS_FILTER_BUILDER_OPERATORS, isFilterValueComplete } from '@object-ui/components';

/** Why a group could not be folded to a flat spec rule list. */
export type FilterFoldRefusal =
    /** `logic: 'or'` over 2+ conditions — a flat rule array is AND-only. */
    | 'or_logic'
    /** A condition that is itself a group — the spec rule list has no nesting. */
    | 'nested_group';

export type FilterFoldResult =
    | { ok: true; rules: ViewFilterRule[] }
    | { ok: false; reason: FilterFoldRefusal };

/** Loose shape of what the FilterBuilder hands back through `onChange`. */
interface FilterGroupLike {
    id?: string;
    logic?: string;
    conditions?: unknown[];
}

/**
 * Operators that are COMPLETE without a value, keyed by the spelling
 * `normalizeFilterOperator` folds a row's operator to.
 *
 * The builder renders no value input for these (`needsValueInput` in
 * `@object-ui/components`'s `filter-builder.tsx`), so "no value" is the row's
 * finished state, not an unfinished one.
 *
 * `exists` / `notExists` are still listed, and no longer for the reason they
 * used to be. They have no canonical spec spelling — `VIEW_FILTER_OPERATORS`
 * has no existence operator — so a rule carrying one is refused by
 * `ViewFilterRuleSchema`. That used to be their whole story here: they reached
 * this fold from the shared dropdown, and listing them kept the server's loud
 * rejection as the reason they failed rather than a silent drop as incomplete.
 * Since objectui#4736 the dropdown no longer OFFERS them to any consumer that
 * folds through here (they moved behind `OPT_IN_OPERATORS`, and only
 * `FilterConditionField` — which writes MongoDB-style criteria, never a view
 * rule — opts in), so the live path stopped producing them. They are still in
 * the set because `needsValueInput` still draws them value-less for that
 * widget, and because stored metadata may carry one — and they now arrive by
 * IMPORT rather than by being re-listed here, so that reasoning lives at the
 * one place that owns it.
 *
 * The builder half is no longer restated here: it is imported from
 * `@object-ui/components`, the module whose `needsValueInput` decides it
 * (objectui#4744). Since objectui#9306 that set is itself written in the
 * canonical spellings, so the four listed beside it are already members; they
 * stay listed so this layer's answer for the spellings a stored
 * `ViewFilterRule` carries does not depend on which vocabulary the builder's
 * set happens to be written in. `viewFilterFold.emptyValue.test.ts` pins the
 * union against that import so a new value-less operator upstream cannot land
 * here half-applied.
 *
 * ⚠️ Membership is asked of the FOLDED spelling, never of the raw one. The set
 * does NOT list the deprecated camelCase ids (`isEmpty`, `isNull`, …) that a
 * row stored before objectui#9306 may carry, and it is not meant to: listing a
 * second spelling here is how the builder's set and this one drifted before.
 * The fold below asks the normalized operator, and `sanitizeViewOverride`
 * (`ObjectView.tsx`) folds before its lookup too — a reader that asked this set
 * the RAW spelling would treat a stored `{ operator: 'isEmpty', value: '' }` as
 * a row still waiting for a value, and drop it.
 */
export const VALUELESS_FILTER_OPERATORS: ReadonlySet<string> = new Set([
    // FilterBuilder vocabulary — the one shared set, not a copy of it.
    ...VALUELESS_FILTER_BUILDER_OPERATORS,
    // …and the canonical spellings a stored rule carries, independently of it.
    'is_empty', 'is_not_empty', 'is_null', 'is_not_null',
]);

/**
 * A value the user has not supplied yet — the same predicate the live query
 * uses, which is now the builder's own {@link isFilterValueComplete}
 * (objectstack#8815).
 *
 * It used to be a local copy of the shape-blind reading (`== null || === '' ||
 * empty array`), and "the same predicate the live query uses" was true only
 * because the live query held an identical copy. Both were blind to the
 * operator's ARITY: a `between` row with one bound typed is an array of length
 * 2, so both read it as complete — the grid queried a half-open range the server
 * refuses (`400 INVALID_FILTER`) and this fold PERSISTED it, so the refusal
 * returned on every later read of that view.
 *
 * Reading the builder's export keeps the promise this comment always made: what
 * is not applied is not persisted, decided in one place instead of two copies
 * that agreed by luck.
 */
function isMissingValue(operator: unknown, value: unknown): boolean {
    return !isFilterValueComplete(
        String(operator ?? ''),
        value as Parameters<typeof isFilterValueComplete>[1],
    );
}

function isGroupLike(value: unknown): value is FilterGroupLike {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    // A nested GROUP is recognised by carrying a logic operator or its own
    // condition list — NOT merely by lacking `field`, which is also true of the
    // blank row `Add filter` inserts before the user picks a column.
    return Array.isArray(v.conditions) || v.logic === 'and' || v.logic === 'or';
}

/**
 * Fold a FilterBuilder group into the spec's `ViewFilterRule[]`.
 *
 * Folding rules:
 *
 * - **Operators** are normalized through the spec's OWN
 *   {@link normalizeFilterOperator}, so any alias spelling a row carries —
 *   including the builder's deprecated camelCase ids (`notEquals`,
 *   `greaterOrEqual`, `startsWith`, `isNull`, …) that a group read from older
 *   storage may still hold; the builder itself has emitted the canonical ids
 *   since objectui#9306 — lands on the canonical vocabulary
 *   `ViewFilterRuleSchema` enumerates. Using the spec's
 *   exported map rather than a hand-kept table is what keeps this from
 *   becoming a second dialect — the previous local table in
 *   `metadata-admin/widgets.tsx` had drifted four operators behind the
 *   builder's dropdown (`startsWith`/`endsWith`/`isNull`/`isNotNull`).
 *   An operator the spec does not know is passed through VERBATIM so the
 *   server's enum rejects it loudly, rather than being coerced to `equals`.
 * - **Blank rows are dropped.** `Add filter` inserts a row with `field: ''`;
 *   it is not yet a filter. (Same predicate the Studio inspector used.)
 * - **`id` is stripped.** It is a React list key, not spec vocabulary. Two
 *   independent reasons, both measured:
 *   1. `ViewFilterRuleSchema` is a `strictObject` over `{field, operator,
 *      value}` — the spec version this repo pins REJECTS a rule carrying `id`
 *      with `unrecognized_keys` on `filter.0`. (The issue's replay matrix saw
 *      variant ② accepted against a server running framework `main`, where
 *      objectstack-ai/objectstack#5154 tolerates the extra key; objectui's own pin does not. Keeping the
 *      id would only trade one 422 for another.)
 *   2. Nothing downstream needs it persisted: the read path regenerates it —
 *      `parseSpecFilter`'s `parseTriplet` always mints `crypto.randomUUID()`,
 *      and `parseSingleOrNested` / `toFilterGroup` fall back to one — so the
 *      builder round-trip is lossless without it.
 *   `viewFilterFold.test.ts` pins both.
 * - **An INCOMPLETE row is dropped, exactly as the live query drops it**
 *   (objectui#4155). `Add filter` inserts `{ field: <first column>, operator:
 *   'equals', value: '' }` — a row with a real field but no value yet. The live
 *   grid never applies it: `ListView.convertFilterGroupToAST` skips conditions
 *   whose value is `null` / `''` / `[]`, because `[field, '=', '']` is a
 *   silently-wrong filter (matches only the empty string) rather than "no
 *   filter". This fold used to carry that same row through VERBATIM, so the one
 *   condition the screen ignores was the one condition that got written to
 *   storage — and on the next read it became the view's whole filter, replacing
 *   the source-declared one and emptying the list for every user of that view.
 *   The two sides now agree: what is not applied is not persisted. A value-less
 *   OPERATOR ({@link VALUELESS_FILTER_OPERATORS} — `is_empty` / `is_null` and
 *   friends, in any spelling that folds onto them) is complete without a value
 *   and is kept; only a row that WANTS a
 *   value and has none is dropped.
 *
 * Refusals (objectstack#5159, maintainer adjudication A1): a shape that cannot
 * fold LOSSLESSLY is refused, never downgraded. `logic: 'or'` has no at-rest
 * representation in a flat rule array, so quietly writing those conditions as
 * AND would return a different record set than the one on screen.
 *
 * `logic: 'or'` over FEWER than two effective rules is folded rather than
 * refused: with 0 or 1 condition, OR and AND select exactly the same records,
 * so there is nothing to lose and nothing to downgrade. The refusal starts
 * where the semantics actually diverge.
 */
export function foldFilterGroupToSpecRules(group: unknown): FilterFoldResult {
    if (group == null) return { ok: true, rules: [] };

    const conditions = isGroupLike(group) && Array.isArray(group.conditions)
        ? group.conditions
        : [];

    const rules: ViewFilterRule[] = [];
    for (const condition of conditions) {
        if (isGroupLike(condition)) return { ok: false, reason: 'nested_group' };
        if (typeof condition !== 'object' || condition === null) continue;
        const c = condition as Record<string, unknown>;
        // Blank row the builder inserts before a column is chosen.
        if (typeof c.field !== 'string' || c.field === '') continue;
        const operator = normalizeFilterOperator(c.operator) as ViewFilterRule['operator'];
        // Row with a column but no value yet (objectui#4155). The live query
        // skips it; persisting it would store a filter the screen never
        // applied — and it would then REPLACE the source-declared filter on
        // the next read.
        const takesValue = !VALUELESS_FILTER_OPERATORS.has(String(c.operator))
            && !VALUELESS_FILTER_OPERATORS.has(String(operator));
        if (takesValue && isMissingValue(c.operator, c.value)) continue;
        const rule: ViewFilterRule = {
            field: c.field,
            operator,
        };
        if (c.value !== undefined) rule.value = c.value as ViewFilterRule['value'];
        rules.push(rule);
    }

    const logic = isGroupLike(group) ? group.logic : undefined;
    if (logic === 'or' && rules.length > 1) return { ok: false, reason: 'or_logic' };

    return { ok: true, rules };
}

/** i18n key carrying the user-readable refusal for each {@link FilterFoldRefusal}. */
export const FILTER_FOLD_REFUSAL_KEYS: Record<FilterFoldRefusal, string> = {
    or_logic: 'console.objectView.filterOrNotSavable',
    nested_group: 'console.objectView.filterNestedNotSavable',
};
