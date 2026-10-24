/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5025 — the overlay RECOVERY pass must strip a half-filled `between`.
 *
 * The third site of objectstack#8815, and the one that matters most, because it
 * is the pass that exists to CLEAN UP the shape the other two used to write.
 * All three asked "is this filter row filled in?" with one shape-blind
 * predicate:
 *
 * ```ts
 * value == null || value === '' || (Array.isArray(value) && value.length === 0)
 * ```
 *
 * Right for `scalar` and `list`, blind to `pair`. A `between` row with one bound
 * typed is `['2024-01-01', '']` — an array of length 2 — so it read as a real
 * condition. The two WRITE paths were converted (`plugin-list/src/ListView.tsx`,
 * `views/viewFilterFold.ts`); `sanitizeViewOverride` kept the verbatim copy, so
 * the read path handed the half-range straight back to the merge and the view
 * went on being refused (`400 INVALID_FILTER`) for every user on every load.
 *
 * WHY THIS IS REACHABLE, not dead-but-misleading code — the question the card
 * asked to measure first. Two independent producers, neither of them the
 * converted builder:
 *
 *   1. Installs that ran a pre-conversion build. `foldFilterGroupToSpecRules`
 *      persisted half-filled ranges into stored view bodies, and this pass is
 *      documented as the recovery half for exactly that class of row — "an
 *      install already carrying a poisoned row self-heals on the next load".
 *      It self-healed every arity except the one the sibling issue was about.
 *   2. Any producer that is not the builder — hand-authored view JSON, an
 *      AI-authored metadata app, an import, a migration — because the SPEC
 *      accepts the shape. Measured below rather than asserted from the
 *      docstring: `ViewFilterRuleSchema` counts the two slots and does not ask
 *      what is in them, so authoring validation is green on a half-filled range
 *      and it only dies at query time. That makes this read-path pass the last
 *      guard standing, not a tidy-up.
 *
 * SUITE DIRECTION — stated before running.
 *
 *   RED under the mutation leg that restores the old predicate at both branches
 *   of `sanitizeViewOverride`: every case in the two `between` blocks below.
 *   Those are the discriminating ones; each quotes a VALUE in its failure, not
 *   an import.
 *
 *   GREEN under that same leg, by design: the whole `arities this change must
 *   not touch` block (the old predicate is CORRECT for `scalar` and `list`, so
 *   an assertion that passes on it there proves the change stayed scoped), plus
 *   the spec-acceptance case, which is a fact about `@objectstack/spec` and
 *   would pass in any world. It is recorded because it is the reason the pair
 *   cases matter, and it is labelled non-discriminating so nobody later reads
 *   it as a pin on OUR code.
 *
 *   Those controls are shown capable of failing by a SECOND leg (see the PR
 *   body): making the sanitizer's predicate answer `false` unconditionally
 *   turns the control block red while leaving the pair block green — the two
 *   legs fail in disjoint directions, which is what makes each of them a
 *   measurement rather than a decoration.
 */

import { describe, it, expect } from 'vitest';
import { ViewFilterRuleSchema } from '@objectstack/spec/ui';
import { sanitizeViewOverride } from './ObjectView';

/** The source-declared body an overlay must not be able to poison or erase. */
const SOURCE_VIEW = {
    label: 'All work orders',
    columns: ['name', 'declare_date'],
    filter: [{ field: 'status', operator: 'not_in', value: ['archived', 'deleted'] }],
};

const overlay = (filter: unknown[]) => ({ name: 'wo.all', object: 'work_order', filter });

describe('sanitizeViewOverride — a `between` needs both bounds (#5025)', () => {
    it.each([
        ['upper bound missing', ['2024-01-01', '']],
        ['lower bound missing', ['', '2024-03-01']],
        ['both bounds missing', ['', '']],
        // Not an array at all. The spec REFUSES a scalar under `between`
        // (measured in the block below), so the server would refuse it too —
        // stripping it is the same judgement, one layer earlier.
        ['a scalar where a range belongs', '2024-01-01'],
    ])('drops the whole `filter` key when the only rule has %s', (_name, value) => {
        const sanitized = sanitizeViewOverride(
            overlay([{ field: 'declare_date', operator: 'between', value }]),
        );
        // The KEY, not an empty array: `{ ...source, ...override }` is key-wise,
        // so `filter: []` would still blank the source declaration.
        expect('filter' in sanitized).toBe(false);
        expect({ ...SOURCE_VIEW, ...sanitized }.filter).toEqual(SOURCE_VIEW.filter);
    });

    it('drops it in the legacy runtime triple shape too', () => {
        const sanitized = sanitizeViewOverride(
            overlay([['declare_date', 'between', ['2024-01-01', '']]]),
        );
        expect('filter' in sanitized).toBe(false);
    });

    it('drops only the half-filled range, keeping the complete rules beside it', () => {
        expect(
            sanitizeViewOverride(
                overlay([
                    { field: 'stage', operator: 'equals', value: 'won' },
                    { field: 'declare_date', operator: 'between', value: ['2024-01-01', ''] },
                ]),
            ).filter,
        ).toEqual([{ field: 'stage', operator: 'equals', value: 'won' }]);
    });
});

