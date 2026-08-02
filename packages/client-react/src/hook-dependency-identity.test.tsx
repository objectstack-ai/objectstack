// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression tests for the dependency-identity loops (#4693) and the
 * subscription churn (#4694).
 *
 * Five hooks keyed a `useCallback`/`useEffect` on values the caller supplies
 * inline — `where`/`fields`/`orderBy` objects, `onSuccess`/`onError` handlers,
 * the `fetcher` `useMetadata` takes as a required argument. Inline means a new
 * identity every render, so the effect re-ran every render, and because the
 * fetch hooks call `setState` that render caused another. Measured on `main`
 * before the fix, requests issued in 250ms from a single mounted component:
 *
 * | hook                              | before | after |
 * |-----------------------------------|-------:|------:|
 * | useQuery (inline `where`)         |   4691 |     1 |
 * | useInfiniteQuery (inline `where`) |   6611 |     1 |
 * | useObject (NO options at all)     |   4306 |     1 |
 * | useView (inline `onSuccess`)      |   8197 |     1 |
 * | useMetadata (inline `fetcher`)    |   7654 |     1 |
 *
 * `useObject` and `useMetadata` needed no particular usage to loop — the former
 * depended on its own `data`/`etag` state while writing both, and the latter
 * takes its fetcher positionally, so there is no non-inline way to call it.
 *
 * The counts are asserted as exact numbers rather than "small": a bound like
 * `< 10` would pass on a loop that merely got slower, which is the failure this
 * whole file exists to prevent.
 *
 * Each fix also has a matching staleness test. The mechanism — hold the handler
 * in a ref, drop it from the deps — trades one bug for a worse one if the ref
 * is read late or synced wrong, so every stabilized handler is asserted to run
 * its LATEST version, not the one captured at subscribe time.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import type { ObjectStackClient } from '@objectstack/client';
import type { DataEvent } from '@objectstack/spec/api';
import { ObjectStackProvider } from './context';
import { useQuery, useInfiniteQuery } from './data-hooks';
import { useObject, useView, useMetadata } from './metadata-hooks';
import { useAutoRefresh, useDataSubscriptionCallback } from './realtime-hooks';
import { stableKey } from './internal-deps';

const RECORD_EVENT: DataEvent = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  type: 'data.record.updated',
  object: 'project_task',
  recordId: 'task_1',
  timestamp: '2026-08-02T12:00:00.000Z',
} as DataEvent;

