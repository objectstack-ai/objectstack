/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4155, the RECOVERY half — a poisoned view overlay must stop
 * overriding the source-declared filter, on READ, without a `sys_metadata`
 * delete and a service restart.
 *
 * Two overlay bodies were destructive, both written by the filter panel:
 *
 *   `filter: [{ field: 'x', operator: 'equals', value: '' }]` — the row
 *      `Add filter` inserts. The live grid never applied it, but merged over
 *      the source view (`{ ...source, ...override }`) it BECAME the view's
 *      whole filter, so the list came back `total: 0` for every user.
 *   `filter: []` — what "Clear all" wrote. Not poisoned, but it still deletes
 *      the source declaration (`status not_in [archived, deleted]`) silently.
 *
 * The merge semantics are MEASURED here, not assumed, because the fix rests on
 * them: `{ ...source, ...override }` is key-wise, so an override carrying
 * `filter: []` is NOT the same as an override carrying no `filter` — the first
 * replaces the declaration with "no filter", the second falls through to it.
 * That is why the sanitizer deletes the key rather than writing an empty array.
 *
 * SUITE DIRECTION — predicted, then MEASURED, and the two did not agree; the
 * measured result is the one recorded here.
 *
 * Predicted: the first two blocks RED against `origin/main` (which returns the
 * override untouched), while the `what must NOT change` block stayed green in
 * both worlds as a control.
 *
 * Measured (revert the three source files, keep these tests): **every** case in
 * this file goes red — 24 red / 13 green across the #4155 suites. The control
 * block goes red too, and NOT for a behavioural reason: `sanitizeViewOverride`
 * does not exist on `origin/main`, so the import on the next line fails and the
 * whole module dies before a single assertion runs.
 *
 * Worth stating plainly, because it bounds what this file can prove: against
 * `origin/main` the control cases are NOT discriminating — a missing export
 * cannot tell "kept the real conditions" apart from "module did not load". They
 * are controls in the FORWARD direction only, pinning what must not change as
 * the sanitizer is edited from here on. The cases that genuinely discriminate
 * old behaviour from new are the ones whose failure message quotes a VALUE
 * (`expected [ { field: 'status', … } ] to deeply equal []`), not an import.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadViewOverrides, sanitizeViewOverride } from './ObjectView';

/** The source-declared view body — what the overlay must not be able to erase. */
const SOURCE_VIEW = {
    label: 'All work orders',
    columns: ['name', 'status'],
    filter: [{ field: 'status', operator: 'not_in', value: ['archived', 'deleted'] }],
};

/** The overlay row the filter panel wrote on `Add filter`. */
const POISONED_OVERLAY = {
    name: 'wo.all',
    object: 'work_order',
    filter: [{ field: 'name', operator: 'equals', value: '' }],
};

describe('sanitizeViewOverride — the stray empty-value condition (#4155)', () => {
    it('drops the `field equals ""` condition the panel wrote', () => {
        expect(sanitizeViewOverride(POISONED_OVERLAY)).toEqual({
            name: 'wo.all',
            object: 'work_order',
        });
    });

    it('drops the `filter` KEY, not just its contents — that is what restores the source filter', () => {
        const sanitized = sanitizeViewOverride(POISONED_OVERLAY);
        // `filter: []` would still win the spread and blank the declaration.
        expect('filter' in sanitized).toBe(false);
    });

    it('MEASURED merge semantics: the source-declared filter wins again', () => {
        // Exactly the merge `ObjectView`'s `views` memo performs.
        const merged = { ...SOURCE_VIEW, ...sanitizeViewOverride(POISONED_OVERLAY) };
        expect(merged.filter).toEqual(SOURCE_VIEW.filter);
    });

    it('…and the UNSANITIZED overlay is what destroyed it — the control', () => {
        const merged = { ...SOURCE_VIEW, ...POISONED_OVERLAY };
        expect(merged.filter).toEqual([{ field: 'name', operator: 'equals', value: '' }]);
        expect(merged.filter).not.toEqual(SOURCE_VIEW.filter);
    });

    it('keeps the overlay’s OTHER personalization — only the filter opinion is dropped', () => {
        const sanitized = sanitizeViewOverride({
            ...POISONED_OVERLAY,
            rowHeight: 'short',
            columnState: { order: ['status', 'name'] },
        });
        expect(sanitized.rowHeight).toBe('short');
        expect(sanitized.columnState).toEqual({ order: ['status', 'name'] });
        expect('filter' in sanitized).toBe(false);
    });
});

