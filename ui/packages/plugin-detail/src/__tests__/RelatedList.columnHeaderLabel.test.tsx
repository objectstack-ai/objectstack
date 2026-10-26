/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedList` translates a column's DISPLAY TEXT into the adapter's
 * vocabulary before delivery (objectui#5351) — the header counterpart of the
 * identity stamp objectui#5022 put in the same function.
 *
 * objectui#5022 moved IDENTITY resolution here and deliberately left the header
 * alone, because `data-table` still read `header: col.header || col.label`. The
 * 2026-08-20 ruling retired that alias, so the other half of the translation has
 * to move here with it. Without it, every `record_related_list` block whose
 * columns are authored the spec way (`{ field, label }` — the shape
 * `ListColumnSchema` declares, and the shape `record-related-list.tsx` passes
 * straight through as `columns`) would arrive HEADERLESS: live cells under a
 * blank title. That is a different failure from #5120's blank-cells-under-a-live
 * -header, which is why the two were filed as separate cards.
 *
 * Pinned through the REAL `data-table`, because a schema-level assertion cannot
 * see it: the column object looks complete at every RelatedList read site — it
 * always did, which is what made the identity half silent too.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads a rendered column HEADER.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const fields = {
  status: {
    type: 'select',
    label: 'SchemaLabel',
    options: [
      { value: 'planned', label: 'Planned' },
      { value: 'running', label: 'Running' },
    ],
  },
};

const rows = [
  { id: 't1', status: 'planned' },
  { id: 't2', status: 'running' },
];

const makeDS = () => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async () => ({ name: 'task', fields })),
});

function renderList(columns: any[]) {
  return render(
    <RelatedList
      title="Tasks"
      type="table"
      api="task"
      objectName="task"
      columns={columns}
      data={rows}
      dataSource={makeDS() as any}
    />,
  );
}

/** Every rendered header cell's text, in order. */
const headers = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

describe('RelatedList — the spec `label` reaches the adapter as `header` (#5351)', () => {
  it('renders the header of a fully spec-spelled column', async () => {
    renderList([{ field: 'status', label: 'Status' }]);
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    expect(headers()).toEqual(['Status']);
  });

  it('renders the header of a legacy `name` + `label` column', async () => {
    // `name` is objectui-side legacy that `columnIdentity` still folds; the
    // header translation is independent of which identity spelling was used.
    renderList([{ name: 'status', label: 'Status' }]);
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    expect(headers()).toEqual(['Status']);
  });

  it('renders the header of an adapter-spelled column unchanged', async () => {
    renderList([{ accessorKey: 'status', header: 'Status' }]);
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    expect(headers()).toEqual(['Status']);
  });

  it('never overwrites an author-supplied `header` with a divergent `label`', async () => {
    renderList([{ field: 'status', label: 'ignored', header: 'Status' }]);
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    expect(headers()).toEqual(['Status']);
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
  });

  it('leaves a column with no display text headerless — nothing is invented', async () => {
    // Deliberately NOT derived from the field def here: the object-schema
    // fallback belongs to the bare-string branch, which is where an author who
    // supplied no column object at all asked for a derived title. An object
    // column that names no text keeps rendering as it did.
    renderList([{ field: 'status' }]);
    await waitFor(() => expect(document.querySelectorAll('thead th').length).toBeGreaterThan(0));
    expect(headers()).toEqual(['']);
    expect(screen.queryByText('SchemaLabel')).not.toBeInTheDocument();
  });
});
