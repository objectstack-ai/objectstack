/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — a list under an open record counts its records once,
 * and objectstack#28915 — that count is the list's own.
 *
 * The split pane narrowed the list beside it and printed the count under it
 * (its `record-count-footer`, objectui#10636), so `ListView`'s bar held its
 * count back while a pane narrowed the list. The split pane retired: a record
 * opens in the drawer over the list, which keeps its full width, so the bar
 * prints the count whether or not a record is open (the drawer publishes the
 * open row, `ActiveListRecordProvider`), beside the grid's column summaries.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, SchemaRendererProvider } from '@object-ui/react';
import { ActiveListRecordProvider } from '@object-ui/components';
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

function renderList(openRecordId: string | null) {
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
        <ActiveListRecordProvider recordId={openRecordId}>
          <ListView schema={schema} dataSource={ds as never} />
        </ActiveListRecordProvider>
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  return ds;
}

describe('ListView under the record drawer counts its records once (objectstack#27545, objectstack#28915)', () => {
  it('CONTROL — no record open: the bar prints the count', async () => {
    renderList(null);
    const bar = await screen.findByTestId('record-count-bar');
    await waitFor(() => expect(within(bar).getByText('4 records')).toBeInTheDocument());
  });

  it('a record open in the drawer: the bar still prints the count', async () => {
    renderList('a1');
    const bar = await screen.findByTestId('record-count-bar');
    await waitFor(() => expect(within(bar).getByText('4 records')).toBeInTheDocument());
  });

  it('a record open in the drawer: the column summaries are drawn beside the count', async () => {
    renderList('a1');
    (await screen.findByTestId('grid-probe')).click();
    const bar = await screen.findByTestId('record-count-bar');
    await waitFor(() => expect(within(bar).getByTestId('record-count-summaries')).toHaveTextContent('Number of Employees: Avg: 10'));
    expect(within(bar).getByText('4 records')).toBeInTheDocument();
  });
});
