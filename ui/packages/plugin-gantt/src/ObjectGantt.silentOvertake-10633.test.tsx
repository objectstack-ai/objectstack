/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10633 — a silent re-read that OVERTAKES a changed query takes over
 * that query's report.
 *
 * `reload()` sequences its runs: only the newest may commit, so a superseded
 * run's answer is discarded, and so is its failure. The `silent` flag decides
 * what a failure does (objectui#7237): a changed query reports it, and a
 * background re-read of the same query logs it and keeps the last good rows,
 * because those rows still answer that query.
 *
 * The overtaking sequence breaks the premise of that second branch. The user
 * changes the query, and before it answers a write fires the data-invalidation
 * bus (or the toolbar refresh is pressed). The silent re-read reads the
 * CHANGED query and makes the changed query's run stale. When the re-read then
 * fails, the rows on screen are the FIRST query's. They answer neither query
 * the user asked for last, and nothing said so.
 *
 * The rule pinned here: a run owes a report when it is non-silent, or when it
 * supersedes a run that still owes one. It is released when the current run
 * settles. A standalone silent re-read owes nothing and stays quiet, as before.
 *
 * Every `find` is held open by hand, so each in-flight assertion is made while
 * the query really is in flight. `GanttView` is a stand-in that takes an
 * instance id once per mount, so a teardown to the loading placeholder shows
 * up as a changed id; it also exposes the toolbar refresh it is handed.
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyDataChanged } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let instanceSeq = 0;

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onRefresh }: any) => {
    const [id] = React.useState(() => ++instanceSeq);
    return (
      <div data-testid="gantt-view" data-instance={id}>
        {onRefresh ? (
          <button type="button" onClick={onRefresh}>toolbar refresh</button>
        ) : null}
        {tasks.map((t: any) => (
          <div key={t.id} data-testid="gantt-task">{t.title}</div>
        ))}
      </div>
    );
  },
}));

const OBJECT = 'tasks';
const PLACEHOLDER = 'Loading Gantt chart...';

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

const row = (id: string, name: string) => [
  { id, name, start_date: '2024-01-01', end_date: '2024-01-05' },
];
const FIRST_ROWS = row('1', 'From the first query');
const CHANGED_ROWS = row('2', 'From the changed query');
const SUPERSEDED_ROWS = row('3', 'From the superseded run');

