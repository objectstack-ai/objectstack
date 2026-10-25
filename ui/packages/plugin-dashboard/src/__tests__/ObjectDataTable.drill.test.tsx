/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Behavior tests for ObjectDataTable drill-to-record: with `drillDown` enabled
 * (record mode), clicking a row opens that record in a RecordDetailDrawer. With
 * drill absent / disabled / in filter-mode, no drawer opens. An author-supplied
 * onRowClick is never hijacked by the drill handler.
 *
 * These render the real `data-table` renderer (registered transitively via
 * `@object-ui/components`) so they exercise the actual row-click path, not a
 * mock.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectDataTable } from '../ObjectDataTable';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '@object-ui/components';

const records = [
  { id: '1', name: 'Acme Renewal', amount: 1500 },
  { id: '2', name: 'Globex Expansion', amount: 9000 },
];

function renderTable(extra: Record<string, any> = {}) {
  return render(
    <ObjectDataTable
      schema={{ type: 'object-data-table', objectName: 'opportunity', data: records, ...extra }}
    />,
  );
}

/** Click the table cell carrying the given record name. */
function clickRow(name: string) {
  fireEvent.click(screen.getByText(name));
}

describe('ObjectDataTable — drill-to-record', () => {
  it('opens the record drawer when a row is clicked (drill enabled)', () => {
    renderTable({ drillDown: { enabled: true } });

    expect(screen.queryByTestId('record-detail-body')).toBeNull();
    clickRow('Acme Renewal');

    const body = screen.getByTestId('record-detail-body');
    expect(body).toBeInTheDocument();
    // The drawer shows the clicked record's fields. (No object schema is bound
    // in this test, so `amount` renders as its raw value — currency formatting
    // from a bound schema is covered by RecordDetailDrawer.test.tsx.)
    expect(within(body).getByText('Amount')).toBeInTheDocument();
    expect(within(body).getByText('1500')).toBeInTheDocument();
  });

  it('does not open a drawer when drill-down is absent', () => {
    renderTable();
    clickRow('Acme Renewal');
    expect(screen.queryByTestId('record-detail-body')).toBeNull();
  });

  it('does not open a drawer when drill-down is explicitly disabled', () => {
    renderTable({ drillDown: { enabled: false } });
    clickRow('Acme Renewal');
    expect(screen.queryByTestId('record-detail-body')).toBeNull();
  });

  it('ignores filter-mode drill on a record table (no row→record)', () => {
    renderTable({ drillDown: { enabled: true, mode: 'filter' } });
    clickRow('Acme Renewal');
    expect(screen.queryByTestId('record-detail-body')).toBeNull();
  });

  it('preserves an author-supplied onRowClick over the drill handler', () => {
    const authorClick = vi.fn();
    renderTable({ drillDown: { enabled: true }, onRowClick: authorClick });

    clickRow('Globex Expansion');
    expect(authorClick).toHaveBeenCalledTimes(1);
    // The author handler wins — the drill drawer must not open.
    expect(screen.queryByTestId('record-detail-body')).toBeNull();
  });
});
