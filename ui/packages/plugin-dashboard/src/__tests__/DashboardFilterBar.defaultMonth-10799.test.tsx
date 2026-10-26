/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard date filter's custom-range calendar opens on the month of the
 * range's first day (objectui#10799).
 *
 * react-day-picker opens on `month`, else `defaultMonth`, else today, and
 * `selected` does not move it. This `Calendar` mount passed `selected` only,
 * so a stored custom range outside the current month opened on today's month.
 * It now passes the range's `from` as `defaultMonth`.
 *
 * ⚠️ The popover is rendered open here, not opened through the filter's
 * select. The select opens it from its "Custom…" item, and with a custom range
 * already stored that item is the select's current value: picking it again
 * changes nothing, so the select never reports it and the popover stays shut.
 * These cases therefore read the mount itself, the way it renders once open.
 *
 * The clock is faked for `Date` alone and set in another year than the range.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { resolveDashboardFilterDefs } from '@object-ui/core';

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { ...actual, Popover: Passthrough, PopoverTrigger: Passthrough, PopoverContent: Passthrough };
});

// Imported after the mock is declared (vitest hoists `vi.mock` anyway).
import { DashboardFilterBar } from '../DashboardFilterBar';

/** Today, in another year than the range below. */
const TODAY = new Date(2026, 8, 27, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const defs = resolveDashboardFilterDefs({ dateRange: { field: 'created_at' } });

function captions(): string[] {
  return [...document.body.querySelectorAll('.rdp-caption_label')].map((el) => (el.textContent ?? '').trim());
}

describe('DashboardFilterBar — the custom range opens on its first day (objectui#10799)', () => {
  it('a range in another year opens on its `from` month', () => {
    render(<DashboardFilterBar defs={defs} values={{ dateRange: { from: '2020-03-15', to: '2020-03-20' } }} onChange={vi.fn()} />);
    // Two months side by side, starting at `from`.
    expect(captions()).toEqual(['March 2020', 'April 2020']);
  });

  it('a `from` that names no instant opens on today and does not throw', () => {
    render(<DashboardFilterBar defs={defs} values={{ dateRange: { from: 'not-a-date' } }} onChange={vi.fn()} />);
    expect(captions()).toEqual(['September 2026', 'October 2026']);
  });

  it('control: no range opens on today', () => {
    render(<DashboardFilterBar defs={defs} values={{ dateRange: undefined }} onChange={vi.fn()} />);
    expect(captions()).toEqual(['September 2026', 'October 2026']);
  });
});
