/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * An empty `object-grid` tells "this object has no record" from "your query
 * found nothing" (objectui#13142).
 *
 * With no authored `emptyState`, an empty grid fell through to the table's own
 * empty row, "No results found / Try adjusting your filters or search query.",
 * over an object that had no record and a grid nobody had searched or
 * filtered. The grid now draws the first-run copy `ListEmptyState` draws
 * (`list.firstRunTitle` / `list.firstRunMessage`) unless a search term is in
 * force, when the table and its row stay; a declared filter alone draws the
 * view-filter copy, never the first-run invitation. An authored `emptyState`
 * still wins wherever it was drawn before.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ObjectGrid } from '../ObjectGrid';
// Registers `object-grid`, the block under test.
import { ObjectGridRenderer } from '../index';

afterEach(cleanup);

const FIRST_RUN_TITLE = 'Nothing here yet';
const FIRST_RUN_MESSAGE = 'Create your first record to get started.';
const TABLE_EMPTY_HEADING = 'No results found';
const TABLE_EMPTY_HINT = 'Try adjusting your filters or search query.';
const AUTHORED_TITLE = 'No contacts yet';

/** A grid over inline rows; `items: []` is a grid with no record at all. */
const grid = (extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: 'probe',
  columns: ['name'],
  data: { provider: 'value', items: [] },
  ...extra,
});

/** A host that owns the search term (the prop `ListView` hands a grid). */
const hostSearched = (search: string, extra: Record<string, unknown> = {}) => (
  <ObjectGrid schema={grid(extra) as never} search={search} />
);

/** The host-driven mode: the grid's own server-side search box writes back to the host. */
const hostDriven = (search: string, extra: Record<string, unknown> = {}) => (
  <ObjectGrid
    schema={grid(extra) as never}
    data={[]}
    manualPagination
    rowCount={0}
    page={1}
    pageSize={10}
    onPageChange={() => {}}
    search={search}
    onSearchChange={() => {}}
  />
);

describe('an empty object-grid with no query draws the first-run state (objectui#13142)', () => {
  it('(a) 0 rows, no query: the first-run title and message, and not "Try adjusting your filters"', async () => {
    const { container } = render(<ObjectGridRenderer schema={grid()} />);
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state.querySelector('h3')).toHaveTextContent(FIRST_RUN_TITLE);
    expect(state).toHaveTextContent(FIRST_RUN_MESSAGE);
    expect(container.textContent ?? '').not.toContain(TABLE_EMPTY_HINT);
    expect(container.textContent ?? '').not.toContain(TABLE_EMPTY_HEADING);
    expect(container.querySelector('table')).toBeNull();
  });

  it('(a) host-driven, no term: the same first-run state', async () => {
    render(hostDriven(''));
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state.querySelector('h3')).toHaveTextContent(FIRST_RUN_TITLE);
  });

  it('(a) under a locale pack: the `list.*` keys resolve to the pack, not to the key or the English default', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ObjectGridRenderer schema={grid()} />
      </I18nProvider>,
    );
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    const heading = state.querySelector('h3')?.textContent ?? '';
    expect(heading).not.toBe('');
    expect(heading).not.toBe('list.firstRunTitle');
    expect(heading).not.toBe(FIRST_RUN_TITLE);
  });

  it('(b) 0 rows with a host search term: the table keeps "No results found" and its hint', async () => {
    const { container } = render(hostSearched('zzz'));
    await screen.findByText(TABLE_EMPTY_HEADING, {}, { timeout: 5000 });
    expect(screen.getByText(TABLE_EMPTY_HINT)).toBeInTheDocument();
    expect(screen.queryByTestId('object-grid-empty-state')).toBeNull();
    expect(container.textContent ?? '').not.toContain(FIRST_RUN_TITLE);
  });

  it('(b) 0 rows with a term in the grid’s own server-side search box: the table, its row and the box stay', async () => {
    const { container } = render(hostDriven('zzz'));
    await screen.findByText(TABLE_EMPTY_HEADING, {}, { timeout: 5000 });
    expect(screen.getByText(TABLE_EMPTY_HINT)).toBeInTheDocument();
    expect(screen.queryByTestId('object-grid-empty-state')).toBeNull();
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('(c) 0 rows under a filter and a search term: the user query wins, the same as (b)', async () => {
    render(hostSearched('zzz', { filter: [['status', '=', 'archived']] }));
    await screen.findByText(TABLE_EMPTY_HEADING, {}, { timeout: 5000 });
    expect(screen.getByText(TABLE_EMPTY_HINT)).toBeInTheDocument();
    expect(screen.queryByTestId('object-grid-empty-state')).toBeNull();
  });

  it('(c) 0 rows under the filter alone: never the first-run invitation, and not "adjust your filters"', async () => {
    const { container } = render(<ObjectGridRenderer schema={grid({ filter: [['status', '=', 'archived']] })} />);
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state.querySelector('h3')).toHaveTextContent('No matching records');
    expect(state).toHaveTextContent('No records match this view’s filter.');
    expect(container.textContent ?? '').not.toContain(FIRST_RUN_MESSAGE);
    expect(container.textContent ?? '').not.toContain(TABLE_EMPTY_HINT);
  });

  it('(d) CONTROL: an authored `emptyState` wins over the first-run state', async () => {
    const { container } = render(<ObjectGridRenderer schema={grid({ emptyState: { title: AUTHORED_TITLE } })} />);
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state.querySelector('h3')).toHaveTextContent(AUTHORED_TITLE);
    expect(container.textContent ?? '').not.toContain(FIRST_RUN_TITLE);
  });

  it('(d) CONTROL: an authored `emptyState` wins under a host search term, as before', async () => {
    const { container } = render(hostSearched('zzz', { emptyState: { title: AUTHORED_TITLE } }));
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state.querySelector('h3')).toHaveTextContent(AUTHORED_TITLE);
    expect(container.textContent ?? '').not.toContain(TABLE_EMPTY_HINT);
  });

  it('is not drawn while the grid holds rows', async () => {
    render(
      <ObjectGridRenderer
        schema={grid({ data: { provider: 'value', items: [{ id: '1', name: 'Alpha' }] } })}
      />,
    );
    await screen.findByText('Alpha', {}, { timeout: 5000 });
    expect(screen.queryByTestId('object-grid-empty-state')).toBeNull();
  });
});
