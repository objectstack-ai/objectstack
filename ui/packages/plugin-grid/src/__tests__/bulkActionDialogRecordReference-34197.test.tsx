/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34197 — a bulk action dialog edits no single record, so a
 * lookup param whose `lookupFilters` read `{ $record }` leaves that entry out,
 * even when a SIBLING param carries a value of the same name.
 *
 * The dialog hands every picker its own in-progress values as
 * `dependentValues` (objectui#8755), and those values are not the record a
 * `{ $record: 'quote_date' }` path names. The picker resolves a reference
 * only on a field a record form stamped (`withRecordBeingEdited`); this
 * dialog stamps nothing. Driven through the real `BulkActionDialog`, because
 * the hand-off of the sibling values IS the hazard.
 *
 * A param that writes `recordBeingEdited` itself is not let opt in:
 * `bulkParamToField` never carries the key from a param.
 *
 * CONTROL: the literal entry beside it reaches the candidate query, so the
 * dialog does forward `lookupFilters` — the missing entry is left out, not
 * lost with the rest.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
// Module scope, per AGENTS.md §测试纪律: the picker sits behind `React.lazy`.
import '@object-ui/fields';
import { BulkActionDialog } from '../components/BulkActionDialog';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as any;
});

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'b1', name: 'Standard 2026' }], total: 1 })),
    findOne: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

const QUOTE_DATE = { name: 'quote_date', label: 'Quote date', type: 'text' };
const PRICE_BOOK = {
  name: 'price_book',
  label: 'Price Book',
  type: 'lookup',
  object: 'price_book',
  lookupFilters: [
    { field: 'is_active', operator: 'eq', value: true },
    { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' }, orEmpty: true },
  ],
};

async function pickerQueries(priceBook: Record<string, unknown>) {
  const ds = makeDataSource();
  render(
    <BulkActionDialog
      def={{ name: 'bulk_reprice', label: 'Reprice', operation: 'update', params: [QUOTE_DATE, priceBook] } as any}
      rows={[{ id: 'r1' }, { id: 'r2' }]}
      resource="quote"
      dataSource={ds}
      open
      onClose={() => {}}
    />,
  );
  const dateInput = await waitFor(() => {
    const el = document.getElementById('bulk-param-quote_date');
    if (!el) throw new Error('dialog not ready');
    return el;
  });
  fireEvent.change(dateInput, { target: { value: '2026-11-01' } });
  const trigger = await screen.findByTestId('lookup-trigger-price_book');
  await act(async () => {
    fireEvent.click(trigger);
  });
  const queries = () => ds.find.mock.calls.filter((c: any[]) => c[0] === 'price_book').map((c: any[]) => c[1]?.$filter);
  await waitFor(() => expect(queries().length).toBeGreaterThan(0));
  return { queries: queries(), ds };
}

describe('BulkActionDialog — a { $record } lookup filter is left out (objectstack#34197)', () => {
  it('a param that writes the record-form stamp itself gains nothing: the entry is still left out', async () => {
    const { queries, ds } = await pickerQueries({ ...PRICE_BOOK, recordBeingEdited: { hopObjects: {} } });
    for (const filter of queries) expect(filter).toEqual({ is_active: true });
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('leaves the entry out although a sibling param holds a value of that name', async () => {
    const ds = makeDataSource();
    render(
      <BulkActionDialog
        def={{ name: 'bulk_reprice', label: 'Reprice', operation: 'update', params: [QUOTE_DATE, PRICE_BOOK] } as any}
        rows={[{ id: 'r1' }, { id: 'r2' }]}
        resource="quote"
        dataSource={ds}
        open
        onClose={() => {}}
      />,
    );
    const dateInput = await waitFor(() => {
      const el = document.getElementById('bulk-param-quote_date');
      if (!el) throw new Error('dialog not ready');
      return el;
    });
    fireEvent.change(dateInput, { target: { value: '2026-11-01' } });

    const trigger = await screen.findByTestId('lookup-trigger-price_book');
    await act(async () => {
      fireEvent.click(trigger);
    });
    const queries = () => ds.find.mock.calls.filter((c: any[]) => c[0] === 'price_book').map((c: any[]) => c[1]?.$filter);
    await waitFor(() => expect(queries().length).toBeGreaterThan(0));
    for (const filter of queries()) expect(filter).toEqual({ is_active: true });
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
