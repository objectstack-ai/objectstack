/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0047 (amended, #2338): a `dropdown` `userFilters` is honored on an object
 * list view (Airtable quick-filter pills). Only `quickFilters` and a `tabs`
 * `userFilters` stay page-only and are suppressed by ObjectView — the author
 * must get a console warning for those, once per object/view. A `dropdown`
 * userFilters must NOT warn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    warnSuppressedListNav,
    resetSuppressedListNavWarnings,
} from '../warnSuppressedListNav';

const DROPDOWN_FILTERS = { element: 'dropdown', fields: [{ field: 'status' }] };
const TABS_FILTERS = { element: 'tabs', tabs: [{ label: 'Mine', filter: [] }] };

describe('warnSuppressedListNav (#2338)', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetSuppressedListNavWarnings();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it('does NOT warn for a dropdown userFilters (honored on object views)', () => {
        const hit = warnSuppressedListNav('showcase_task', 'showcase_task.tabular',
            { userFilters: DROPDOWN_FILTERS }, {});
        expect(hit).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns when the view def carries a tabs userFilters', () => {
        const hit = warnSuppressedListNav('showcase_task', 'showcase_task.tabular',
            { userFilters: TABS_FILTERS }, {});
        expect(hit).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = warn.mock.calls[0][0] as string;
        expect(msg).toContain('showcase_task.tabular');
        expect(msg).toContain('userFilters');
        expect(msg).toContain('ADR-0047');
    });

    it('warns when only the base list schema carries quickFilters', () => {
        const hit = warnSuppressedListNav('showcase_task', 'all',
            {}, { quickFilters: [{ field: 'status' }] });
        expect(hit).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('quickFilters');
    });

    it('warns only once per object/view across re-renders', () => {
        warnSuppressedListNav('showcase_task', 'tabular', { userFilters: TABS_FILTERS }, {});
        warnSuppressedListNav('showcase_task', 'tabular', { userFilters: TABS_FILTERS }, {});
        expect(warn).toHaveBeenCalledTimes(1);
        // A different view still gets its own warning.
        warnSuppressedListNav('showcase_task', 'board', { userFilters: TABS_FILTERS }, {});
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('stays silent for a clean view', () => {
        const hit = warnSuppressedListNav('showcase_task', 'grid', { filter: [] }, {});
        expect(hit).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });
});
