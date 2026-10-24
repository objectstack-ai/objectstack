/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12966 — the list's quick-search box is not offered on an object
 * whose `search` resolves to no field.
 *
 * THE PLATFORM CHANGE. objectstack answers a non-blank `search` over such an
 * object with `400 INVALID_FIELD` (`param: 'search'`); before, it answered
 * every row. The common shape is a junction object: two lookups and a composed
 * formula title, so the auto-default set (textual and enum types) is empty.
 *
 * WHAT IS PINNED.
 *
 *   - (a) A searchless object draws no quick-search box, and a term the host
 *     restores at mount reaches no fetch.
 *   - (b) CONTROL: the same view on an object with a text field draws it.
 *   - (c) An object that DECLARES `searchableFields` naming a stored field (a
 *     lookup, which the auto-default skips) draws it: the resolver's declared
 *     branch.
 *   - A text field declared `internal: true` does not count: the engine never
 *     scans one.
 *   - A VIEW's `searchableFields` does not make a searchless object
 *     searchable: the server intersects that `$searchFields` override with the
 *     object's resolved set and refuses it outside, so the box would 400 on
 *     every term.
 *   - (e) Where the box still shows — the data source serves no object
 *     definition — and the server refuses the term, the panel renders the
 *     server's own message, not the generic "query was rejected" copy.
 *
 * Every case waits for the view's stand-in first, so a mount that never
 * reached the render branch reads as a broken harness, never as a pass.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

ComponentRegistry.register(
  'object-grid',
  () => <div data-testid="object-grid-standin" />,
  { namespace: 'test', label: 'object-grid stand-in', category: 'view' },
);

/** A junction object: two lookups and a composed formula title. */
const JUNCTION_FIELDS = {
  book: { name: 'book', type: 'lookup', reference: 'lib_book', label: 'Book' },
  reader: { name: 'reader', type: 'lookup', reference: 'lib_reader', label: 'Reader' },
  title: { name: 'title', type: 'formula', label: 'Title' },
  due: { name: 'due', type: 'date', label: 'Due' },
};

const OBJECTS = {
  searchless: { name: 'lib_loan', label: 'Loan', nameField: 'title', fields: JUNCTION_FIELDS },
  withText: {
    name: 'lib_loan',
    label: 'Loan',
    fields: { ...JUNCTION_FIELDS, note: { name: 'note', type: 'text', label: 'Note' } },
  },
  declaresStoredField: {
    name: 'lib_loan',
    label: 'Loan',
    nameField: 'title',
    searchableFields: ['book'],
    fields: JUNCTION_FIELDS,
  },
  onlyInternalText: {
    name: 'lib_loan',
    label: 'Loan',
    fields: { ...JUNCTION_FIELDS, digest: { name: 'digest', type: 'text', internal: true } },
  },
} as const;

const rows = [{ id: '1', book: 'b1', reader: 'r1', due: '2026-01-05' }];

const REFUSAL_MESSAGE =
  "Object 'lib_loan' has no searchable field, so 'search' cannot be honoured on it.";

