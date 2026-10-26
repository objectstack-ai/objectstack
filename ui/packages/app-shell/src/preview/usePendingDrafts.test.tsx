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
 *    conversation loses its package binding).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePendingDrafts, fetchPendingDrafts } from './usePendingDrafts.js';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';

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
      '/api/v1/meta/_drafts?packageId=app.k9qk',
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
