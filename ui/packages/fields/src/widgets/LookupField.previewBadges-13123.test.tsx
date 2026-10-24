/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lookup quick-picker's option preview never cuts a badge — objectui#13123.
 *
 * Measured in a browser on the showcase's Account lookup: each option's preview
 * line read "Lifecycle: A. · Industry: Tec... · Annual Revenue: $96,00...".
 * Every previewed column was one `min-w-0 truncate` span, so the line shrank
 * all of them together, and inside each the label kept its width while the
 * value took the whole cut: a `select` badge fell to its padding with its text
 * at zero width.
 *
 * The rule now: a badge shows its whole label or the line drops its column.
 *
 *  - A column whose cell is drawn by the renderer that draws a `select` badge
 *    keeps its width: neither the column nor its value clamps it.
 *  - Any other column still truncates its value (the control).
 *  - A column the line cannot hold leaves whole — label and value together —
 *    with every column after it, and comes back when the line widens.
 *
 * jsdom has no layout, so the first half is pinned on the classes that do the
 * clamping, and the second on the line's measured widths, stubbed here. The
 * pixels themselves were read in Chromium; the pull request records them.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LookupField } from './LookupField';
// Installs the cell-renderer resolver the preview draws its values with.
import '../index';

/** A field of the referenced object's schema, as `getObjectSchema` serves it. */
type SchemaField = { type: string; label: string; [key: string]: unknown };

const FIELDS: Record<string, SchemaField> = {
  name: { type: 'text', label: 'Account Name' },
  status: {
    type: 'select',
    label: 'Lifecycle',
    options: [
      { value: 'active', label: 'Active', color: '#10B981' },
      { value: 'prospect', label: 'Prospect', color: '#94A3B8' },
    ],
  },
  industry: {
    type: 'select',
    label: 'Industry',
    options: [{ value: 'technology', label: 'Technology' }],
  },
  // Not `select`, but drawn by the same badge renderer: the renderer map
  // decides which columns are badges, not a list of type names.
  tier: {
    type: 'radio',
    label: 'Tier',
    options: [{ value: 'gold', label: 'Gold' }],
  },
  annual_revenue: {
    type: 'currency',
    label: 'Annual Revenue',
    currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
  },
  billing_email: { type: 'text', label: 'Billing Email' },
};

const ROW = {
  id: 'acc_1',
  name: 'Northwind Traders',
  status: 'active',
  industry: 'technology',
  tier: 'gold',
  annual_revenue: 96000000,
  billing_email: 'accounts.payable@northwind.example.com',
};

const BADGE_COLUMNS = ['status', 'industry', 'tier'];
const TEXT_COLUMNS = ['annual_revenue', 'billing_email'];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [ROW], total: 1 })),
    findOne: vi.fn(async () => ROW),
    getObjectSchema: vi.fn(async (objectName: string) => ({ name: objectName, fields: FIELDS })),
  };
}

async function openPicker(columns: string[]): Promise<void> {
  const dataSource = makeDataSource();
  // Labelled, as the showcase's columns (derived from its `highlightFields`) are.
  const lookupColumns = columns.map((field) => ({ field, label: FIELDS[field].label }));
  render(
    <LookupField
      value={undefined}
      onChange={() => {}}
      // Read-only: the picker only reads, so the write members stay absent.
      dataSource={dataSource as never}
      field={{ reference: 'showcase_account', displayField: 'name', lookupColumns } as never}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getByText('Northwind Traders')).toBeInTheDocument());
  // The badges need the referenced object's schema (their option labels).
  await waitFor(() => expect(document.querySelector('[data-lookup-preview="status"] [title="Active"]')).not.toBeNull());
}

