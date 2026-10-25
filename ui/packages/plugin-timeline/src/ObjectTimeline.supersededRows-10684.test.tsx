/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10684 — an `object-timeline` block's rows and its `loading` flag
 * belong to the CURRENT run of its fetch effect only.
 *
 * The fetch effect already numbered its runs (objectui#10663 added
 * `fetchSeqRef` / `isCurrent()`), but only the two `error` writes read the
 * number. The rows commit (`setFetchedData`) and the `loading` release in the
 * `finally` ran for every run, so:
 *
 *   - when the query changed while a read was in flight, the earlier answer
 *     could land AFTER the current one and replace the current rows;
 *   - a superseded read that settled FIRST dropped the skeleton while the
 *     current read was still in flight.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration. Every `find` is held open by hand and settled in the order
 * each case names, so no case depends on a timer or on which read the
 * scheduler happens to finish first.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-timeline` through this package's own entry.
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
    find: vi.fn((_objectName: string, _params?: Record<string, unknown>) => {
      const d = deferred<any>();
      finds.push(d);
      return d.promise;
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'task', fields: { name: { type: 'text' }, due: { type: 'date' } } })),
  };
  return { dataSource, finds };
}

const rows = (name: string) => [{ id: name, name, due: '2026-01-05' }];

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

const block = (status: string) => ({
  type: 'object-timeline',
  objectName: 'task',
  filter: [['status', '=', status]],
  timeline: { titleField: 'name', startDateField: 'due' },
});

function tree(dataSource: ReturnType<typeof makeDeferredDataSource>['dataSource'], status: string) {
  return (
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={block(status) as any} />
    </SchemaRendererProvider>
  );
}

const shown = (text: string) => screen.queryByText(text) !== null;
const skeletonShown = () => screen.queryByTestId('timeline-loading') !== null;

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  // A failed read is logged by the component; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe('object-timeline: only the current run commits rows and releases loading (objectui#10684)', () => {
  it('a superseded answer that lands AFTER the current one does not replace the current rows', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'open'));
    await waitFor(() => expect(finds).toHaveLength(1));

    // The query changes while the first read is still in flight.
    view.rerender(tree(dataSource, 'closed'));
    await waitFor(() => expect(finds).toHaveLength(2));
    expect(dataSource.find.mock.calls[1][1]).toMatchObject({ $filter: [['status', '=', 'closed']] });

    await answer(finds[1], 'Current rows');
    await answer(finds[0], 'Superseded rows');

    const currentShown = shown('Current rows');
    const supersededShown = shown('Superseded rows');
    expect({ currentShown, supersededShown }).toEqual({ currentShown: true, supersededShown: false });
  });

  it('a superseded read that settles FIRST leaves the skeleton up until the current answer lands', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'open'));
    await waitFor(() => expect(finds).toHaveLength(1));
    expect(skeletonShown()).toBe(true);

    view.rerender(tree(dataSource, 'closed'));
    await waitFor(() => expect(finds).toHaveLength(2));

    // A failure carries no rows, so this isolates the `loading` release from
    // the rows commit: only the `finally` can take the skeleton down here.
    await fail(finds[0], 'superseded read failed');
    expect(skeletonShown(), 'a superseded read released loading while the current read was in flight').toBe(true);
    expect(screen.queryByTestId('timeline-error')).toBeNull();

    // The current run ends loading itself.
    await answer(finds[1], 'Current rows');
    expect(skeletonShown()).toBe(false);
    expect(shown('Current rows')).toBe(true);
  });

  it('the current run ends loading when it throws, even after a superseded run settled', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'open'));
    await waitFor(() => expect(finds).toHaveLength(1));
    view.rerender(tree(dataSource, 'closed'));
    await waitFor(() => expect(finds).toHaveLength(2));

    await answer(finds[0], 'Superseded rows');
    await fail(finds[1], 'current read failed');

    expect(skeletonShown()).toBe(false);
    expect(screen.getByTestId('timeline-error').textContent).toContain('current read failed');
    expect(shown('Superseded rows')).toBe(false);
  });

  it('control: a single read renders its rows and clears the skeleton, as before', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    render(tree(dataSource, 'open'));
    await waitFor(() => expect(finds).toHaveLength(1));
    expect(skeletonShown()).toBe(true);

    await answer(finds[0], 'Only rows');

    expect(skeletonShown()).toBe(false);
    expect(shown('Only rows')).toBe(true);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });
});
