// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression tests for the AI-build empty-state FIRST-message drop.
 *
 * On a fresh `/ai/:agent` the composer goes live before `POST /conversations`
 * has minted the conversation id, and `<ChatPane>` is keyed on that id — so the
 * instant it resolves the pane REMOUNTS. A first message submitted in that
 * window used to die with the doomed pane: its optimistic bubble was discarded
 * and the just-started `…/chat` request was aborted before it reached the wire,
 * so the message vanished silently (input cleared, no bubble, no error, no
 * `…/chat`). The user had to send a second time.
 *
 * Distinct from the #2047 path, where `…/chat` WAS sent and then failed
 * (429/5xx/network) — there is a failure to recover from. Here the send never
 * happened, so these lock in that `useDeferredFirstSend` STASHES such a send and
 * REPLAYS it the moment a conversation id exists — including across the pane
 * remount — so `doSend` (which fires `…/chat`) is reliably invoked and the
 * message is never dropped.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useDeferredFirstSend, type PendingFirstMessage } from '../AiChatPage';
import { useChatConversation } from '../../../hooks/useChatConversation';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

/**
 * objectstack#32031 — the replay fires on the next task, not inside the effect
 * (a send issued inside it is stopped by the chat runtime's own effect
 * teardown under StrictMode). Let that task run.
 */