describe('sanitizeViewOverride — a complete `between` survives untouched (#5025)', () => {
    it('keeps a range with both bounds, and returns the row by identity', () => {
        const row = overlay([
            { field: 'declare_date', operator: 'between', value: ['2024-01-01', '2024-03-01'] },
        ]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });

    it('keeps a bound of 0 — a real bound on a number column (objectui#4873)', () => {
        const row = overlay([{ field: 'amount', operator: 'between', value: [0, 100] }]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });

    it('keeps a bound of `false`, which `!bound` would have read as unfilled', () => {
        const row = overlay([{ field: 'flag', operator: 'between', value: [false, true] }]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });

    it('keeps a complete range in the legacy runtime triple shape', () => {
        const row = overlay([['declare_date', 'between', ['2024-01-01', '2024-03-01']]]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });
});

describe('the arities this change must not touch (#5025)', () => {
    // The retired predicate is CORRECT for `scalar` and `list`. These cases read
    // identically before and after, and that is the point: a red here means the
    // conversion reached past `pair`.
    it('still drops an empty scalar and an empty list', () => {
        expect(
            sanitizeViewOverride(
                overlay([
                    { field: 'name', operator: 'equals', value: '' },
                    { field: 'kind', operator: 'in', value: [] },
                    { field: 'owner', operator: 'equals', value: null },
                ]),
            ).filter,
        ).toBeUndefined();
    });

    it('still keeps a filled scalar and a non-empty list', () => {
        const row = overlay([
            { field: 'name', operator: 'equals', value: 'acme' },
            { field: 'kind', operator: 'in', value: ['a'] },
        ]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });

    it('still keeps a value-less operator whose value slot is empty', () => {
        // Both spellings a stored overlay can carry: the canonical one (the
        // builder's own id since objectui#9306) and the deprecated camelCase
        // one a row stored before that change still holds.
        const row = overlay([
            { field: 'closed_at', operator: 'isEmpty', value: '' },
            { field: 'owner', operator: 'is_null', value: '' },
        ]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });
});

/**
 * objectui#9306 — the recovery pass FOLDS a row's operator before asking
 * whether it takes a value.
 *
 * The value-less set it asks (`VALUELESS_FILTER_OPERATORS`) is written in the
 * protocol's spellings, and since objectui#9306 so is the builder half of it:
 * the deprecated camelCase ids are no longer members. A stored overlay row
 * `{ operator: 'isEmpty', value: '' }` — written before that change — would
 * then miss a RAW lookup, fall to the value test, have its `''` read as
 * unfilled, and be DROPPED: the stored filter loses a condition on read, and
 * the list widens to rows the author excluded. Every spelling below is one the
 * spec's alias table folds onto a value-less member.
 */
describe('a stored deprecated-spelling value-less row survives the recovery pass (objectui#9306)', () => {
    it.each([
        ['isEmpty', 'is_empty'],
        ['isNotEmpty', 'is_not_empty'],
        ['isNull', 'is_null'],
        ['isNotNull', 'is_not_null'],
        ['isnull', 'is_null'],
    ])('`%s` (folds to `%s`) with an empty value slot is KEPT', (operator) => {
        const row = overlay([{ field: 'closed_at', operator, value: '' }]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });

    it('…in the legacy runtime triple shape too', () => {
        const row = overlay([['closed_at', 'isEmpty', '']]);
        expect(sanitizeViewOverride(row)).toBe(row);
    });

    it('CONTROL: a value-TAKING deprecated spelling with no value is still dropped', () => {
        // The fold must not make every camelCase row look finished: `notEquals`
        // takes a value, so an empty one is an unfinished row exactly as its
        // canonical twin's is.
        expect(
            sanitizeViewOverride(overlay([{ field: 'name', operator: 'notEquals', value: '' }])).filter,
        ).toBeUndefined();
        expect(
            sanitizeViewOverride(overlay([{ field: 'name', operator: 'not_equals', value: '' }])).filter,
        ).toBeUndefined();
    });
});

describe('why the read path is the last guard (#5025)', () => {
    // NON-DISCRIMINATING by construction: this asserts a fact about
    // `@objectstack/spec`, not about `sanitizeViewOverride`, so it is green in
    // every world. It is here because it is the reason the cases above are a
    // bug fix rather than a tidy-up — authoring validation cannot catch this
    // shape, so nothing upstream of the recovery pass will.
    it('the spec ACCEPTS a half-filled range, so authoring validation lets it through', () => {
        expect(
            ViewFilterRuleSchema.safeParse({
                field: 'declare_date',
                operator: 'between',
                value: ['2024-01-01', ''],
            }).success,
        ).toBe(true);
    });

    it('…while refusing the shapes that are merely malformed', () => {
        for (const value of ['2024-01-01', ['2024-01-01']]) {
            expect(
                ViewFilterRuleSchema.safeParse({
                    field: 'declare_date',
                    operator: 'between',
                    value,
                }).success,
                JSON.stringify(value),
            ).toBe(false);
        }
    });
});
