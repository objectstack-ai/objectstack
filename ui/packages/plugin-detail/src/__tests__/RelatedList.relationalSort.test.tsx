/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3096 — a related list must not offer a sort whose key is invisible.
 *
 * The two branches differ in what a sort even CAN order by, so they diverge:
 *
 *   - windowed (server `$orderby` over the whole child collection): the key is
 *     the stored foreign-key id, and no join is available to reach the related
 *     record's name (objectstack#4256). The affordance is withheld.
 *   - client mode (sorting the rows already in memory): the key can be — and
 *     now is — the label the cell shows, resolved from this list's own
 *     id → name map. The affordance stays, and it sorts by the name.
 *
 * The guarantee is unchanged since #3106 moved the affordance; what carries it
 * is now the embedded table's column headers rather than a separate row of sort
 * buttons, so these assertions read the column's `sortable` flag and drive the
 * table's `onSortChange` instead of clicking buttons that no longer exist for a
 * `table` list. (The button row survives for `data-list`, which has no headers
 * — covered in `RelatedList.headerSort.test.tsx`.)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Both cases read whether a relational column keeps its HEADER.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table), so
// we can read the row order it renders without depending on the table itself.
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

const objectSchema = {
  name: 'contact',
  fields: {
    name: { type: 'text', label: 'Name' },
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  },
};

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'owner', header: 'Owner' },
];

/** Owner ids are opaque and deliberately disagree with the owner NAMES. */
const owners: Record<string, string> = { u_1: 'Zoe', u_2: 'Alice', u_3: 'Mallory' };

const contacts = [
  { id: 'c1', name: 'Row 1', owner: 'u_1' },
  { id: 'c2', name: 'Row 2', owner: 'u_2' },
  { id: 'c3', name: 'Row 3', owner: 'u_3' },
];

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async () => objectSchema),
  find: vi.fn(async (api: string, params: any) => {
    if (api === 'sys_user') {
      const ids: string[] = params?.$filter?.id?.$in ?? [];
      return { data: ids.map((id) => ({ id, name: owners[id] })) };
    }
    const skip = params?.$skip ?? 0;
    const top = params?.$top ?? contacts.length;
    return { data: contacts.slice(skip, skip + top), total: contacts.length };
  }),
});

/** Whether the embedded table offers a sort on this column. */
const columnSortable = (accessorKey: string) => {
  const col = h.schema?.columns?.find((c: any) => c.accessorKey === accessorKey);
  return col ? col.sortable !== false : undefined;
};

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList sort entry points — relational columns (objectui#3096)', () => {
  it('withholds the relational column header when the sort is a server $orderby', async () => {
    const dataSource = makeDataSource();
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        referenceField="account"
        parentId="ACC-1"
        pageSize={5}
        columns={columns}
        sortable
        dataSource={dataSource as any}
      />,
    );
    // A plain column stays sortable — proving the table rendered at all.
    await waitFor(() => expect(columnSortable('name')).toBe(true));
    expect(columnSortable('owner')).toBe(false);
  });

  it('keeps it in client mode and orders by the resolved label, not the id', async () => {
    const dataSource = makeDataSource();
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        referenceField="account"
        parentId="ACC-1"
        columns={columns}
        sortable
        data={contacts}
        dataSource={dataSource as any}
      />,
    );
    // Wait for the id → name map to resolve; until then the cells show ids.
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledWith('sys_user', expect.anything()));

    expect(columnSortable('owner')).toBe(true);
    await React.act(async () => {
      h.schema.onSortChange([{ field: 'owner', order: 'asc' }]);
    });

    await waitFor(() =>
      expect(h.schema.data.map((row: any) => owners[row.owner])).toEqual([
        'Alice',
        'Mallory',
        'Zoe',
      ]),
    );
    // The stored ids would have ordered them Zoe / Alice / Mallory.
    expect([...contacts].sort((a, b) => a.owner.localeCompare(b.owner)).map((r) => owners[r.owner]))
      .toEqual(['Zoe', 'Alice', 'Mallory']);
  });
});
