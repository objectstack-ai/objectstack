/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10578 — one failed load must not keep the gantt on its error
 * screen after a later load succeeds.
 *
 * `ObjectGantt` renders its error screen with an early return, so once `error`
 * is set the chart is gone. `reload()` used to write `error` in ONE place, its
 * `catch`, and clear it nowhere: every later answer still reached `data`, but
 * the component kept returning the error screen until it remounted.
 *
 * What clears it, and why there and nowhere else:
 *
 *   - The CURRENT reload clears it when it COMMITS rows, silent or not. Those
 *     rows answer the current query, so no earlier failure describes the
 *     screen any more. That covers a silent re-read that succeeds after an
 *     error, which is how `ObjectGrid`'s re-read ends as well.
 *   - It is NOT cleared when a reload STARTS, although `ObjectGrid`'s load
 *     clears there. A start clear is safe only if the run that cleared also
 *     reports its own failure. Here a SILENT reload (objectui#7237; the grid
 *     has no such mode) can overtake a changed query and then fail
 *     unreported, and the screen would go back to an older query's rows with
 *     nothing saying so. The last case below pins that.
 *   - Only the CURRENT reload clears, under the same `isCurrent()` guard as
 *     every other result write. A superseded run's answer is discarded, so it
 *     may not take down the error the current run reported either.
 *
 * Every `find` is held open by hand, so each in-flight assertion is made while
 * the query really is in flight. The error screen's text is read through the
 * message the adapter threw, which is the part of that screen this card is
 * about; the screen's English prefix is not.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyDataChanged } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">{t.title}</div>
      ))}
    </div>
  ),
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
const GOOD_ROWS = row('2', 'From the query that succeeded');
const STALE_ROWS = row('3', 'From the superseded query');

