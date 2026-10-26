/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * One sorting semantics per related list (objectui#3106).
 *
 * A related list used to carry two. Its own sort-button row (opt-in via
 * `sortable`) went out as a server `$orderby` over the whole child collection;
 * the table it embeds took `sortable`'s default of `true` and sorted the rows
 * it held — which, in windowed mode, is one page. Turning `sortable` on put
 * both in the same card, with nothing saying they meant different things; and
 * leaving it off — the default — made the page-local one the *only* sort the
 * user could reach.
 *
 * Now the table's headers drive this list's sort in both modes, and the button
 * row survives only where there are no headers to click (`data-list`).
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads the sorting carried by the schema handed to the table.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table).
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

const rows = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `c${start + i}`,
    name: `Row ${start + i}`,
    owner: `usr_${start + i}`,
  }));

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'owner', header: 'Owner' },
];

const makeWindowedDS = (totalRecords = 12) => ({
  find: vi.fn(async (_api: string, params: any) => {
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? totalRecords;
    return {
      data: rows(skip, Math.max(0, Math.min(top, totalRecords - skip))),
      total: totalRecords,
    };
  }),
  getObjectSchema: vi.fn(async () => ({
    name: 'contact',
    fields: {
      name: { type: 'text' },
      owner: { type: 'lookup', reference: 'user' },
      account: { type: 'lookup', reference: 'account' },
    },
  })),
});

/**
 * The most recent fetch OF THE CHILD COLLECTION.
 *
 * Not simply the last `find` call: a `lookup` column makes this list resolve
 * the related records' labels through the same dataSource, so the last call is
 * usually a label lookup against `user` with no `$orderby` at all.
 */
const lastFindParams = (ds: any) => {
  const calls = ds.find.mock.calls.filter((c: any[]) => c[0] === 'contact');
  return calls[calls.length - 1]?.[1];
};

function renderWindowed(ds: any, props?: Record<string, unknown>) {
  return render(
    <RelatedList
      title="Contacts"
      type="table"
      api="contact"
      objectName="contact"
      referenceField="account"
      parentId="ACC-1"
      columns={columns}
      pageSize={5}
      dataSource={ds as any}
      {...props}
    />,
  );
}

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList — the embedded table sorts the collection, not the window', () => {
  it('hands the table controlled sorting instead of letting it sort locally', async () => {
    const ds = makeWindowedDS();
    renderWindowed(ds);
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));

    expect(h.schema.manualSorting).toBe(true);
    expect(Array.isArray(h.schema.sort)).toBe(true);
    expect(typeof h.schema.onSortChange).toBe('function');
  });

  it('turns a header sort into a server $orderby over the whole collection', async () => {
    const ds = makeWindowedDS();
    renderWindowed(ds);
    await waitFor(() => expect(typeof h.schema?.onSortChange).toBe('function'));

    await React.act(async () => {
      h.schema.onSortChange([{ field: 'name', order: 'desc' }]);
    });

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'name', order: 'desc' }]);
    });
  });

  it('assigns the direction the header resolved rather than re-toggling it', async () => {
    // The table sends the direction it computed against `sort`. Running that
    // back through the button row's own toggle would invert it.
    const ds = makeWindowedDS();
    renderWindowed(ds);
    await waitFor(() => expect(typeof h.schema?.onSortChange).toBe('function'));

    await React.act(async () => {
      h.schema.onSortChange([{ field: 'name', order: 'desc' }]);
    });
    await waitFor(() => expect(lastFindParams(ds).$orderby).toEqual([{ field: 'name', order: 'desc' }]));

    await React.act(async () => {
      h.schema.onSortChange([{ field: 'name', order: 'desc' }]);
    });
    await waitFor(() => expect(lastFindParams(ds).$orderby).toEqual([{ field: 'name', order: 'desc' }]));
  });

  it('returns to the first page when the order changes', async () => {
    const ds = makeWindowedDS();
    renderWindowed(ds);
    await waitFor(() => expect(typeof h.schema?.onSortChange).toBe('function'));

    await React.act(async () => {
      h.schema.onSortChange([{ field: 'name', order: 'asc' }]);
    });

    await waitFor(() => {
      const p = lastFindParams(ds);
      expect(p.$orderby).toEqual([{ field: 'name', order: 'asc' }]);
      expect(p.$skip ?? 0).toBe(0);
    });
  });

  it('shows the declared defaultSort before anyone clicks — the same one it fetched with', async () => {
    const ds = makeWindowedDS();
    renderWindowed(ds, { defaultSort: '-name' });
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));

    expect(h.schema.sort).toEqual([{ field: 'name', order: 'desc' }]);
    expect(lastFindParams(ds).$orderby).toEqual([{ field: 'name', order: 'desc' }]);
  });

  it('withholds the header from a relational column while windowed (#3096)', async () => {
    // `$orderby` on `owner` orders by the stored id while the cell shows a
    // name. This is the rule the sort-button row already applied.
    const ds = makeWindowedDS();
    renderWindowed(ds);
    await waitFor(() => expect(h.schema?.columns?.length).toBeGreaterThan(0));

    const owner = h.schema.columns.find((c: any) => c.accessorKey === 'owner');
    const name = h.schema.columns.find((c: any) => c.accessorKey === 'name');
    expect(owner.sortable).toBe(false);
    expect(name.sortable).not.toBe(false);
  });

  it('keeps a relational header live in client mode, where the key is the label', async () => {
    // Not windowed (caller supplied `data`), so this list sorts in memory
    // through its resolved label map — an honest key, unlike the stored id.
    render(
      <RelatedList
        title="Contacts"
        type="table"
        objectName="contact"
        columns={columns}
        data={rows(0, 3)}
        dataSource={makeWindowedDS() as any}
      />,
    );
    await waitFor(() => expect(h.schema?.columns?.length).toBeGreaterThan(0));

    const owner = h.schema.columns.find((c: any) => c.accessorKey === 'owner');
    expect(owner.sortable).not.toBe(false);
    // Still controlled: this list owns the order in both modes, so there is
    // never a table-local sort sitting on top of it.
    expect(h.schema.manualSorting).toBe(true);
  });
});

describe('RelatedList — one sort control per card', () => {
  it('renders no sort-button row for a table list, even with sortable on', async () => {
    // The headers carry the sort. A button row above them would be a second
    // control over one order — and, before #3106, a second ORDER.
    const ds = makeWindowedDS();
    renderWindowed(ds, { sortable: true });
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));

    expect(screen.queryByRole('button', { name: /^Name/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Owner/ })).toBeNull();
  });

  it('keeps the button row for a `list` related list, which has no headers', async () => {
    render(
      <RelatedList
        title="Contacts"
        type="list"
        objectName="contact"
        columns={columns}
        data={rows(0, 3)}
        sortable
        dataSource={makeWindowedDS() as any}
      />,
    );
    await waitFor(() => expect(h.schema?.type).toBe('data-list'));

    expect(screen.getByRole('button', { name: /Name/ })).toBeTruthy();
  });
});
