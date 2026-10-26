/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10250 — the gantt's record query carries the node's full-text
 * search: `search` as `$search`, and `searchableFields` as `$searchFields`
 * alongside it.
 *
 * ## What was wrong
 *
 * `ListView` offers its toolbar Search box on a gantt view, and its own fetch
 * sends `$search` (plus `$searchFields` when the view declares
 * `searchableFields`). The gantt chart does not draw those rows: the registered
 * `object-gantt` wrapper hands `ObjectGantt` the node's `schema` and nothing
 * else, and `reload` issues the chart's own query. That query had no search
 * channel at all, so the term changed the list's fetch and nothing drawn. The
 * node is the only door: `ListView` writes the term there, and this file pins
 * the half that reads it. The writing half is pinned in
 * `plugin-list/src/__tests__/ListView.selfQueryingViewsToolbarState-10250.test.tsx`.
 *
 * ## The shape is the list's own
 *
 * The pair travels together or not at all — a field list with no term is
 * inert, exactly as it is on `ListView`'s fetch and on `ObjectGrid`'s. Nothing
 * here decides WHICH fields a term matches: that is the server's answer from
 * the object's metadata (ADR-0061), narrowed only by an authored list.
 *
 * REVERSE VERIFICATION. Delete the `$search` spread from `reload`: TERM,
 * FIELDS, CHANGE and INLINE go red, and so does STABILITY, whose precondition
 * waits for the pair; CONTROL and INERT FIELDS stay green (they assert an
 * absence, which a query without the pair satisfies). Key the effect on
 * `schema.searchableFields` itself instead of its serialised value: STABILITY
 * alone goes red.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The bar canvas is irrelevant — every assertion is about the QUERY, plus one
// about which inline rows reached the chart.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-task-ids={tasks.map((t: any) => String(t.id)).join(',')} />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const ROWS = [
  { id: '1', subject: 'Alpha needle', visible_from: '2026-01-01', due_date: '2026-01-31' },
  { id: '2', subject: 'Bravo', visible_from: '2026-02-01', due_date: '2026-02-28' },
  { id: '3', subject: 'Charlie needle', visible_from: '2026-03-01', due_date: '2026-03-31' },
];

let calls: Array<Record<string, any>> = [];

function makeDataSource() {
  return {
    find: vi.fn(async (_resource: string, params: any) => {
      calls.push({ ...(params ?? {}) });
      return { data: ROWS, total: ROWS.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'duly_task',
      fields: {
        id: { name: 'id', type: 'text' },
        subject: { name: 'subject', type: 'text' },
        visible_from: { name: 'visible_from', type: 'date' },
        due_date: { name: 'due_date', type: 'date' },
      },
    })),
  } as any;
}

const base: any = {
  type: 'object-gantt',
  objectName: 'duly_task',
  gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
};

const last = () => calls[calls.length - 1] ?? {};
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  calls = [];
});

describe('ObjectGantt — the node\'s search reaches the record query (objectui#10250)', () => {
  it('CONTROL: a node with no `search` sends neither $search nor $searchFields', async () => {
    render(<ObjectGantt schema={base} dataSource={makeDataSource()} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(last()).not.toHaveProperty('$search');
    expect(last()).not.toHaveProperty('$searchFields');
  });

  it('TERM: `search` is sent as $search', async () => {
    render(<ObjectGantt schema={{ ...base, search: 'needle' }} dataSource={makeDataSource()} />);
    await waitFor(() => expect(last().$search).toBe('needle'));
    expect(last()).not.toHaveProperty('$searchFields');
  });

  it('FIELDS: `searchableFields` is sent as $searchFields alongside the term', async () => {
    render(
      <ObjectGantt schema={{ ...base, search: 'needle', searchableFields: ['subject'] }} dataSource={makeDataSource()} />,
    );
    await waitFor(() => expect(last().$search).toBe('needle'));
    expect(last().$searchFields).toEqual(['subject']);
  });

  it('INERT FIELDS: `searchableFields` with no term sends neither key', async () => {
    render(<ObjectGantt schema={{ ...base, searchableFields: ['subject'] }} dataSource={makeDataSource()} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await settle();
    expect(last()).not.toHaveProperty('$search');
    expect(last()).not.toHaveProperty('$searchFields');
  });

  it('CHANGE: a new term re-queries with it; clearing it re-queries without it', async () => {
    const dataSource = makeDataSource();
    const { rerender } = render(<ObjectGantt schema={{ ...base, search: 'needle' }} dataSource={dataSource} />);
    await waitFor(() => expect(last().$search).toBe('needle'));
    rerender(<ObjectGantt schema={{ ...base, search: 'thread' }} dataSource={dataSource} />);
    await waitFor(() => expect(last().$search).toBe('thread'));
    rerender(<ObjectGantt schema={{ ...base }} dataSource={dataSource} />);
    await waitFor(() => expect(last()).not.toHaveProperty('$search'));
  });

  it('STABILITY: a new but equal node — same term, a fresh equal field list — does not re-query', async () => {
    const dataSource = makeDataSource();
    const node = () => ({ ...base, search: 'needle', searchableFields: ['subject'] });
    const { rerender } = render(<ObjectGantt schema={node()} dataSource={dataSource} />);
    await waitFor(() => expect(last().$searchFields).toEqual(['subject']));
    await settle();
    const settled = calls.length;
    rerender(<ObjectGantt schema={node()} dataSource={dataSource} />);
    rerender(<ObjectGantt schema={node()} dataSource={dataSource} />);
    await settle();
    expect(calls.length).toBe(settled);
  });

  it('INLINE: the term narrows inline rows too, through the same in-memory adapter', async () => {
    // The provider does not change which query keys apply (objectui#8769):
    // `provider: 'value'` goes through `ValueDataSource`, which honours
    // `$search` the way it honours `$filter`.
    render(<ObjectGantt schema={{ ...base, objectName: undefined, data: { provider: 'value', items: ROWS }, search: 'needle' }} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view').getAttribute('data-task-ids')).toBe('1,3'));
  });
});
