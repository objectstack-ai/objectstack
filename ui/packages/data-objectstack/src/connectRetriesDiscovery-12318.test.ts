/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12318 — with `autoReconnect`, a failed first `connect()` retries
 * discovery as a NEW attempt, and the one promise every caller holds settles.
 *
 * The retry used to call the public `connect()` from inside the attempt it was
 * retrying. `connect()` hands every caller the in-flight promise, so the retry
 * awaited itself: one discovery read, a state stuck at `reconnecting`, and a
 * promise that never settled. A console booted while its backend was down
 * never got past `AdapterProvider`'s `await a.connect()`.
 *
 * These pins drive the REAL client through a fake fetch under fake time:
 *
 * - discovery refused N times and then answered, within the budget: `connect()`
 *   resolves and the state ends `connected`;
 * - refused past the budget: `connect()` rejects with the `ConnectionError`
 *   and the state ends `error`;
 * - concurrent `connect()` calls, one of them made during the backoff, share
 *   one attempt.
 *
 * Each pin reads how the promise settled through a tracker rather than by
 * awaiting it, so an attempt that never settles fails an assertion here
 * instead of hanging the run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ObjectStackAdapter,
  ConnectionError,
  clearSharedDiscoveryCache,
} from './index';

const DISCOVERY = { name: 'fake', routes: {} };

/**
 * A fake ObjectStack server behind the adapter's injected fetch: discovery is
 * refused (no HTTP answer) `refusals` times, then answered.
 */
function fakeServer(refusals: number) {
  let refused = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/api/v1/discovery')) {
      throw new Error(`unexpected request ${url}`);
    }
    if (refused < refusals) {
      refused++;
      throw new TypeError('Failed to fetch');
    }
    return new Response(JSON.stringify({ success: true, data: DISCOVERY }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetch };
}

function adapterFor(
  refusals: number,
  options: { maxReconnectAttempts: number; reconnectDelay: number },
) {
  const { fetch } = fakeServer(refusals);
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://fake-12318.test',
    fetch,
    autoReconnect: true,
    ...options,
  });
  const states: string[] = [];
  adapter.onConnectionStateChange((event) => states.push(event.state));
  return { adapter, fetch, states };
}

/** Records how a promise settled without awaiting it. */
function track(promise: Promise<void>) {
  const outcome: { settled: 'pending' | 'resolved' | 'rejected'; error?: unknown } = {
    settled: 'pending',
  };
  promise.then(
    () => {
      outcome.settled = 'resolved';
    },
    (error: unknown) => {
      outcome.settled = 'rejected';
      outcome.error = error;
    },
  );
  return outcome;
}

describe('a failed first connect() retries discovery as a new attempt (objectui#12318)', () => {
  beforeEach(() => {
    clearSharedDiscoveryCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refused twice, then answered within the budget: connect() resolves and the state ends connected', async () => {
    const { adapter, fetch, states } = adapterFor(2, {
      maxReconnectAttempts: 3,
      reconnectDelay: 1000,
    });

    const outcome = track(adapter.connect());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    // The backoff is reconnectDelay * 2^(n-1): the first retry is a new
    // discovery read 1000 ms later, the second one 2000 ms after that.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcome.settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);

    expect(outcome.settled).toBe('resolved');
    expect(adapter.getConnectionState()).toBe('connected');
    expect(adapter.isConnected()).toBe(true);
    expect(await adapter.getDiscovery()).toEqual(DISCOVERY);
    expect(states).toEqual([
      'connecting',
      'error',
      'reconnecting',
      'error',
      'reconnecting',
      'connected',
    ]);
    // Nothing is left scheduled once the attempt has settled.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refused past the budget: connect() rejects with the ConnectionError and the state ends error', async () => {
    const { adapter, fetch, states } = adapterFor(Number.POSITIVE_INFINITY, {
      maxReconnectAttempts: 2,
      reconnectDelay: 1000,
    });

    const outcome = track(adapter.connect());
    // 1000 ms + 2000 ms of backoff covers both retries.
    await vi.advanceTimersByTimeAsync(3000);

    // The first attempt plus maxReconnectAttempts retries, each a new read.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(outcome.settled).toBe('rejected');
    expect(outcome.error).toBeInstanceOf(ConnectionError);
    expect(outcome.error).toMatchObject({ code: 'CONNECTION_ERROR', statusCode: 503 });
    expect(adapter.getConnectionState()).toBe('error');
    expect(adapter.isConnected()).toBe(false);
    expect(states).toEqual([
      'connecting',
      'error',
      'reconnecting',
      'error',
      'reconnecting',
      'error',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('concurrent connect() calls share one attempt, including a call made during the backoff', async () => {
    const { adapter, fetch, states } = adapterFor(1, {
      maxReconnectAttempts: 3,
      reconnectDelay: 1000,
    });

    const first = track(adapter.connect());
    const second = track(adapter.connect());
    await vi.advanceTimersByTimeAsync(500);
    // Mid-backoff: the attempt is waiting to retry. A third caller joins it
    // rather than starting a discovery read of its own.
    expect(adapter.getConnectionState()).toBe('reconnecting');
    const third = track(adapter.connect());
    await vi.advanceTimersByTimeAsync(500);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect([first.settled, second.settled, third.settled]).toEqual([
      'resolved',
      'resolved',
      'resolved',
    ]);
    expect(states).toEqual(['connecting', 'error', 'reconnecting', 'connected']);
  });
});
