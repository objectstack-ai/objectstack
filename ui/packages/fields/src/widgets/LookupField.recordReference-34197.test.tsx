/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `lookupFilters` values that read the record being edited — `{ $record }` —
 * and the `orEmpty` flag (`@objectstack/spec` `field.zod.ts`,
 * `LookupFilterRecordReferenceSchema`).
 *
 * The picker sends the referenced value in place of the reference, reads a
 * one-hop path off the lookup's target row, leaves an entry out while its
 * value is empty, re-queries when a referenced field changes, and sends
 * `orEmpty: true` as an `$or` with a null match on the same column. Literal
 * entries and `dependsOn` query exactly as before.
 *
 * Resolution is opt-in by the host: only a field a record form stamped
 * (`withRecordBeingEdited`) reads the values it is handed. A host that edits
 * no single record — a bulk action dialog handing the widget its sibling
 * parameters — leaves every `{ $record }` entry out.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LookupField } from './LookupField';
import { lookupFiltersToRecord } from './RecordPickerDialog';
import { RECORD_BEING_EDITED_KEY, resolveLookupFilters, withRecordBeingEdited } from './lookupRecordReference';

const books = [{ id: 'b1', name: 'Standard 2026' }];

function makeDataSource(hopRows: Record<string, Record<string, unknown>> = {}) {
  const find = vi.fn(async () => ({ data: books, total: books.length }));
  const findOne = vi.fn(async (object: string, id: string) => hopRows[`${object}:${id}`] ?? null);
  return { find, findOne } as any;
}

/** The `$filter` of every candidate query sent to `price_book`, in order. */
function candidateFilters(ds: { find: { mock: { calls: any[][] } } }): unknown[] {
  return ds.find.mock.calls.filter((c) => c[0] === 'price_book').map((c) => c[1]?.$filter);
}

function priceBookField(lookupFilters: unknown[], extra: Record<string, unknown> = {}) {
  return { name: 'price_book', label: 'Price Book', reference: 'price_book', lookupFilters, ...extra } as any;
}

/** The field as a record form hands it: stamped as drawn for a single record being edited. */
function formField(lookupFilters: unknown[], objectFields: Record<string, unknown> = {}) {
  return withRecordBeingEdited(priceBookField(lookupFilters), objectFields);
}

async function openPopover() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

