/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5022, the boundary half — WHERE the column identity is resolved.
 *
 * `column-identity.ts` draws a deliberate line at `TABLE_ADAPTER_COLUMN_KEY`:
 * `accessorKey` names a slot in the table LIBRARY's column model, not a field
 * in ObjectStack metadata, and the canonicalizing fold "neither reads nor
 * writes it". So the fix for the blank-cell defect belongs on RelatedList's
 * side of that line — `normalizeColumn` speaks the adapter's vocabulary to the
 * adapter — and not inside `data-table`'s accessor normalization, which would
 * merge the two vocabularies in the one place the module says it must not.
 *
 * These pins assert exactly that: the column objects handed to the table
 * already carry `accessorKey`, and an author-supplied one is never rewritten.
 * The rendered-cell half lives in `RelatedList.columnIdentityAccessor.test.tsx`
 * — this file mocks `SchemaRenderer`, so it cannot see real cells.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads the column objects `RelatedList` hands the table; on the
 * mobile branch what it hands over is an `object-gallery` schema, which carries
 * no `columns` at all.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table) —
// the same lever `RelatedList.headerSort.test.tsx` uses.
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

const fields = {
  subject: { type: 'text', label: 'Subject' },
  status: { type: 'text', label: 'Status' },
};

const rows = [
  { id: 't1', subject: 'Fix the pump', status: 'planned' },
  { id: 't2', subject: 'Replace filter', status: 'running' },
];

const makeDS = () => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async () => ({ name: 'task', fields })),
});

function renderList(columns: any[]) {
  h.schema = null;
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

const firstColumn = async () => {
  await waitFor(() => expect(h.schema?.columns?.length).toBe(1));
  return h.schema.columns[0];
};

describe('objectui#5022 — the identity is resolved before the table adapter, not inside it', () => {
  it('stamps the resolved identity onto `accessorKey` for a `field` entry', async () => {
    renderList([{ field: 'status', label: 'Status' }]);
    const col = await firstColumn();

    expect(col.accessorKey).toBe('status');
    // The authored spelling survives — the stamp mirrors, it does not move.
    expect(col.field).toBe('status');
  });

  it('stamps the resolved identity onto `accessorKey` for a legacy `name` entry', async () => {
    renderList([{ name: 'status', label: 'Status' }]);
    const col = await firstColumn();

    expect(col.accessorKey).toBe('status');
    expect(col.name).toBe('status');
  });

  it('does not overwrite an author-supplied `accessorKey`', async () => {
    // A deliberate divergence — the table column reads one slot while the
    // metadata names another — belongs to the author, not to this resolver.
    renderList([{ accessorKey: 'status', field: 'subject', header: 'Status' }]);
    const col = await firstColumn();

    expect(col.accessorKey).toBe('status');
    expect(col.field).toBe('subject');
  });

  it('leaves an entry with no resolvable identity untouched', async () => {
    // `columnIdentity` returns undefined rather than '' precisely so callers
    // can tell "no identity" apart from an empty one; nothing is invented here.
    renderList([{ label: 'Nothing' }]);
    const col = await firstColumn();

    expect(col.accessorKey).toBeUndefined();
  });

  it('gives the cells the same identity the sort already used', async () => {
    // The card's asymmetry: the sort path resolved `status` through
    // `columnIdentity` and sorted correctly while the cells read
    // `row[undefined]`. One identity now feeds both.
    renderList([{ field: 'status', label: 'Status' }]);
    const col = await firstColumn();

    expect(col.accessorKey).toBe('status');
    expect(typeof h.schema.onSortChange).toBe('function');
  });
});
