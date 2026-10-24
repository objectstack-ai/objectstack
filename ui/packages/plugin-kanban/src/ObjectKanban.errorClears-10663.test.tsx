/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10663 — one failed load must not keep an `object-kanban` block on
 * its error screen after a later load succeeds (the objectui#10578 shape,
 * landed on `ObjectGantt`).
 *
 * The board renders its error screen with an early return. Its fetch effect
 * wrote `error` in ONE place, its `catch`, and cleared it nowhere, so every
 * later answer reached the cards while the component kept returning the error
 * screen until it remounted. Since objectui#10572 every data-invalidation event
 * re-reads this block, so one failed background re-read was enough.
 *
 * What clears it:
 *
 *   - The CURRENT run clears it when it COMMITS cards, under the effect's
 *     existing `isMounted` guard. A run that a newer one superseded is
 *     discarded, and its clear with it.
 *   - A failed background re-read does NOT keep the last good cards on screen.
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
// Registers `object-kanban`.
import './index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope keeps the cold transform out of the assertion
// window (the objectui#3010 rule, same specifier as `index.tsx`'s factory).
import './KanbanImpl';

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
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { name: { type: 'text' }, status: { type: 'text' } } })),
  };
  return { dataSource, finds };
}

const rows = (name: string) => [{ id: name, name, status: 'open' }];

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
    notifyDataChanged({ objectName: 'deal' });
  });
}

const BLOCK = { type: 'object-kanban', objectName: 'deal', groupBy: 'status', columns: [{ id: 'open', title: 'Open' }] };

function mount(dataSource: ReturnType<typeof makeDeferredDataSource>['dataSource']) {
  return render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={BLOCK as any} />
    </SchemaRendererProvider>,
  );
}

const errorShown = (message: string) => screen.queryByText(new RegExp(`: ${message}$`)) !== null;
const anyErrorShown = () => screen.queryByText(/^Error loading kanban data/) !== null;

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

describe('object-kanban clears its error when a later load commits cards (objectui#10663)', () => {
  it('a failed load, then a data-invalidation re-read that succeeds: the error screen is gone and the cards are drawn', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));

    await fail(finds[0], 'backend down');
    expect(errorShown('backend down'), 'the first failure was not reported').toBe(true);

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(2));
    await answer(finds[1], 'Recovered');

    expect(anyErrorShown(), 'the error screen outlived a re-read that succeeded').toBe(false);
    await waitFor(() => expect(screen.getByText('Recovered')).toBeTruthy());
  });

  it('a failed BACKGROUND re-read over good cards is reported, and does not keep those cards on screen; the next re-read that succeeds takes the screen back', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    mount(dataSource);
    await waitFor(() => expect(finds).toHaveLength(1));
    await answer(finds[0], 'First cards');
    await waitFor(() => expect(screen.getByText('First cards')).toBeTruthy());

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(2));
    await fail(finds[1], 're-read failed');
    // No silent mode on this block: the failure is reported, and the last good
    // cards stay in state but are not drawn.
    expect(errorShown('re-read failed')).toBe(true);
    expect(screen.queryByText('First cards')).toBeNull();

    await invalidate();
    await waitFor(() => expect(finds).toHaveLength(3));
    await answer(finds[2], 'Second cards');
    expect(anyErrorShown()).toBe(false);
    await waitFor(() => expect(screen.getByText('Second cards')).toBeTruthy());
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
    await answer(finds[0], 'Superseded cards');

    expect(errorShown('current run failed'), 'a superseded answer cleared the current error').toBe(true);
  });
});
