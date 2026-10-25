/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `usePendingActions` polls according to what it was last answered
 * (objectui#11736).
 *
 * The defect: the hook re-armed a fixed `setInterval` whatever the list read
 * answered. On a deployment with no AI service, the open edition answers `501`,
 * so the page asked the dead endpoint every five seconds for as long as it was
 * open. The fault policy is documented on `ListReadOutcome` in
 * `usePendingActions.ts`. These pins hold its three arms, and the live control
 * the card asks for, by counting reads under fake timers:
 *
 *  - refused (`501`, `404`, `403`, `401`): one read, then nothing, however long
 *    the page stays open;
 *  - transient (`5xx` other than `501`, `408`, `429`, no answer at all): the
 *    delay doubles per consecutive failure, up to a ceiling;
 *  - ok: a read every `pollInterval`, and a success after failures resets the
 *    cadence. This is the live control: a working endpoint keeps being polled.
 *
 * Counting reads, not timers: `vi.getTimerCount()` would also count whatever
 * React or the DOM shim schedules, while the number of `fetch` calls is exactly
 * the traffic the card is about.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { usePendingActions } from '../usePendingActions';

const POLL = 5_000;

/** A `Response`-shaped answer: the hook reads `ok`, `status`, `statusText` and `json()`. */
function answer(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as unknown as Response;
}

const EMPTY = { items: [], total: 0 };
const NOT_IMPLEMENTED = {
  success: false,
  error: { code: 'NOT_IMPLEMENTED', message: 'The AI service is not available on this deployment.' },
};

/** Stub `fetch` with a per-call responder; `n` is the 1-based call number. */
function stubFetch(respond: (n: number) => Response | Promise<Response>) {
  let n = 0;
  const fetchMock = vi.fn(async () => respond(++n));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('usePendingActions: a refused read stops the poll (objectui#11736)', () => {
  it.each([501, 404, 403, 401])('a %i is read once, and not again across ten poll intervals', async (status) => {
    const fetchMock = stubFetch(() => answer(status, NOT_IMPLEMENTED));
    const { result } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe(NOT_IMPLEMENTED.error.message);

    await advance(10 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe(NOT_IMPLEMENTED.error.message);
  });

  it('a manual refresh that succeeds restarts the poll at its normal cadence', async () => {
    const fetchMock = stubFetch((n) => (n === 1 ? answer(501, NOT_IMPLEMENTED) : answer(200, EMPTY)));
    const { result } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();
    await advance(3 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeUndefined();

    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a manual refresh that is refused again leaves the poll stopped', async () => {
    const fetchMock = stubFetch(() => answer(501, NOT_IMPLEMENTED));
    const { result } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();

    await act(async () => { await result.current.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(10 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a change to the inputs starts the poll over, and is judged on its own answer', async () => {
    const fetchMock = stubFetch(() => answer(501, NOT_IMPLEMENTED));
    const { rerender } = renderHook(
      ({ status }: { status: 'pending' | 'all' }) => usePendingActions({ pollInterval: POLL, status }),
      { initialProps: { status: 'pending' } },
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ status: 'all' });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(10 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('usePendingActions: a transient failure backs the poll off, within a ceiling (objectui#11736)', () => {
  it('doubles the delay per consecutive 503 and stops growing at the ceiling', async () => {
    const fetchMock = stubFetch(() => answer(503, { error: { message: 'Service Unavailable' } }));
    renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 5 s doubled per failure: 10 s, 20 s, 40 s, 80 s, then the 120 s ceiling.
    const delays = [10_000, 20_000, 40_000, 80_000, 120_000, 120_000];
    let reads = 1;
    for (const delay of delays) {
      await advance(delay - 1);
      expect(fetchMock).toHaveBeenCalledTimes(reads);
      await advance(1);
      reads += 1;
      expect(fetchMock).toHaveBeenCalledTimes(reads);
    }
  });

  it.each([500, 502, 504, 408, 429])('a %i backs off rather than stopping', async (status) => {
    const fetchMock = stubFetch(() => answer(status, { error: { message: `status ${status}` } }));
    renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();

    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a read with no answer at all (fetch rejects) backs off rather than stopping', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();
    expect(result.current.error?.message).toBe('Failed to fetch');

    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a success after failures resets the cadence to pollInterval', async () => {
    const fetchMock = stubFetch((n) => (n <= 2 ? answer(503, {}) : answer(200, EMPTY)));
    const { result } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeUndefined();

    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('usePendingActions: live control, a working endpoint keeps being polled (objectui#11736)', () => {
  it('reads every pollInterval while the endpoint answers', async () => {
    const fetchMock = stubFetch(() => answer(200, EMPTY));
    const { result } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let tick = 2; tick <= 6; tick += 1) {
      await advance(POLL);
      expect(fetchMock).toHaveBeenCalledTimes(tick);
    }
    expect(result.current.error).toBeUndefined();
    expect(result.current.items).toEqual([]);
  });

  it('an unmounted hook reads nothing more', async () => {
    const fetchMock = stubFetch(() => answer(200, EMPTY));
    const { unmount } = renderHook(() => usePendingActions({ pollInterval: POLL }));
    await settle();
    unmount();

    await advance(10 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
