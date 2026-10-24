/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useAiUsage (ADR-0057 #8) — fetches the D5-safe usage fractions of the ONE AI
 * quota pool (objectui#8524), is inert without an apiBase, fails soft on a
 * non-2xx / missing endpoint, and refetches on the chat engine's post-turn / 429
 * nudge. The reader is strict: `{ pool, breakdown? }` and nothing else.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAiUsage } from '../useAiUsage';
import { AI_USAGE_REFRESH_EVENT } from '@object-ui/plugin-chatbot';

const POOL = { planType: 'free', fraction: 0.5, unmetered: false, resetKind: 'weekly', resetsAt: null, upgrade: true, topUp: false };

/** The cloud endpoint's answer since the single-pool ruling: one pool + its read-only split. */
const RESP = { pool: POOL, breakdown: { build: 0.3, dataChat: 0.2 } };

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useAiUsage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches {apiBase}/usage with credentials and exposes the pool and its split', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(RESP));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));

    await waitFor(() => expect(result.current.usage).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/ai/usage',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(result.current.usage).toEqual({ pool: POOL, breakdown: { build: 0.3, dataChat: 0.2 } });
    expect(result.current.error).toBeUndefined();
  });

  // Optional by the upstream ruling (cloud ADR-0015): an absent split is a
  // normal reading, never the parse-failure branch (objectui#8524).
  it('reads a payload with no `breakdown` as the pool alone — not a parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ pool: POOL })));

    const { result } = renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));

    await waitFor(() => expect(result.current.usage).not.toBeNull());
    expect(result.current.usage).toEqual({ pool: POOL });
    expect(result.current.error).toBeUndefined();
  });

  it('reads a `breakdown` whose members are both null (split not measured) as a normal reading', async () => {
    const body = { pool: { ...POOL, fraction: null }, breakdown: { build: null, dataChat: null } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));

    const { result } = renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));

    await waitFor(() => expect(result.current.usage).not.toBeNull());
    expect(result.current.usage).toEqual(body);
    expect(result.current.error).toBeUndefined();
  });

  // The strict reader, pinned: the retired per-meter answer is not a second
  // dialect this hook understands. It parses to `null` and says so in `error`.
  it('does not read the retired per-meter `{ meters }` answer — usage null, error set', async () => {
    const meter = { planType: 'free', fraction: 0.5, unmetered: false, resetKind: 'daily', resetsAt: null, upgrade: true, topUp: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ meters: { build: meter, dataChat: meter } })));

    const { result } = renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.usage).toBeNull();
  });

  it('does not read a `breakdown` whose members are not fractions — usage null, error set', async () => {
    const body = { pool: POOL, breakdown: { build: '30%', dataChat: 0.2 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));

    const { result } = renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.usage).toBeNull();
  });

  it('fails soft on a non-2xx (endpoint absent on an older backend) — usage stays null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.usage).toBeNull();
  });

  it('is inert without an apiBase (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAiUsage({ apiBase: undefined }));
    // give any effect a tick
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.usage).toBeNull();
  });

  it('refetches on the AI_USAGE_REFRESH_EVENT nudge (post-turn / 429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(RESP));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAiUsage({ apiBase: '/api/v1/ai' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new CustomEvent(AI_USAGE_REFRESH_EVENT));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
