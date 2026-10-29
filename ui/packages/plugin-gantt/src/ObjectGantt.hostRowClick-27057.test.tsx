/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27057 — a host's `onRowClick` takes a gantt bar click, as it
 * takes a kanban card or a grid row.
 *
 * The console hands the chart one through `ListView` (a function on the
 * `object-gantt` node), and that handler opens the record in the one record
 * page. Two things stood in its way: `ObjectGanttRenderer` forwarded no host
 * prop at all, and `ObjectGantt` dropped a direct caller's handler whenever
 * its own navigation was the drawer. So a gantt bar opened the quick-look
 * `RecordDetailPanel` while a grid row of the same object opened the page.
 *
 * Rows, each through the real `SchemaRenderer` and the registered renderer:
 *   - a host function on the node key (the `ListView` channel) → the host gets
 *     the row, and neither the drawer nor a navigation happens;
 *   - the same handler under an authored `page` → still the host's (the
 *     console reads the view's `navigation` itself);
 *   - no host → the chart's own drawer opens, the fallback outside the console;
 *   - an authored string on the key → dropped by the renderer, so the drawer
 *     opens and the click raises nothing.
 *
 * That the renderer forwards no host `data` beside the handler stays pinned
 * where it was, in `ObjectGantt.hostDataProp-7210`.
 *
 * REVERSE VERIFICATION, direction predicted before running: drop
 * `onRowClick={hostRowClick(onRowClick)}` from the renderer and the two host
 * rows go red (the host is never called; the drawer opens, or the `page`
 * sink navigates), while the fallback and authored-string rows stay green.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskClick }: any) => (
    <div data-testid="gantt-view" data-task-count={String(tasks.length)}>
      {tasks.map((t: any) => (
        <button key={t.id} data-testid={`task-${t.id}`} onClick={() => onTaskClick?.(t)}>
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  // The quick-look payload of the chart's own drawer.
  RecordDetailPanel: ({ recordId }: { recordId: string | number }) => (
    <div data-testid="quick-look-panel" data-record-id={String(recordId)} />
  ),
}));

// Module scope: the registration side effect this file renders through.
import './index';

const ROWS = [
  { id: '1', subject: 'Ada onboarding', visible_from: '2099-09-01', due_date: '2099-09-03' },
  { id: '2', subject: 'Grace onboarding', visible_from: '2099-10-01', due_date: '2099-10-02' },
];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => ROWS[0]),
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
  }) as any;

const BASE: Record<string, any> = {
  type: 'object-gantt',
  objectName: 'duly_task',
  gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
};

let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState({}, '', '/console/duly_task/views/all');
  pushSpy = vi.spyOn(window.history, 'pushState');
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

async function clickFirstTask(schema: Record<string, any>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
  fireEvent.click(await screen.findByTestId('task-1'));
}

describe('a host row click takes a gantt bar (objectstack#27057)', () => {
  it('a host function on the node key gets the row; no drawer opens and nothing navigates', async () => {
    const host = vi.fn();
    await clickFirstTask({ ...BASE, onRowClick: host });

    await waitFor(() => expect(host).toHaveBeenCalledTimes(1));
    expect(host.mock.calls[0][0]).toMatchObject({ id: '1', subject: 'Ada onboarding' });
    expect(screen.queryByTestId('quick-look-panel')).toBeNull();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('under an authored `page` the click is still the host\'s, not the chart\'s own sink', async () => {
    const host = vi.fn();
    await clickFirstTask({ ...BASE, navigation: { mode: 'page' }, onRowClick: host });

    await waitFor(() => expect(host).toHaveBeenCalledTimes(1));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-look-panel')).toBeNull();
  });

  it('FALLBACK: with no host the chart opens its own drawer', async () => {
    await clickFirstTask({ ...BASE });

    const panel = await screen.findByTestId('quick-look-panel');
    expect(panel.getAttribute('data-record-id')).toBe('1');
  });

  it('an authored string on the key is dropped: the drawer opens and the click raises nothing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await clickFirstTask({ ...BASE, onRowClick: 'NOT-A-FUNCTION' });

    expect(await screen.findByTestId('quick-look-panel')).toBeTruthy();
    const typeErrors = errors.mock.calls.filter((args) => args.join(' ').includes('is not a function'));
    expect(typeErrors).toEqual([]);
  });
});
