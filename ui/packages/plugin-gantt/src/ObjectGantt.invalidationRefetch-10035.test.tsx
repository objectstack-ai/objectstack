/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10035 — `ObjectGantt` refetches IN PLACE when the data-invalidation
 * bus reports a write to the object it reads (AGENTS.md #8's corollary:
 * refresh data, don't rebuild UI).
 *
 * The gantt used to read no refresh input: the registered `object-gantt`
 * renderer hands it only `schema` and `dataSource`, and its own query named no
 * counter, no `onMutation` and no bus. So a host could show it a write only by
 * bumping its `key` — a remount that loses the chart's scroll, collapsed groups
 * and zoom.
 *
 * Every case drives the REAL bus (`notifyDataChanged` from `@object-ui/react`).
 * `GanttView` is a stand-in carrying an instance id from a `useState`
 * initializer, which runs once per mount: a changed id means `GanttView` was
 * unmounted — by a remount of the gantt OR by the loading placeholder a
 * non-silent reload swaps in. Either is the damage this card is about, so the
 * in-place case asserts:
 *   (a) the SAME `GanttView` instance afterwards, and the placeholder never
 *       painted;
 *   (b) the rows written after the first read reach it;
 *   (c) one invalidation costs exactly one query (no refetch storm).
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyDataChanged } from '@object-ui/react';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let instanceSeq = 0;

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => {
    const [id] = React.useState(() => ++instanceSeq);
    return (
      <div data-testid="gantt-view" data-instance={id} data-task-count={String(tasks.length)} />
    );
  },
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const OBJECT = 'task';

const OBJECT_DEF = {
  name: OBJECT,
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    visible_from: { name: 'visible_from', type: 'date' },
    due_date: { name: 'due_date', type: 'date' },
  },
};

/** A server whose store the test writes to, so a re-read returns the new row. */
function makeAdapter() {
  const store = [{ id: '1', subject: 'Renewal', visible_from: '2026-01-01', due_date: '2026-01-05' }];
  return {
    store,
    find: vi.fn(async () => ({ data: store.map((r) => ({ ...r })), total: store.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
  } as any;
}

const schema: any = {
  type: 'object-gantt',
  objectName: OBJECT,
  gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
};

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
const view = () => screen.getByTestId('gantt-view');

beforeEach(() => {
  instanceSeq = 0;
});

describe('ObjectGantt refetches in place on a data-invalidation for its object (objectui#10035)', () => {
  it('re-reads the rows once, silently, into the same GanttView', async () => {
    const adapter = makeAdapter();
    render(<ObjectGantt schema={schema} dataSource={adapter} />);
    await waitFor(() => expect(view().dataset.taskCount).toBe('1'));
    await settle();
    const before = view().dataset.instance;
    const queriesBefore = adapter.find.mock.calls.length;

    adapter.store.push({ id: '2', subject: 'Kickoff', visible_from: '2026-01-02', due_date: '2026-01-03' });
    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
      // The placeholder must not paint at any point of the reload.
      expect(screen.queryByText('Loading Gantt chart...')).toBeNull();
    });

    await waitFor(() =>
      expect(
        view().dataset.taskCount,
        '(b) The gantt never re-read its rows after the bus reported a write to its object.',
      ).toBe('2'),
    );
    await settle();
    expect(adapter.find.mock.calls.length - queriesBefore, '(c) one invalidation, one query').toBe(1);
    expect(
      view().dataset.instance,
      '(a) GanttView was unmounted: the refresh went through the loading placeholder (a\n'
        + 'non-silent reload) or a remount, and took the chart\'s scroll and collapse state with it.',
    ).toBe(before);
    expect(screen.queryByText('Loading Gantt chart...')).toBeNull();
  });

  it('a change to another object does not query', async () => {
    const adapter = makeAdapter();
    render(<ObjectGantt schema={schema} dataSource={adapter} />);
    await waitFor(() => expect(view().dataset.taskCount).toBe('1'));
    await settle();
    const queriesBefore = adapter.find.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();

    expect(adapter.find.mock.calls.length - queriesBefore).toBe(0);
  });

  it('rows a host handed down are not re-queried — the host owns that refresh', async () => {
    const adapter = makeAdapter();
    const hostRows = [{ id: 'h1', subject: 'Host row', visible_from: '2026-01-01', due_date: '2026-01-02' }];
    render(<ObjectGantt schema={schema} dataSource={adapter} {...({ data: hostRows } as any)} />);
    await waitFor(() => expect(view().dataset.taskCount).toBe('1'));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
    });
    await settle();

    expect(adapter.find).not.toHaveBeenCalled();
  });
});
