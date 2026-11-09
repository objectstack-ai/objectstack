// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30223 — the conversation list (`/_console/ai/build/…` left rail)
 * previews the latest user message. The follow-up turn the chat sends the model
 * after 确认 / 取消 is stored as one, so the preview showed 「[HITL pa_…] The
 * operator approved …」. The preview now reads past it to what the person asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useConversationList } from '../useConversationList';

const API_BASE = 'http://ai.test/api/v1/ai';
const ASK = '把这条状态改成 Active';
const CONTINUATION =
  '[HITL pa_8cf40802-901e-44ae-9610-bcaac8935d3b] The operator approved the `update_record` call. ' +
  'It executed successfully with result: {"statu';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useConversationList — the preview skips the HITL continuation (objectstack#30223)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews the person\'s last ask, not the continuation stored after it; an ordinary row is unchanged', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        conversations: [
          {
            id: 'conv-confirmed',
            title: '修改客户状态',
            updatedAt: '2026-11-05T03:00:00.000Z',
            messages: [
              { role: 'user', content: ASK },
              { role: 'assistant', content: [{ type: 'text', text: '请在上方卡片确认。' }] },
              { role: 'user', content: CONTINUATION },
              { role: 'assistant', content: '已将状态改为 Active。' },
            ],
          },
          {
            // CONTROL: no confirm in this conversation.
            id: 'conv-plain',
            title: '查询',
            updatedAt: '2026-11-05T02:00:00.000Z',
            messages: [
              { role: 'user', content: 'How many leads?' },
              { role: 'assistant', content: '12' },
              { role: 'user', content: [{ type: 'text', text: 'And how many are open?' }] },
            ],
          },
          {
            // Only a continuation and no typed ask to fall back to: no preview,
            // rather than the continuation.
            id: 'conv-only-continuation',
            title: '旧对话',
            updatedAt: '2026-11-05T01:00:00.000Z',
            messages: [{ role: 'user', content: CONTINUATION }],
            preview: CONTINUATION,
          },
        ],
      }),
    );

    const { result } = renderHook(() => useConversationList({ userId: 'u1', apiBase: API_BASE }));
    await waitFor(() => expect(result.current.conversations).toHaveLength(3));

    const byId = new Map(result.current.conversations.map((c) => [c.id, c]));
    expect(byId.get('conv-confirmed')?.preview).toBe(ASK);
    expect(byId.get('conv-plain')?.preview).toBe('And how many are open?');
    expect(byId.get('conv-only-continuation')?.preview).toBeUndefined();
  });
});
