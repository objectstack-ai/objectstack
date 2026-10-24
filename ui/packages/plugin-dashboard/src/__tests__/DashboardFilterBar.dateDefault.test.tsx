/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * framework#4475 — the date filter's control must AGREE with the query it
 * drives.
 *
 * Setup → System Overview rendered every KPI tile as 0 while its period
 * selector read "All time". Both halves were one missing normalization: a
 * `globalFilters` entry of `type: 'date'` declares its default as a bare
 * preset NAME (`GlobalFilterSchema.defaultValue` is `string | number |
 * boolean`, so there is no object spelling to write), and only the built-in
 * `dateRange` declaration was ever lifted to `{ preset }`.
 *
 * `DateRangeFilter` derives its selected item from `value.preset` / `.from` /
 * `.to` — all `undefined` on a bare string — so the control fell through to
 * its ALL sentinel and displayed "All time" while the same raw string went
 * out as `created_at = 'last_7_days'`. The tiles therefore looked deliberately
 * unfiltered and merely empty, which is why nothing in the UI signalled a
 * failure. This pins the display half; the query half lives in
 * `@object-ui/core`'s dashboard-filters tests.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DashboardFilterBar } from '../DashboardFilterBar';
import { resolveDashboardFilterDefs } from '@object-ui/core';

afterEach(cleanup);

/** The System Overview declaration verbatim. */
const SYSTEM_OVERVIEW_FILTERS = [
  { field: 'created_at', type: 'date', label: 'Date Range', scope: 'dashboard', defaultValue: 'last_7_days' },
] as any;

describe('DashboardFilterBar — date filter default (framework#4475)', () => {
  it('shows the declared preset, not "All time"', () => {
    const defs = resolveDashboardFilterDefs({ globalFilters: SYSTEM_OVERVIEW_FILTERS });
    // The dashboard variables provider seeds values from the resolved defaults.
    const values = Object.fromEntries(defs.map((d) => [d.name, d.defaultValue]));

    render(<DashboardFilterBar defs={defs} values={values} onChange={vi.fn()} />);

    const control = screen.getByTestId('dashboard-filter-created_at');
    expect(control.textContent).not.toMatch(/All time/i);
    expect(control.textContent).toMatch(/last 7 days/i);
  });

  it('still shows "All time" when the filter genuinely has no value', () => {
    // Clearing the selector sets the value to `undefined` — that IS all-time,
    // and it must keep reading that way.
    const defs = resolveDashboardFilterDefs({ globalFilters: SYSTEM_OVERVIEW_FILTERS });

    render(<DashboardFilterBar defs={defs} values={{ created_at: undefined }} onChange={vi.fn()} />);

    expect(screen.getByTestId('dashboard-filter-created_at').textContent).toMatch(/All time/i);
  });
});

/**
 * objectui#4165 — a stored dashboard carrying the LEGACY `{ preset }` spelling
 * of the same declaration must render identically.
 *
 * The maintainer ruling made the bare preset name the single canonical
 * spelling and turned the object form into an ADR-0089 legacy alias, lifted on
 * read by `resolveDashboardFilterDefs`. "Lifted" is only worth anything if the
 * user cannot tell: this is the display half of that claim, and it is asserted
 * against the framework#4475 fixture above rather than a fresh one, so the two
 * spellings are compared on identical input.
 */
describe('DashboardFilterBar — legacy `{ preset }` default (objectui#4165)', () => {
  const LEGACY_FILTERS = [
    { field: 'created_at', type: 'date', label: 'Date Range', scope: 'dashboard', defaultValue: { preset: 'last_7_days' } },
  ] as any;

  it('renders a lifted legacy default exactly like the canonical one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const legacyDefs = resolveDashboardFilterDefs({ globalFilters: LEGACY_FILTERS });
      const canonicalDefs = resolveDashboardFilterDefs({ globalFilters: SYSTEM_OVERVIEW_FILTERS });
      expect(legacyDefs).toEqual(canonicalDefs);

      const values = Object.fromEntries(legacyDefs.map((d) => [d.name, d.defaultValue]));
      render(<DashboardFilterBar defs={legacyDefs} values={values} onChange={vi.fn()} />);

      const control = screen.getByTestId('dashboard-filter-created_at');
      expect(control.textContent).not.toMatch(/All time/i);
      expect(control.textContent).toMatch(/last 7 days/i);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * objectui#10339 — the built-in `dateRange` with NO `defaultRange` takes the
 * spec's declared default preset (`this_month` on the pinned spec), so the
 * control must read that preset rather than "All time".
 */
describe('DashboardFilterBar — built-in dateRange omitting defaultRange (objectui#10339)', () => {
  it('shows the spec default preset, not "All time"', () => {
    const defs = resolveDashboardFilterDefs({ dateRange: { field: 'created_at' } });
    const values = Object.fromEntries(defs.map((d) => [d.name, d.defaultValue]));

    render(<DashboardFilterBar defs={defs} values={values} onChange={vi.fn()} />);

    const control = screen.getByTestId('dashboard-filter-dateRange');
    expect(control.textContent).not.toMatch(/All time/i);
    expect(control.textContent).toMatch(/this month/i);
  });
});
