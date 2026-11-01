/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28484 — on a phone, the ENLARGED related tab hands its rows to
 * `object-grid`, whose card face is the phone list's card row (the name, one
 * subtitle line, one status chip) at the body's full width, rather than to the
 * inset `object-gallery`. The rows are the ones this list read, inline; a tap
 * still reaches the host's `onRowClick` with the row.
 *
 * Controls: a related list that is NOT enlarged keeps the gallery on a phone,
 * and the enlarged tab at a desktop width keeps the table.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedListEnlargedContext } from '../relatedListCompact';

/** Capture the schema `RelatedList` hands to `SchemaRenderer`. */
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

const ORIGINAL_INNER_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

afterEach(() => {
  cleanup();
  h.schema = null;
  setWidth(ORIGINAL_INNER_WIDTH);
});

const ROWS = [
  { id: 'c1', name: 'Ada Lovelace', title: 'Director of Sales', status: 'active', lead: 'L-1' },
  { id: 'c2', name: 'Alan Turing', title: 'CTO', status: 'inactive', lead: 'L-1' },
];

function renderList({ enlarged, onRowClick }: { enlarged: boolean; onRowClick?: (...args: unknown[]) => void }) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => ({
      name: 'contact',
      fields: {
        name: { type: 'text', label: 'Name' },
        title: { type: 'text', label: 'Title' },
        status: { type: 'select', label: 'Status', options: [{ value: 'active', label: 'Active' }] },
        lead: { type: 'lookup', reference: 'lead', label: 'Lead' },
      },
    })),
  };
  return render(
    <RelatedListEnlargedContext.Provider value={enlarged}>
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        referenceField="lead"
        parentId="L-1"
        pageSize={25}
        columns={[{ field: 'name', label: 'Name' }, { field: 'title', label: 'Title' }, { field: 'status', label: 'Status' }]}
        onRowClick={onRowClick as never}
        dataSource={dataSource as never}
      />
    </RelatedListEnlargedContext.Provider>,
  );
}

describe('the enlarged related tab on a phone draws the phone list card rows (objectstack#28484)', () => {
  it('hands object-grid the rows it read, inline, with its columns', async () => {
    setWidth(390);
    renderList({ enlarged: true });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(2));
    expect(h.schema.type).toBe('object-grid');
    expect(h.schema.objectName).toBe('contact');
    expect(h.schema.data.provider).toBe('value');
    expect(h.schema.data.items.map((row: any) => row.id)).toEqual(['c1', 'c2']);
    expect(h.schema.columns).toEqual(['name', 'title', 'status']);
    expect(h.schema.gallery, 'no gallery config rides along').toBeUndefined();
  });

  it('a tapped card still reaches the host\'s onRowClick with the row', async () => {
    setWidth(390);
    const onRowClick = vi.fn();
    renderList({ enlarged: true, onRowClick });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(2));
    h.schema.onRowClick(ROWS[1]);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'c2' });
  });

  it('CONTROL: a related list that is not enlarged keeps the gallery on a phone', async () => {
    setWidth(390);
    renderList({ enlarged: false });
    await waitFor(() => expect(h.schema?.type).toBe('object-gallery'));
  });

  it('CONTROL: the enlarged tab at a desktop width keeps the table', async () => {
    setWidth(1280);
    renderList({ enlarged: true });
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));
  });
});
