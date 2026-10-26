/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression tests for AI-build chat send-failure handling. A rejected chat POST
 * (429 rate-limit / 5xx / network) used to vanish silently — the input cleared,
 * no message appeared, no error showed. These lock in the mechanism that makes a
 * failed send recoverable: the request is tagged (`notSent` + `status`) and the
 * optimistic user bubble is rolled back, so the composer can restore the text +
 * surface a clear error, and reconcile-on-error never suppresses it.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { useObjectChat, sendAwareFetch } from '../useObjectChat';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendAwareFetch', () => {
  it('tags a 429 with status + notSent and preserves the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"rate_limited"}', { status: 429, statusText: 'Too Many Requests' })),
    );
    await expect(sendAwareFetch(API)).rejects.toMatchObject({ status: 429, notSent: true });
    await expect(sendAwareFetch(API)).rejects.toThrow(/rate_limited/);
  });

  it('tags a 5xx with status + notSent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    await expect(sendAwareFetch(API)).rejects.toMatchObject({ status: 503, notSent: true });
  });

  it('tags a network failure as notSent (no status)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(sendAwareFetch(API)).rejects.toMatchObject({ notSent: true });
  });

  it('passes a 2xx response through untouched', async () => {
    const ok = new Response('hi', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => ok));
    await expect(sendAwareFetch(API)).resolves.toBe(ok);
  });
});

describe('useObjectChat send-failure (API mode)', () => {
  it('a 429 send calls onError with notSent+status and rolls back the optimistic user message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"rate_limited"}', { status: 429 })),
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useObjectChat({ api: API, conversationId: 'c1', onError }),
    );

    await act(async () => {
      result.current.sendMessage('please build me an app');
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    const err = onError.mock.calls[0][0] as { notSent?: boolean; status?: number };
    expect(err.notSent).toBe(true);
    expect(err.status).toBe(429);

    // The never-sent turn must NOT linger as a "sent" user bubble.
    await waitFor(() => {
      expect(
        result.current.messages.find((m) => m.content === 'please build me an app'),
      ).toBeUndefined();
    });
  });

  it('a network failure also surfaces a notSent error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useObjectChat({ api: API, conversationId: 'c1', onError }),
    );

    await act(async () => {
      result.current.sendMessage('hi');
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0][0] as { notSent?: boolean }).notSent).toBe(true);
  });
});
