/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list.showViewAll` — READ (objectui#12741; ENFORCE, the
 * objectui half of objectstack-ai/objectstack#23941).
 *
 * The contract declares `showViewAll: z.boolean().default(true)`, "Show 'View
 * All' link to see all related records". Until objectui#12741 nothing read it
 * and no host handed `RelatedList` an `onViewAll`, so the default `true` drew
 * nothing. The rule this file pins:
 *
 *   - ABSENT or `true` → the link draws when the host offers a destination
 *     (`handlers.onViewAll`) and the list has records, including when every
 *     row fits on the list (no truncation condition: the spec states none);
 *   - `false` → no link, whatever the host offers;
 *   - an EMPTY list → no link;
 *   - no destination from the host (none offered, or no host at all) → no link.
 *
 * The destination itself, the child object's list scoped to this parent, is
 * the host's, and is pinned through the real bridge in
 * `app-shell/src/views/__tests__/RelatedRecordActionsBridge.viewAll-12741.test.tsx`.
 *
 * Every case mounts the node the way a page does: the `{ type, properties }`
 * document through the real `SchemaRenderer`, this package's registration, the
 * real `RelatedList` and the real data table, and reads the DOM.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  RecordContextProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
// Registers `record:related_list`, the block under test.
import '../index';

/** Desktop, pinned (objectui#8399): under 768px a table related list is a card gallery. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** Two rows, under the spec's default `limit` of 5: every row fits. */
const ROWS = [
  { id: 'c1', name: 'Alice' },
  { id: 'c2', name: 'Bob' },
];

const onViewAll = vi.fn();
const onCreate = vi.fn();

/** Stable, like the bridge's memoised value. `onCreate` is the painted-header control. */
const HOST: RelatedRecordActionsValue = {
  resolve: ({ objectName }) => (objectName === 'contact' ? { onCreate, onViewAll } : {}),
};
/** A host that offers no destination, as the bridge does when no route can show the list. */
const HOST_WITHOUT_DESTINATION: RelatedRecordActionsValue = {
  resolve: ({ objectName }) => (objectName === 'contact' ? { onCreate } : {}),
};

const makeDataSource = (rows: unknown[]) => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
});

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (showViewAll: unknown) => ({
  type: 'record:related_list',
  properties: {
    objectName: 'contact',
    relationshipField: 'account_id',
    columns: ['name'],
    ...(showViewAll === undefined ? {} : { showViewAll }),
  },
});

function mount(
  showViewAll: unknown,
  { host = HOST as RelatedRecordActionsValue | null, rows = ROWS as unknown[] } = {},
) {
  const node = <SchemaRenderer schema={doc(showViewAll) as never} />;
  return render(
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDataSource(rows) as never}>
      {host ? <RelatedRecordActionsProvider value={host}>{node}</RelatedRecordActionsProvider> : node}
    </RecordContextProvider>,
  );
}

const viewAll = () => screen.queryByRole('button', { name: /view all/i });
/** Both rows painted: every "no link" read below is taken on a list that drew its records. */
const waitForRows = async () => {
  await screen.findByText('Alice');
  await screen.findByText('Bob');
};

beforeEach(() => {
  onViewAll.mockClear();
  onCreate.mockClear();
});

afterEach(() => cleanup());

describe('record:related_list.showViewAll — default on (objectui#12741)', () => {
  it('ABSENT (the spec default `true`): the link draws although every row fits, and calls the host’s destination', async () => {
    mount(undefined);
    await waitForRows();
    const link = viewAll();
    expect(link).toBeInTheDocument();
    fireEvent.click(link!);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('`true`: the link draws', async () => {
    mount(true);
    await waitForRows();
    expect(viewAll()).toBeInTheDocument();
  });
});

describe('record:related_list.showViewAll — when no link draws (objectui#12741)', () => {
  it('`false`: no link, while the host offers a destination', async () => {
    mount(false);
    await waitForRows();
    // The header painted (the host's New), so the absence is the key's.
    expect(await screen.findByTestId('related-list-new')).toBeInTheDocument();
    expect(viewAll()).toBeNull();
    expect(onViewAll).not.toHaveBeenCalled();
  });

  it('an EMPTY list: no link', async () => {
    mount(undefined, { rows: [] });
    expect(await screen.findByTestId('related-list-new')).toBeInTheDocument();
    expect(await screen.findByText(/no related records|no records/i)).toBeInTheDocument();
    expect(viewAll()).toBeNull();
  });

  it('a host that offers no destination: no link', async () => {
    mount(undefined, { host: HOST_WITHOUT_DESTINATION });
    await waitForRows();
    expect(await screen.findByTestId('related-list-new')).toBeInTheDocument();
    expect(viewAll()).toBeNull();
  });

  it('no host at all: no link — there is nothing to open', async () => {
    mount(undefined, { host: null });
    await waitForRows();
    expect(viewAll()).toBeNull();
  });
});
