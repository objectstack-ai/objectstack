/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7333 — an EMPTY host `data` array is "no host rows yet", not "the
 * host owns zero rows".
 *
 * `ObjectGantt` read a host `data` prop at two sites, and both took `[]` as an
 * authoritative answer: `reload`'s short-circuit (`data && Array.isArray(data)`
 * — `[]` is truthy) adopted it and returned before the chart's own query, and
 * the gating flag (`Array.isArray(data)`) switched off the object-schema gate
 * and the invalidation subscription that belong to that query. So a gantt whose
 * `data` names its own source painted an EMPTY chart the moment a host handed
 * it an array it had not filled yet.
 *
 * Both sites now read one predicate, `hostRows` in `ObjectGantt.tsx`: a
 * non-empty host array is adopted as it always was, and an empty one leaves the
 * chart reading from its own source, exactly as with no host array at all.
 *
 * ⚠️ Reach: the registered `object-gantt` renderer forwards no host prop, which
 * `ObjectGantt.hostDataProp-7210.test.tsx` pins, and `ObjectGanttProps` does
 * not declare `data`. So every case here renders `ObjectGantt` directly and
 * spreads the prop in, as a direct caller would have to.
 *
 * Cases 1 and 4 are the pins; 2 and 3 are their controls, and 5 is the "yet":
 *   1. own source + host `[]` ⇒ the source is read and its rows paint;
 *   2. own source + host rows ⇒ those rows paint, the source is never read;
 *   3. own source + no host `data` ⇒ the source is read;
 *   4. object provider + host `[]` ⇒ the query waits for the object schema and
 *      goes out ONCE, already expanded (the gating flag's half);
 *   5. host rows that arrive after an empty first render are adopted.
 *
 * Cases 1–3 and 5 used to name an `api`-provider gantt's endpoint as its own
 * source. The view-level `api` data source is retired in `@objectstack/spec`
 * (objectstack#23082) and ObjectGantt builds no adapter from it
 * (objectui#12325), so the own source here is the bound object, read through
 * the context adapter — the predicate under test does not depend on which
 * provider supplies it.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-task-count={String(tasks.length)}>
      {tasks.map((t: any) => (
        <div key={t.id} data-testid={`gv-task-${t.id}`}>{t.title}</div>
      ))}
    </div>
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

/** What the gantt's own source (the bound object) answers with. */
const SOURCE_ROWS = [
  { id: 'e1', name: 'Source task 1', start_date: '2026-01-01', end_date: '2026-01-05' },
  { id: 'e2', name: 'Source task 2', start_date: '2026-01-02', end_date: '2026-01-06' },
];

/** What a host hands down as `data` when it DOES have rows. */
const HOST_ROWS = [
  { id: 'h1', name: 'Host task 1', start_date: '2026-02-01', end_date: '2026-02-03' },
];

function ownSourceSchema(): any {
  return {
    type: 'object-gantt',
    objectName: 'tasks',
    gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
  };
}

function makeSource() {
  return {
    find: vi.fn(async () => ({ data: SOURCE_ROWS, total: SOURCE_ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'tasks', fields: {} })),
  } as any;
}

/** Renders an object-bound gantt, spreading `hostProps` in as a direct caller would. */
function renderOwnSourceGantt(source: ReturnType<typeof makeSource>, hostProps: Record<string, unknown>) {
  const tree = (props: Record<string, unknown>) => (
    <ObjectGantt schema={ownSourceSchema()} dataSource={source} {...(props as any)} />
  );
  const utils = render(tree(hostProps));
  return { ...utils, rerenderWith: (props: Record<string, unknown>) => utils.rerender(tree(props)) };
}

const taskCount = () => screen.getByTestId('gantt-view').getAttribute('data-task-count');

/** Lets every in-flight read settle, so a query that would follow is counted. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

describe('objectui#7333 — a gantt handed an EMPTY host array still reads its own source', () => {
  it('host `data: []` ⇒ the source is read and its rows paint', async () => {
    const source = makeSource();

    renderOwnSourceGantt(source, { data: [] });

    await waitFor(() => expect(screen.getByTestId('gv-task-e2')).toBeTruthy());
    expect(taskCount()).toBe(String(SOURCE_ROWS.length));
    expect(source.find).toHaveBeenCalledWith('tasks', expect.anything());
  });

  it('CONTROL — host `data` with rows ⇒ those rows paint and the source is never read', async () => {
    const source = makeSource();

    renderOwnSourceGantt(source, { data: HOST_ROWS });

    await waitFor(() => expect(screen.getByTestId('gv-task-h1')).toBeTruthy());
    await settle();
    expect(taskCount()).toBe(String(HOST_ROWS.length));
    expect(screen.queryByTestId('gv-task-e1')).toBeNull();
    expect(source.find).not.toHaveBeenCalled();
  });

  it('CONTROL — no host `data` ⇒ the source is read', async () => {
    const source = makeSource();

    renderOwnSourceGantt(source, {});

    await waitFor(() => expect(screen.getByTestId('gv-task-e2')).toBeTruthy());
    expect(source.find).toHaveBeenCalledWith('tasks', expect.anything());
  });

  it('host rows that arrive after an empty first render are adopted', async () => {
    const source = makeSource();

    const { rerenderWith } = renderOwnSourceGantt(source, { data: [] });
    await waitFor(() => expect(screen.getByTestId('gv-task-e2')).toBeTruthy());

    rerenderWith({ data: HOST_ROWS });

    await waitFor(() => expect(screen.getByTestId('gv-task-h1')).toBeTruthy());
    expect(taskCount()).toBe(String(HOST_ROWS.length));
    expect(screen.queryByTestId('gv-task-e1')).toBeNull();
  });
});

describe('objectui#7333 — an EMPTY host array does not switch off the object-schema gate', () => {
  /** A definition with a lookup, so the gated query has a real `$expand` to carry. */
  const OBJECT_DEF = {
    name: 'task',
    fields: {
      id: { name: 'id', type: 'text' },
      subject: { name: 'subject', type: 'text' },
      owner: { name: 'owner', type: 'lookup', reference: 'user' },
      visible_from: { name: 'visible_from', type: 'date' },
      due_date: { name: 'due_date', type: 'date' },
    },
  };

  const OBJECT_ROWS = [
    { id: '1', subject: 'Renewal', owner: 'u1', visible_from: '2026-01-01', due_date: '2026-01-05' },
  ];

  const objectSchema: any = {
    type: 'object-gantt',
    objectName: 'task',
    gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
  };

  it('host `data: []` on an object-bound gantt ⇒ ONE query, issued after the schema settles, already expanded', async () => {
    const adapter = {
      find: vi.fn(async () => ({ data: OBJECT_ROWS, total: OBJECT_ROWS.length })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => OBJECT_DEF),
    } as any;

    render(<ObjectGantt schema={objectSchema} dataSource={adapter} {...({ data: [] } as any)} />);

    await waitFor(() => expect(taskCount()).toBe(String(OBJECT_ROWS.length)));
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await settle();
    // Ungated, the first query goes out before the definition lands and
    // carries no expansion, and a second follows once it does: `[null,
    // ['owner']]` — the signature `ObjectGantt.fetchGate-7225.test.tsx`
    // records for the ungated regime.
    const expandSets = adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
    expect(expandSets).toEqual([['owner']]);
  });
});