/** Long enough for a runaway loop to make itself obvious (it managed ~5000). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

function createFakeClient() {
  const find = vi.fn(async (_object: string, _options?: Record<string, unknown>) => ({
    records: [],
    total: 0,
  }));
  const getCached = vi.fn(async (_objectName: string, _options?: Record<string, unknown>) => ({
    data: { name: 'todo_task' },
    etag: { value: 'W/"1"' },
    notModified: false,
  }));
  const getItem = vi.fn(async (_kind: string, _objectName: string) => ({ name: 'todo_task' }));
  const getView = vi.fn(async (_objectName: string, _viewType: string) => ({
    name: 'todo_task_list',
  }));
  const subscriptions: { unsubscribe: ReturnType<typeof vi.fn>; deliver: (e: DataEvent) => void }[] = [];

  const client = {
    data: { find, query: find },
    meta: { getCached, getItem, getView },
    events: {
      subscribeData: vi.fn((_object: string, callback: (e: DataEvent) => void) => {
        const unsubscribe = vi.fn();
        subscriptions.push({ unsubscribe, deliver: callback });
        return unsubscribe;
      }),
      subscribeBulkData: vi.fn(() => vi.fn()),
      subscribeMetadata: vi.fn(() => vi.fn()),
    },
    setLocale: vi.fn(),
  } as unknown as ObjectStackClient;

  return { client, find, getCached, getItem, getView, subscriptions };
}

function mount(client: ObjectStackClient, Component: React.ComponentType) {
  return render(
    <ObjectStackProvider client={client}>
      <Component />
    </ObjectStackProvider>
  );
}

// ---------------------------------------------------------------------------
// #4693 — the fetch hooks issue exactly one request
// ---------------------------------------------------------------------------

describe('#4693 fetch hooks key on values, not identities', () => {
  it('useQuery fetches once with an inline options object', async () => {
    const { client, find } = createFakeClient();
    mount(client, () => {
      useQuery('todo_task', { where: { status: 'open' } as any, fields: ['id', 'subject'] });
      return null;
    });

    await settle();

    expect(find).toHaveBeenCalledTimes(1);
  });

  it('useInfiniteQuery fetches once with an inline options object', async () => {
    const { client, find } = createFakeClient();
    mount(client, () => {
      useInfiniteQuery('todo_task', { where: { status: 'open' } as any });
      return null;
    });

    await settle();

    expect(find).toHaveBeenCalledTimes(1);
  });

  it('useObject fetches once — it used to loop on its own state', async () => {
    const { client, getCached } = createFakeClient();
    mount(client, () => {
      useObject('todo_task');
      return null;
    });

    await settle();

    // The pre-fix loop needed no options at all: `data` and `etag` were in the
    // fetch's dependency array and the fetch wrote both.
    expect(getCached).toHaveBeenCalledTimes(1);
  });

  it('useView fetches once with an inline onSuccess', async () => {
    const { client, getView } = createFakeClient();
    mount(client, () => {
      useView('todo_task', 'list', { onSuccess: () => {} });
      return null;
    });

    await settle();

    expect(getView).toHaveBeenCalledTimes(1);
  });

  it('useMetadata fetches once with an inline fetcher', async () => {
    const { client } = createFakeClient();
    const fetcher = vi.fn(async () => ({ ok: true }));
    mount(client, () => {
      useMetadata(() => fetcher());
      return null;
    });

    await settle();

    // `fetcher` is positional and required, so inline is the only natural call.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// #4693 — a changed VALUE still refetches
// ---------------------------------------------------------------------------

describe('#4693 value changes still drive a refetch', () => {
  it('useQuery refetches when the where VALUE changes, not when it is rebuilt', async () => {
    const { client, find } = createFakeClient();

    function Harness({ status }: { status: string }) {
      useQuery('todo_task', { where: { status } as any });
      return null;
    }

    const { rerender } = render(
      <ObjectStackProvider client={client}>
        <Harness status="open" />
      </ObjectStackProvider>
    );
    await settle();
    expect(find).toHaveBeenCalledTimes(1);

    // Same value, freshly built object — must not refetch. Without the
    // value-keyed dependency this is where the loop restarted.
    rerender(
      <ObjectStackProvider client={client}>
        <Harness status="open" />
      </ObjectStackProvider>
    );
    await settle();
    expect(find).toHaveBeenCalledTimes(1);

    // Genuinely different filter — must refetch, or the fix would have traded a
    // loop for a stale list.
    rerender(
      <ObjectStackProvider client={client}>
        <Harness status="done" />
      </ObjectStackProvider>
    );
    await settle();
    expect(find).toHaveBeenCalledTimes(2);
    expect((find.mock.calls[1] as any)[1].where).toEqual({ status: 'done' });
  });

  it('useObject refetches when the object name changes', async () => {
    const { client, getCached } = createFakeClient();

    function Harness({ name }: { name: string }) {
      useObject(name);
      return null;
    }

    const { rerender } = render(
      <ObjectStackProvider client={client}>
        <Harness name="todo_task" />
      </ObjectStackProvider>
    );
    await settle();
    expect(getCached).toHaveBeenCalledTimes(1);

    rerender(
      <ObjectStackProvider client={client}>
        <Harness name="account" />
      </ObjectStackProvider>
    );
    await settle();
    expect(getCached).toHaveBeenCalledTimes(2);
    expect(getCached.mock.calls[1][0]).toBe('account');
  });
});

// ---------------------------------------------------------------------------
// #4693 / #4694 — stabilized handlers must not go stale
// ---------------------------------------------------------------------------

describe('#4693 stabilized handlers still run their latest version', () => {
  it('useQuery calls the onSuccess from the current render', async () => {
    const { client } = createFakeClient();
    const first = vi.fn();
    const second = vi.fn();

    function Harness({ onSuccess }: { onSuccess: () => void }) {
      const { refetch } = useQuery('todo_task', { where: { status: 'open' } as any, onSuccess });
      // Expose refetch so the test can trigger a second call after the handler
      // has been swapped.
      (globalThis as any).__refetch = refetch;
      return null;
    }

    const { rerender } = render(
      <ObjectStackProvider client={client}>
        <Harness onSuccess={first} />
      </ObjectStackProvider>
    );
    await settle();
    expect(first).toHaveBeenCalledTimes(1);

    rerender(
      <ObjectStackProvider client={client}>
        <Harness onSuccess={second} />
      </ObjectStackProvider>
    );
    await settle();

    // Swapping the handler must not refetch (that was the loop)...
    expect(second).not.toHaveBeenCalled();

    // ...but the next fetch must reach the NEW handler, not the one captured
    // when the effect first ran.
    await act(async () => {
      await (globalThis as any).__refetch();
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    delete (globalThis as any).__refetch;
  });
});

// ---------------------------------------------------------------------------
// #4694 — subscriptions stop churning
// ---------------------------------------------------------------------------

describe('#4694 subscription callbacks do not churn the subscription', () => {
  it('useAutoRefresh subscribes once across renders with an unmemoized refetch', () => {
    const { client } = createFakeClient();
    const events = (client as any).events;

    const { rerender } = renderHook(
      () => useAutoRefresh('project_task', () => {}),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <ObjectStackProvider client={client}>{children}</ObjectStackProvider>
        ),
      }
    );

    rerender();
    rerender();

    // Before the fix: 3 renders → 3 subscriptions on each stream, each render
    // unsubscribing the previous one and losing anything delivered in the gap.
    expect(events.subscribeData).toHaveBeenCalledTimes(1);
    expect(events.subscribeBulkData).toHaveBeenCalledTimes(1);
  });

  it('useDataSubscriptionCallback delivers to the latest callback after a swap', () => {
    const { client, subscriptions } = createFakeClient();
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ callback }) => useDataSubscriptionCallback('project_task', callback),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <ObjectStackProvider client={client}>{children}</ObjectStackProvider>
        ),
        initialProps: { callback: first as (e: DataEvent) => void },
      }
    );

    rerender({ callback: second as (e: DataEvent) => void });

    // Still one subscription — and it must invoke the CURRENT callback. A ref
    // synced in the wrong phase would deliver to `first` forever, which is a
    // worse bug than the churn this replaced.
    expect(subscriptions).toHaveLength(1);
    act(() => subscriptions[0].deliver(RECORD_EVENT));

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stableKey
// ---------------------------------------------------------------------------

describe('stableKey', () => {
  it('is insensitive to key order but sensitive to values', () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });

  it('preserves array order, which is semantic for orderBy', () => {
    expect(stableKey(['-created_at', 'name'])).not.toBe(stableKey(['name', '-created_at']));
  });

  it('distinguishes nested differences and undefined from absent', () => {
    expect(stableKey({ where: { a: { b: 1 } } })).not.toBe(stableKey({ where: { a: { b: 2 } } }));
    expect(stableKey({ a: undefined })).not.toBe(stableKey({}));
  });
});
