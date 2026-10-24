/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for the shared ADR-0013 D2 reconcile-on-error wiring used by every
 * chat surface (AiChatPage + console floating chatbot). The pure decision is
 * tested in console/ai/__tests__/reconcileTurn.test.ts; here we test the hook's
 * branching: completed turn → re-hydrate + suppress; incomplete → surface.
 */
import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../useChatConversation', () => ({
  fetchConversation: vi.fn(async () => ({ id: 'c1', messages: [] })),
  toUIMessages: vi.fn((m: unknown) => m ?? []),
}));
vi.mock('../../console/ai/reconcileTurn', () => ({
  isReconcilableCompletedTurn: vi.fn(),
}));

import { useReconcileOnError } from '../useReconcileOnError';
import { fetchConversation } from '../useChatConversation';
import { isReconcilableCompletedTurn } from '../../console/ai/reconcileTurn';

const API = 'https://x/api/v1/ai/agents/metadata_assistant/chat';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useReconcileOnError', () => {
  it('completed turn → re-hydrates via setMessages and suppresses the error', async () => {
    (isReconcilableCompletedTurn as any).mockReturnValue(true);
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useReconcileOnError({ chatApi: API, conversationId: 'c1' }),
    );
    result.current.setMessagesRef.current = setMessages;

    await act(async () => {
      await result.current.handleChatError(new Error('stream dropped'));
    });

    expect(fetchConversation).toHaveBeenCalledWith('https://x/api/v1/ai', 'c1');
    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(result.current.errorSuppressed).toBe(true);
  });

  it('incomplete turn → does NOT suppress and does NOT re-hydrate', async () => {
    (isReconcilableCompletedTurn as any).mockReturnValue(false);
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useReconcileOnError({ chatApi: API, conversationId: 'c1' }),
    );
    result.current.setMessagesRef.current = setMessages;

    await act(async () => {
      await result.current.handleChatError(new Error('boom'));
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(result.current.errorSuppressed).toBe(false);
  });

  it('notSent failure (429/network) → never suppresses and never re-fetches', async () => {
    // A request rejected before any reply streamed must SURFACE (composer shows
    // the error + restores the input). Without the guard a 429 looked like a
    // completed turn (the thread still ends with the prior assistant reply) and
    // got silently reconciled away — the reported "message vanished" bug.
    (isReconcilableCompletedTurn as any).mockReturnValue(true);
    const setMessages = vi.fn();
    const { result } = renderHook(() =>
      useReconcileOnError({ chatApi: API, conversationId: 'c1' }),
    );
    result.current.setMessagesRef.current = setMessages;

    const err = Object.assign(new Error('Too Many Requests'), { notSent: true, status: 429 });
    await act(async () => {
      await result.current.handleChatError(err);
    });

    expect(fetchConversation).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
    expect(result.current.errorSuppressed).toBe(false);
  });

  it('no conversationId → no fetch, never suppresses', async () => {
    const { result } = renderHook(() =>
      useReconcileOnError({ chatApi: API, conversationId: undefined }),
    );
    await act(async () => {
      await result.current.handleChatError(new Error('boom'));
    });
    expect(fetchConversation).not.toHaveBeenCalled();
    expect(result.current.errorSuppressed).toBe(false);
  });

  it('resetSuppression clears a prior suppression', async () => {
    (isReconcilableCompletedTurn as any).mockReturnValue(true);
    const { result } = renderHook(() =>
      useReconcileOnError({ chatApi: API, conversationId: 'c1' }),
    );
    result.current.setMessagesRef.current = vi.fn();
    await act(async () => {
      await result.current.handleChatError(new Error('x'));
    });
    expect(result.current.errorSuppressed).toBe(true);
    act(() => result.current.resetSuppression());
    expect(result.current.errorSuppressed).toBe(false);
  });
});
