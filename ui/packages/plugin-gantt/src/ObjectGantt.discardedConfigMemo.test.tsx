/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6592 — see `ObjectMap.discardedConfigMemo.test.tsx` for the full
 * rationale. This file pins the same contract for `ObjectGantt`'s
 * `reload()` fetch (the `useEffect(() => { reload(); }, [reload])` mount
 * effect) and its "fetch object schema" effect.
 *
 * `ObjectGantt`'s own `dataConfig` memo already buys a value-stable identity
 * via `useMemo(() => rawDataConfig, [JSON.stringify(rawDataConfig)])`
 * (pre-dating this card, and untouched by it) — so the map/tree/calendar
 * discard proxy ("a schema with a new reference but byte-identical `.data`")
 * would not even recompute `dataConfig` here: the JSON-string dep would
 * compare equal and the memo would keep its old cached object. So the
 * discard proxy for THIS component adds an inert field to `schema.data` that
 * changes value between renders — `_probe` below, never read by
 * `getDataConfig`, `reload`, or `resolveDataSource` — which forces the JSON
 * string (and so `dataConfig`'s identity) to change while every primitive
 * either fetch effect actually reads (`provider`, `object`) stays the same.
 * That is the same "different identity, same content" shape a genuine
 * memo-cache discard would produce.
 *
 * One more thing has to hold for this to isolate the two effects under
 * test rather than a third, architecturally-unavoidable one:
 * `effectiveDataSource = useMemo(() => resolveDataSource(dataConfig, ...), [dataConfig, ...])`
 * also depends on `dataConfig`'s identity, and objectui#6592 deliberately
 * leaves it that way (see the comment on `dataItems` in `ObjectGantt.tsx` —
 * `resolveDataSource` reads a provider-shaped slice of `dataConfig` that
 * cannot be flattened to a fixed primitive list). For the `object` provider
 * this component is tested with here, though, `resolveDataSource` returns
 * the `fallback` context DataSource UNCHANGED (`packages/core/src/adapters/resolveDataSource.ts`
 * — no new adapter is constructed), so `effectiveDataSource`'s value stays
 * referentially the SAME object across the `_probe` churn even though its
 * memo's factory reran. That is what makes the two fixed effects observable
 * in isolation below; it is also why this file's own comment does not claim
 * gantt is unconditionally immune to a `dataConfig` discard — see the PR
 * body's "Known boundary" note for the `api`/`value` providers, where
 * `resolveDataSource` allocates a fresh adapter every call and this
 * decoupling does not hold.
 *
 * The two effects under test used to list bare `dataConfig`; after
 * objectui#6592 the `reload` callback lists `dataProvider`/`dataItems` and
 * the "fetch object schema" effect drops the (unused) dependency entirely.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';
import { DataSource } from '@object-ui/types';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">{t.title}</div>
      ))}
    </div>
  ),
}));

const ROWS = [
  { id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05', progress: 50 },
];

function makeDataSource(): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ fields: { name: { type: 'text' } } }),
  } as any;
}

const GANTT_CONFIG = { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' };

describe('ObjectGantt — reload/schema fetch effects survive a discarded `dataConfig` memo (objectui#6592)', () => {
  it('does not re-fire either fetch when `dataConfig` recomputes to a new identity with the SAME primitive fields', async () => {
    const dataSource = makeDataSource();
    // `_probe` is read by nothing under test — it exists only to force
    // `JSON.stringify(rawDataConfig)` to differ so `dataConfig`'s OWN memo
    // (unrelated to this card, see the file docblock) recomputes to a new
    // object identity while `provider`/`object` stay unchanged.
    const schemaA: any = { type: 'gantt', gantt: GANTT_CONFIG, data: { provider: 'object', object: 'tasks', _probe: 'a' } };
    const schemaB: any = { type: 'gantt', gantt: GANTT_CONFIG, data: { provider: 'object', object: 'tasks', _probe: 'b' } };

    const { rerender } = render(<ObjectGantt schema={schemaA} dataSource={dataSource} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(1));
    await waitFor(() => expect((dataSource.getObjectSchema as any)).toHaveBeenCalled());

    const findCallsAtRest = (dataSource.find as any).mock.calls.length;
    const schemaCallsAtRest = (dataSource.getObjectSchema as any).mock.calls.length;
    expect(findCallsAtRest).toBeGreaterThan(0);

    rerender(<ObjectGantt schema={schemaB} dataSource={dataSource} />);
    await new Promise((r) => setTimeout(r, 0));

    expect((dataSource.find as any).mock.calls.length).toBe(findCallsAtRest);
    expect((dataSource.getObjectSchema as any).mock.calls.length).toBe(schemaCallsAtRest);
  });

  it('still DOES re-fire when the recomputed `dataConfig` carries a genuinely different `object`', async () => {
    const dataSource = makeDataSource();
    const schemaA: any = { type: 'gantt', gantt: GANTT_CONFIG, data: { provider: 'object', object: 'tasks' } };
    const schemaB: any = { type: 'gantt', gantt: GANTT_CONFIG, data: { provider: 'object', object: 'milestones' } };

    const { rerender } = render(<ObjectGantt schema={schemaA} dataSource={dataSource} />);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledWith('tasks', expect.any(Object)));
    const callsBefore = (dataSource.find as any).mock.calls.length;

    rerender(<ObjectGantt schema={schemaB} dataSource={dataSource} />);

    await waitFor(() => expect((dataSource.find as any).mock.calls.length).toBeGreaterThan(callsBefore));
    expect(dataSource.find).toHaveBeenCalledWith('milestones', expect.any(Object));
  });
});
