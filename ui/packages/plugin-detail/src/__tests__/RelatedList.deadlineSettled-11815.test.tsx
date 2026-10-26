/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — a related list judges each CHILD row's declared deadline
 * against that row (never the parent record), and asks the server for the
 * fields its `settledWhen` reads when no column shows them.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** Capture the schema `RelatedList` hands to `SchemaRenderer` (the data-table). */
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

const OBJECT = 'task';
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const FIELDS = {
  title: { type: 'text', label: 'Title' },
  status: { type: 'text', label: 'Status' },
  project_id: { type: 'text', label: 'Project' },
  due_date: { type: 'date', label: 'Due', dueLike: true, settledWhen: "record.status == 'done'" },
};
const ROWS = [
  { id: 't1', title: 'Open', status: 'open', due_date: daysAgo(5), project_id: 'p1' },
  { id: 't2', title: 'Done', status: 'done', due_date: daysAgo(5), project_id: 'p1' },
];

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: FIELDS })),
  find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
});

beforeEach(() => {
  h.schema = null;
});
afterEach(cleanup);

const renderList = (ds: ReturnType<typeof makeDataSource>) =>
  render(
    <RelatedList
      title="Tasks"
      type="table"
      api={OBJECT}
      objectName={OBJECT}
      referenceField="project_id"
      parentId="p1"
      dataSource={ds as any}
      columns={['title', 'due_date']}
    />,
  );

const drawCell = (row: Record<string, unknown>) => {
  const col = (h.schema?.columns ?? []).find((c: any) => c.accessorKey === 'due_date');
  const { container } = render(<>{col.cell(row.due_date, row)}</>);
  const span = container.querySelector('span.tabular-nums') as HTMLElement | null;
  return { text: span?.textContent ?? '', red: !!span?.className.includes('text-red-600') };
};

describe('RelatedList — each child row is judged on its own (objectui#11815)', () => {
  it("an open row's declared deadline reads overdue, a done row's reads neutral", async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect((h.schema?.columns ?? []).some((c: any) => c.accessorKey === 'due_date')).toBe(true));
    expect(drawCell(ROWS[0])).toEqual({ text: 'Overdue 5d', red: true });
    expect(drawCell(ROWS[1])).toEqual({ text: '5 days ago', red: false });
  });

  it("asks for the settledWhen's operand when no column shows it", async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const selects = ds.find.mock.calls.filter(([api]: any[]) => api === OBJECT).map(([, p]: any[]) => p?.$select);
    expect(selects.length).toBeGreaterThan(0);
    for (const sel of selects) expect(sel).toEqual(expect.arrayContaining(['id', 'title', 'due_date', 'status']));
  });
});
