/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5801 — the ONE pending-drafts data source. Pinned here:
 *  - every response shape a deployed `_drafts` endpoint has answered with;
 *  - the scope param;
 *  - the bus subscription (a publish anywhere converges this hook);
 *  - `enabled:false` holds fetching and clears state (no stale count when a
 *    conversation loses its package binding);
 *  - a change made outside the tab (objectstack#32592): the ledger is read
 *    again when the tab becomes visible and on a poll while it stays visible,
 *    never while it is hidden, once per scope however many hooks read it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePendingDrafts, fetchPendingDrafts, PENDING_DRAFTS_POLL_MS } from './usePendingDrafts.js';
import { emitMetadataRefresh, subscribeMetadataRefresh } from '../assistant/assistantBus.js';
import { __resetHiddenTabClock } from '../hooks/hiddenTabPollStop.js';

const draftsRow = { type: 'object', name: 'task', packageId: 'app.k9qk' };

function stubFetch(payload: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPendingDrafts — response-shape tolerance', () => {
  it.each([
    ['bare array', [draftsRow]],
    ['{drafts} envelope', { drafts: [draftsRow] }],
    ['{data:{drafts}} envelope', { data: { drafts: [draftsRow] } }],
  ])('parses the %s shape', async (_label, payload) => {
    stubFetch(payload);
    const rows = await fetchPendingDrafts();
    expect(rows).toEqual([{ type: 'object', name: 'task', packageId: 'app.k9qk' }]);
  });

  it('scopes by packageId via the query string', async () => {
    const fn = stubFetch([]);
    await fetchPendingDrafts('app.k9qk');
    expect(fn).toHaveBeenCalledWith(
      '/api/v1/meta/_drafts?package=app.k9qk',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('drops malformed rows and normalizes a missing packageId to null', async () => {
    stubFetch([draftsRow, { type: 'view' }, { name: 'x' }, { type: 'seed', name: 's' }]);
    const rows = await fetchPendingDrafts();
    expect(rows).toEqual([
      { type: 'object', name: 'task', packageId: 'app.k9qk' },
      { type: 'seed', name: 's', packageId: null },
    ]);
  });
});

describe('usePendingDrafts', () => {
  it('loads on mount and refreshes on the metadata-refresh pulse — the unification edge', async () => {
    const fn = stubFetch([draftsRow]);
    const { result } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await waitFor(() => expect(result.current.count).toBe(1));

    stubFetch([]); // the publish emptied the drafts
    act(() => {
      emitMetadataRefresh();
    });
    await waitFor(() => expect(result.current.count).toBe(0));
    expect(fn).toHaveBeenCalledTimes(1); // first stub used exactly once
  });

  it('enabled:false holds fetching and clears state', async () => {
    const fn = stubFetch([draftsRow]);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePendingDrafts({ packageId: 'p', enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.count).toBe(1));
    rerender({ enabled: false });
    await waitFor(() => expect(result.current.count).toBeNull());
    const calls = fn.mock.calls.length;
    act(() => {
      emitMetadataRefresh();
    });
    expect(fn.mock.calls.length).toBe(calls); // pulse ignored while disabled
  });

  it('an errored read reports UNKNOWN (null), never a stale count and never a fake zero', async () => {
    stubFetch(null, false);
    const { result } = renderHook(() => usePendingDrafts({}));
    // stays null: fail-safe consumers (preview bar) treat unknown ≠ empty
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.count).toBeNull();
    expect(result.current.entries).toEqual([]);
  });
});

describe('a change made outside the tab reaches the hook without a reload (objectstack#32592)', () => {
  const DRAFTS_URL = '/api/v1/meta/_drafts?package=app.k9qk';
  /** What `_drafts` answers right now, server-side — an agent writes it over MCP. */
  let ledger: unknown[] = [];

  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
  }
  function switchTab(hidden: boolean): void {
    setHidden(hidden);
    document.dispatchEvent(new Event('visibilitychange'));
  }
  function stubLedger() {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ drafts: ledger }) }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const ledgerReads = (fn: ReturnType<typeof stubLedger>) =>
    (fn.mock.calls as unknown as Array<[string]>).filter(([url]) => url === DRAFTS_URL).length;
  /** Let the pending reads and the renders they cause settle. */
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

  beforeEach(() => {
    ledger = [];
    setHidden(false);
    __resetHiddenTabClock();
  });
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it('a draft staged outside the tab shows after the tab becomes visible again, with no reload and no pulse of its own', async () => {
    const fn = stubLedger();
    const { result } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await waitFor(() => expect(result.current.count).toBe(0));

    switchTab(true);
    ledger = [draftsRow]; // the agent stages a draft while the user is in the MCP client
    await settle();
    expect(result.current.count).toBe(0);
    const whileHidden = ledgerReads(fn);

    switchTab(false);
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.entries).toEqual([{ type: 'object', name: 'task', packageId: 'app.k9qk' }]);
    // The return read, then the hook's re-read on the pulse that answer sent.
    expect(ledgerReads(fn)).toBe(whileHidden + 2);
  });

  it('focusing the window reads again too', async () => {
    stubLedger();
    const { result } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await waitFor(() => expect(result.current.count).toBe(0));
    ledger = [draftsRow];
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(result.current.count).toBe(1));
  });

  it('an unchanged answer sends no pulse: a return to the tab costs one read and nothing else', async () => {
    const fn = stubLedger();
    ledger = [draftsRow];
    const { result } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await waitFor(() => expect(result.current.count).toBe(1));
    let pulses = 0;
    const off = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    const before = ledgerReads(fn);
    switchTab(true);
    switchTab(false);
    await settle();
    off();
    expect(ledgerReads(fn)).toBe(before + 1);
    expect(pulses).toBe(0);
  });

  it('polls every PENDING_DRAFTS_POLL_MS while visible, one read per tick across every hook of the scope', async () => {
    vi.useFakeTimers();
    const fn = stubLedger();
    const hooks = [0, 1, 2].map(() => renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' })));
    await settle();
    expect(hooks.every((h) => h.result.current.count === 0)).toBe(true);
    expect(PENDING_DRAFTS_POLL_MS).toBeGreaterThanOrEqual(15_000);
    expect(PENDING_DRAFTS_POLL_MS).toBeLessThanOrEqual(30_000);
    const mounted = ledgerReads(fn);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DRAFTS_POLL_MS - 1);
    });
    expect(ledgerReads(fn)).toBe(mounted);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ledgerReads(fn)).toBe(mounted + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DRAFTS_POLL_MS);
    });
    expect(ledgerReads(fn)).toBe(mounted + 2);

    // A tick that finds a change: every hook shows it.
    ledger = [draftsRow];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DRAFTS_POLL_MS);
    });
    await settle();
    expect(hooks.map((h) => h.result.current.count)).toEqual([1, 1, 1]);
    hooks.forEach((h) => h.unmount());
  });

  it('makes no request while the tab is hidden, however long, and reads once on the way back', async () => {
    vi.useFakeTimers();
    const fn = stubLedger();
    const { result, unmount } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await settle();
    expect(result.current.count).toBe(0);
    const before = ledgerReads(fn);

    switchTab(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DRAFTS_POLL_MS * 40);
    });
    expect(ledgerReads(fn)).toBe(before);

    switchTab(false);
    await settle();
    expect(ledgerReads(fn)).toBe(before + 1);
    // And the visible cadence resumes from there.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DRAFTS_POLL_MS);
    });
    expect(ledgerReads(fn)).toBe(before + 2);
    unmount();
  });

  it('stops polling once the last hook unmounts', async () => {
    vi.useFakeTimers();
    const fn = stubLedger();
    const { unmount } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await settle();
    unmount();
    const before = fn.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DRAFTS_POLL_MS * 3);
    });
    switchTab(true);
    switchTab(false);
    await settle();
    expect(fn.mock.calls.length).toBe(before);
  });

  it('CONTROL: the in-tab pulse (Studio\'s own save or publish) still refreshes at once, not at the next tick', async () => {
    vi.useFakeTimers();
    stubLedger();
    const { result, unmount } = renderHook(() => usePendingDrafts({ packageId: 'app.k9qk' }));
    await settle();
    expect(result.current.count).toBe(0);
    ledger = [draftsRow];
    act(() => {
      emitMetadataRefresh();
    });
    await settle();
    expect(result.current.count).toBe(1);
    unmount();
  });
});
