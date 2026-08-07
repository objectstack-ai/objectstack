// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Behavioral tests for the realtime subscription hooks (#4682).
 *
 * `tsc --noEmit` was this package's only gate until now, and it is structurally
 * blind to everything below: a dependency array is a value, not a type, so a
 * missing entry, a missing cleanup, and a callback that is simply never invoked
 * all typecheck perfectly.
 *
 * The three things covered here are exactly the three the type checker cannot
 * see:
 *
 *  1. **Re-subscription on dependency change** — changing `object` must drop
 *     the old subscription and open one on the new name. The mirror case
 *     matters just as much: a re-render that changes nothing must NOT churn the
 *     subscription.
 *  2. **Unsubscribe on unmount** — a missed cleanup leaks the subscription and
 *     keeps delivering into an unmounted tree.
 *  3. **The callback actually fires** — `useAutoRefresh` must refetch on BOTH
 *     event streams. That it did not fire for the bulk stream was the whole of
 *     #4678, and no type would have caught it.
 *
 * The client is faked rather than driven end-to-end on purpose: the contract
 * under test is what these hooks ask of `client.events` and when they let go,
 * not whether the transport delivers. `packages/client/src/realtime-api-data.
 * test.ts` covers the other side of that boundary (and is the style reference
 * for the fixtures below).
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ObjectStackClient } from '@objectstack/client';
import type {
  BulkDataEvent,
  DataEvent,
  MetadataEvent,
  MetadataEventSubject,
} from '@objectstack/spec/api';
import { ObjectStackProvider } from './context';
import {
  useAutoRefresh,
  useBulkDataSubscription,
  useBulkDataSubscriptionCallback,
  useDataSubscription,
  useDataSubscriptionCallback,
  useMetadataSubscription,
} from './realtime-hooks';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECORD_EVENT: DataEvent = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  type: 'data.record.updated',
  object: 'project_task',
  recordId: 'task_1',
  after: { id: 'task_1', title: 'Ship it', status: 'done' },
  timestamp: '2026-08-02T12:00:00.000Z',
} as DataEvent;

const BULK_EVENT: BulkDataEvent = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  type: 'data.records.updated',
  object: 'project_task',
  matched: 40,
  timestamp: '2026-08-02T12:00:00.000Z',
} as BulkDataEvent;

const METADATA_EVENT = {
  id: '9f8b0f6e-1c2d-4a3b-8c9d-0e1f2a3b4c5d',
  type: 'metadata.object.updated',
  name: 'project_task',
  timestamp: '2026-08-02T12:00:00.000Z',
} as unknown as MetadataEvent;

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

interface Recorded<E> {
  object: string;
  options?: { recordId?: string; packageId?: string };
  /** Push an event into this subscription's callback. */
  deliver: (event: E) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

/**
 * Records every `subscribe*` call and hands back a distinct unsubscribe spy per
 * call, so a test can tell "re-subscribed" from "kept the old subscription" —
 * a single shared spy could not.
 */
function createFakeClient() {
  const data: Recorded<DataEvent>[] = [];
  const bulk: Recorded<BulkDataEvent>[] = [];
  const metadata: Recorded<MetadataEvent>[] = [];

  function recorder<E>(log: Recorded<E>[]) {
    return (
      object: string,
      callback: (event: E) => void,
      options?: Recorded<E>['options']
    ) => {
      const unsubscribe = vi.fn();
      log.push({ object, options, deliver: callback, unsubscribe });
      return unsubscribe;
    };
  }

  const client = {
    events: {
      subscribeData: vi.fn(recorder(data)),
      subscribeBulkData: vi.fn(recorder(bulk)),
      subscribeMetadata: vi.fn(recorder(metadata)),
    },
    // ObjectStackProvider mirrors the active locale onto the client during
    // render; without this the provider throws before any hook runs.
    setLocale: vi.fn(),
  } as unknown as ObjectStackClient;

  return { client, data, bulk, metadata };
}

function wrapperFor(client: ObjectStackClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ObjectStackProvider client={client}>{children}</ObjectStackProvider>;
  };
}

// ---------------------------------------------------------------------------
// 1. Re-subscription driven by the dependency array
// ---------------------------------------------------------------------------

