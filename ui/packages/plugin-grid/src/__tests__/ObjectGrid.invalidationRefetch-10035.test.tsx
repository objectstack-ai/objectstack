/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10035 — `ObjectGrid` refetches IN PLACE when the data-invalidation
 * bus reports a write to the object it fetches (AGENTS.md #8's corollary:
 * refresh data, don't rebuild UI).
 *
 * The grid used to read no refresh input at all: its load effect moved only on
 * its own internal counter, so a host (`plugin-view`'s `ObjectView`) could show
 * it a write only by bumping its `key` — a remount that threw away selection,
 * scroll, column state and any open inline edit. The grid now names the bus's
 * nonce in that effect.
 *
 * Every case drives the REAL bus (`notifyDataChanged` from `@object-ui/react`)
 * and asserts, where it applies:
 *   (a) the table is the SAME DOM node afterwards — a remount would replace it;
 *   (b) the rows written after the first read reach the screen;
 *   (c) one invalidation costs exactly one refetch (no refetch storm).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { notifyDataChanged } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'duly_task';

/** A server whose store the test writes to, so a refetch returns the new row. */
function makeDataSource() {
  const store: Record<string, any>[] = [{ id: 'r1', name: 'First row' }];
  const find = vi.fn(async () => {
    const data = store.map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  return {
    store,
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

function renderGrid(dataSource: any, extra: Record<string, unknown> = {}) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    pagination: { pageSize: 50 },
  };
  return render(<ObjectGrid schema={schema} dataSource={dataSource} {...extra} />);
}

/** Long enough for any effect a step schedules to have run and settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

describe('ObjectGrid refetches in place on a data-invalidation for its object (objectui#10035)', () => {
  it('an object-scoped change re-reads the rows once, into the same table', async () => {
    const ds = makeDataSource();
    renderGrid(ds);
    await waitFor(() => expect(screen.getByText('First row')).toBeInTheDocument());
    await settle();
    const table = screen.getByRole('table');
    const before = ds.find.mock.calls.length;

    ds.store.push({ id: 'r2', name: 'Written later' });
    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
    });

    await waitFor(() =>
      expect(
        screen.queryByText('Written later'),
        '(b) The grid never re-read its rows after the bus reported a write to its object.\n'
          + 'Its load effect must name `useDataInvalidation(objectName)`\'s nonce.',
      ).toBeInTheDocument(),
    );
    await settle();
    expect(ds.find.mock.calls.length - before, '(c) one invalidation must cost exactly one refetch').toBe(1);
    expect(
      screen.getByRole('table'),
      '(a) The table was replaced: the refresh rebuilt the grid instead of refreshing its data.',
    ).toBe(table);
  });

  it('a record-scoped change to its object re-reads the list too (membership may have moved)', async () => {
    const ds = makeDataSource();
    renderGrid(ds);
    await waitFor(() => expect(screen.getByText('First row')).toBeInTheDocument());
    await settle();
    const before = ds.find.mock.calls.length;

    ds.store[0].name = 'Renamed';
    await act(async () => {
      notifyDataChanged({ objectName: OBJECT, recordId: 'r1' });
    });

    await waitFor(() => expect(screen.getByText('Renamed')).toBeInTheDocument());
    await settle();
    expect(ds.find.mock.calls.length - before).toBe(1);
  });

  it('a change to another object does not refetch', async () => {
    const ds = makeDataSource();
    renderGrid(ds);
    await waitFor(() => expect(screen.getByText('First row')).toBeInTheDocument());
    await settle();
    const before = ds.find.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();

    expect(ds.find.mock.calls.length - before).toBe(0);
  });

  it('a grid handed its rows by a host does not fetch on an invalidation — the host owns that refresh', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { data: [{ id: 'h1', name: 'Host row' }] });
    await waitFor(() => expect(screen.getByText('Host row')).toBeInTheDocument());
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
    });
    await settle();

    expect(ds.find).not.toHaveBeenCalled();
  });
});
