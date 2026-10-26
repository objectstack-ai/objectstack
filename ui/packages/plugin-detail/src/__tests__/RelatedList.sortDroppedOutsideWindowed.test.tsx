/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A declared related-list `sort` is DROPPED while the client text filter is
 * active — recorded, not fixed (attached to objectui#5795).
 *
 * `$orderby` is assembled inside `RelatedList`'s WINDOWED branch only, and
 * `windowed` is false whenever `filterActive` is true: the built-in
 * contains-filter is a client-side sweep over the list's unmasked columns
 * (objectui#10728), inexpressible as a server filter, so the component falls
 * back to fetching the whole collection.
 * On that path the rows are returned in the order the server chose (primary
 * key), because client-side sorting only runs when the user has clicked a
 * column (`sortField`), and a declared `sort` never sets `sortField`.
 *
 * So a list ordered by `seq_no` reverts to id order the moment someone types a
 * letter into its filter box, and returns to `seq_no` order when they clear it.
 *
 * ## Why this file exists here, on this card
 *
 * objectui#5795 makes derived related lists INHERIT the child object's default
 * list view `sort`. That inheritance lands on exactly this prop, so it lands on
 * exactly this hole — and the hole becomes reachable without anyone authoring
 * anything, on every derived list whose child object declares a list-view
 * order. Fixing it means changing `RelatedList`'s fetch/sort split, which is
 * out of scope for that card (`RelatedList.tsx` is not its file surface).
 *
 * Recording it is the part that is in scope: pinned, the disappearance is a
 * known, deliberate, dated fact with a test that will go red when someone
 * closes it — instead of a surprise found by a user whose sorted tab
 * unsorts itself mid-search.
 *
 * ⚠️ This file asserts TODAY'S behaviour. When the hole is closed, these
 * assertions SHOULD go red — the fix is to rewrite them to the new contract,
 * not to delete the file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

// Capture the schema RelatedList hands to SchemaRenderer (the data-table), so
// the rows it renders can be read without the table in the way.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

/** Rows in the server's primary-key order, deliberately NOT in `seq_no` order. */
const PK_ORDER = [
  { id: 'ci-b', name: 'Item B', seq_no: 20 },
  { id: 'ci-c', name: 'Item C', seq_no: 30 },
  { id: 'ci-a', name: 'Item A', seq_no: 10 },
  { id: 'ci-d', name: 'Item D', seq_no: 40 },
];

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'seq_no', header: 'Seq No' },
];

/**
 * A backend that HONOURS `$orderby` — so an unordered result in these tests
 * means the query carried no ordering, not that the fake ignored one.
 */
const makeDS = () => ({
  find: vi.fn(async (_api: string, params: any) => {
    const rows = [...PK_ORDER];
    const orderby = params?.$orderby;
    if (Array.isArray(orderby) && orderby.length > 0) {
      const { field, order } = orderby[0];
      rows.sort((a: any, b: any) => (a[field] - b[field]) * (order === 'desc' ? -1 : 1));
    }
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? rows.length;
    return { data: rows.slice(skip, skip + top), total: rows.length };
  }),
});

const DECLARED_SORT = [{ field: 'seq_no', order: 'asc' as const }];

function renderList(ds: any) {
  return render(
    <RelatedList
      title="Check Items"
      type="table"
      api="check_item"
      objectName="check_item"
      referenceField="task_version"
      parentId="tv-1"
      pageSize={10}
      columns={columns}
      defaultSort={DECLARED_SORT}
      filterable
      dataSource={ds as any}
    />,
  );
}

const seqOrder = () => (h.schema?.data ?? []).map((r: any) => r.seq_no);
const lastParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList — a declared sort outside windowed mode (attached to objectui#5795)', () => {
  it('CONTROL — windowed, the declared sort goes out as $orderby and rows arrive ordered', async () => {
    const ds = makeDS();
    renderList(ds);
    await waitFor(() => expect(h.schema?.data?.length).toBe(4));
    expect(lastParams(ds).$orderby).toEqual(DECLARED_SORT);
    expect(seqOrder()).toEqual([10, 20, 30, 40]);
  });

  it('RECORDED HOLE — typing in the client filter drops $orderby from the query', async () => {
    const ds = makeDS();
    renderList(ds);
    await waitFor(() => expect(h.schema?.data?.length).toBe(4));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Item' } });

    // The refetch leaves windowed mode: no `$top`/`$skip` window, and with it
    // no `$orderby` — the declared order is not expressed anywhere on the wire.
    await waitFor(() => {
      expect(lastParams(ds).$top).toBeUndefined();
    });
    expect(lastParams(ds).$orderby).toBeUndefined();
    // Live control: the query is still the scoped related-list query.
    expect(lastParams(ds).$filter).toEqual({ task_version: 'tv-1' });
  });

  it('RECORDED HOLE — and the rows the user sees revert to the server order', async () => {
    const ds = makeDS();
    renderList(ds);
    await waitFor(() => expect(seqOrder()).toEqual([10, 20, 30, 40]));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Item' } });

    // Every row still matches the filter, so this is purely the ordering
    // changing under the user: 10/20/30/40 becomes the primary-key order.
    await waitFor(() => expect(seqOrder()).toEqual([20, 30, 10, 40]));
  });

  it('the order comes back when the filter is cleared', async () => {
    const ds = makeDS();
    renderList(ds);
    await waitFor(() => expect(seqOrder()).toEqual([10, 20, 30, 40]));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Item' } });
    await waitFor(() => expect(seqOrder()).toEqual([20, 30, 10, 40]));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    await waitFor(() => expect(seqOrder()).toEqual([10, 20, 30, 40]));
  });
});
