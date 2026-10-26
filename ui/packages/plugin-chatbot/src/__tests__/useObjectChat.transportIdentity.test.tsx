/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4187 — the transport `useMemo` in `useObjectChat` used to list the
 * caller's `body`/`headers` as deps. Every caller passes a fresh object literal
 * each render, so the memo never hit and a `DefaultChatTransport` was built on
 * every render of every chat surface — once per token batch while streaming.
 *
 * These tests pin BOTH halves of the fix:
 *   1. the transport is built once, however often the caller re-renders;
 *   2. what a send actually observes afterwards — `body`/`headers` are now read
 *      through refs at SEND time, so the values are those of the most recent
 *      render rather than of the last render that happened to rebuild the
 *      transport. That timing shift is the one real behavioural difference
 *      between this fix and call-site memoization, and it is not visible by
 *      reading the diff.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useObjectChat } from '../useObjectChat';

/** Counts `new DefaultChatTransport(...)` across a test. */
const transportSpy = vi.hoisted(() => ({ constructions: 0 }));

// Count constructions without changing behaviour: a construct-trap Proxy around
// the real class, so the hook still talks to the genuine transport.
vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as { [key: string]: unknown };
  const Real = actual.DefaultChatTransport as new (...args: never[]) => object;
  const Counting = new Proxy(Real, {
    construct(target, args) {
      transportSpy.constructions += 1;
      return Reflect.construct(target, args);
    },
  });
  return { ...actual, DefaultChatTransport: Counting };
});

const API = 'https://example.test/api/v1/ai/agents/build/chat';

type AnyRecord = { [key: string]: unknown };
type FetchMock = { mock: { calls: unknown[][] } };

/** A minimal, well-formed Vercel AI UI-message data stream so a send completes. */
function dataStreamResponse(): Response {
  const body =
    'data: {"type":"start"}\n\n' + 'data: {"type":"finish"}\n\n' + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  });
}

/** The JSON body of a captured chat POST. */
function bodyOf(fetchMock: FetchMock, callIndex: number): AnyRecord {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? '{}') as AnyRecord;
}

/** One request header off a captured chat POST, however the SDK shaped it. */
function headerOf(fetchMock: FetchMock, callIndex: number, name: string): string | null {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { headers?: HeadersInit } | undefined;
  return new Headers(init?.headers ?? {}).get(name);
}

beforeEach(() => {
  transportSpy.constructions = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useObjectChat — transport identity (#4187)', () => {
  it('builds ONE transport across renders that pass fresh body/headers literals', () => {
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useObjectChat({
          api: API,
          conversationId: 'build_1',
          // Fresh identity on every render — the shape every caller uses today
          // (the AI page's chat pane builds its `body.context` inline).
          body: { context: { activeApp: 'AI', tick } },
          headers: { 'x-oui-tick': String(tick) },
        }),
      { initialProps: { tick: 0 } },
    );

    expect(transportSpy.constructions).toBe(1);

    rerender({ tick: 1 });
    rerender({ tick: 2 });
    rerender({ tick: 3 });

    // Without the fix this is 4 — one construction per render.
    expect(transportSpy.constructions).toBe(1);
  });

  it('still rebuilds the transport when a memoized dep really changes', () => {
    const { rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) =>
        useObjectChat({ api: API, conversationId, body: { context: {} } }),
      { initialProps: { conversationId: 'build_1' } },
    );

    expect(transportSpy.constructions).toBe(1);
    rerender({ conversationId: 'build_2' });
    expect(transportSpy.constructions).toBe(2);
  });

  it('a send carries the body/headers of the MOST RECENT render', async () => {
    const fetchMock = vi.fn(async () => dataStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useObjectChat({
          api: API,
          conversationId: 'build_1',
          body: { context: { tick } },
          headers: { 'x-oui-tick': String(tick) },
        }),
      { initialProps: { tick: 1 } },
    );

    rerender({ tick: 2 });
    rerender({ tick: 3 });

    await act(async () => {
      result.current.sendMessage('hello');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect((bodyOf(fetchMock as unknown as FetchMock, 0).context as AnyRecord).tick).toBe(3);
    expect(headerOf(fetchMock as unknown as FetchMock, 0, 'x-oui-tick')).toBe('3');
  });

  it('reads `body` at SEND time, not at transport-construction time', async () => {
    const fetchMock = vi.fn(async () => dataStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    // One STABLE object identity for the whole test. With a stable identity the
    // memo never re-ran even before this change, so the value a send observes is
    // decided purely by WHEN it is read: the old code spread `body` into the
    // transport at CONSTRUCTION time and froze `tick: 1`; the ref is spread at
    // SEND time. (Mutating a prop is not endorsed here — it is simply the only
    // externally observable probe of the read timing.)
    const stableBody: { tick: number } = { tick: 1 };

    const { result } = renderHook(() =>
      useObjectChat({ api: API, conversationId: 'build_1', body: stableBody }),
    );

    stableBody.tick = 2;

    await act(async () => {
      result.current.sendMessage('hello');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(bodyOf(fetchMock as unknown as FetchMock, 0).tick).toBe(2);
  });

  it('keeps the hook-owned keys winning over the caller body', async () => {
    const fetchMock = vi.fn(async () => dataStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useObjectChat({
        api: API,
        conversationId: 'build_1',
        model: 'claude-sonnet',
        systemPrompt: 'be brief',
        // A caller body that tries to shadow every hook-owned key.
        body: { conversationId: 'spoofed', model: 'spoofed', systemPrompt: 'spoofed', stream: false },
      }),
    );

    await act(async () => {
      result.current.sendMessage('hello');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const sent = bodyOf(fetchMock as unknown as FetchMock, 0);
    expect(sent.conversationId).toBe('build_1');
    expect(sent.model).toBe('claude-sonnet');
    expect(sent.systemPrompt).toBe('be brief');
    expect(sent.stream).toBe(true);
  });
});
