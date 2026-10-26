/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12528 nail 4, the grid's half — a host that draws its own footer
 * row takes the column summaries into it.
 *
 * A list with column summaries drew TWO footer rows: this grid's summary row
 * ("Amount: Sum: …") and, under it, `ListView`'s record-count row. With
 * `onColumnSummaryChange` passed the grid draws no summary row and reports, in
 * column order, what that row would have drawn; `ListView` draws it at the
 * right of the count (its half is pinned in `@object-ui/plugin-list`,
 * `ListView.footerOneRow-12528.test.tsx`).
 *
 * CONTROL: a grid with no host callback keeps its own summary row, unchanged.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'plan_line';
const ROWS = [
  { id: 'r1', name: 'Line 1', amount: 100 },
  { id: 'r2', name: 'Line 2', amount: 250 },
];
const COLUMNS = [
  { field: 'name', label: 'Name' },
  { field: 'amount', label: 'Amount', type: 'number', summary: 'sum' },
];

const dataSource = () => ({
  find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({
    name: OBJECT,
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
  })),
});

function renderGrid(onColumnSummaryChange?: (s: unknown) => void) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, columns: COLUMNS, data: { provider: 'value', items: ROWS } } as unknown as ObjectGridSchema}
        dataSource={dataSource() as unknown as DataSource}
        {...(onColumnSummaryChange ? { onColumnSummaryChange } : {})}
      />
    </ActionProvider>,
  );
}

describe('ObjectGrid — a host draws the column summaries (objectui#12528)', () => {
  it('reports the summaries and draws no summary row of its own', async () => {
    const report = vi.fn();
    renderGrid(report);

    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith([{ key: 'amount', header: 'Amount', label: 'Sum: 350' }]),
    );
    expect(screen.queryByTestId('column-summary-footer')).toBeNull();
  });

  it('reports null when it unmounts', async () => {
    const report = vi.fn();
    const { unmount } = renderGrid(report);
    await waitFor(() => expect(report).toHaveBeenCalled());

    unmount();
    expect(report).toHaveBeenLastCalledWith(null);
  });

  it('CONTROL: with no host callback the grid keeps its own summary row', async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByTestId('summary-amount')).toHaveTextContent('Amount: Sum: 350'));
    expect(screen.getByTestId('column-summary-footer')).toBeInTheDocument();
  });
});