describe('sanitizeViewOverride — "Clear all" left an empty filter (#4155)', () => {
    it('an overlay with `filter: []` no longer blanks the source declaration', () => {
        const cleared = { name: 'wo.all', object: 'work_order', filter: [] };
        const merged = { ...SOURCE_VIEW, ...sanitizeViewOverride(cleared) };
        expect(merged.filter).toEqual(SOURCE_VIEW.filter);
    });

    it('the empty array is dropped even though nothing was FILTERED OUT of it', () => {
        // Regression guard for the ordering bug this fix nearly shipped: an
        // "unchanged → return as-is" shortcut ahead of the empty check hands
        // `filter: []` straight back.
        expect('filter' in sanitizeViewOverride({ name: 'v', filter: [] })).toBe(false);
    });
});

describe('sanitizeViewOverride — what must NOT change', () => {
    it('keeps an overlay filter that carries real conditions (an explicit save)', () => {
        const saved = {
            name: 'wo.mine',
            filter: [{ field: 'owner', operator: 'equals', value: 'u1' }],
        };
        expect(sanitizeViewOverride(saved)).toEqual(saved);
        expect({ ...SOURCE_VIEW, ...sanitizeViewOverride(saved) }.filter).toEqual(saved.filter);
    });

    it('keeps a value-less operator — `is_empty` needs no value to be complete', () => {
        const saved = { name: 'v', filter: [{ field: 'closed_at', operator: 'is_empty' }] };
        expect(sanitizeViewOverride(saved)).toEqual(saved);
    });

    it('keeps the real conditions and drops only the stray one', () => {
        const mixed = {
            name: 'v',
            filter: [
                { field: 'owner', operator: 'equals', value: 'u1' },
                { field: 'name', operator: 'equals', value: '' },
            ],
        };
        expect(sanitizeViewOverride(mixed).filter).toEqual([
            { field: 'owner', operator: 'equals', value: 'u1' },
        ]);
    });

    it('handles the legacy runtime TRIPLE shape a source view may declare', () => {
        // `persistViewPatch` USED TO copy the whole view body into the overlay
        // (objectui#5233 narrowed it to the patch), so an overlay's `filter` can
        // be triples rather than spec rule objects — on any row written before
        // that landed, and on a saved view's own body.
        expect(sanitizeViewOverride({ name: 'v', filter: [['status', '=', '']] }))
            .toEqual({ name: 'v' });
        const real = { name: 'v', filter: [['status', 'not_in', ['archived']]] };
        expect(sanitizeViewOverride(real)).toEqual(real);
    });

    it('leaves a non-array (Mongo-style object) filter alone', () => {
        const objFilter = { name: 'v', filter: { status: { $ne: 'archived' } } };
        expect(sanitizeViewOverride(objFilter)).toEqual(objFilter);
    });

    it('passes through overrides with no filter at all, and non-objects', () => {
        expect(sanitizeViewOverride({ name: 'v', rowHeight: 'tall' })).toEqual({ name: 'v', rowHeight: 'tall' });
        expect(sanitizeViewOverride(null)).toBe(null);
        expect(sanitizeViewOverride(undefined)).toBe(undefined);
    });
});

describe('loadViewOverrides applies the sanitizer on BOTH read branches (#4155)', () => {
    const IDS = ['wo.all'];

    it('the batch branch', async () => {
        const dataSource = {
            listViewOverrides: vi.fn(async () => ({ 'wo.all': POISONED_OVERLAY })),
            getView: vi.fn(),
        };
        const map = await loadViewOverrides(dataSource, 'work_order', IDS);
        expect('filter' in map['wo.all']).toBe(false);
    });

    it('the per-view fallback branch', async () => {
        // Only `getView` — the branch a minimal adapter takes. A poisoned row
        // read here reached the merge untouched before this fix.
        const dataSource = { getView: vi.fn(async () => POISONED_OVERLAY) };
        const map = await loadViewOverrides(dataSource, 'work_order', IDS);
        expect('filter' in map['wo.all']).toBe(false);
    });

    it('#3774 stays intact: a rejecting batch still falls through to per-view', async () => {
        const dataSource = {
            listViewOverrides: vi.fn(async () => { throw new Error('503'); }),
            getView: vi.fn(async () => ({ name: 'wo.all', rowHeight: 'short' })),
        };
        const map = await loadViewOverrides(dataSource, 'work_order', IDS);
        expect(map).toEqual({ 'wo.all': { name: 'wo.all', rowHeight: 'short' } });
        expect(dataSource.getView).toHaveBeenCalledTimes(1);
    });
});
