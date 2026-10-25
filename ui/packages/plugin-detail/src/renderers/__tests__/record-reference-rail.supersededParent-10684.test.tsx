/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10684 — a `record:reference_rail` entry's rows and its skeleton
 * belong to the run whose signature is still the one dispatched.
 *
 * The rail keeps a mounted latch (results are applied "regardless of which
 * effect run dispatched them") and a signature ref that fetches once per
 * (parent + entries). Its commits read only the latch, so when the record
 * changed while a read for the previous record was in flight, that earlier
 * answer could land AFTER the current record's answer and replace it, and a
 * previous-record read that settled FIRST took the skeleton down while the
 * current record's read was still in flight.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, inside a `RecordContextProvider` whose `recordId` changes the
 * way a record page's does. Every `find` is held open by hand and settled in
 * the order each case names, so no case depends on a timer.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:reference_rail` through this package's own entry.
import '../../index';

/** The rail gates its queries on an IntersectionObserver. Report intersecting
 *  immediately so the fetch effect runs deterministically under jsdom. */
class ImmediateIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
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

/** Every `find` returns a promise the test settles by hand. No
 *  `getObjectSchema`, so the rail goes straight to its row reads. */
function makeDeferredDataSource() {
  const finds: Deferred<any>[] = [];
  const dataSource = {
    find: vi.fn((_objectName: string, _params?: Record<string, unknown>) => {
      const d = deferred<any>();
      finds.push(d);
      return d.promise;
    }),
  };
  return { dataSource, finds };
}

async function answer(d: Deferred<any>, name: string) {
  await act(async () => {
    d.resolve({ data: [{ id: `${name}-id`, name }], total: 1 });
    await Promise.resolve();
  });
}

async function fail(d: Deferred<any>, message: string) {
  await act(async () => {
    d.reject(new Error(message));
    await Promise.resolve();
  });
}

const RAIL = {
  type: 'record:reference_rail',
  hideEmpty: false,
  entries: [{ objectName: 'contact', relationshipField: 'account_id', title: 'Contacts' }],
};

function tree(dataSource: ReturnType<typeof makeDeferredDataSource>['dataSource'], recordId: string) {
  return (
    <MemoryRouter>
      <RecordContextProvider objectName="account" recordId={recordId} dataSource={dataSource as any}>
        <SchemaRenderer schema={RAIL as any} />
      </RecordContextProvider>
    </MemoryRouter>
  );
}

const shown = (text: string) => screen.queryByText(text) !== null;
const skeletonShown = (container: HTMLElement) => container.querySelector('.animate-pulse') !== null;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('record:reference_rail: only the current parent\'s run commits (objectui#10684)', () => {
  it('a previous record\'s answer that lands AFTER the current record\'s does not replace its rows', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'A1'));
    await waitFor(() => expect(finds).toHaveLength(1));

    // The record changes while the first record's read is still in flight.
    view.rerender(tree(dataSource, 'B2'));
    await waitFor(() => expect(finds).toHaveLength(2));
    expect(JSON.stringify(dataSource.find.mock.calls[1][1])).toContain('B2');

    await answer(finds[1], 'Current contact');
    await answer(finds[0], 'Superseded contact');

    const currentShown = shown('Current contact');
    const supersededShown = shown('Superseded contact');
    expect({ currentShown, supersededShown }).toEqual({ currentShown: true, supersededShown: false });
  });

  it('a previous record\'s read that settles FIRST leaves the skeleton up until the current answer lands', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'A1'));
    await waitFor(() => expect(finds).toHaveLength(1));

    view.rerender(tree(dataSource, 'B2'));
    await waitFor(() => expect(finds).toHaveLength(2));
    expect(skeletonShown(view.container)).toBe(true);

    // A failure carries no rows, so only the loading release is in play.
    await fail(finds[0], 'previous record read failed');
    expect(skeletonShown(view.container), 'a superseded read cleared the skeleton while the current read was in flight').toBe(true);
    expect(shown('previous record read failed')).toBe(false);

    await answer(finds[1], 'Current contact');
    expect(skeletonShown(view.container)).toBe(false);
    expect(shown('Current contact')).toBe(true);
  });

  it('control: a single read renders its rows, as before', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'A1'));
    await waitFor(() => expect(finds).toHaveLength(1));
    expect(skeletonShown(view.container)).toBe(true);

    await answer(finds[0], 'Only contact');

    expect(skeletonShown(view.container)).toBe(false);
    expect(shown('Only contact')).toBe(true);
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });

  it('control: a re-render with the same record issues no second read, and the in-flight answer still lands', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(tree(dataSource, 'A1'));
    await waitFor(() => expect(finds).toHaveLength(1));

    // A new `dataSource`-bearing context identity with the SAME record: the
    // signature is unchanged, so the rail's mounted-latch promise must hold.
    view.rerender(tree({ ...dataSource } as any, 'A1'));
    await answer(finds[0], 'Same record contact');

    expect(dataSource.find).toHaveBeenCalledTimes(1);
    expect(shown('Same record contact')).toBe(true);
  });
});