describe('LookupField — { $record } lookupFilters values (#34197)', () => {
  it('sends a field of the record being edited in place of the reference', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={formField([{ field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' } }])}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ quote_date: '2026-11-01' }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({ valid_from: { $lte: '2026-11-01' } });
  });

  it('reads a one-hop path off the row the lookup points at, and queries once with its value', async () => {
    const ds = makeDataSource({ 'account:a1': { id: 'a1', cb_market: 'm9' } });
    const field = formField(
      [{ field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' } }],
      { account: { type: 'lookup', reference: 'account' } },
    );
    render(
      <LookupField field={field} value={undefined} onChange={vi.fn()} dataSource={ds} dependentValues={{ account: 'a1' }} />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(ds.findOne).toHaveBeenCalledWith('account', 'a1', { $select: ['id', 'cb_market'] });
    expect(candidateFilters(ds)).toEqual([{ cb_market: 'm9' }]);
  });

  it('reads a hop the record already holds expanded without another request', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={formField([{ field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' } }])}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ account: { id: 'a1', name: 'Acme', cb_market: 'm7' } }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({ cb_market: 'm7' });
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('leaves an entry out while the referenced value is empty, and on a picker given no record', async () => {
    const filters = [
      { field: 'is_active', operator: 'eq', value: true },
      { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' } },
      { field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' } },
    ];
    const ds = makeDataSource();
    const { unmount } = render(
      <LookupField
        field={formField(filters)}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ quote_date: '', account: null }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({ is_active: true });
    unmount();

    const bare = makeDataSource();
    render(<LookupField field={formField(filters)} value={undefined} onChange={vi.fn()} dataSource={bare} />);
    await openPopover();
    await waitFor(() => expect(candidateFilters(bare)).toHaveLength(1));
    expect(candidateFilters(bare)[0]).toEqual({ is_active: true });
  });

  it('re-queries once when a referenced field changes, and not when another field does', async () => {
    const ds = makeDataSource();
    const field = formField([{ field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' } }]);
    const { rerender } = render(
      <LookupField field={field} value={undefined} onChange={vi.fn()} dataSource={ds} dependentValues={{ quote_date: '2026-11-01', subject: 'a' }} />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));

    rerender(
      <LookupField field={field} value={undefined} onChange={vi.fn()} dataSource={ds} dependentValues={{ quote_date: '2026-11-01', subject: 'ab' }} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(candidateFilters(ds)).toHaveLength(1);

    rerender(
      <LookupField field={field} value={undefined} onChange={vi.fn()} dataSource={ds} dependentValues={{ quote_date: '2026-12-01', subject: 'ab' }} />,
    );
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(2));
    await act(async () => { await Promise.resolve(); });
    expect(candidateFilters(ds)).toEqual([
      { valid_from: { $lte: '2026-11-01' } },
      { valid_from: { $lte: '2026-12-01' } },
    ]);
  });

  it('sends orEmpty as an $or with a null match on the same column', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={formField([
          { field: 'is_active', operator: 'eq', value: true },
          { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' }, orEmpty: true },
          { field: 'valid_to', operator: 'gte', value: { $record: 'quote_date' }, orEmpty: true },
        ])}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ quote_date: '2026-11-01' }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({
      is_active: true,
      $and: [
        { $or: [{ valid_from: { $lte: '2026-11-01' } }, { valid_from: { $null: true } }] },
        { $or: [{ valid_to: { $gte: '2026-11-01' } }, { valid_to: { $null: true } }] },
      ],
    });
  });

  it('hands the table picker the resolved values', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={formField([{ field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' }, orEmpty: true }])}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ quote_date: '2026-11-01' }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-all-records'));
    });
    await waitFor(() => expect(candidateFilters(ds).length).toBeGreaterThan(0));
    for (const filter of candidateFilters(ds)) {
      expect(filter).toEqual({
        $and: [{ $or: [{ valid_from: { $lte: '2026-11-01' } }, { valid_from: { $null: true } }] }],
      });
    }
  });

  it('a host that does not say a record is being edited leaves every { $record } entry out, even when its values hold one of that name', async () => {
    // The bulk action dialog's shape: the widget is handed the dialog's sibling
    // parameter values, and its field carries no record-form stamp.
    const filters = [
      { field: 'is_active', operator: 'eq', value: true },
      { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' } },
      { field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' } },
    ];
    const ds = makeDataSource({ 'account:a1': { id: 'a1', cb_market: 'm9' } });
    render(
      <LookupField
        field={priceBookField(filters)}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ quote_date: '2026-11-01', account: { id: 'a1', cb_market: 'm7' } }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({ is_active: true });
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('CONTROL: the same field and values on a record-form host resolve', async () => {
    const filters = [
      { field: 'is_active', operator: 'eq', value: true },
      { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' } },
      { field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' } },
    ];
    const ds = makeDataSource();
    const field = formField(filters, { account: { type: 'lookup', reference: 'account' } });
    expect(field[RECORD_BEING_EDITED_KEY]).toEqual({ hopObjects: { account: 'account' } });
    render(
      <LookupField
        field={field}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ quote_date: '2026-11-01', account: { id: 'a1', cb_market: 'm7' } }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({ is_active: true, valid_from: { $lte: '2026-11-01' }, cb_market: 'm7' });
  });

  it('CONTROL: a literal entry and a dependsOn entry query exactly as before', async () => {
    const ds = makeDataSource();
    render(
      <LookupField
        field={priceBookField([{ field: 'is_active', operator: 'eq', value: true }], { dependsOn: ['account'] })}
        value={undefined}
        onChange={vi.fn()}
        dataSource={ds}
        dependentValues={{ account: 'a1' }}
      />,
    );
    await openPopover();
    await waitFor(() => expect(candidateFilters(ds)).toHaveLength(1));
    expect(candidateFilters(ds)[0]).toEqual({ is_active: true, account: 'a1' });
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});

describe('lookupFiltersToRecord — an unresolved { $record } never reaches the wire (#34197)', () => {
  it('leaves out an entry still carrying a reference, and keeps the literal ones', () => {
    expect(
      lookupFiltersToRecord([
        { field: 'is_active', operator: 'eq', value: true },
        { field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' }, orEmpty: true },
      ]),
    ).toEqual({ is_active: true });
  });

  it('resolveLookupFilters keeps literal entries, in order, as the same objects', () => {
    const literal = { field: 'is_active', operator: 'eq' as const, value: true };
    const out = resolveLookupFilters(
      [literal, { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' } }],
      { quote_date: '2026-11-01' },
    );
    expect(out[0]).toBe(literal);
    expect(out[1]).toEqual({ field: 'valid_from', operator: 'lte', value: '2026-11-01' });
  });
});
