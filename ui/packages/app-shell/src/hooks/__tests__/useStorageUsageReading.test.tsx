/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useStorageUsageReading (objectui#10439) — reads the flat storage half of
 * `GET /api/v1/usage/storage` and resolves it to a banner from the served
 * verdict alone.
 *
 * The behaviours pinned here are contract properties, not rendering choices:
 *   - `warn` / `blocked` decide the banner, and the two numbers never do — a
 *     reading far over the line with `warn: false` stays quiet, one far under
 *     it with `warn: true` raises the banner (the card's "read the verdict, do
 *     not re-derive the threshold");
 *   - every non-banner answer the endpoint serves — `ok`, the miss spelling
 *     `unknown`, `unlimited` — resolves to no banner, and a failed read is a
 *     different value from all three;
 *   - the storage banner and the read-rate report cost ONE request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useStorageUsageReading,
  classifyStorageUsage,
  type StorageUsageSnapshot,
} from '../useStorageUsageReading';
import { useReadRateReading } from '../useReadRateReading';

// `createAuthenticatedFetch` reads `response.headers` to adopt a rotated
// session token, so a stub without them is not a Response this lane can use.
function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

/** Render the hook against one payload and settle on a terminal status. */
async function readPayload(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(okResponse(payload));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useStorageUsageReading({ apiBase: '/api/v1' }));
  await waitFor(() => expect(result.current.status).not.toBe('loading'));
  return { result, fetchMock };
}

/** The endpoint's own miss answer (cloud `unknownStorageUsage`). */
const UNKNOWN = { state: 'unknown', warn: false, blocked: false, warnFraction: 0.8 };