function schemaSorted(order: 'asc' | 'desc'): any {
  return {
    type: 'object-gantt',
    gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
    data: { provider: 'object', object: OBJECT },
    sort: [{ field: 'start_date', order }],
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every `find` returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const finds: Deferred<any>[] = [];
  const dataSource = {
    find: vi.fn(() => {
      const d = deferred<any>();
      finds.push(d);
      return d.promise;
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as unknown as DataSource;
  return { dataSource, finds, find: dataSource.find as unknown as ReturnType<typeof vi.fn> };
}

async function answer(d: Deferred<any>, rows: unknown[]) {
  await act(async () => {
    d.resolve({ data: rows });
    await Promise.resolve();
  });
}

async function fail(d: Deferred<any>, message: string) {
  await act(async () => {
    d.reject(new Error(message));
    await Promise.resolve();
  });
}

/** Let every settled run finish its `catch` / `finally` and re-render. */
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });
}

async function invalidate() {
  await act(async () => {
    notifyDataChanged({ objectName: OBJECT });
  });
}

const shown = (text: string) => screen.queryByText(text) !== null;
const errorShown = (message: string) => shown(`Error: ${message}`);
const anyErrorShown = () => screen.queryByText(/^Error: /) !== null;
const refreshing = () => screen.queryByTestId('refresh-indicator') !== null;
const instance = () => screen.queryByTestId('gantt-view')?.dataset.instance ?? 'unmounted';

/** First paint: the first query answers and its rows are on screen. */
async function paintFirstQuery() {
  const ds = makeDeferredDataSource();
  const view = render(<ObjectGantt schema={schemaSorted('asc')} dataSource={ds.dataSource} />);
  await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
  await answer(ds.finds[0], FIRST_ROWS);
  await waitFor(() => expect(shown('From the first query')).toBe(true));
  return { ...ds, rerender: view.rerender, mountedAs: instance() };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  instanceSeq = 0;
  // Each failure below is logged or reported by the component; keep the run readable.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('a silent re-read that overtakes a changed query takes over its report (objectui#10633)', () => {
  it('the card\'s sequence: the changed query is overtaken by an invalidation re-read that fails ⇒ the failure is reported', async () => {
    const { dataSource, finds, find, rerender, mountedAs } = await paintFirstQuery();

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
    expect(find.mock.calls[2][1].$orderby, 'the re-read reads the CHANGED query').toEqual({ start_date: 'desc' });

    // In flight: the chart stays mounted under the refreshing state.
    expect(instance(), 'the overtaking re-read tore the chart down').toBe(mountedAs);
    expect(shown(PLACEHOLDER)).toBe(false);
    expect(refreshing(), 'no refreshing state while the overtaking re-read is in flight').toBe(true);

    // The changed query answers, but its run is stale: discarded.
    await answer(finds[1], SUPERSEDED_ROWS);
    expect(refreshing(), 'the refreshing state ended while the current run was still in flight').toBe(true);

    await fail(finds[2], 'the re-read failed');
    await settle();

    expect(
      errorShown('the re-read failed'),
      'nothing answered the changed query, and the overtaking re-read\'s failure was swallowed',
    ).toBe(true);
    expect(
      shown('From the first query'),
      'the first query\'s rows are on screen, answering neither query, with no report',
    ).toBe(false);
    expect(refreshing()).toBe(false);
  });

  it('the same sequence settled the other way round: the re-read fails first, the stale changed query answers late', async () => {
    const { dataSource, finds, find, rerender } = await paintFirstQuery();

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));

    await fail(finds[2], 'the re-read failed');
    await settle();
    expect(errorShown('the re-read failed')).toBe(true);

    await answer(finds[1], SUPERSEDED_ROWS);
    await settle();
    expect(errorShown('the re-read failed'), 'a stale answer took the report down').toBe(true);
    expect(shown('From the first query')).toBe(false);
  });

  it('the overtaking re-read succeeds ⇒ the changed query\'s rows, no error, the same chart', async () => {
    const { dataSource, finds, find, rerender, mountedAs } = await paintFirstQuery();

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));

    await answer(finds[2], CHANGED_ROWS);
    await waitFor(() => expect(shown('From the changed query')).toBe(true));
    await answer(finds[1], SUPERSEDED_ROWS);
    await settle();

    expect(shown('From the changed query')).toBe(true);
    expect(shown('From the superseded run'), 'a stale answer overwrote the current one').toBe(false);
    expect(anyErrorShown()).toBe(false);
    expect(refreshing()).toBe(false);
    expect(instance()).toBe(mountedAs);
  });

  it('the toolbar refresh overtakes the changed query and fails ⇒ reported (every silent caller, not only the bus)', async () => {
    const { dataSource, finds, find, rerender } = await paintFirstQuery();

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('toolbar refresh'));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));

    await answer(finds[1], SUPERSEDED_ROWS);
    await fail(finds[2], 'the refresh failed');
    await settle();

    expect(errorShown('the refresh failed'), 'the toolbar refresh swallowed the changed query\'s report').toBe(true);
    expect(shown('From the first query')).toBe(false);
  });

  it('two re-reads in a row: the report passes down the chain to the last one', async () => {
    const { dataSource, finds, find, rerender } = await paintFirstQuery();

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(4));

    await answer(finds[1], SUPERSEDED_ROWS);
    await fail(finds[2], 'the first re-read failed');
    await fail(finds[3], 'the second re-read failed');
    await settle();

    expect(
      errorShown('the second re-read failed'),
      'the report was dropped when a second silent run overtook the one that inherited it',
    ).toBe(true);
    expect(shown('From the first query')).toBe(false);
  });

  it('before the first paint: a re-read overtakes the initial load and fails ⇒ reported, not an empty chart', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    expect(shown(PLACEHOLDER), 'the placeholder while the overtaking re-read is in flight').toBe(true);

    await answer(finds[0], SUPERSEDED_ROWS);
    expect(shown(PLACEHOLDER), 'a stale initial load released the placeholder').toBe(true);

    await fail(finds[1], 'the re-read failed');
    await settle();

    expect(
      errorShown('the re-read failed'),
      'no run answered the initial query, and the chart painted empty with no report',
    ).toBe(true);
    expect(shown(PLACEHOLDER)).toBe(false);
  });

  it('control: a standalone silent re-read that fails stays quiet — the rows stay, the failure is only logged', async () => {
    const { finds, find, mountedAs } = await paintFirstQuery();

    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    // As before this card: a silent re-read is in place, so it draws the
    // refreshing state while it runs.
    expect(refreshing()).toBe(true);
    expect(anyErrorShown()).toBe(false);

    await fail(finds[1], 'the re-read failed');
    await settle();

    expect(anyErrorShown(), 'a standalone silent re-read reported its failure').toBe(false);
    expect(shown('From the first query'), 'a failed re-read of the same query took its rows down').toBe(true);
    expect(refreshing()).toBe(false);
    expect(instance()).toBe(mountedAs);
    expect(
      consoleError.mock.calls.some((call: unknown[]) => call[0] === '[ObjectGantt] Failed to refresh data:'),
      'the silent failure was not logged',
    ).toBe(true);
  });

  it('control: once the changed query has answered, a later re-read that fails owes nothing and stays quiet', async () => {
    const { dataSource, finds, find, rerender } = await paintFirstQuery();

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await answer(finds[1], CHANGED_ROWS);
    await waitFor(() => expect(shown('From the changed query')).toBe(true));
    await settle();

    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
    await fail(finds[2], 'the re-read failed');
    await settle();

    expect(anyErrorShown(), 'a report outlived the run that owed it').toBe(false);
    expect(shown('From the changed query')).toBe(true);
  });

  it('control: a silent re-read that overtakes another SILENT re-read owes nothing and stays quiet', async () => {
    const { finds, find } = await paintFirstQuery();

    fireEvent.click(screen.getByText('toolbar refresh'));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await invalidate();
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));

    await fail(finds[1], 'the refresh failed');
    await fail(finds[2], 'the re-read failed');
    await settle();

    expect(anyErrorShown(), 'a re-read inherited a report no run owed').toBe(false);
    expect(shown('From the first query')).toBe(true);
    expect(refreshing()).toBe(false);
  });
});
