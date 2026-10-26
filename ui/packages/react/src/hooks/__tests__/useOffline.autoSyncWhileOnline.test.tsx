/**
 * ObjectUI — useOffline auto-syncs mutations queued while ONLINE (objectui#6818)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The auto-sync effect was keyed `[isOnline, enabled]` with
 * `react-hooks/exhaustive-deps` suppressed, so its `queue.length === 0` guard
 * was evaluated against the queue as it stood when `isOnline` or `enabled` last
 * changed. `queueMutation` has never been conditional on being offline, so a
 * mutation queued while ALREADY online found the effect asleep: nothing
 * re-ran it, and only an explicit `sync()` could drain the queue.
 *
 * Nothing in this repo reaches that queue — `AppHeader.tsx` is the one in-repo
 * caller and it destructures `isOnline` only — so a green suite proved nothing
 * about this path before these pins existed. Each one below drives a real
 * mutation through the queue.
 *
 * Timers are faked because two of the pins are about WHEN the 100ms
 * stabilization timer fires, not merely whether it does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOffline, type OfflineResult } from '../useOffline';

function queueOne(result: { current: OfflineResult }, resource: string) {
  act(() => {
    result.current.queueMutation({ operation: 'create', resource, data: { resource } });
  });
}

/** Advance fake time and let React flush whatever the timers scheduled. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe('useOffline — auto-sync reaches mutations queued while online (#6818)', () => {
  // ---- pin 1: the card's finding, stated as behaviour ----------------------
  // This is the assertion the whole card is about, and it fails on the base:
  // the effect had already returned early against an empty queue and nothing
  // re-ran it when `queueMutation` made the queue non-empty.
  it('drains a mutation queued while already online', async () => {
    const { result } = renderHook(() => useOffline());
    expect(result.current.isOnline).toBe(true);

    queueOne(result, 'account');
    expect(result.current.pendingCount).toBe(1);

    await advance(150);

    expect(result.current.pendingCount).toBe(0);
    expect(result.current.syncState).toBe('idle');
  });

  // ---- pin 2: DISCRIMINATING — the timer must NOT restart per mutation -----
  // The suppressed dep list existed to stop the 100ms timer restarting on every
  // queued mutation, and that reason is kept: the dep is the BOOLEAN
  // `queue.length > 0`. This pin is what tells the two shapes apart. The timer
  // is armed at t=0 by the first mutation; a second mutation lands at t=60. If
  // the effect were keyed on the queue (or on `queue.length`), it would re-run
  // there and re-arm for t=160, so at t=105 nothing would have drained yet.
  // Keyed on the boolean, the ORIGINAL timer fires at t=100 and — because
  // `sync` now reads the queue through the same commit-phase ref it already
  // read `batchSize` through — it flushes BOTH entries, not just the first.
  it('keeps the original timer when a second mutation is queued before it fires', async () => {
    const { result } = renderHook(() => useOffline());

    queueOne(result, 'account');
    await advance(60);
    expect(result.current.pendingCount).toBe(1);

    queueOne(result, 'contact');
    expect(result.current.pendingCount).toBe(2);

    await advance(45); // t = 105: past the ORIGINAL 100ms deadline, short of a restarted one

    expect(result.current.pendingCount).toBe(0);
  });

  // ---- pin 3: the original feature is not traded away ----------------------
  // Green on the base too, deliberately: it is the regression guard for the
  // behaviour the narrow dep list did deliver ("sync when you come back
  // online"), so a future edit cannot close #6818 by breaking the reconnect.
  it('still auto-syncs on the offline to online transition', async () => {
    const { result } = renderHook(() => useOffline());

    setOnline(false);
    expect(result.current.isOnline).toBe(false);

    queueOne(result, 'account');
    await advance(150);
    // Offline: the guard is right to hold the queue.
    expect(result.current.pendingCount).toBe(1);

    setOnline(true);
    await advance(150);

    expect(result.current.pendingCount).toBe(0);
  });

  // ---- pin 4: point 2 of the card — one call, one notion of "current" ------
  // `sync` read `batchSize` through a ref (newest) and `queue` from its own
  // closure (a snapshot), so the two halves of a RETAINED call disagreed about
  // how current they were — and the auto-sync effect retains one by design.
  // Mirrors #6797's pin 1 ("a retained closure reads the newest batchSize")
  // with its missing half: a retained closure batches the newest QUEUE.
  it('lets a retained sync closure batch the newest queue, not its own snapshot', async () => {
    const { result } = renderHook(() => useOffline());

    queueOne(result, 'account');
    const retained = result.current.sync;

    queueOne(result, 'contact');
    expect(result.current.pendingCount).toBe(2);

    await act(async () => {
      const settled = retained();
      await vi.advanceTimersByTimeAsync(1); // the simulated round-trip, not the 100ms timer
      await settled;
    });

    // On the base this is 1: `retained` closed over the one-entry queue and
    // flushed only that, leaving the mutation queued after it behind.
    expect(result.current.pendingCount).toBe(0);
  });
});
