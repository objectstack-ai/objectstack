/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10663 — one failed load must not keep an `object-calendar` block on
 * its error screen after a later load succeeds (the objectui#10578 shape,
 * landed on `ObjectGantt`).
 *
 * The calendar renders its error screen with an early return. Its fetch
 * effect wrote `error` in ONE place, its `catch`, and cleared it nowhere, so
 * every later answer reached `data` while the component kept returning the
 * error screen until it remounted. Since objectui#10572 every data-invalidation
 * event re-reads this block, so one failed background re-read was enough.
 *
 * What clears it:
 *
 *   - The CURRENT run clears it when it COMMITS rows, on every commit branch
 *     of the fetch effect, under the effect's existing `isMounted` guard. A run
 *     that a newer one superseded is discarded, and its clear with it.
 *   - Rows a parent hands over (`data`) clear it too, where the calendar
 *     already drops a ceiling left over from its own fetch: those rows are not
 *     this component's query, so no failure of that query describes them.
 *   - A failed background re-read does NOT keep the last good rows on screen.
 *     This block has no silent mode (`ObjectGantt` and `ObjectMap` have one),
 *     so the failure is reported, and the next re-read that succeeds takes the
 *     screen back.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration. Every `find` is held open by hand. The error screen is read
 * through the message the adapter threw.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
import { ObjectCalendar } from './ObjectCalendar';
// Registers `object-calendar`.
import './index';

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
    getObjectSchema: vi.fn(async () => ({ name: 'event', fields: { name: { type: 'text' }, due: { type: 'datetime' } } })),
  };
  return { dataSource, finds };
}

// A day inside the month the calendar opens on, so a committed event is drawn.
const today = new Date();
const inThisMonth = new Date(today.getFullYear(), today.getMonth(), 10, 9, 0, 0, 0).toISOString();
const rows = (name: string) => [{ id: name, name, due: inThisMonth }];

async function answer(d: Deferred<any>, name: string) {
  await act(async () => {
    d.resolve({ data: rows(name), total: 1 });
    await Promise.resolve();
  });
}

async function fail(d: Deferred<any>, message: string) {
  await act(async () => {
    d.reject(new Error(message));
    await Promise.resolve();
  });
}

async function invalidate() {
  await act(async () => {
    notifyDataChanged({ objectName: 'event' });
  });
}

/** The shape the ObjectStack adapter throws: status + code decorated on the Error. */
function refusal(): Error {
  const err = new Error(
    'ApiDataSource: HTTP 403 Forbidden — {"error":"PERMISSION_DENIED: no read access to event"}',
  ) as Error & { httpStatus?: number; code?: string };
  err.httpStatus = 403;
  err.code = 'PERMISSION_DENIED';
  return err;
}

function serverError(): Error {
  const err = new Error('ApiDataSource: HTTP 500 Internal Server Error') as Error & { httpStatus?: number };
  err.httpStatus = 500;
  return err;
}

async function failWith(d: Deferred<any>, err: Error) {
  await act(async () => {
    d.reject(err);
    await Promise.resolve();
  });
}

const CALENDAR = { startDateField: 'due', titleField: 'name' };
const BLOCK = { type: 'object-calendar', objectName: 'event', calendar: CALENDAR };

function mount(dataSource: ReturnType<typeof makeDeferredDataSource>['dataSource']) {
  return render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={BLOCK as any} />
    </SchemaRendererProvider>,
  );
}

