import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHitlInChat } from '../useHitlInChat';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const baseMessage = (pendingActionId: string, toolCallId = 'tc-1'): ChatbotEnhancedMessage => ({
  id: 'm-1',
  role: 'assistant',
  content: '',
  toolInvocations: [
    {
      toolCallId,
      toolName: 'action_delete_task',
      state: 'approval-requested',
      args: { id: 't1' },
      result: { status: 'pending_approval', pendingActionId },
      pendingActionId,
    },
  ],
});

describe('useHitlInChat', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fires continueConversation with an executed-outcome prompt on approve', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      // The approve wire response, exactly: `{ status, result?, error? }` and no
      // `id` (spec `ApproveAiPendingActionResponseSchema`; objectui#3783). The
      // `pa_42` the prompt below carries comes from the message index, not from
      // this payload — which is why the old `id: string` promise on
      // `ApproveOutcome` was never load-bearing here and stayed invisible.
      text: async () => JSON.stringify({
        status: 'executed',
        result: { deleted: 1, taskId: 't1' },
      }),
    } as Response);

    const continueConversation = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({
        messages: [baseMessage('pa_42')],
        apiBase: 'http://localhost:3004/api/v1/ai',
        continueConversation,
      }),
    );

    await act(async () => {
      await result.current.decide('tc-1', true);
    });

    await waitFor(() => expect(continueConversation).toHaveBeenCalledTimes(1));
    const [prompt, ctx] = continueConversation.mock.calls[0];
    expect(prompt).toContain('[HITL pa_42]');
    expect(prompt).toContain('action_delete_task');
    expect(prompt).toContain('approved');
    expect(prompt).toContain('"deleted":1');
    expect(ctx).toMatchObject({
      toolCallId: 'tc-1',
      pendingActionId: 'pa_42',
      decision: 'approved',
      toolName: 'action_delete_task',
    });
  });

  it('fires continueConversation with a rejection prompt that includes the reason', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ id: 'pa_42', status: 'rejected' }),
    } as Response);

    const continueConversation = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({
        messages: [baseMessage('pa_42')],
        apiBase: '/api/v1/ai',
        continueConversation,
      }),
    );

    await act(async () => {
      await result.current.decide('tc-1', false, 'too risky');
    });

    await waitFor(() => expect(continueConversation).toHaveBeenCalledTimes(1));
    const [prompt] = continueConversation.mock.calls[0];
    expect(prompt).toContain('rejected');
    expect(prompt).toContain('too risky');
  });

  it('does NOT continue when execution failed', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'failed', error: 'boom' }),
    } as Response);

    const continueConversation = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({
        messages: [baseMessage('pa_42')],
        continueConversation,
      }),
    );

    await act(async () => {
      await result.current.decide('tc-1', true);
    });

    expect(continueConversation).not.toHaveBeenCalled();
    expect(result.current.decisions['tc-1']?.state).toBe('error');
    expect(result.current.decisions['tc-1']?.message).toContain('boom');
  });

  /* ------------------------------------------------------------------ */
  /* objectui#3783 — what `onDecided` actually receives.                 */
  /* ------------------------------------------------------------------ */

  it('hands onDecided the approve payload verbatim — which carries no id', async () => {
    // The drift `ApproveOutcome.id: string` promised: it was REQUIRED on the
    // type and absent from the wire, so a consumer reading `outcome.id` here
    // got `undefined` with no compiler complaint. The type no longer declares
    // it; this pins that the runtime object never had it either.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'executed', result: { deleted: 1 } }),
    } as Response);

    const onDecided = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({ messages: [baseMessage('pa_42')], onDecided }),
    );

    await act(async () => {
      await result.current.decide('tc-1', true);
    });

    expect(onDecided).toHaveBeenCalledTimes(1);
    const [toolCallId, outcome] = onDecided.mock.calls[0];
    expect(toolCallId).toBe('tc-1');
    expect(outcome).toEqual({ status: 'executed', result: { deleted: 1 } });
    expect('id' in (outcome as object)).toBe(false);
  });

  it('hands onDecided the reject payload verbatim — where id IS the wire', async () => {
    // Mirror image: the spec puts `id` on the reject response, so it is present
    // here and `RejectOutcome` declares it.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'rejected', id: 'pa_42' }),
    } as Response);

    const onDecided = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({ messages: [baseMessage('pa_42')], onDecided }),
    );

    await act(async () => {
      await result.current.decide('tc-1', false, 'too risky');
    });

    expect(onDecided).toHaveBeenCalledWith('tc-1', { status: 'rejected', id: 'pa_42' });
  });

  it('still synthesizes the locally-built failure envelope, id included, on a non-2xx', async () => {
    // Behaviour pin for the type-only narrowing (objectui#3783): on a non-2xx
    // there is no decision response at all, so the hook fabricates one. That
    // object has carried `id` since the callback shipped and still does —
    // `ApproveOutcome` simply stopped DECLARING a field the wire never sent.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'ai:approve required' }),
    } as Response);

    const onDecided = vi.fn();
    const continueConversation = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({ messages: [baseMessage('pa_42')], onDecided, continueConversation }),
    );

    await act(async () => {
      await result.current.decide('tc-1', true);
    });

    expect(onDecided).toHaveBeenCalledWith('tc-1', {
      id: 'pa_42',
      status: 'failed',
      error: 'ai:approve required',
    });
    expect(result.current.decisions['tc-1']?.state).toBe('error');
    expect(continueConversation).not.toHaveBeenCalled();
  });

  it('keeps treating an unrecognised status as a success chip, without continuing', async () => {
    // The `else` fallback in `decide()`. objectui#3783 narrowed the TYPES only,
    // and deliberately left this branch alone: `status` is read off an unparsed
    // `Record<string, unknown>`, so the closed enum exerts no exhaustiveness
    // pressure on it and the branch stays reachable for a server that answers
    // outside the spec vocabulary. Pinned as-is so a later behaviour verdict
    // is a visible diff rather than a silent one — including the part the
    // filing report got wrong: `succeeded` goes true, but the continuation
    // prompt builder returns `undefined` for an unknown status, so the
    // conversation is NOT continued.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'quarantined' }),
    } as Response);

    const continueConversation = vi.fn();
    const { result } = renderHook(() =>
      useHitlInChat({ messages: [baseMessage('pa_42')], continueConversation }),
    );

    await act(async () => {
      await result.current.decide('tc-1', true);
    });

    expect(result.current.decisions['tc-1']).toEqual({
      state: 'success',
      message: 'Status: quarantined',
    });
    expect(continueConversation).not.toHaveBeenCalled();
  });

  it('does NOT continue when option is omitted', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'executed', result: 'ok' }),
    } as Response);

    const { result } = renderHook(() =>
      useHitlInChat({
        messages: [baseMessage('pa_42')],
      }),
    );

    await act(async () => {
      await result.current.decide('tc-1', true);
    });

    expect(result.current.decisions['tc-1']?.state).toBe('success');
  });
});
