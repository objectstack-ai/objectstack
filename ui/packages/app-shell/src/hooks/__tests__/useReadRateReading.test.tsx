/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useReadRateReading (objectui#9954) — reads the tenant runtime's `readRate`
 * off `GET /api/v1/usage/storage` and keeps the three "no banner" answers apart.
 *
 * The behaviours pinned here are contract properties of the reading, not
 * rendering choices:
 *   - an ABSENT `readRate` is `'unmeasured'`, never the same value as a
 *     measured `'ok'` — the card's property (1);
 *   - an ABSENT `readsPerWrite` survives parsing as an absent key, because its
 *     absence IS the no-writes case — the card's property (2);
 *   - the verdict is read, not re-derived — a reading whose `readsPerWrite` sits
 *     far above `ratioThreshold` but whose `state` says `'ok'` stays `'ok'` —
 *     the card's property (3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useReadRateReading,
  classifyReadRate,
  resolveRuntimeApiBase,
  type ReadRateSnapshot,
} from '../useReadRateReading';

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
  const { result } = renderHook(() => useReadRateReading({ apiBase: '/api/v1' }));
  await waitFor(() => expect(result.current.status).not.toBe('loading'));
  return { result, fetchMock };
}

describe('useReadRateReading', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches {apiBase}/usage/storage and exposes the reading', async () => {
    const { result, fetchMock } = await readPayload({
      readRate: { state: 'anomalous', readsPerWrite: 4210.5, ratioThreshold: 500 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/usage/storage',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.status).toBe('measured');
    expect(result.current.reading).toEqual({
      state: 'anomalous',
      readsPerWrite: 4210.5,
      ratioThreshold: 500,
    });
  });

  // Property (1). An absent `readRate` means the control plane reported NO
  // reading. If this ever equals the measured-and-under-the-line answer, the two
  // different answers to "why does my environment show no banner" have been
  // collapsed into one.
  it('reports an ABSENT readRate as `unmeasured`, which is NOT the measured `ok` answer', async () => {
    const absent = await readPayload({ storage: { bytes: 1 } });
    expect(absent.result.current.status).toBe('unmeasured');
    expect(absent.result.current.reading).toBeNull();

    vi.unstubAllGlobals();
    const measuredOk = await readPayload({
      readRate: { state: 'ok', readsPerWrite: 3, ratioThreshold: 500 },
    });
    expect(measuredOk.result.current.status).toBe('measured');
    expect(measuredOk.result.current.reading?.state).toBe('ok');

    expect(absent.result.current.status).not.toBe(measuredOk.result.current.status);
    expect(classifyReadRate(absent.result.current)).toBe('unmeasured');
    expect(classifyReadRate(measuredOk.result.current)).toBe('ok');
  });

  // Property (2). The key must survive parsing as ABSENT — not defaulted, not
  // coerced to a number — because its absence is the no-writes reading.
  it('keeps an ABSENT readsPerWrite absent, in both spellings, and classifies it as the no-writes case', async () => {
    const omitted = await readPayload({
      readRate: { state: 'anomalous', ratioThreshold: 500 },
    });
    expect(omitted.result.current.reading).toEqual({ state: 'anomalous', ratioThreshold: 500 });
    expect(omitted.result.current.reading).not.toHaveProperty('readsPerWrite');
    expect(classifyReadRate(omitted.result.current)).toBe('anomalous-no-writes');

    vi.unstubAllGlobals();
    // A serializer that spells an omitted optional as JSON `null` must reach the
    // same case — reading it as off-contract would HIDE the worst reading.
    const nulled = await readPayload({
      readRate: { state: 'anomalous', readsPerWrite: null, ratioThreshold: 500 },
    });
    expect(classifyReadRate(nulled.result.current)).toBe('anomalous-no-writes');
  });

  // Property (3). `state` is the control plane's verdict. A ratio far above the
  // threshold with `state: 'ok'` must stay `ok`: re-deriving the verdict here
  // would flip it.
  it('reads `state` as the verdict and never re-derives it from the ratio', async () => {
    const { result } = await readPayload({
      readRate: { state: 'ok', readsPerWrite: 99_999, ratioThreshold: 500 },
    });
    expect(result.current.reading?.state).toBe('ok');
    expect(classifyReadRate(result.current)).toBe('ok');
  });

  it('fails soft to `unavailable` on a non-2xx, and does NOT claim `unmeasured`', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, headers: new Headers() } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReadRateReading({ apiBase: '/api/v1' }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.reading).toBeNull();
    expect(classifyReadRate(result.current)).toBe('unavailable');
  });

  it('refuses an off-contract readRate rather than coercing it', async () => {
    const badState = await readPayload({
      readRate: { state: 'degraded', readsPerWrite: 3, ratioThreshold: 500 },
    });
    expect(badState.result.current.status).toBe('unavailable');

    vi.unstubAllGlobals();
    const noThreshold = await readPayload({ readRate: { state: 'anomalous' } });
    expect(noThreshold.result.current.status).toBe('unavailable');

    vi.unstubAllGlobals();
    const badRatio = await readPayload({
      readRate: { state: 'anomalous', readsPerWrite: 'lots', ratioThreshold: 500 },
    });
    expect(badRatio.result.current.status).toBe('unavailable');
  });

  it('is inert when disabled — no request at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReadRateReading({ apiBase: '/api/v1', enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(classifyReadRate(result.current)).toBe('pending');
  });

  it('resolveRuntimeApiBase trims a trailing slash off an explicit base', () => {
    expect(resolveRuntimeApiBase('/api/v1/')).toBe('/api/v1');
    expect(resolveRuntimeApiBase('/api/v1')).toBe('/api/v1');
  });

  it('classifyReadRate gives every distinct fact its own value', () => {
    const cases: Array<[ReadRateSnapshot, string]> = [
      [{ status: 'idle', reading: null }, 'pending'],
      [{ status: 'loading', reading: null }, 'pending'],
      [{ status: 'unavailable', reading: null }, 'unavailable'],
      [{ status: 'unmeasured', reading: null }, 'unmeasured'],
      [{ status: 'measured', reading: { state: 'ok', readsPerWrite: 2, ratioThreshold: 500 } }, 'ok'],
      [
        { status: 'measured', reading: { state: 'anomalous', readsPerWrite: 900, ratioThreshold: 500 } },
        'anomalous-ratio',
      ],
      [
        { status: 'measured', reading: { state: 'anomalous', ratioThreshold: 500 } },
        'anomalous-no-writes',
      ],
    ];
    for (const [snapshot, expected] of cases) {
      expect(classifyReadRate(snapshot)).toBe(expected);
    }
    // The three "renders nothing" answers are three values, never one.
    expect(new Set(['unavailable', 'unmeasured', 'ok']).size).toBe(3);
  });
});