async function flushReplay(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setup(initial: { chatApi?: string; conversationId?: string }) {
  const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = { current: null };
  const doSend = vi.fn();
  const { result, rerender } = renderHook(
    ({ chatApi, conversationId }) =>
      useDeferredFirstSend({ chatApi, conversationId, pendingRef, doSend }),
    { initialProps: { chatApi: initial.chatApi, conversationId: initial.conversationId } },
  );
  return { result, rerender, pendingRef, doSend };
}

describe('useDeferredFirstSend', () => {
  it('defers a send made before the conversation id exists, then replays it once it lands', async () => {
    const { result, rerender, pendingRef, doSend } = setup({ chatApi: API, conversationId: undefined });

    // Empty-state first send: id not minted yet → stash, do NOT send (a send now
    // would be a convId-less /chat or aborted by the imminent remount).
    act(() => result.current('please build me a CRM'));
    expect(doSend).not.toHaveBeenCalled();
    expect(pendingRef.current).toEqual({ content: 'please build me a CRM', files: undefined });

    // POST /conversations resolved → the stashed message is replayed exactly once.
    act(() => rerender({ chatApi: API, conversationId: 'c1' }));
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('please build me a CRM', undefined);
    expect(pendingRef.current).toBeNull();

    // A later id change (URL mirror / switch) must not re-fire the consumed send.
    act(() => rerender({ chatApi: API, conversationId: 'c2' }));
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  // ADR-0057 P4 follow-up #1 (handoff swallow): the handoff seed sets `pendingRef`
  // OUT OF BAND, and can land AFTER the conversation id already resolved (the
  // async agent-catalog race). Refs don't trigger effects, so the replay would
  // never fire — unless a `pendingSignal` bump re-runs it. This locks that in.
  it('replays a pending message seeded AFTER the id resolved, driven by pendingSignal', async () => {
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = { current: null };
    const doSend = vi.fn();
    const { rerender } = renderHook(
      ({ pendingSignal }) =>
        useDeferredFirstSend({ chatApi: API, conversationId: 'c1', pendingRef, doSend, pendingSignal }),
      { initialProps: { pendingSignal: 0 } },
    );
    // Id already present but nothing seeded yet → no send.
    expect(doSend).not.toHaveBeenCalled();

    // Page seeds the handoff prompt out of band (id already resolved) + bumps the
    // signal → the replay fires exactly once.
    act(() => {
      pendingRef.current = { content: 'handoff prompt', files: undefined };
      rerender({ pendingSignal: 1 });
    });
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('handoff prompt', undefined);
    expect(pendingRef.current).toBeNull();

    // A SECOND handoff (#2) — seed again + bump again → replays again.
    act(() => {
      pendingRef.current = { content: 'second handoff', files: undefined };
      rerender({ pendingSignal: 2 });
    });
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(2);
    expect(doSend).toHaveBeenLastCalledWith('second handoff', undefined);
  });

  // #2450 — mid ask→build transition, a doomed pane (wrong agent binding) must
  // NOT consume the handoff stash: a send issued there dies with the unmount
  // before reaching the wire. A stash stamped `targetAgentRoute: 'build'` is
  // HELD by any non-build pane and replayed only by the build-bound one.
  it('holds a targeted stash in a mismatched-agent pane, replays it in the matching one', async () => {
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = { current: null };
    const doSend = vi.fn();
    const { rerender } = renderHook(
      ({ agentRoute, pendingSignal }) =>
        useDeferredFirstSend({
          chatApi: API,
          conversationId: 'c1',
          pendingRef,
          doSend,
          pendingSignal,
          agentRoute,
        }),
      { initialProps: { agentRoute: 'ask', pendingSignal: 0 } },
    );

    // Handoff seed lands while the pane is still ask-bound (stale window):
    // held untouched — not consumed, not sent.
    act(() => {
      pendingRef.current = { content: 'handoff prompt', targetAgentRoute: 'build' };
      rerender({ agentRoute: 'ask', pendingSignal: 1 });
    });
    await flushReplay();
    expect(doSend).not.toHaveBeenCalled();
    expect(pendingRef.current).not.toBeNull();

    // The pane re-binds to build (transition settled) → replayed exactly once.
    act(() => rerender({ agentRoute: 'build', pendingSignal: 1 }));
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('handoff prompt', undefined);
    expect(pendingRef.current).toBeNull();
  });

  it('an untargeted stash keeps the legacy consume-anywhere behavior', async () => {
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = { current: null };
    const doSend = vi.fn();
    const { rerender } = renderHook(
      ({ pendingSignal }) =>
        useDeferredFirstSend({
          chatApi: API,
          conversationId: 'c1',
          pendingRef,
          doSend,
          pendingSignal,
          agentRoute: 'ask',
        }),
      { initialProps: { pendingSignal: 0 } },
    );
    act(() => {
      pendingRef.current = { content: 'typed by user' };
      rerender({ pendingSignal: 1 });
    });
    await flushReplay();
    expect(doSend).toHaveBeenCalledWith('typed by user', undefined);
  });

  it('sends straight through when a conversation id is already present', () => {
    const { result, pendingRef, doSend } = setup({ chatApi: API, conversationId: 'c1' });

    act(() => result.current('second message'));
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('second message', undefined);
    expect(pendingRef.current).toBeNull();
  });

  it('carries file attachments through the deferral', async () => {
    const { result, rerender, pendingRef, doSend } = setup({ chatApi: API, conversationId: undefined });
    const file = new File(['hi'], 'spec.txt', { type: 'text/plain' });

    act(() => result.current('with a file', [file]));
    expect(doSend).not.toHaveBeenCalled();
    expect(pendingRef.current).toEqual({ content: 'with a file', files: [file] });

    act(() => rerender({ chatApi: API, conversationId: 'c1' }));
    await flushReplay();
    expect(doSend).toHaveBeenCalledWith('with a file', [file]);
  });

  it('local/echo mode (no chatApi) sends immediately so the offline-demo bot still responds', () => {
    const { result, pendingRef, doSend } = setup({ chatApi: undefined, conversationId: undefined });

    act(() => result.current('hello echo'));
    expect(doSend).toHaveBeenCalledWith('hello echo', undefined);
    expect(pendingRef.current).toBeNull();
  });

  // The crux of the bug: the stash lives in the PAGE, so it survives the keyed
  // <ChatPane> remount and the replay fires in the FRESHLY-mounted pane. This
  // harness mirrors that structure — a parent owns the ref + id, the child is
  // keyed on the id (so resolving it unmounts/remounts the child).
  it('replays the first message across the id-keyed pane REMOUNT (reproduces the reported bug)', async () => {
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = { current: null };
    const doSend = vi.fn();
    let mounts = 0;

    function Pane({ conversationId }: { conversationId: string | undefined }) {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      const submit = useDeferredFirstSend({ chatApi: API, conversationId, pendingRef, doSend });
      return (
        <button data-testid="send" onClick={() => submit('first message')}>
          send
        </button>
      );
    }

    function Page() {
      const [conversationId, setConversationId] = React.useState<string | undefined>(undefined);
      return (
        <>
          {/* Keyed exactly like the real <ChatPane>: pending → real id remounts it. */}
          <Pane key={conversationId ?? 'pending'} conversationId={conversationId} />
          <button data-testid="resolve" onClick={() => setConversationId('c1')}>
            resolve
          </button>
        </>
      );
    }

    render(<Page />);
    expect(mounts).toBe(1);

    // Submit while the id is still pending → deferred, nothing sent yet.
    fireEvent.click(screen.getByTestId('send'));
    expect(doSend).not.toHaveBeenCalled();
    expect(pendingRef.current).toEqual({ content: 'first message', files: undefined });

    // Conversation id resolves → the pane REMOUNTS, and the new instance replays
    // the stashed message (this is what used to be silently dropped).
    fireEvent.click(screen.getByTestId('resolve'));
    await flushReplay();
    expect(mounts).toBe(2); // proves the remount actually happened
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('first message', undefined);
    expect(pendingRef.current).toBeNull();
  });
});

// objectstack#32031 — the conversation row is created by the FIRST SEND, not
// on mount. The stash above is what makes that safe: the send waits in the
// page-owned ref while `ensureConversation` mints the row, then replays into
// the remounted pane. These drive the real hook pair over a mocked fetch.
describe('useDeferredFirstSend — the first send creates the conversation (objectstack#32031)', () => {
  const AI_BASE = 'https://example.test/api/v1/ai';
  let fetchMock: ReturnType<typeof vi.fn>;
  const createCount = () =>
    fetchMock.mock.calls.filter(
      (c) => c[0] === `${AI_BASE}/conversations` && (c[1] as RequestInit | undefined)?.method === 'POST',
    ).length;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'conv-1', messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountSurface() {
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = { current: null };
    const doSend = vi.fn();
    function Pane(props: { conversationId: string | undefined; ensure: () => unknown }) {
      const submit = useDeferredFirstSend({
        chatApi: API,
        conversationId: props.conversationId,
        pendingRef,
        doSend,
        ensureConversation: props.ensure,
      });
      return (
        <>
          <button data-testid="send-a" onClick={() => submit('first message')}>a</button>
          <button data-testid="send-b" onClick={() => submit('second message')}>b</button>
        </>
      );
    }
    function Page() {
      const { conversationId, ensureConversation } = useChatConversation({
        userId: 'u1',
        scope: 'ask',
        apiBase: AI_BASE,
      });
      return (
        <>
          <span data-testid="conv">{conversationId ?? 'pending'}</span>
          <Pane key={conversationId ?? 'pending'} conversationId={conversationId} ensure={ensureConversation} />
        </>
      );
    }
    render(<Page />);
    return { pendingRef, doSend };
  }

  it('mounting creates nothing; the first send creates one row and is replayed into it', async () => {
    const { doSend } = mountSurface();
    // Let the mount-time resolve settle: still no row.
    await act(async () => {});
    expect(createCount()).toBe(0);
    expect(screen.getByTestId('conv').textContent).toBe('pending');

    fireEvent.click(screen.getByTestId('send-a'));
    await waitFor(() => expect(screen.getByTestId('conv').textContent).toBe('conv-1'));
    expect(createCount()).toBe(1);
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('first message', undefined);
  });

  it('a fast double submit makes one row and keeps the first message', async () => {
    const { doSend } = mountSurface();
    await act(async () => {});

    fireEvent.click(screen.getByTestId('send-a'));
    fireEvent.click(screen.getByTestId('send-b'));
    await waitFor(() => expect(screen.getByTestId('conv').textContent).toBe('conv-1'));
    expect(createCount()).toBe(1);
    await flushReplay();
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(doSend).toHaveBeenCalledWith('first message', undefined);
  });

  it('the replayed first send survives the effect teardown StrictMode runs on mount', async () => {
    // The chat runtime (`useChat`) stops its in-flight request in an effect
    // cleanup, and StrictMode runs that cleanup right after the first effect
    // pass on mount. This pane models exactly that: a send in flight when the
    // teardown runs is aborted. Replaying inside the effect lost the message.
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = {
      current: { content: 'first message' },
    };
    const chat = { inflight: null as string | null, aborted: [] as string[] };
    function Pane() {
      React.useEffect(
        () => () => {
          if (chat.inflight) chat.aborted.push(chat.inflight);
          chat.inflight = null;
        },
        [],
      );
      useDeferredFirstSend({
        chatApi: API,
        conversationId: 'conv-1',
        pendingRef,
        doSend: (content) => {
          chat.inflight = content;
        },
      });
      return null;
    }
    render(
      <React.StrictMode>
        <Pane />
      </React.StrictMode>,
    );
    await flushReplay();
    expect(chat.aborted).toEqual([]);
    expect(chat.inflight).toBe('first message');
    expect(pendingRef.current).toBeNull();
  });

  it('a stash seeded out of band (the handoff) asks for the conversation itself', async () => {
    const pendingRef: React.MutableRefObject<PendingFirstMessage | null> = {
      current: { content: 'handoff prompt' },
    };
    const doSend = vi.fn();
    const ensure = vi.fn();
    renderHook(() =>
      useDeferredFirstSend({ chatApi: API, conversationId: undefined, pendingRef, doSend, ensureConversation: ensure }),
    );
    expect(ensure).toHaveBeenCalled();
    expect(doSend).not.toHaveBeenCalled();
    expect(pendingRef.current).toEqual({ content: 'handoff prompt' });
  });
});
