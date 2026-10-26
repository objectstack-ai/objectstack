/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10684 — a `record:attachments` block's list and its `loading`
 * status belong to the CURRENT `refresh()` call only.
 *
 * `refresh()` committed `rows` and moved `status` for every call, so when the
 * record changed while a read was in flight, the previous record's answer
 * could land AFTER the current record's and replace its list, and a previous
 * read that settled FIRST ended `loading` while the current read was still
 * out.
 *
 * Rendered through the real `SchemaRenderer` and the block's own registration,
 * inside a `RecordContextProvider` whose `recordId` changes the way a record
 * page's does. Every `find` is held open by hand and settled in the order each
 * case names, so no case depends on a timer.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:attachments`.
import '../record-attachments-renderer';

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
    create: vi.fn(),
    delete: vi.fn(),
  };
  return { dataSource, finds };
}

const row = (fileName: string) => ({ id: `${fileName}-id`, file_id: `${fileName}-f`, file_name: fileName, size: 10 });

async function answer(d: Deferred<any>, fileName: string) {
  await act(async () => {
    d.resolve({ data: [row(fileName)], total: 1 });
    await Promise.resolve();
  });
}

async function fail(d: Deferred<any>, message: string) {
  await act(async () => {
    d.reject(new Error(message));
    await Promise.resolve();
  });
}

function tree(dataSource: ReturnType<typeof makeDeferredDataSource>['dataSource'], recordId: string) {
  return (
    <RecordContextProvider objectName="att_case" recordId={recordId} dataSource={dataSource as any}>
      <SchemaRenderer schema={{ type: 'record:attachments' } as any} />
    </RecordContextProvider>
  );
}

const shown = (text: string) => screen.queryByText(text) !== null;
const loadingShown = () => shown('Loading attachments…');

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('record:attachments: only the current refresh commits (objectui#10684)', () => {
  it('a previous record\'s answer that lands AFTER the current record\'s does not replace its list', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'r1'));
    await waitFor(() => expect(finds).toHaveLength(1));

    // The record changes while the first record's read is still in flight.
    view.rerender(tree(dataSource, 'r2'));
    await waitFor(() => expect(finds).toHaveLength(2));
    expect(dataSource.find.mock.calls[1][1]).toMatchObject({ $filter: { parent_object: 'att_case', parent_id: 'r2' } });

    await answer(finds[1], 'current.pdf');
    await answer(finds[0], 'superseded.pdf');

    const currentShown = shown('current.pdf');
    const supersededShown = shown('superseded.pdf');
    expect({ currentShown, supersededShown }).toEqual({ currentShown: true, supersededShown: false });
  });

  it('a previous record\'s read that settles FIRST leaves the list loading until the current answer lands', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'r1'));
    await waitFor(() => expect(finds).toHaveLength(1));
    expect(loadingShown()).toBe(true);

    view.rerender(tree(dataSource, 'r2'));
    await waitFor(() => expect(finds).toHaveLength(2));

    // A failure carries no rows, so only the `status` move is in play.
    await fail(finds[0], 'previous record read failed');
    expect(loadingShown(), 'a superseded read ended loading while the current read was in flight').toBe(true);
    expect(screen.queryByTestId('record-attachments-unavailable')).toBeNull();

    await answer(finds[1], 'current.pdf');
    expect(loadingShown()).toBe(false);
    expect(shown('current.pdf')).toBe(true);
  });

  it('control: a single read renders its list, as before', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    render(tree(dataSource, 'r1'));
    await waitFor(() => expect(finds).toHaveLength(1));
    expect(loadingShown()).toBe(true);

    await answer(finds[0], 'only.pdf');

    expect(loadingShown()).toBe(false);
    expect(shown('only.pdf')).toBe(true);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });
});
