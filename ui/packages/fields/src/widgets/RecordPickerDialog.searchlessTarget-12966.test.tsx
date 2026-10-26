/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12966 — the record pickers offer no type-ahead on a target object
 * whose `search` resolves to no field, and still list its records.
 *
 * objectstack answers a non-blank `search` over such an object with `400
 * INVALID_FIELD` (`param: 'search'`). The common shape is a junction object:
 * two lookups and a composed formula title.
 *
 * Pinned against the real `RecordPickerDialog` and the real `LookupField`
 * inline dropdown:
 *
 *   - (d) on a searchless target the dialog draws no search box, lists and
 *     pages the records, and sends no `$search`; the inline dropdown draws no
 *     type-ahead box and still offers the records;
 *   - CONTROL: a target with a text field keeps both boxes;
 *   - an unknown target schema keeps the box (behaviour before the card);
 *   - (e) where the box shows and the server refuses the term anyway, the
 *     dialog renders the refusal's own message, not an empty table.
 *
 * `objectResolvesSearch` itself is pinned in `searchOffer.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordPickerDialog } from './RecordPickerDialog';
import { LookupField } from './LookupField';

afterEach(cleanup);

beforeEach(() => {
  // jsdom has no matchMedia; the lookup's mobile check reads it. Desktop width.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

/** A junction object: two lookups and a composed formula title. */
const JUNCTION_FIELDS: Record<string, any> = {
  book: { name: 'book', type: 'lookup', reference: 'lib_book', label: 'Book' },
  reader: { name: 'reader', type: 'lookup', reference: 'lib_reader', label: 'Reader' },
  title: { name: 'title', type: 'formula', label: 'Title' },
};
const SEARCHLESS = { name: 'lib_loan', nameField: 'title', fields: JUNCTION_FIELDS };
const WITH_TEXT = {
  name: 'lib_loan',
  fields: { ...JUNCTION_FIELDS, note: { name: 'note', type: 'text', label: 'Note' } },
};

const LOANS = Array.from({ length: 12 }, (_, i) => ({
  id: `loan${i + 1}`,
  title: `Loan ${i + 1}`,
  book: `b${i + 1}`,
  reader: 'r1',
}));

const REFUSAL_MESSAGE =
  "Object 'lib_loan' has no searchable field, so 'search' cannot be honoured on it.";

function makeDataSource(schema: unknown, opts: { refuseSearch?: boolean } = {}) {
  return {
    find: vi.fn(async (_object: string, params?: Record<string, any>) => {
      if (opts.refuseSearch && params?.$search) {
        // The data adapter's raw-GET failure shape: message, code, status.
        throw Object.assign(new Error(REFUSAL_MESSAGE), {
          code: 'INVALID_FIELD',
          status: 400,
          httpStatus: 400,
        });
      }
      const skip = params?.$skip ?? 0;
      const top = params?.$top ?? LOANS.length;
      return { data: LOANS.slice(skip, skip + top), total: LOANS.length };
    }),
    findOne: vi.fn(async () => null),
    ...(schema ? { getObjectSchema: vi.fn(async () => schema) } : {}),
  } as any;
}

const searches = (ds: { find: ReturnType<typeof vi.fn> }) =>
  ds.find.mock.calls.map((c: any[]) => c[1]?.$search);

function renderDialog(dataSource: any, objectSchema: unknown) {
  return render(
    <RecordPickerDialog
      open
      onOpenChange={() => {}}
      dataSource={dataSource}
      objectName="lib_loan"
      displayField="title"
      objectSchema={objectSchema as any}
      pageSize={5}
      onSelect={vi.fn()}
    />,
  );
}

describe('objectui#12966 — RecordPickerDialog on a searchless target', () => {
  it('(d) draws no search box, and still lists and pages the records', async () => {
    const ds = makeDataSource(SEARCHLESS);
    renderDialog(ds, SEARCHLESS);

    await waitFor(() => expect(screen.getByText('Loan 1')).toBeInTheDocument());
    expect(screen.queryByTestId('record-picker-search')).not.toBeInTheDocument();

    // Paging still reads: page 2 asks for the next window.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    await waitFor(() => expect(screen.getByText('Loan 6')).toBeInTheDocument());
    expect(ds.find.mock.calls.at(-1)?.[1]?.$skip).toBe(5);
    expect(searches(ds).every((s: unknown) => s === undefined)).toBe(true);
  });

  it('CONTROL: a target with a text field keeps the search box', async () => {
    renderDialog(makeDataSource(WITH_TEXT), WITH_TEXT);
    await waitFor(() => expect(screen.getByText('Loan 1')).toBeInTheDocument());
    expect(screen.getByTestId('record-picker-search')).toBeInTheDocument();
  });

  it('an unknown target schema keeps the search box', async () => {
    renderDialog(makeDataSource(null), undefined);
    await waitFor(() => expect(screen.getByText('Loan 1')).toBeInTheDocument());
    expect(screen.getByTestId('record-picker-search')).toBeInTheDocument();
  });

  it('(e) a refused term renders the refusal\'s own message, not an empty table', async () => {
    const ds = makeDataSource(null, { refuseSearch: true });
    renderDialog(ds, undefined);
    await waitFor(() => expect(screen.getByText('Loan 1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('record-picker-search'), { target: { value: 'Dune' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(REFUSAL_MESSAGE);
    expect(screen.queryByText('Loan 1')).not.toBeInTheDocument();
  });
});

const loanLookup = {
  name: 'loan',
  label: 'Loan',
  reference: 'lib_loan',
  reference_field: 'title',
} as any;

async function openLookup(dataSource: any) {
  render(
    <LookupField field={loanLookup} value={undefined} onChange={vi.fn()} readonly={false} dataSource={dataSource} />,
  );
  // The target schema is read at mount; let it land before opening.
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
  });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
}

describe('objectui#12966 — LookupField inline dropdown on a searchless target', () => {
  it('(d) draws no type-ahead box and still offers the records', async () => {
    const ds = makeDataSource(SEARCHLESS);
    await openLookup(ds);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Loan 1');
    expect(searches(ds).every((s: unknown) => s === undefined)).toBe(true);
  });

  it('CONTROL: a target with a text field keeps the type-ahead box', async () => {
    await openLookup(makeDataSource(WITH_TEXT));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
