// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useConversationList } from '../useConversationList';

const API_BASE = 'http://ai.test/api/v1/ai';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useConversationList', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses conversation detail messages as the title fallback for placeholder titles', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          conversations: [
            {
              id: 'conv-a',
              title: '新对话',
              updatedAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'conv-a',
          title: '新对话',
          updatedAt: '2025-01-01T00:00:00.000Z',
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'How many users are in the system?' }],
            },
          ],
        }),
      );

    const { result } = renderHook(() =>
      useConversationList({ userId: 'u1', apiBase: API_BASE }),
    );

    await waitFor(() =>
      expect(result.current.conversations[0]?.preview).toBe('How many users are in the system?'),
    );

    expect(result.current.conversations[0]?.title).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/conversations/conv-a`,
      // The authenticated fetch hands the wire a `Headers` (the bearer, when one is stored).
      { credentials: 'include', headers: expect.any(Headers) },
    );
  });
});

describe('useConversationList selectBackfillRows (objectstack#37959)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads details only for the rows the caller selects, and fills their previews', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, updatedAt: `2025-01-0${i + 1}T00:00:00.000Z` }));
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/conversations?limit=')) return jsonResponse({ conversations: rows });
      const id = url.split('/conversations/')[1];
      return jsonResponse({ id, messages: [{ role: 'user', content: `Question ${id}` }] });
    });

    const { result } = renderHook(() =>
      useConversationList({
        userId: 'u1',
        apiBase: API_BASE,
        selectBackfillRows: (sorted) => sorted.filter((row) => row.id === 'b' || row.id === 'd'),
      }),
    );

    await waitFor(() => expect(result.current.conversations.find((r) => r.id === 'b')?.preview).toBe('Question b'));
    const details = fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.includes('/conversations/'));
    expect(details.sort()).toEqual([`${API_BASE}/conversations/b`, `${API_BASE}/conversations/d`]);
    expect(result.current.conversations.map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(result.current.conversations.find((r) => r.id === 'c')?.preview).toBeUndefined();
  });
});
