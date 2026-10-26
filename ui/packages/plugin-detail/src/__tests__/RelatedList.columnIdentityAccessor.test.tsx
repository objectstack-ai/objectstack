/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5022 — a related-list column object keyed with the spec-canonical
 * `field` spelling must reach the screen with VALUES, not just a header.
 *
 * The seam this pins: `RelatedList` resolves column identity through
 * `columnIdentity()` (canonical-first on `field`, objectui#3104), so
 * `{ field: 'status', label: 'Status' }` passes the FLS filter, the FK filter,
 * `pruneEmpty`, the sort-button row, and even collects a type-aware `cell`.
 * The `data-table` it feeds then normalizes the accessor as
 * `accessorKey: col.accessorKey || col.name` — it never reads `field` — so
 * every cell read `row[undefined]` and rendered the empty placeholder: the
 * objectui#3951 blank-cell shape, one spelling over.
 *
 * These pins render the REAL `data-table` and read the REAL cells, because the
 * defect was invisible to every schema-level assertion — the column object
 * looked complete at every RelatedList read site. The boundary half (the
 * identity is resolved before the adapter, not inside it) is pinned in
 * `RelatedList.columnIdentityAccessor.schema.test.tsx`, which has to mock
 * `SchemaRenderer` and therefore cannot live in this file.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads rendered table CELLS.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// `status` is a `select` on purpose: its cell renderer resolves the stored
// value to the option LABEL, so a cell reading the right field says "Planned"
// while a cell reading `row[undefined]` falls into `makeCell`'s null branch and
// says "—". That makes the two outcomes textually distinguishable — with a
// plain `text` column both a broken accessor and an empty value render as the
// empty string, and the pin could not tell them apart.
const fields = {
  subject: { type: 'text', label: 'Subject' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'planned', label: 'Planned' },
      { value: 'running', label: 'Running' },
    ],
  },
};

const rows = [
  { id: 't1', subject: 'Fix the pump', status: 'planned' },
  { id: 't2', subject: 'Replace filter', status: 'running' },
];

const makeDS = () => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async () => ({ name: 'task', fields })),
});

/** Render a `table` related list over the given rows with the given columns. */
function renderList(columns: any[], data: any[] = rows) {
  return render(
    <RelatedList
      title="Tasks"
      type="table"
      api="task"
      objectName="task"
      columns={columns}
      data={data}
      dataSource={makeDS() as any}
    />,
  );
}

/**
 * The placeholder `makeCell` renders for a null/undefined value. Its presence
 * in a column whose rows all HAVE values is the defect's fingerprint.
 */
const EM_DASH = '—';

/** Every rendered body cell's text, in DOM order. */
const cellTexts = () =>
  screen.getAllByRole('cell').map((c) => (c.textContent || '').trim());

describe('objectui#5022 — RelatedList object columns render cells for every identity spelling', () => {
  it('renders real cell values for the spec-canonical `field` spelling', async () => {
    renderList([{ field: 'status', label: 'Status' }]);

    // The header always rendered — that is what made the defect silent.
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());

    // The cells are what was blank: both rows' values, no placeholder.
    // Waited on, not sampled — the option labels only appear once the object
    // schema resolves and `makeCell` attaches the select renderer.
    await waitFor(() =>
      expect(cellTexts()).toEqual(expect.arrayContaining(['Planned', 'Running'])),
    );
    expect(screen.queryAllByText(EM_DASH)).toHaveLength(0);
  });

  it('keeps the legacy `name` spelling working end to end', async () => {
    // `column-identity.ts` documents `name` as objectui-side legacy for list
    // surfaces; it is the ONE object spelling that worked before this fix, and
    // must not be traded away for the canonical one.
    renderList([{ name: 'status', label: 'Status' }]);

    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    await waitFor(() =>
      expect(cellTexts()).toEqual(expect.arrayContaining(['Planned', 'Running'])),
    );
    expect(screen.queryAllByText(EM_DASH)).toHaveLength(0);
  });

  it('leaves an explicit `accessorKey` entry rendering as before', async () => {
    // The table's own vocabulary, authored directly: the resolver must not
    // second-guess it.
    renderList([{ accessorKey: 'status', header: 'Status' }]);

    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    await waitFor(() =>
      expect(cellTexts()).toEqual(expect.arrayContaining(['Planned', 'Running'])),
    );
    expect(screen.queryAllByText(EM_DASH)).toHaveLength(0);
  });

  it('keeps bare-string entries hydrating as before', async () => {
    renderList(['status']);

    // The string path resolves the header from the object schema's field label.
    await waitFor(() => expect(screen.getByText('Status')).toBeInTheDocument());
    await waitFor(() =>
      expect(cellTexts()).toEqual(expect.arrayContaining(['Planned', 'Running'])),
    );
    expect(screen.queryAllByText(EM_DASH)).toHaveLength(0);
  });

  it('renders a mixed-spelling column set without blanking either column', async () => {
    renderList([
      { field: 'subject', label: 'Subject' },
      { name: 'status', label: 'Status' },
    ]);

    await waitFor(() => expect(screen.getByText('Subject')).toBeInTheDocument());
    await waitFor(() =>
      expect(cellTexts()).toEqual(
        expect.arrayContaining(['Fix the pump', 'Planned', 'Replace filter', 'Running']),
      ),
    );
    expect(screen.queryAllByText(EM_DASH)).toHaveLength(0);
  });

  it('makes a header sort order by the field the cells display', async () => {
    // One identity has to feed BOTH halves. On a `table` list the sort control
    // is the column header, and the table resolves what it sorts by from
    // `col.accessorKey` — the same slot the cells read. So an unstamped `field`
    // column did not merely render blank: its header sort dispatched an
    // undefined field, which `RelatedList` drops (`!sortField` → unsorted), and
    // the column was inert in both directions at once.
    renderList([{ field: 'status', label: 'Status' }], [rows[1], rows[0]]);

    await waitFor(() =>
      expect(cellTexts()).toEqual(expect.arrayContaining(['Planned', 'Running'])),
    );
    // As supplied: Running first.
    expect(cellTexts()[0]).toBe('Running');

    fireEvent.click(screen.getByText('Status'));

    // Ascending by the stored value (`planned` < `running`) — the field the
    // cells are showing, not `undefined`.
    await waitFor(() => expect(cellTexts()[0]).toBe('Planned'));
  });
});