function schemaSorted(order: 'asc' | 'desc', field = 'start_date'): any {
  return {
    type: 'object-gantt',
    gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
    data: { provider: 'object', object: OBJECT },
    sort: [{ field, order }],
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

const errorShown = (message: string) => screen.queryByText(`Error: ${message}`) !== null;
const indicator = () => screen.queryByTestId('refresh-indicator');

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Each failure below is logged by the component; keep the run readable.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('ObjectGantt clears its error when a later load succeeds (objectui#10578)', () => {
  it('fail, then succeed, BEFORE the first paint: the chart renders', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const { rerender } = render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await fail(finds[0], 'backend unavailable');
    await waitFor(() => expect(errorShown('backend unavailable')).toBe(true));

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    // Nothing has painted yet, so the changed query takes the loading
    // placeholder — the clear cannot hide it.
    expect(screen.queryByText(PLACEHOLDER), 'the placeholder while the changed query is in flight').not.toBeNull();

    await answer(finds[1], GOOD_ROWS);
    await waitFor(() =>
      expect(
        screen.queryByText('From the query that succeeded'),
        'the query succeeded, but the gantt is still on the error screen of the one before it',
      ).not.toBeNull(),
    );
    expect(errorShown('backend unavailable')).toBe(false);
  });

  it('fail, then succeed, AFTER the first paint: the chart renders', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const { rerender } = render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await fail(finds[1], 'sort field not readable');
    await waitFor(() => expect(errorShown('sort field not readable')).toBe(true));

    rerender(<ObjectGantt schema={schemaSorted('asc', 'end_date')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
    await answer(finds[2], GOOD_ROWS);
    await waitFor(() =>
      expect(
        screen.queryByText('From the query that succeeded'),
        'the query succeeded, but the gantt is still on the error screen of the one before it',
      ).not.toBeNull(),
    );
    expect(errorShown('sort field not readable')).toBe(false);
    expect(indicator()).toBeNull();
  });

  it('control: fail, then fail again — the error stays, and it is the NEWER failure', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const { rerender } = render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await fail(finds[1], 'first failure');
    await waitFor(() => expect(errorShown('first failure')).toBe(true));

    rerender(<ObjectGantt schema={schemaSorted('asc', 'end_date')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
    await fail(finds[2], 'second failure');

    await waitFor(() => expect(errorShown('second failure')).toBe(true));
    expect(errorShown('first failure')).toBe(false);
    expect(screen.queryByTestId('gantt-view'), 'a failed query left the previous rows on screen').toBeNull();
    expect(screen.queryByText('From the first query')).toBeNull();
  });

  it('a SUPERSEDED reload that succeeds does not clear the error the current reload reported', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const { rerender } = render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());

    // Two changes in a row: the first query is superseded while in flight.
    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    rerender(<ObjectGantt schema={schemaSorted('asc', 'end_date')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));

    // The CURRENT query fails and is reported…
    await fail(finds[2], 'current query failed');
    await waitFor(() => expect(errorShown('current query failed')).toBe(true));

    // …and the superseded one answers late. Its rows are discarded, so it may
    // not take the current failure's report down with it.
    await answer(finds[1], STALE_ROWS);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    expect(errorShown('current query failed'), 'a superseded answer cleared the current query\'s error').toBe(true);
    expect(screen.queryByText('From the superseded query')).toBeNull();
  });

  it('a SILENT reload that succeeds after an error clears it (as ObjectGrid\'s re-read does)', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await fail(finds[0], 'backend unavailable');
    await waitFor(() => expect(errorShown('backend unavailable')).toBe(true));

    // A write to the object re-reads the SAME query, silently (objectui#10035).
    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
    });
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));

    await answer(finds[1], GOOD_ROWS);
    await waitFor(() =>
      expect(
        screen.queryByText('From the query that succeeded'),
        'the re-read answered the current query, but the gantt is still on its error screen',
      ).not.toBeNull(),
    );
    expect(errorShown('backend unavailable')).toBe(false);
  });

  it('control: a SILENT reload that fails after an error leaves the error on screen', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await fail(finds[0], 'backend unavailable');
    await waitFor(() => expect(errorShown('backend unavailable')).toBe(true));

    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
    });
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    // In flight: a silent run does not clear at the start.
    expect(errorShown('backend unavailable'), 'a silent re-read cleared the error before it had an answer').toBe(true);

    await fail(finds[1], 'still unavailable');
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    // A silent failure is never reported itself, so the report that stays up
    // is the one that was already there.
    expect(errorShown('backend unavailable'), 'a failed silent re-read took the error screen down').toBe(true);
    expect(screen.queryByTestId('gantt-view')).toBeNull();
  });

  it('why the error is not cleared when a reload STARTS: a silent re-read overtakes the changed query and fails', async () => {
    const { dataSource, finds, find } = makeDeferredDataSource();
    const { rerender } = render(<ObjectGantt schema={schemaSorted('asc')} dataSource={dataSource} />);

    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await answer(finds[0], FIRST_ROWS);
    await waitFor(() => expect(screen.getByText('From the first query')).toBeTruthy());

    rerender(<ObjectGantt schema={schemaSorted('desc')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    await fail(finds[1], 'sort field not readable');
    await waitFor(() => expect(errorShown('sort field not readable')).toBe(true));

    // The user changes the query again, and before it answers a write to the
    // object triggers a silent re-read, which overtakes it and fails.
    rerender(<ObjectGantt schema={schemaSorted('asc', 'end_date')} dataSource={dataSource} />);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
    await act(async () => {
      notifyDataChanged({ objectName: OBJECT });
    });
    await waitFor(() => expect(find).toHaveBeenCalledTimes(4));
    await fail(finds[2], 'changed query failed, overtaken');
    await fail(finds[3], 'silent re-read failed');
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });

    // No run answered the current query. The screen must still say something
    // went wrong. ⛔ Not the first query's rows back without a word, which is
    // what clearing at the start of the changed query leaves here. Which
    // message is shown is not the point: it reads "an error", not a text.
    expect(
      screen.queryByText(/^Error: /),
      'the error was cleared although nothing answered the current query',
    ).not.toBeNull();
    expect(
      screen.queryByText('From the first query'),
      'the rows of a query the user moved away from are back on screen, with no report',
    ).toBeNull();
  });
});