/** The value of one previewed column. */
function valueOf(field: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-lookup-preview="${field}"]`);
  if (!el) throw new Error(`no previewed value for ${field}`);
  return el;
}

/** The segment the line shows or drops as one: separator, label and value. */
function segmentOf(field: string): HTMLElement {
  return valueOf(field).parentElement as HTMLElement;
}

/** The classes that let a box shrink below its content, or cut what overflows. */
const CLAMPS = ['truncate', 'min-w-0', 'overflow-hidden'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LookupField option preview: a badge is never cut (objectui#13123)', () => {
  it('gives a badge column no clamp, so its badge keeps its whole label', async () => {
    await openPicker(['name', ...BADGE_COLUMNS, ...TEXT_COLUMNS]);

    for (const field of BADGE_COLUMNS) {
      const value = valueOf(field);
      const segment = segmentOf(field);
      for (const clamp of CLAMPS) {
        expect(value.classList.contains(clamp), `${field} value carries ${clamp}`).toBe(false);
        expect(segment.classList.contains(clamp), `${field} column carries ${clamp}`).toBe(false);
      }
      expect(segment.classList.contains('shrink-0'), `${field} column shrinks`).toBe(true);
      // The badge itself is inside the unclamped value.
      expect(value.querySelector('div[title]'), `${field} draws no badge`).not.toBeNull();
    }
  });

  it('still truncates a text column: the control', async () => {
    await openPicker(['name', ...BADGE_COLUMNS, ...TEXT_COLUMNS]);

    for (const field of TEXT_COLUMNS) {
      const value = valueOf(field);
      expect(value.classList.contains('truncate'), `${field} value no longer truncates`).toBe(true);
      expect(value.classList.contains('min-w-0'), `${field} value no longer shrinks`).toBe(true);
      expect(segmentOf(field).classList.contains('shrink-0'), `${field} column stopped shrinking`).toBe(false);
    }
  });

  it('keeps each column whole in one segment: its separator, label and value', async () => {
    await openPicker(['name', 'status', 'industry', 'annual_revenue']);

    const line = screen.getByTestId('lookup-option-preview');
    expect(Array.from(line.children)).toEqual([segmentOf('status'), segmentOf('industry'), segmentOf('annual_revenue')]);
    expect(segmentOf('status').textContent).toBe('Lifecycle:Active');
    expect(segmentOf('industry').textContent).toBe('·Industry:Technology');
    expect(segmentOf('annual_revenue').textContent).toContain('·Annual Revenue:');
  });
});

/**
 * The line's layout, modelled: each column has a width, the segments sit 4px
 * apart, and a hidden segment takes no room. `lineWidth` is the line's box.
 */
const COLUMN_WIDTH: Record<string, number> = { status: 114, industry: 148, annual_revenue: 130 };
let lineWidth = 0;

function stubLineLayout(): void {
  const isLine = (el: HTMLElement) => el.dataset.testid === 'lookup-option-preview';
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isLine(this) ? lineWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (!isLine(this)) return 0;
    const shown = Array.from(this.children).filter((s) => !(s as HTMLElement).hidden);
    const content = shown.reduce((sum, s) => {
      const field = s.querySelector('[data-lookup-preview]')?.getAttribute('data-lookup-preview') ?? '';
      return sum + (COLUMN_WIDTH[field] ?? 0);
    }, 0);
    // The browser reports the box's own width when the content is narrower.
    return Math.max(lineWidth, content + 4 * Math.max(0, shown.length - 1));
  });
}

/** A `ResizeObserver` the test fires by hand, for the preview lines only. */
const lineObservers: Array<() => void> = [];
function stubResizeObserver(): void {
  class LineObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if ((target as HTMLElement).dataset?.testid === 'lookup-option-preview') {
        lineObservers.push(() => this.callback([], this as never));
      }
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', LineObserver);
}

function shownColumns(): string[] {
  return ['status', 'industry', 'annual_revenue'].filter((f) => !segmentOf(f).hidden);
}

describe('LookupField option preview: a column the line cannot hold leaves whole (objectui#13123)', () => {
  it.each([
    // The card's width: both badges whole, the revenue column dropped.
    [280, ['status', 'industry']],
    [180, ['status']],
    [600, ['status', 'industry', 'annual_revenue']],
    // Not even the first badge fits: the line drops it rather than cut it.
    [100, []],
  ])('on a %ipx line shows %j', async (width, expected) => {
    lineWidth = width;
    stubLineLayout();
    await openPicker(['name', 'status', 'industry', 'annual_revenue']);

    expect(shownColumns()).toEqual(expected);
    // A dropped column leaves with its label and separator, never as a stub.
    for (const field of ['status', 'industry', 'annual_revenue']) {
      if (expected.includes(field)) continue;
      expect(segmentOf(field).hidden).toBe(true);
      expect(valueOf(field).closest('[hidden]')).toBe(segmentOf(field));
    }
  });

  it('brings a dropped column back when the line widens, and drops it again when it narrows', async () => {
    lineObservers.length = 0;
    stubResizeObserver();
    lineWidth = 180;
    stubLineLayout();
    await openPicker(['name', 'status', 'industry', 'annual_revenue']);
    expect(shownColumns()).toEqual(['status']);
    expect(lineObservers.length).toBeGreaterThan(0);

    lineWidth = 600;
    act(() => lineObservers.forEach((fire) => fire()));
    expect(shownColumns()).toEqual(['status', 'industry', 'annual_revenue']);

    lineWidth = 280;
    act(() => lineObservers.forEach((fire) => fire()));
    expect(shownColumns()).toEqual(['status', 'industry']);
  });
});
