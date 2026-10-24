/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12508 — `useAiModels` asks `GET …/ai/models` once per session on a
 * server without an AI service.
 *
 * Measured on the card's session: a framework without `@objectstack/service-ai`
 * answers `/ai/models` with 501 Not Implemented, and the hook treated it as a
 * cold-boot miss: five retries 1.2 s apart, then the same again on every mount
 * (each route change). A 501 does not change while the page lives, so it is
 * now remembered for the session: no retry, no re-ask on a later mount, an
 * empty picker and no error.
 *
 * Pinned:
 *  - a 501: one request, none after the retry window, none on a remount;
 *  - CONTROL: a 503 (cold boot) is still retried;
 *  - CONTROL: a 200 still fills the picker.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAiModels, resetAiModelsSession } from '../useAiModels';

const API = '/api/v1/ai';

let answer: () => Response;
const fetchMock = vi.fn(async () => answer());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Past the hook's whole retry window (five retries, 1.2 s apart). */
async function pastRetries() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAiModelsSession();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useAiModels — a 501 means no AI service for the session (objectui#12508)', () => {
  it('asks once, never retries, and does not ask again on a later mount', async () => {
    answer = () => json(501, { success: false, error: { code: 'NOT_IMPLEMENTED' } });
    const first = renderHook(() => useAiModels({ apiBase: API }));
    await pastRetries();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.result.current).toMatchObject({ models: [], defaultModelId: undefined, isLoading: false, error: undefined });
    first.unmount();

    // A route change remounts the pane: the session already knows.
    const second = renderHook(() => useAiModels({ apiBase: API }));
    await pastRetries();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.result.current.models).toEqual([]);
    second.unmount();
  });

  it('CONTROL: a 503 (the cold-boot answer) is still retried', async () => {
    answer = () => json(503, {});
    const hook = renderHook(() => useAiModels({ apiBase: API }));
    await pastRetries();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    hook.unmount();
  });

  it('CONTROL: a 200 still fills the picker', async () => {
    answer = () => json(200, { models: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], defaultModel: 'b' });
    const hook = renderHook(() => useAiModels({ apiBase: API }));
    await pastRetries();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.models).toEqual([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    expect(hook.result.current.defaultModelId).toBe('b');
    hook.unmount();
  });
});