const errorShown = (message: string) => screen.queryByText(`Error: ${message}`) !== null;
const anyErrorShown = () => screen.queryByText(/^Error: /) !== null;

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  // Each failure below is logged by the component; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe('object-calendar clears its error when a later load commits rows (objectui#10663)', () => {
  it('a failed load, then a data-invalidation re-read that succeeds: the error screen is gone and the events are drawn', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));

    await fail(finds[0], 'backend down');
    expect(errorShown('backend down'), 'the first failure was not reported').toBe(true);

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(2));
    await answer(finds[1], 'Recovered');

    expect(anyErrorShown(), 'the error screen outlived a re-read that succeeded').toBe(false);
    expect(screen.getByText('Recovered')).toBeTruthy();
  });

  it('a failed BACKGROUND re-read over good rows is reported, and does not keep those rows on screen; the next re-read that succeeds takes the screen back', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));
    await answer(finds[0], 'First rows');
    expect(screen.getByText('First rows')).toBeTruthy();

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(2));
    await fail(finds[1], 're-read failed');
    // No silent mode on this block: the failure is reported, and the last good
    // rows stay in state but are not drawn.
    expect(errorShown('re-read failed')).toBe(true);
    expect(screen.queryByText('First rows')).toBeNull();

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(3));
    await answer(finds[2], 'Second rows');
    expect(anyErrorShown()).toBe(false);
    expect(screen.getByText('Second rows')).toBeTruthy();
  });

  it('control: a failure, then another failure, shows the newer failure', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));
    await fail(finds[0], 'first failure');

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(2));
    await fail(finds[1], 'second failure');

    expect(errorShown('second failure')).toBe(true);
    expect(errorShown('first failure')).toBe(false);
  });

  it('a SUPERSEDED run that succeeds does not clear the error the current run reported', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));
    // A re-read starts while the first read is still in flight.
    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(2));

    await fail(finds[1], 'current run failed');
    expect(errorShown('current run failed')).toBe(true);
    await answer(finds[0], 'Superseded rows');

    expect(errorShown('current run failed'), 'a superseded answer cleared the current error').toBe(true);
  });

  it('rows a parent hands over after a failed fetch take the calendar off its error screen', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const schema: any = { type: 'object-calendar', objectName: 'event', calendar: CALENDAR };
    const { rerender } = render(<ObjectCalendar schema={schema} dataSource={dataSource as any} />);
    await waitFor(() => expect(finds).toHaveLength(1));
    await fail(finds[0], 'own fetch failed');
    expect(errorShown('own fetch failed')).toBe(true);

    await act(async () => {
      rerender(<ObjectCalendar schema={schema} dataSource={dataSource as any} data={rows('Handed over')} />);
    });

    expect(anyErrorShown(), 'the error of a fetch whose rows are not drawn outlived the handed-over rows').toBe(false);
    expect(screen.getByText('Handed over')).toBeTruthy();
  });
});

/**
 * A refused read draws the calm no-access state, not the raw error.
 *
 * A reader who may open the page but not read the calendar's object used to see
 * the transport's own string ("ApiDataSource: HTTP 403 Forbidden — ..."). The
 * calendar now classifies a failed load with the shared `classifyLoadError` and,
 * for a `forbidden` read, draws the shared `list.loadErrorForbidden*` sentence
 * as a neutral `role="status"` panel. Every other failure keeps the existing
 * error screen (CONTROL).
 */
describe('object-calendar: a refused read draws the no-access state', () => {
  it('a 403 read draws the no-access state, with none of the server text', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const { container } = mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));
    await failWith(finds[0], refusal());

    const panel = await screen.findByTestId('calendar-no-access');
    expect(panel.getAttribute('role')).toBe('status');
    expect(panel.textContent).toContain('You don\u2019t have access');
    expect(panel.textContent).toContain('You don\u2019t have permission to view these records.');
    const text = container.textContent ?? '';
    expect(text).not.toContain('Error');
    expect(text).not.toContain('PERMISSION_DENIED');
    expect(text).not.toContain('HTTP 403');
  });

  it('CONTROL: a 500 keeps the existing error screen', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));
    await failWith(finds[0], serverError());

    expect(errorShown('ApiDataSource: HTTP 500 Internal Server Error')).toBe(true);
    expect(screen.queryByTestId('calendar-no-access')).toBeNull();
  });
});
