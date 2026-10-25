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
      { credentials: 'include' },
    );
  });
});
