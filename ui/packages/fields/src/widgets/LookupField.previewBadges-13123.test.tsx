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

async function openPicker(columns: string[], extra: { compact?: boolean } = {}): Promise<void> {
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
      {...extra}
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
 * The preview's layout, modelled: each column has a width, the segments sit
 * 4px apart and wrap onto the next row (20px down) when they do not fit beside
 * the one before, a hidden segment takes no room, and a badge wider than the
 * line overflows it where a text column would shrink to it. `lineWidth` is the
 * line's box.
 */
const COLUMN_WIDTH: Record<string, number> = { status: 114, industry: 148, annual_revenue: 130 };
const BADGES = new Set(['status', 'industry']);
let lineWidth = 0;

const isLine = (el: Element | null): el is HTMLElement => (el as HTMLElement | null)?.dataset?.testid === 'lookup-option-preview';
const fieldOf = (segment: Element) =>
  segment.querySelector('[data-lookup-preview]')?.getAttribute('data-lookup-preview') ?? '';

/** Each shown segment's row offset, and the widest badge the line must hold. */
function layoutOf(line: HTMLElement): { tops: Map<Element, number>; widest: number } {
  const tops = new Map<Element, number>();
  let x = 0;
  let row = 0;
  let widest = 0;
  for (const segment of Array.from(line.children)) {
    if ((segment as HTMLElement).hidden) continue;
    const field = fieldOf(segment);
    const natural = COLUMN_WIDTH[field] ?? 0;
    const width = BADGES.has(field) ? natural : Math.min(natural, lineWidth);
    if (BADGES.has(field)) widest = Math.max(widest, natural);
    if (x > 0 && x + 4 + width > lineWidth) {
      row += 1;
      x = 0;
    }
    x += (x > 0 ? 4 : 0) + width;
    tops.set(segment, row * 20);
  }
  return { tops, widest };
}

function stubLineLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isLine(this) ? lineWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    // The browser reports the box's own width when the content is narrower.
    return isLine(this) ? Math.max(lineWidth, layoutOf(this).widest) : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return isLine(this.parentElement) ? layoutOf(this.parentElement).tops.get(this) ?? 0 : 0;
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

describe('LookupField option preview: a column the rows cannot hold leaves whole (objectui#13123)', () => {
  it.each([
    // The card's width: the revenue column wraps onto the second row whole.
    [280, ['status', 'industry', 'annual_revenue']],
    // One column a row: a third row is one too many, so revenue leaves.
    [180, ['status', 'industry']],
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
    expect(shownColumns()).toEqual(['status', 'industry']);
    expect(lineObservers.length).toBeGreaterThan(0);

    lineWidth = 600;
    act(() => lineObservers.forEach((fire) => fire()));
    expect(shownColumns()).toEqual(['status', 'industry', 'annual_revenue']);

    lineWidth = 100;
    act(() => lineObservers.forEach((fire) => fire()));
    expect(shownColumns()).toEqual([]);
  });
});

/** The `·` that leads every column after the first. */
function separatorOf(field: string): HTMLElement {
  const sep = segmentOf(field).querySelector<HTMLElement>('[data-lookup-preview-separator]');
  if (!sep) throw new Error(`no separator before ${field}`);
  return sep;
}

describe('LookupField option preview: secondary columns stay told apart (objectstack#34362)', () => {
  it('lets the preview wrap, so a column that does not fit opens the next row instead of cutting both', async () => {
    await openPicker(['name', 'status', 'billing_email']);
    const line = screen.getByTestId('lookup-option-preview');
    expect(line.classList.contains('flex-wrap'), 'the preview no longer wraps').toBe(true);
  });

  it('drops the separator of a column that opens a row, and keeps it beside the column before', async () => {
    lineWidth = 280;
    stubLineLayout();
    await openPicker(['name', 'status', 'industry', 'annual_revenue']);
    // Row one: status, industry. Row two: revenue.
    expect(separatorOf('industry').hidden).toBe(false);
    expect(separatorOf('annual_revenue').hidden).toBe(true);
  });

  it('keeps every separator on one row', async () => {
    lineWidth = 600;
    stubLineLayout();
    await openPicker(['name', 'status', 'industry', 'annual_revenue']);
    expect(separatorOf('industry').hidden).toBe(false);
    expect(separatorOf('annual_revenue').hidden).toBe(false);
  });

  it('gives a text value cut short its whole text as its title, and a whole value none', async () => {
    const CUT = 'billing_email';
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-lookup-preview') === CUT ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-lookup-preview') === CUT ? 120 : 0;
    });
    await openPicker(['name', 'status', ...TEXT_COLUMNS]);

    expect(valueOf(CUT).getAttribute('title')).toBe(ROW.billing_email);
    expect(valueOf('annual_revenue').hasAttribute('title')).toBe(false);
    // A badge keeps its own title; the fit never writes one onto its value.
    expect(valueOf('status').hasAttribute('title')).toBe(false);
  });
});

