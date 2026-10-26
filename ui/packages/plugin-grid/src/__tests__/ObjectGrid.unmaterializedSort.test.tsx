/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3950 — no sort header on a column the platform cannot order by.
 *
 * A `formula` value is computed on read: no driver materialises a column for
 * it, so a server `$orderby` naming one has nothing to order by. That sort
 * never worked. Until objectstack#6994 the platform did not say so — the
 * response carried the very values it was asked to order by, out of order,
 * under a `200`, with ascending and descending byte-identical — and it now
 * answers `400 INVALID_SORT`. Both are the same defect here: a clickable
 * header offering a sort that cannot be performed.
 *
 * This is the second reason a server-sorted column is withheld, alongside the
 * relational one (#3096, pinned in `serverSorting.test.tsx`). The corpus makes
 * it concrete rather than hypothetical: the CRM `Opportunities` list renders
 * `expected_revenue`, and the showcase `Projects` list renders
 * `budget_remaining` — both `formula` fields, both with a clickable header
 * before this change.
 *
 * The COLLATERAL half matters as much as the pin: a grid whose formula header
 * went quiet while its text / number / currency headers also stopped sorting
 * would be a regression wearing a fix's clothes, so every stored column here is
 * driven through a real header click.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const TOTAL = 300;
const PAGE_SIZE = 50;

/**
 * Shaped after `crm_opportunity`: an `amount` and a `probability` with real
 * columns, and `expected_revenue` — the product of the two, computed on read.
 * `sequence` is an `autonumber` and `line_total` a `summary`: both are in the
 * spec's "never client-written" family and both DO get a stored column, so they
 * belong on the control side of this test.
 */
function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from({ length: Math.max(0, Math.min(top, TOTAL - skip)) }, (_, i) => ({
      id: `id-${skip + i}`,
      name: `Row ${skip + i}`,
      amount: (skip + i) * 10,
      probability: 50,
      expected_revenue: (skip + i) * 5,
      sequence: skip + i,
      line_total: (skip + i) * 2,
    }));
    return { data: rows, total: TOTAL, hasMore: skip + rows.length < TOTAL, pageSize: top };
  });
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        amount: { type: 'currency' },
        probability: { type: 'percent' },
        expected_revenue: { type: 'formula', label: 'Expected Revenue' },
        sequence: { type: 'autonumber' },
        line_total: { type: 'summary' },
      },
    }),
  } as any;
}

function renderGrid(dataSource: any, opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'opportunity',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount' },
      { field: 'probability', label: 'Probability' },
      { field: 'expected_revenue', label: 'Expected Revenue' },
      { field: 'sequence', label: 'Sequence' },
      { field: 'line_total', label: 'Line Total' },
    ],
    pagination: { pageSize: PAGE_SIZE },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) =>
    th.textContent?.includes(label),
  ) as HTMLElement;

describe('ObjectGrid — the sort header is withheld from an unmaterialized column (#3950)', () => {
  it('gives a formula column no sort affordance', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    const header = headerCell(container, 'Expected Revenue');
    expect(header).toBeTruthy();
    expect(header.className).not.toContain('cursor-pointer');
  });

  it('does not turn a click on that header into an $orderby the server would refuse', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    const before = ds.find.mock.calls.length;
    fireEvent.click(headerCell(container, 'Expected Revenue'));
    // No refetch at all: the click is not a sort request, so nothing goes out
    // for the platform to answer with `400 INVALID_SORT`.
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.find.mock.calls.length).toBe(before);
  });

  // ── Collateral control ────────────────────────────────────────────────────
  // Every column whose type HAS a stored column keeps its header, including the
  // two that share the formula field's "computed" reputation and none of its
  // storage problem.
  it.each([
    ['Name', 'name'],
    ['Amount', 'amount'],
    ['Probability', 'probability'],
    ['Sequence', 'sequence'],
    ['Line Total', 'line_total'],
  ])('keeps the %s header sorting through the server', async (label, field) => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    const header = headerCell(container, label);
    expect(header.className).toContain('cursor-pointer');

    fireEvent.click(header);
    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field, order: 'asc' }]);
    });
  });

  /**
   * Client-side sorting is a different question with a different answer. The
   * rows are all in the browser and the formula value is the one the server
   * hydrated on read, so ordering by what the cell shows is honest — the same
   * split the relational carve-out makes (#3096).
   */
  it('keeps the formula header live where the sort never leaves the browser', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, {
      // objectui#8348 — the DECLARED inline-rows spelling. `object-grid`'s
      // published `data` row is the `ViewData` union ("the bare-array shortcut
      // is refused"), so `getDataConfig` no longer lifts a bare array; this form
      // resolves to the same config and this row still sorts in the browser.
      data: {
        provider: 'value',
        items: [
          { id: 'a', name: 'A', amount: 10, probability: 20, expected_revenue: 2 },
          { id: 'b', name: 'B', amount: 30, probability: 40, expected_revenue: 12 },
        ],
      },
    });
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    expect(headerCell(container, 'Expected Revenue').className).toContain('cursor-pointer');
  });
});