function makeDataSource(objectDef: unknown, opts: { refuseSearch?: boolean } = {}) {
  return {
    find: vi.fn(async (_object: string, params?: Record<string, unknown>) => {
      if (opts.refuseSearch && params?.$search) {
        // The data adapter's raw-GET failure shape: message, code, status.
        const err = new Error(REFUSAL_MESSAGE) as Error & Record<string, unknown>;
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.httpStatus = 400;
        throw err;
      }
      return { data: rows, total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(objectDef ? { getObjectSchema: vi.fn(async () => objectDef) } : {}),
  } as never as { find: ReturnType<typeof vi.fn> };
}

function mount(
  dataSource: unknown,
  view: Record<string, unknown> = {},
  listProps: Record<string, unknown> = {},
) {
  const schema = {
    type: 'list-view',
    objectName: 'lib_loan',
    viewType: 'grid',
    columns: ['book', 'reader'],
    compactToolbar: false,
    ...view,
  };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={schema as never} dataSource={dataSource as never} {...listProps} />
    </SchemaRendererProvider>,
  );
}

const searchTrigger = () => screen.queryByTestId('search-icon-button');
const gridOnScreen = () =>
  waitFor(() => expect(screen.getByTestId('object-grid-standin')).toBeInTheDocument());
const hostSearches = (dataSource: { find: ReturnType<typeof vi.fn> }) =>
  dataSource.find.mock.calls.map((c: unknown[]) => (c[1] as Record<string, unknown> | undefined)?.$search);
const settle = () => new Promise((r) => setTimeout(r, 50));

afterEach(cleanup);

describe('objectui#12966 — quick-search follows the object\'s resolved search set', () => {
  it('(a) a junction object whose search resolves to no field draws no quick-search box', async () => {
    mount(makeDataSource(OBJECTS.searchless));
    await gridOnScreen();
    expect(searchTrigger()).not.toBeInTheDocument();
  });

  it('(b) CONTROL: the same object with a text field draws it', async () => {
    mount(makeDataSource(OBJECTS.withText));
    await gridOnScreen();
    expect(searchTrigger()).toBeInTheDocument();
  });

  it('(c) an object declaring `searchableFields` naming a stored field draws it', async () => {
    mount(makeDataSource(OBJECTS.declaresStoredField));
    await gridOnScreen();
    expect(searchTrigger()).toBeInTheDocument();
  });

  it('a text field declared `internal: true` does not count — the engine never scans it', async () => {
    mount(makeDataSource(OBJECTS.onlyInternalText));
    await gridOnScreen();
    expect(searchTrigger()).not.toBeInTheDocument();
  });

  it('a VIEW\'s `searchableFields` does not make a searchless object searchable', async () => {
    mount(makeDataSource(OBJECTS.searchless), { searchableFields: ['book'] });
    await gridOnScreen();
    expect(searchTrigger()).not.toBeInTheDocument();
  });

  it('on a searchless object, a term the host restores at mount reaches no fetch', async () => {
    const dataSource = makeDataSource(OBJECTS.searchless);
    mount(dataSource, {}, { initialSearchTerm: 'Dune' });
    await gridOnScreen();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    expect(hostSearches(dataSource).every((s) => s === undefined)).toBe(true);
  });

  it('CONTROL: on a searchable object, the restored term reaches the fetch', async () => {
    const dataSource = makeDataSource(OBJECTS.withText);
    mount(dataSource, {}, { initialSearchTerm: 'Dune' });
    await gridOnScreen();
    await waitFor(() => expect(hostSearches(dataSource).at(-1)).toBe('Dune'));
  });
});

describe('objectui#12966 — a refused search renders the server\'s message', () => {
  it('(e) with no object definition the box stays; a refused term shows the refusal\'s own sentence', async () => {
    const dataSource = makeDataSource(null, { refuseSearch: true });
    mount(dataSource);
    await gridOnScreen();

    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Dune' } });

    const panel = await screen.findByTestId('list-error-state');
    expect(panel).toHaveAttribute('data-error-kind', 'rejected');
    expect(panel).toHaveTextContent(REFUSAL_MESSAGE);
    // The box is still there to clear the term with.
    expect(searchTrigger()).toBeInTheDocument();
  });

  it('CONTROL: a 400 that is not a search refusal keeps the generic rejected copy', async () => {
    const err = Object.assign(new Error('Bad filter'), { code: 'INVALID_QUERY', status: 400 });
    const dataSource = {
      ...makeDataSource(null),
      find: vi.fn(async () => { throw err; }),
    };
    mount(dataSource);
    const panel = await screen.findByTestId('list-error-state');
    expect(panel).toHaveAttribute('data-error-kind', 'rejected');
    expect(panel).not.toHaveTextContent('Bad filter');
  });
});