describe('LookupField picker popover: bound to the room it is given (objectstack#34362)', () => {
  /** The listbox's scroll box, stubbed: `content` px of options in a `box` px list. */
  function stubListScroll(box: number, content: number): void {
    const isList = (el: HTMLElement) => el.getAttribute('role') === 'listbox';
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return isList(this) ? box : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return isList(this) ? content : 0;
    });
  }

  it('is portaled out of the field, so no dialog body can clip it and Radix flips it against the viewport', async () => {
    await openPicker(['name', 'status']);
    const popover = screen.getByTestId('lookup-popover');
    expect(screen.getByTestId('lookup-trigger').parentElement?.contains(popover)).toBe(false);
    expect(popover.parentElement?.hasAttribute('data-radix-popper-content-wrapper')).toBe(true);
  });

  it('caps the popover at the available height Radix reports, and the list takes what the search row leaves', async () => {
    await openPicker(['name', 'status']);
    const popover = screen.getByTestId('lookup-popover');
    for (const cls of ['flex', 'flex-col', 'max-h-(--radix-popover-content-available-height)']) {
      expect(popover.classList.contains(cls), `popover lacks ${cls}`).toBe(true);
    }
    const search = screen.getByRole('combobox').closest('.p-2') as HTMLElement;
    expect(search.classList.contains('shrink-0'), 'the search row gives up its height').toBe(true);
    const list = screen.getByRole('listbox');
    // `min-h-0` lets the list shrink below its 16rem cap; the cap still holds where there is room.
    for (const cls of ['min-h-0', 'max-h-64', 'overflow-y-auto']) {
      expect(list.classList.contains(cls), `list lacks ${cls}`).toBe(true);
    }
    expect((list.parentElement as HTMLElement).classList.contains('min-h-0'), 'the list wrapper does not shrink').toBe(true);
  });

  it('marks the list edge with more options past it, so a row cut there reads as scroll for more', async () => {
    stubListScroll(256, 600);
    await openPicker(['name', 'status']);
    const list = screen.getByRole('listbox');
    await waitFor(() => expect(screen.queryByTestId('lookup-list-more-below')).not.toBeNull());
    expect(screen.queryByTestId('lookup-list-more-above')).toBeNull();

    act(() => {
      list.scrollTop = 344;
      fireEvent.scroll(list);
    });
    expect(screen.queryByTestId('lookup-list-more-below')).toBeNull();
    expect(screen.queryByTestId('lookup-list-more-above')).not.toBeNull();

    act(() => {
      list.scrollTop = 100;
      fireEvent.scroll(list);
    });
    expect(screen.queryByTestId('lookup-list-more-below')).not.toBeNull();
    expect(screen.queryByTestId('lookup-list-more-above')).not.toBeNull();
  });

  it('draws no edge marks when every option fits', async () => {
    stubListScroll(256, 120);
    await openPicker(['name', 'status']);
    expect(screen.queryByTestId('lookup-list-more-below')).toBeNull();
    expect(screen.queryByTestId('lookup-list-more-above')).toBeNull();
  });

  it('leaves room for the edge mark when the keyboard scrolls an option into view', async () => {
    await openPicker(['name', 'status']);
    expect(screen.getByRole('listbox').classList.contains('scroll-py-6')).toBe(true);
  });
});

describe('LookupField picker popover: wide enough to read an option, never wider than the screen (objectstack#34601)', () => {
  /**
   * The width contract, as classes: jsdom has no layout. The trigger width
   * stays the width, an 18rem floor keeps option names readable when the
   * trigger is a narrow line-item grid cell, and the room Radix reports caps
   * both the panel and the floor, so a narrow screen never puts the panel past
   * its edge. The pixels were read in Chromium; the pull request records them.
   */
  const WIDTH = [
    'w-[var(--radix-popover-trigger-width)]',
    'min-w-[min(18rem,var(--radix-popover-content-available-width,100vw))]',
    'max-w-(--radix-popover-content-available-width)',
  ];

  it('floors a compact (grid-cell) trigger\'s popover at 18rem and caps it at the available width', async () => {
    await openPicker(['name', 'status'], { compact: true });
    const popover = screen.getByTestId('lookup-popover');
    for (const cls of WIDTH) {
      expect(popover.classList.contains(cls), `popover lacks ${cls}`).toBe(true);
    }
  });

  it('gives a full-size trigger the same floor and cap', async () => {
    await openPicker(['name', 'status']);
    const popover = screen.getByTestId('lookup-popover');
    for (const cls of WIDTH) {
      expect(popover.classList.contains(cls), `popover lacks ${cls}`).toBe(true);
    }
  });
});