describe('useStorageUsageReading', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches {apiBase}/usage/storage and exposes the storage half', async () => {
    const { result, fetchMock } = await readPayload({
      state: 'warning',
      usedMb: 850,
      limitMb: 1024,
      fraction: 0.83,
      warn: true,
      blocked: false,
      warnFraction: 0.8,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/usage/storage',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.status).toBe('answered');
    // `fraction` and `warnFraction` are not modelled: nothing on this side may
    // hold a second copy of the line.
    expect(result.current.reading).toEqual({
      state: 'warning',
      warn: true,
      blocked: false,
      usedMb: 850,
      limitMb: 1024,
    });
    expect(classifyStorageUsage(result.current)).toEqual({
      case: 'warning',
      usedMb: 850,
      limitMb: 1024,
    });
  });

  it('resolves `blocked` to the full banner, ahead of `warn`', async () => {
    const { result } = await readPayload({
      state: 'exhausted',
      usedMb: 1100,
      limitMb: 1024,
      fraction: 1,
      warn: true,
      blocked: true,
      warnFraction: 0.8,
    });
    expect(classifyStorageUsage(result.current)).toEqual({
      case: 'blocked',
      usedMb: 1100,
      limitMb: 1024,
    });
  });

  // The card's ⭐ rule. If either assertion flips, the hook has started deciding
  // the banner from the numbers instead of from the served verdict.
  it('reads the verdict and never re-derives it from the numbers', async () => {
    const overTheLineButQuiet = await readPayload({
      state: 'ok',
      usedMb: 1000,
      limitMb: 1024,
      fraction: 0.98,
      warn: false,
      blocked: false,
      warnFraction: 0.8,
    });
    expect(classifyStorageUsage(overTheLineButQuiet.result.current)).toEqual({ case: 'none', state: 'ok' });

    vi.unstubAllGlobals();
    const underTheLineButWarned = await readPayload({
      state: 'warning',
      usedMb: 10,
      limitMb: 1024,
      fraction: 0.01,
      warn: true,
      blocked: false,
      warnFraction: 0.99,
    });
    expect(classifyStorageUsage(underTheLineButWarned.result.current).case).toBe('warning');
  });

  it.each([
    ['the endpoint miss answer (`unknown`)', UNKNOWN, 'unknown'],
    [
      'an unlimited plan (limit 0)',
      { state: 'unlimited', usedMb: 50_000, limitMb: 0, warn: false, blocked: false, warnFraction: 0.8 },
      'unlimited',
    ],
    [
      'a reading under the line',
      { state: 'ok', usedMb: 100, limitMb: 1024, fraction: 0.1, warn: false, blocked: false, warnFraction: 0.8 },
      'ok',
    ],
  ])('raises no banner for %s, and keeps the served state', async (_label, payload, state) => {
    const { result } = await readPayload(payload);
    expect(result.current.status).toBe('answered');
    expect(classifyStorageUsage(result.current)).toEqual({ case: 'none', state });
  });

  it('fails soft to `unavailable` on a non-2xx, which is NOT the answered no-banner case', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, headers: new Headers() } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStorageUsageReading({ apiBase: '/api/v1' }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.reading).toBeNull();
    expect(classifyStorageUsage(result.current)).toEqual({ case: 'unavailable' });
  });

  it.each([
    ['an undeclared state', { ...UNKNOWN, state: 'nearly-full' }],
    ['a non-boolean warn', { ...UNKNOWN, warn: 'yes' }],
    ['a missing blocked', { state: 'unknown', warn: false, warnFraction: 0.8 }],
    ['a negative usedMb', { ...UNKNOWN, usedMb: -1 }],
    ['a string limitMb', { ...UNKNOWN, limitMb: '1024' }],
    ['a banner verdict without its numbers', { state: 'warning', warn: true, blocked: false, warnFraction: 0.8 }],
    ['a blocked verdict without a limit', { state: 'exhausted', usedMb: 2000, warn: true, blocked: true, warnFraction: 0.8 }],
  ])('refuses %s rather than coercing it', async (_label, payload) => {
    const { result } = await readPayload(payload);
    expect(result.current.status).toBe('unavailable');
    expect(classifyStorageUsage(result.current)).toEqual({ case: 'unavailable' });
  });

  it('is inert when disabled — no request at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStorageUsageReading({ apiBase: '/api/v1', enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(classifyStorageUsage(result.current)).toEqual({ case: 'pending' });
  });

  // One response, two halves: the storage banner and the read-rate report mount
  // together and must not issue the same request twice.
  it('shares ONE request with the read-rate reading, and each hook reads its own half', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        state: 'warning',
        usedMb: 900,
        limitMb: 1024,
        fraction: 0.88,
        warn: true,
        blocked: false,
        warnFraction: 0.8,
        readRate: { state: 'anomalous', readsPerWrite: 700, ratioThreshold: 500 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => ({
      storage: useStorageUsageReading({ apiBase: '/api/v1' }),
      readRate: useReadRateReading({ apiBase: '/api/v1' }),
    }));
    await waitFor(() => {
      expect(result.current.storage.status).toBe('answered');
      expect(result.current.readRate.status).toBe('measured');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(classifyStorageUsage(result.current.storage).case).toBe('warning');
    expect(result.current.readRate.reading).toEqual({
      state: 'anomalous',
      readsPerWrite: 700,
      ratioThreshold: 500,
    });
  });

  // The shared reader keeps no ANSWER: once a request settles, asking again is
  // a new request, so `refetch` still means "look again".
  it('issues a new request on refetch once the first one settled', async () => {
    const { result, fetchMock } = await readPayload(UNKNOWN);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('answered'));
  });

  it('classifyStorageUsage gives every distinct fact its own value', () => {
    const cases: Array<[StorageUsageSnapshot, string]> = [
      [{ status: 'idle', reading: null }, 'pending'],
      [{ status: 'loading', reading: null }, 'pending'],
      [{ status: 'unavailable', reading: null }, 'unavailable'],
      [{ status: 'answered', reading: { state: 'unknown', warn: false, blocked: false } }, 'none'],
      [
        { status: 'answered', reading: { state: 'warning', warn: true, blocked: false, usedMb: 1, limitMb: 2 } },
        'warning',
      ],
      [
        { status: 'answered', reading: { state: 'exhausted', warn: true, blocked: true, usedMb: 2, limitMb: 2 } },
        'blocked',
      ],
    ];
    for (const [snapshot, expected] of cases) {
      expect(classifyStorageUsage(snapshot).case).toBe(expected);
    }
  });
});