describe('#4682 dependency arrays drive re-subscription', () => {
  it('useDataSubscription re-subscribes to the new object and drops the old one', () => {
    const { client, data } = createFakeClient();
    const { rerender } = renderHook(({ object }) => useDataSubscription(object), {
      wrapper: wrapperFor(client),
      initialProps: { object: 'project_task' },
    });

    expect(data.map((s) => s.object)).toEqual(['project_task']);
    expect(data[0].unsubscribe).not.toHaveBeenCalled();

    rerender({ object: 'account' });

    // Both halves matter: a missing `object` dep would leave the subscription
    // on 'project_task' (still receiving the wrong object's events), and a
    // missing cleanup would leave BOTH open.
    expect(data.map((s) => s.object)).toEqual(['project_task', 'account']);
    expect(data[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(data[1].unsubscribe).not.toHaveBeenCalled();
  });

  it('useDataSubscription does not churn the subscription on an unrelated re-render', () => {
    const { client, data } = createFakeClient();
    const { rerender } = renderHook(({ object }) => useDataSubscription(object), {
      wrapper: wrapperFor(client),
      initialProps: { object: 'project_task' },
    });

    rerender({ object: 'project_task' });
    rerender({ object: 'project_task' });

    expect(data).toHaveLength(1);
    expect(data[0].unsubscribe).not.toHaveBeenCalled();
  });

  it('useDataSubscription keys on options.recordId, not on the options object identity', () => {
    const { client, data } = createFakeClient();
    const { rerender } = renderHook(
      ({ options }) => useDataSubscription('project_task', options),
      {
        wrapper: wrapperFor(client),
        initialProps: { options: { recordId: 'task_1' } },
      }
    );

    // A caller writing `useDataSubscription('t', { recordId: id })` inline
    // creates a fresh object every render. The hook depends on the primitive
    // `options?.recordId`, so an equal-but-new object must be a no-op —
    // "simplifying" that dep to `options` would resubscribe on every render.
    rerender({ options: { recordId: 'task_1' } });
    expect(data).toHaveLength(1);

    // ...while a genuinely different record must re-subscribe.
    rerender({ options: { recordId: 'task_2' } });
    expect(data).toHaveLength(2);
    expect(data[1].options?.recordId).toBe('task_2');
    expect(data[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('useBulkDataSubscription re-subscribes when the object changes', () => {
    const { client, bulk } = createFakeClient();
    const { rerender } = renderHook(({ object }) => useBulkDataSubscription(object), {
      wrapper: wrapperFor(client),
      initialProps: { object: 'project_task' },
    });

    expect(bulk.map((s) => s.object)).toEqual(['project_task']);

    rerender({ object: 'account' });

    expect(bulk.map((s) => s.object)).toEqual(['project_task', 'account']);
    expect(bulk[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('useMetadataSubscription keys on type and options.packageId', () => {
    const { client, metadata } = createFakeClient();
    const { rerender } = renderHook(
      ({ type, options }) => useMetadataSubscription(type, options),
      {
        wrapper: wrapperFor(client),
        // Annotated, not widened: `renderHook` infers the prop type from this
        // literal, and a bare `'object'` widens to `string` — which the hook
        // no longer accepts (#4627). `rerender({ type: 'view' })` below is
        // exactly why the annotation must be the union rather than the literal.
        initialProps: {
          type: 'object' as MetadataEventSubject,
          options: { packageId: 'crm' },
        },
      }
    );

    rerender({ type: 'object', options: { packageId: 'crm' } });
    expect(metadata).toHaveLength(1);

    rerender({ type: 'view', options: { packageId: 'crm' } });
    expect(metadata).toHaveLength(2);
    expect(metadata[1].object).toBe('view');

    rerender({ type: 'view', options: { packageId: 'sales' } });
    expect(metadata).toHaveLength(3);
    expect(metadata[2].options?.packageId).toBe('sales');
  });
});

// ---------------------------------------------------------------------------
// 2. Unsubscribe on unmount
// ---------------------------------------------------------------------------

describe('#4682 subscriptions are released on unmount', () => {
  it('useDataSubscription unsubscribes', () => {
    const { client, data } = createFakeClient();
    const { unmount } = renderHook(() => useDataSubscription('project_task'), {
      wrapper: wrapperFor(client),
    });

    expect(data[0].unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(data[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('useBulkDataSubscription unsubscribes', () => {
    const { client, bulk } = createFakeClient();
    const { unmount } = renderHook(() => useBulkDataSubscription('project_task'), {
      wrapper: wrapperFor(client),
    });

    unmount();
    expect(bulk[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('useMetadataSubscription unsubscribes', () => {
    const { client, metadata } = createFakeClient();
    const { unmount } = renderHook(() => useMetadataSubscription('object'), {
      wrapper: wrapperFor(client),
    });

    unmount();
    expect(metadata[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('useAutoRefresh releases BOTH streams', () => {
    const { client, data, bulk } = createFakeClient();
    const refetch = vi.fn();
    const { unmount } = renderHook(() => useAutoRefresh('project_task', refetch), {
      wrapper: wrapperFor(client),
    });

    expect(data).toHaveLength(1);
    expect(bulk).toHaveLength(1);

    unmount();

    expect(data[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(bulk[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('an unmounted useDataSubscription does not set state from a late event', () => {
    const { client, data } = createFakeClient();
    const { unmount } = renderHook(() => useDataSubscription('project_task'), {
      wrapper: wrapperFor(client),
    });

    const deliver = data[0].deliver;
    unmount();

    // A transport that already had the event in flight when the component went
    // away. The hook is unsubscribed, so this is a no-op — it must not warn or
    // throw. (React logs an "update on unmounted component" error for this
    // class of bug rather than throwing, so assert on the console too.)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => deliver(RECORD_EVENT))).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. The callbacks actually fire
// ---------------------------------------------------------------------------

describe('#4682 events reach the caller', () => {
  it('useDataSubscription exposes the latest per-record event', () => {
    const { client, data } = createFakeClient();
    const { result } = renderHook(() => useDataSubscription('project_task'), {
      wrapper: wrapperFor(client),
    });

    expect(result.current).toBeNull();

    act(() => data[0].deliver(RECORD_EVENT));

    expect(result.current).toEqual(RECORD_EVENT);
    expect(result.current?.recordId).toBe('task_1');
  });

  it('useBulkDataSubscription exposes the latest aggregate event', () => {
    const { client, bulk } = createFakeClient();
    const { result } = renderHook(() => useBulkDataSubscription('project_task'), {
      wrapper: wrapperFor(client),
    });

    act(() => bulk[0].deliver(BULK_EVENT));

    expect(result.current?.matched).toBe(40);
    expect(result.current?.type).toBe('data.records.updated');
  });

  it('useMetadataSubscription exposes the latest metadata event', () => {
    const { client, metadata } = createFakeClient();
    const { result } = renderHook(() => useMetadataSubscription('object'), {
      wrapper: wrapperFor(client),
    });

    expect(result.current).toBeNull();

    act(() => metadata[0].deliver(METADATA_EVENT));

    expect(result.current).toEqual(METADATA_EVENT);
  });

  it('useDataSubscriptionCallback forwards the event without re-rendering state', () => {
    const { client, data } = createFakeClient();
    const seen: DataEvent[] = [];
    const callback = (e: DataEvent) => seen.push(e);

    renderHook(() => useDataSubscriptionCallback('project_task', callback), {
      wrapper: wrapperFor(client),
    });

    act(() => data[0].deliver(RECORD_EVENT));

    expect(seen).toHaveLength(1);
    expect(seen[0].recordId).toBe('task_1');
  });

  it('useBulkDataSubscriptionCallback forwards the aggregate event', () => {
    const { client, bulk } = createFakeClient();
    const seen: BulkDataEvent[] = [];
    const callback = (e: BulkDataEvent) => seen.push(e);

    renderHook(() => useBulkDataSubscriptionCallback('project_task', callback), {
      wrapper: wrapperFor(client),
    });

    act(() => bulk[0].deliver(BULK_EVENT));

    expect(seen).toHaveLength(1);
    expect(seen[0].matched).toBe(40);
  });

  it('useAutoRefresh refetches on a per-record write', () => {
    const { client, data } = createFakeClient();
    const refetch = vi.fn();
    renderHook(() => useAutoRefresh('project_task', refetch), {
      wrapper: wrapperFor(client),
    });

    act(() => data[0].deliver(RECORD_EVENT));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('useAutoRefresh refetches on a predicate write (#4678 regression)', () => {
    const { client, bulk } = createFakeClient();
    const refetch = vi.fn();
    renderHook(() => useAutoRefresh('project_task', refetch), {
      wrapper: wrapperFor(client),
    });

    // The defect #4678 fixed: this hook watched only the per-record stream, so
    // a `multi: true` write — the one that can change every row on screen —
    // left the list stale while a single-row edit refreshed it. Nothing about
    // the types changed when it was fixed, which is why this pin exists.
    act(() => bulk[0].deliver(BULK_EVENT));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('useAutoRefresh refetches for a bulk write even when narrowed to one record', () => {
    const { client, bulk } = createFakeClient();
    const refetch = vi.fn();
    renderHook(() => useAutoRefresh('project_task', refetch, { recordId: 'task_1' }), {
      wrapper: wrapperFor(client),
    });

    // A bulk event carries only a count, so there is no way to tell whether
    // task_1 was in the match set. Refetching anyway is the deliberate choice
    // (#4678): a redundant query beats showing a record a predicate write
    // already changed.
    act(() => bulk[0].deliver(BULK_EVENT));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
