/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12528 nail 4, the list's half — one footer row on an aggregated
 * list: the record count at the left, the column summaries at the right of the
 * same row, truncated with the full text as their tooltip.
 *
 * ⚠️ RETIRED by objectstack#35548: the summaries are the grid's own last
 * table row again, each under its column (so they line up at any width and
 * scroll with it), led by 「Count N」. What is pinned now is the hand-back:
 * the list hands the grid no `onColumnSummaryChange`, and its count row holds
 * the count alone. The grid's row is pinned in `@object-ui/plugin-grid`
 * (`footerSummaryHost-12528.test.tsx`, `column-features.test.tsx`).
 *
 * The grid hands its summaries up through the `onColumnSummaryChange` host
 * channel and draws no summary row of its own (that half is pinned in
 * `@object-ui/plugin-grid`, `footerSummaryHost-12528.test.tsx`). Here the grid
 * is a probe registered as `object-grid` that reports what a real grid with a
 * `sum` column reports, so what is pinned is the list's drawing of it.
 *
 * CONTROL: a grid that reports no summaries leaves the count row as it was.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const OBJECT = 'account';
const FIELDS = {
  name: { type: 'text', label: 'Name' },
  annual_revenue: { type: 'currency', label: 'Annual Revenue' },
  employees: { type: 'number', label: 'Number of Employees' },
};
const ROWS = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, name: `Acme ${i}`, annual_revenue: 1000, employees: 10 }));
const SUMMARIES = [
  { key: 'annual_revenue', header: 'Annual Revenue', label: 'Sum: 109,800,000.00' },
  { key: 'employees', header: 'Number of Employees', label: 'Avg: 760' },
];

let reported: typeof SUMMARIES | null = SUMMARIES;
/** Every report the probe made, so a test can wait until one has happened. */
const reports = vi.fn();

/**
 * Stands in for `ObjectGrid`: reports its summaries the way the grid does —
 * from a passive effect, which runs AFTER the commit that draws the count
 * row. So the summaries reach the row one render later, and every assertion
 * about them (present or absent) waits for the report first.
 */
/** Every props object the probe was rendered with. */
const probeProps: Array<{ onColumnSummaryChange?: unknown }> = [];

function GridProbe(props: { onColumnSummaryChange?: (s: typeof SUMMARIES | null) => void }) {
  probeProps.push(props);
  const { onColumnSummaryChange } = props;
  React.useEffect(() => {
    reports(reported);
    onColumnSummaryChange?.(reported);
  }, [onColumnSummaryChange]);
  return <div data-testid="grid-probe" />;
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as never;
  }
});
beforeEach(() => {
  reported = SUMMARIES;
  reports.mockClear();
  ComponentRegistry.register('object-grid', GridProbe as never);
});
afterEach(() => {
  ComponentRegistry.unregister?.('object-grid');
  cleanup();
});

function renderList() {
  const ds = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({ name, label: 'Account', fields: FIELDS })),
  };
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: ['name', 'annual_revenue', 'employees'],
  } as unknown as ListViewSchema;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds as never}>
        <ListView schema={schema} dataSource={ds as never} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

describe('ListView hands the grid its summaries back (objectui#12528 retired by objectstack#35548)', () => {
  it('the grid is handed no summary channel, so it draws its own summary row; the count row holds the count alone', async () => {
    renderList();

    const bar = await screen.findByTestId('record-count-bar');
    await waitFor(() => expect(within(bar).getByText('9 records')).toBeInTheDocument());
    // The probe reports through the channel only if it is handed one.
    await waitFor(() => expect(reports).toHaveBeenCalled());
    await act(async () => {});
    expect(probeProps.at(-1)?.onColumnSummaryChange).toBeUndefined();
    expect(within(bar).queryByTestId('record-count-summaries')).toBeNull();
    expect(screen.getAllByTestId('record-count-bar')).toHaveLength(1);
  });
});
