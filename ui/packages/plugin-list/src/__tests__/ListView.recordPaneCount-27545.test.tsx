/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — a list beside a record pane counts its records once.
 *
 * The console prints the count under the list it hands the pane (its
 * `record-count-footer`, objectui#10636), so `ListView`'s own record-count bar
 * does not print it again while a pane narrows the list (`useRecordListFace()`
 * is `columns` or `cards`). The rest of the row stays: the grid's column
 * summaries are still drawn. With no pane beside it (`full`) the bar is the
 * one it was.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, SchemaRendererProvider } from '@object-ui/react';
import { RecordListFaceProvider, type RecordListFace } from '@object-ui/components';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const OBJECT = 'account';
const FIELDS = {
  name: { type: 'text', label: 'Name' },
  employees: { type: 'number', label: 'Number of Employees' },
};
const ROWS = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, name: `Acme ${i}`, employees: 10 }));
const SUMMARIES = [{ key: 'employees', header: 'Number of Employees', label: 'Avg: 10' }];

function GridProbe(props: { onColumnSummaryChange?: (s: typeof SUMMARIES | null) => void }) {
  const { onColumnSummaryChange } = props;
  const [summaries, setSummaries] = React.useState<typeof SUMMARIES | null>(null);
  React.useEffect(() => {
    onColumnSummaryChange?.(summaries);
  }, [onColumnSummaryChange, summaries]);
  return <button type="button" data-testid="grid-probe" onClick={() => setSummaries(SUMMARIES)} />;
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as never;
  }
});
beforeEach(() => {
  ComponentRegistry.register('object-grid', GridProbe as never);
});
afterEach(() => {
  ComponentRegistry.unregister?.('object-grid');
  cleanup();
});

function renderList(face: RecordListFace) {
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
    columns: ['name', 'employees'],
  } as unknown as ListViewSchema;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds as never}>
        <RecordListFaceProvider value={face}>
          <ListView schema={schema} dataSource={ds as never} />
        </RecordListFaceProvider>
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  return ds;
}

describe('ListView beside a record pane counts its records once (objectstack#27545)', () => {
  it('CONTROL — `full` (no pane): the bar prints the count', async () => {
    renderList('full');
    const bar = await screen.findByTestId('record-count-bar');
    await waitFor(() => expect(within(bar).getByText('4 records')).toBeInTheDocument());
  });

  it.each(['columns', 'cards'] as const)('`%s`: the bar prints no count, and draws no empty row', async (face) => {
    const ds = renderList(face);
    await screen.findByTestId('grid-probe');
    // The rows are in, and still no bar: with no count there is nothing else to draw.
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await ds.find.mock.results[0].value;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('4 records')).toBeNull();
    expect(screen.queryByTestId('record-count-bar')).toBeNull();
  });

  it('`columns`: the rest of the row stays — the column summaries are drawn, without the count', async () => {
    renderList('columns');
    (await screen.findByTestId('grid-probe')).click();
    const bar = await screen.findByTestId('record-count-bar');
    await waitFor(() => expect(within(bar).getByTestId('record-count-summaries')).toHaveTextContent('Number of Employees: Avg: 10'));
    expect(within(bar).queryByText('4 records')).toBeNull();
  });
});
