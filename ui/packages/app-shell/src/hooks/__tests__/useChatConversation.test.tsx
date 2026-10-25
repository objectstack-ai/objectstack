/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
// The chat surface derives the draft/plan affordance cards from the tool result
// via these mappers — round-tripping our cache through them is the real
// production path (live render → cache → cache-fallback reload).
import { uiMessageToChatMessage } from '@object-ui/plugin-chatbot';
// objectui#9232 — the cache round trip is only proven by driving the affordance
// it exists to restore, so the test mounts the real HITL hook over the restored
// messages and presses Approve. `hydratedMessagesToChatMessages` is the
// cache-fallback read this page really performs (AiChatPage feeds it
// `initialMessages` from `useChatConversation`).
import {
  useHitlInChat,
  detectDraftResult,
  detectPendingApproval,
} from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../../console/ai/AiChatPage';

import {
  purgeChatCaches,
  sanitizeChatMessagesForCache,
  toUIMessages,
  useChatConversation,
  writeConversationMessagesCache,
  type HydratedUIMessage,
} from '../useChatConversation';

const API_BASE = 'http://ai.test/api/v1/ai';
const CACHE_PREFIX = 'objectstack:ai-chat-conversation-id';
const MESSAGE_PREFIX = 'objectstack:ai-chat-messages';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useChatConversation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is inert when userId is undefined', async () => {
    const { result } = renderHook(() =>
      useChatConversation({ userId: undefined, apiBase: API_BASE }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.initialMessages).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hydrates from a cached conversation id', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-cached');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'conv-cached',
        messages: [
          { id: 'm1', role: 'user', content: 'hello' },
          { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
        ],
      }),
    );

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-cached');
    expect(result.current.initialMessages).toEqual([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hi back' }] },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-cached`);
  });

  it('preserves non-text message parts during hydration', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-tools');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'conv-tools',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: [
              { type: 'tool-query_data', toolCallId: 'tc1', input: { objectName: 'deal' }, output: { count: 3 }, state: 'output-available' },
              { type: 'text', text: 'Found 3 deals.' },
            ],
          },
        ],
      }),
    );

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.initialMessages[0]?.parts).toEqual([
      { type: 'tool-query_data', toolCallId: 'tc1', input: { objectName: 'deal' }, output: { count: 3 }, state: 'output-available' },
      { type: 'text', text: 'Found 3 deals.' },
    ]);
  });

  it('falls back to the sanitized local message cache when the server has no messages', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-cached');
    writeConversationMessagesCache(
      'conv-cached',
      sanitizeChatMessagesForCache([
        { id: 'u1', role: 'user', content: 'count records' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Found records.',
          toolInvocations: [
            { toolCallId: 'tc1', toolName: 'aggregate_data', state: 'output-available' },
          ],
        },
      ]),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-cached', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.initialMessages).toEqual([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'count records' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Found records.' },
          {
            type: 'tool-aggregate_data',
            toolCallId: 'tc1',
            toolName: 'aggregate_data',
            state: 'output-available',
          },
        ],
      },
    ]);
  });

  it('falls back to POST when cached id 404s', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-missing');
    fetchMock
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-new', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE }),
    );

    await waitFor(() => expect(result.current.conversationId).toBe('conv-new'));
    expect(result.current.initialMessages).toEqual([]);
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBe('conv-new');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-missing`);
    const postCall = fetchMock.mock.calls[1];
    expect(postCall[0]).toBe(`${API_BASE}/conversations`);
    expect((postCall[1] as RequestInit).method).toBe('POST');
  });

  it('creates a new conversation when there is no cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-fresh', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u2', apiBase: API_BASE }),
    );

    await waitFor(() => expect(result.current.conversationId).toBe('conv-fresh'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations`);
    expect(localStorage.getItem(`${CACHE_PREFIX}:u2`)).toBe('conv-fresh');
  });

  it('uses a distinct cache key per scope', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-default');
    localStorage.setItem(`${CACHE_PREFIX}:u1:agent-x`, 'conv-scoped');
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-scoped', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', scope: 'agent-x', apiBase: API_BASE }),
    );

    await waitFor(() => expect(result.current.conversationId).toBe('conv-scoped'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-scoped`);
  });

  it('reset() deletes the current conversation and creates a new one', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-old');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-old', messages: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-new', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE }),
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-old'));

    await act(async () => {
      await result.current.reset();
    });

    expect(result.current.conversationId).toBe('conv-new');
    expect(result.current.initialMessages).toEqual([]);
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBe('conv-new');

    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1][0]).toBe(`${API_BASE}/conversations/conv-old`);
    expect((calls[1][1] as RequestInit).method).toBe('DELETE');
    expect(calls[2][0]).toBe(`${API_BASE}/conversations`);
    expect((calls[2][1] as RequestInit).method).toBe('POST');
  });

  it('swallows fetch errors and clears loading', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u3', apiBase: API_BASE }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.initialMessages).toEqual([]);
  });
});

describe('useChatConversation — forceNew (the sidebar New button)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips the cached conversation and creates a fresh one', async () => {
    localStorage.setItem('objectstack:ai-chat-conversation-id:u1', 'conv-cached');
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-fresh', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE, forceNew: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-fresh');
    // ONE call — the create; the cached id was never even fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    // Cache now points at the fresh conversation.
    expect(localStorage.getItem('objectstack:ai-chat-conversation-id:u1')).toBe('conv-fresh');
  });

  it('overrides the resolved-once guard when flipping forceNew on an open page', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-a', messages: [] }));

    const { result, rerender } = renderHook(
      ({ forceNew }: { forceNew: boolean }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, forceNew }),
      { initialProps: { forceNew: false } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));

    // The user clicks New: same mount, forceNew flips true. The stale id must
    // clear immediately (so the URL-mirroring host can't bounce back), then a
    // fresh conversation resolves.
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-b', messages: [] }));
    rerender({ forceNew: true });
    await waitFor(() => expect(result.current.conversationId).toBe('conv-b'));
    const createCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === `${API_BASE}/conversations` && c[1]?.method === 'POST',
    );
    expect(createCalls.length).toBe(2);
  });

  it('is ignored while an explicit activeId is set (deep link wins)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-x', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE, activeId: 'conv-x', forceNew: true }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-x`);
  });
});

// The floating assistant's ASK surface opens a FRESH thread each visit
// (`resumeMode: 'fresh'`) instead of resuming the last conversation, while
// avoiding empty-row spam by reusing an untouched cached conversation. Its
// "New chat" button calls startNew(), which mints a fresh conversation WITHOUT
// deleting the current one (contrast reset()).
describe('useChatConversation — resumeMode "fresh" + startNew (the floating ask surface)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses an untouched (zero-message) cached conversation rather than minting another', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-empty');
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-empty', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE, resumeMode: 'fresh' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-empty');
    expect(result.current.initialMessages).toEqual([]);
    // GET only — the empty conversation is reused, NOT a fresh POST (no spam).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-empty`);
  });

  it('starts a fresh conversation when the cached one was actually used, leaving it in history', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-used');
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'conv-used',
          messages: [{ id: 'm1', role: 'user', content: 'an earlier question' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-fresh', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE, resumeMode: 'fresh' }),
    );

    await waitFor(() => expect(result.current.conversationId).toBe('conv-fresh'));
    expect(result.current.initialMessages).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-used`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE}/conversations`);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    // The used conversation is NOT deleted; the cache simply repoints to the new one.
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? 'GET');
    expect(methods).not.toContain('DELETE');
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBe('conv-fresh');
  });

  it('startNew() mints a fresh conversation and switches to it without deleting the current one', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-current');
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'conv-current',
          messages: [{ id: 'm1', role: 'user', content: 'hi' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-next', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE }),
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-current'));

    await act(async () => {
      await result.current.startNew();
    });

    expect(result.current.conversationId).toBe('conv-next');
    expect(result.current.initialMessages).toEqual([]);
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBe('conv-next');
    // Crucially: NO delete — the prior thread survives in history.
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? 'GET');
    expect(methods).not.toContain('DELETE');
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE}/conversations`);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
  });
});

// Regression: a cache-fallback reload (server returns no/partial messages →
// `readMessageCache`) must keep the draft/plan affordance cards, not just the
// bare tool header. `sanitizeChatMessagesForCache` used to drop the tool
// `output`, so `mapMessages.detect*` returned undefined for cache-restored
// messages and the "Review N changes / Publish" card, the ADR-0038 verification
// chip, and the "Proposed plan" card silently vanished.
describe('sanitizeChatMessagesForCache — affordance cards survive a cache round-trip', () => {
  // The raw tool outputs exactly as the build/propose tools return them.
  const draftedOutput = {
    status: 'drafted',
    drafted: [
      { type: 'app', name: 'tracker_app' },
      { type: 'object', name: 'task' },
    ],
    summary: 'Built Tracker',
    packageId: 'pkg_1',
    autoPublishable: true,
    failed: [{ type: 'view', name: 'broken' }],
    materialized: true,
    verification: { errors: 0, warnings: 1 },
    issues: [{ severity: 'warning', code: 'lint_x', message: 'Consider X', fix: 'do Y' }],
    nextSteps: ['Replace the sample data', 'Publish from the status panel'],
  };
  const proposedOutput = {
    status: 'blueprint_proposed',
    summary: 'A lightweight tracker',
    counts: { objects: 2, views: 3, dashboards: 1, seedData: 2 },
    questions: ['Track interviews separately?'],
    targetApp: 'recruiting',
    blueprint: {
      assumptions: ['One pipeline for all roles'],
      objects: [
        { name: 'candidate', label: 'Candidate', fields: [{ name: 'full_name' }, { name: 'stage' }] },
        { name: 'job', fields: [{ name: 'title' }] },
      ],
    },
  };

  // An assistant message carrying both an apply_blueprint (drafted) and a
  // propose_blueprint (blueprint_proposed) tool output, as the live stream
  // produces it.
  const liveUiMessage = {
    id: 'a1',
    role: 'assistant' as const,
    parts: [
      { type: 'text', text: 'Done.' },
      {
        type: 'tool-apply_blueprint',
        toolCallId: 'tc-draft',
        state: 'output-available' as const,
        input: {},
        output: draftedOutput,
      },
      {
        type: 'tool-propose_blueprint',
        toolCallId: 'tc-plan',
        state: 'output-available' as const,
        input: {},
        output: proposedOutput,
      },
    ],
  };

  it('preserves draftReview + proposedPlan through sanitize → localStorage → re-map', () => {
    // 1. Live render derives the cards from the raw tool output (baseline).
    const live = uiMessageToChatMessage(liveUiMessage);
    expect(live.toolInvocations?.[0]?.draftReview?.items).toEqual(draftedOutput.drafted);
    // objectui#12724 — the live plan lifts each field's name for the card's
    // field chips; the cache copy below keeps only the count, and the card
    // degrades to the object chips there.
    expect(live.toolInvocations?.[1]?.proposedPlan?.objects).toEqual([
      {
        name: 'candidate',
        label: 'Candidate',
        fieldCount: 2,
        fields: [{ name: 'full_name' }, { name: 'stage' }],
      },
      { name: 'job', fieldCount: 1, fields: [{ name: 'title' }] },
    ]);

    // 2. Cache it, then round-trip through JSON exactly like localStorage does.
    const cached = sanitizeChatMessagesForCache([live]);
    const persisted = JSON.parse(JSON.stringify(cached)) as typeof cached;

    // The cached tool parts keep a compact `output` (no full blueprint).
    const draftPart = persisted[0]?.parts.find((p) => p.type === 'tool-apply_blueprint');
    const planPart = persisted[0]?.parts.find((p) => p.type === 'tool-propose_blueprint');
    expect(draftPart?.output).toMatchObject({ status: 'drafted' });
    expect(planPart?.output).toMatchObject({ status: 'blueprint_proposed' });
    // Leanness: the field definitions are dropped, only the count is kept.
    expect(JSON.stringify(planPart?.output)).not.toContain('full_name');

    // 3. Cache-fallback reload re-derives the cards from the cached output.
    const reloaded = uiMessageToChatMessage(persisted[0]);

    const draftReview = reloaded.toolInvocations?.[0]?.draftReview;
    expect(draftReview).toBeDefined();
    expect(draftReview?.items).toEqual(draftedOutput.drafted);
    expect(draftReview?.summary).toBe('Built Tracker');
    expect(draftReview?.packageId).toBe('pkg_1');
    expect(draftReview?.autoPublishable).toBe(true);
    expect(draftReview?.materialized).toBe(true);
    expect(draftReview?.failedCount).toBe(1);
    expect(draftReview?.verification).toEqual({ errors: 0, warnings: 1 });
    expect(draftReview?.issues).toEqual([
      { severity: 'warning', code: 'lint_x', message: 'Consider X', fix: 'do Y' },
    ]);
    expect(draftReview?.nextSteps).toEqual([
      'Replace the sample data',
      'Publish from the status panel',
    ]);

    const proposedPlan = reloaded.toolInvocations?.[1]?.proposedPlan;
    expect(proposedPlan).toBeDefined();
    expect(proposedPlan?.objects).toEqual([
      { name: 'candidate', label: 'Candidate', fieldCount: 2 },
      { name: 'job', fieldCount: 1 },
    ]);
    expect(proposedPlan?.counts).toEqual({ objects: 2, views: 3, dashboards: 1, seedData: 2 });
    expect(proposedPlan?.questions).toEqual(['Track interviews separately?']);
    expect(proposedPlan?.assumptions).toEqual(['One pipeline for all roles']);
    expect(proposedPlan?.summary).toBe('A lightweight tracker');
    expect(proposedPlan?.targetApp).toBe('recruiting');
  });

  it('does not add an output to plain (non-draft/plan) tool invocations', () => {
    const cached = sanitizeChatMessagesForCache([
      {
        id: 'a1',
        role: 'assistant',
        content: 'Counted.',
        toolInvocations: [{ toolCallId: 'tc1', toolName: 'aggregate_data', state: 'output-available' }],
      },
    ]);
    const toolPart = cached[0]?.parts.find((p) => p.type === 'tool-aggregate_data');
    expect(toolPart).toBeDefined();
    expect('output' in (toolPart as object)).toBe(false);
  });
});

// The server persists conversations in ModelMessage format, where an assistant
// tool CALL is the literal `type:'tool-call'` with the real tool in `toolName`.
// Left as-is the chat step humanizes to "Call"; toUIMessages must remap it to
// the AI SDK UI part type `tool-<toolName>` so the title (and the toolName the
// mapper extracts) reflect the real tool after a clean server-backed reload.
describe('toUIMessages — remaps the ModelMessage tool-call part type', () => {
  it('rewrites assistant tool-call → tool-<toolName> and still merges the tool result', () => {
    const ui = toUIMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'apply_blueprint', input: { goal: 'tracker' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc1',
            output: { status: 'drafted', drafted: [{ type: 'app', name: 'tracker_app' }], summary: 'Built' },
          },
        ],
      },
    ]);

    const part = ui[0]?.parts[0];
    expect(part?.type).toBe('tool-apply_blueprint');
    expect(part?.output).toEqual({
      status: 'drafted',
      drafted: [{ type: 'app', name: 'tracker_app' }],
      summary: 'Built',
    });

    // Through the mapper the tool reads as the real tool, not "call", and its
    // draft card survives because the result merged onto the remapped part.
    const cm = uiMessageToChatMessage(ui[0]);
    expect(cm.toolInvocations?.[0]?.toolName).toBe('apply_blueprint');
    expect(cm.toolInvocations?.[0]?.draftReview?.items).toEqual([{ type: 'app', name: 'tracker_app' }]);
  });

  it('leaves a tool-call without a toolName untouched (no false remap)', () => {
    const ui = toUIMessages([
      { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1' }] },
    ]);
    expect(ui[0]?.parts[0]?.type).toBe('tool-call');
  });
});

// ADR-0057 Amendment A1.b — bind-on-create re-key + the legacy-scope migration
// read. `rekeyScope` re-keys the CURRENT conversation under a new scope
// without re-resolving (build thread binds the package it just minted); the
// legacy fallback lets an app-scoped visit (`app:X:build`) adopt a thread
// still cached under the product-only scope, but ONLY when the host's
// predicate confirms the thread is actually bound to that app.
describe('useChatConversation — A1.b rekeyScope + legacy-scope fallback', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rekeyScope writes the new scope key, keeps the legacy key, and flips conversationScope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-a', messages: [] }));

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope }),
      { initialProps: { scope: 'build' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));
    expect(result.current.conversationScope).toBe('build');

    act(() => result.current.rekeyScope('app:crm:build'));

    // Same conversation id under BOTH keys — the product-only key is
    // deliberately left intact (dock/FAB still resolve through it).
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:app:crm:build`)).toBe('conv-a');
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:build`)).toBe('conv-a');
    rerender({ scope: 'build' }); // conversationScope is ref-backed; read after a render
    expect(result.current.conversationScope).toBe('app:crm:build');
  });

  it('a scope change to the rekeyed scope resumes the SAME conversation without re-resolving', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-a', messages: [] }));

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope }),
      { initialProps: { scope: 'build' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));
    const callsBefore = fetchMock.mock.calls.length;

    // The host rekeys and THEN flips its scope (the ?package= navigate) — the
    // resolve guard must treat the new scope as already-resolved: same id, no
    // create, no refetch, and crucially no setConversationId(undefined) window.
    act(() => result.current.rekeyScope('app:crm:build'));
    rerender({ scope: 'app:crm:build' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-a');
    expect(result.current.conversationScope).toBe('app:crm:build');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    const createCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === `${API_BASE}/conversations` && c[1]?.method === 'POST',
    );
    expect(createCalls.length).toBe(1); // only the original resolve created one
  });

  it('rekeyScope is a no-op before a conversation is resolved', async () => {
    const { result } = renderHook(() =>
      useChatConversation({ userId: undefined, apiBase: API_BASE, scope: 'build' }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.rekeyScope('app:crm:build'));
    expect(localStorage.getItem(`${CACHE_PREFIX}:app:crm:build`)).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX))).toEqual([]);
  });

  it('adopts the legacy-scope thread when the predicate matches (pre-A1.b migration read)', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1:build`, 'conv-legacy');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'conv-legacy',
        messages: [{ id: 'm1', role: 'user', content: 'build a crm' }],
      }),
    );
    const adoptLegacy = vi.fn(
      (messages: { parts: Array<{ text?: string }> }[]) =>
        messages.some((m) => m.parts.some((p) => p.text === 'build a crm')),
    );

    const { result } = renderHook(() =>
      useChatConversation({
        userId: 'u1',
        apiBase: API_BASE,
        scope: 'app:crm:build',
        legacyScope: 'build',
        adoptLegacy,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-legacy');
    expect(result.current.conversationScope).toBe('app:crm:build');
    expect(adoptLegacy).toHaveBeenCalled();
    // Adopted: the app scope now caches the same id; the legacy key survives.
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:app:crm:build`)).toBe('conv-legacy');
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:build`)).toBe('conv-legacy');
    // ONE fetch (the legacy GET) — no create.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/conversations/conv-legacy`);
  });

  it('creates a fresh conversation when the predicate rejects, leaving the legacy key intact', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1:build`, 'conv-other');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-other', messages: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-fresh', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({
        userId: 'u1',
        apiBase: API_BASE,
        scope: 'app:crm:build',
        legacyScope: 'build',
        adoptLegacy: () => false,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-fresh');
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:app:crm:build`)).toBe('conv-fresh');
    // The legacy product-only thread was NOT hijacked or unlinked.
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:build`)).toBe('conv-other');
  });

  it('treats a failing legacy fetch as a miss (creates fresh) instead of dead-ending', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1:build`, 'conv-legacy');
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'conv-fresh', messages: [] }));

    const { result } = renderHook(() =>
      useChatConversation({
        userId: 'u1',
        apiBase: API_BASE,
        scope: 'app:crm:build',
        legacyScope: 'build',
        adoptLegacy: () => true,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-fresh');
  });

  it('feeds the predicate the local message cache when the server returns no history', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1:build`, 'conv-legacy');
    // The sanitized cache path (documented cache-fallback): the draft card —
    // and its packageId — may only survive locally.
    writeConversationMessagesCache('conv-legacy', [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-apply_blueprint',
            toolCallId: 'tc1',
            toolName: 'apply_blueprint',
            state: 'output-available',
            output: { status: 'drafted', drafted: [], packageId: 'crm' },
          },
        ],
      },
    ]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-legacy', messages: [] }));
    // Typed with the option's own parameter type. The hand-written structural
    // stand-in (`{ parts: Array<{ output?: { packageId?: string } }> }[]`) is
    // NOT `HydratedUIMessage[]` — a `HydratedUIMessagePart` shares no declared
    // property with it — so the mock was unassignable to `adoptLegacy` the
    // moment anything compiled this file (objectui#4040). `output` rides in on
    // the part's catch-all, so it still needs narrowing at the read.
    const adoptLegacy = vi.fn((messages: HydratedUIMessage[]) =>
      messages.some((m) =>
        m.parts.some(
          (p) => (p.output as { packageId?: string } | undefined)?.packageId === 'crm',
        ),
      ),
    );

    const { result } = renderHook(() =>
      useChatConversation({
        userId: 'u1',
        apiBase: API_BASE,
        scope: 'app:crm:build',
        legacyScope: 'build',
        adoptLegacy,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-legacy');
    expect(adoptLegacy).toHaveBeenCalled();
    // The adopted thread also hydrates from that cache (not an empty pane).
    expect(result.current.initialMessages.length).toBe(1);
  });

  it('the legacy fallback never runs when the primary scope key is cached', async () => {
    localStorage.setItem(`${CACHE_PREFIX}:u1:app:crm:build`, 'conv-app');
    localStorage.setItem(`${CACHE_PREFIX}:u1:build`, 'conv-legacy');
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-app', messages: [] }));
    const adoptLegacy = vi.fn(() => true);

    const { result } = renderHook(() =>
      useChatConversation({
        userId: 'u1',
        apiBase: API_BASE,
        scope: 'app:crm:build',
        legacyScope: 'build',
        adoptLegacy,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-app');
    expect(adoptLegacy).not.toHaveBeenCalled();
  });
});

// The activeId re-resolve (scope re-key / URL-mirror) can race an in-flight
// turn: the server persists messages at turn COMPLETION, so a mid-stream read
// returns none. That empty read must never wipe the messages already hydrated
// for the SAME conversation — a later pane remount would render an empty
// thread (the A1.b blanked-pane incident).
describe('useChatConversation — same-conversation empty re-read preserves hydrated messages', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps initialMessages when a scope-change refetch of the held conversation returns none', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'conv-a',
        messages: [{ id: 'm1', role: 'user', content: 'build it' }],
      }),
    );

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope, activeId: 'conv-a' }),
      { initialProps: { scope: 'build' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));
    expect(result.current.initialMessages).toHaveLength(1);

    // The A1.b re-key flips the scope; the effect re-resolves the SAME
    // activeId while the turn is still streaming server-side → no history yet.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-a', messages: [] }));
    act(() => result.current.rekeyScope('app:crm:build'));
    rerender({ scope: 'app:crm:build' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-a');
    // The empty mid-turn read did NOT clobber the hydrated history.
    expect(result.current.initialMessages).toHaveLength(1);
  });

  it('still replaces messages when the activeId resolves a DIFFERENT conversation', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'conv-a', messages: [{ id: 'm1', role: 'user', content: 'a' }] }),
    );
    const { result, rerender } = renderHook(
      ({ activeId }: { activeId: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope: 'build', activeId }),
      { initialProps: { activeId: 'conv-a' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));

    // Sidebar switch to an (untouched) other conversation: empty is the truth.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'conv-b', messages: [] }));
    rerender({ activeId: 'conv-b' });
    await waitFor(() => expect(result.current.conversationId).toBe('conv-b'));
    expect(result.current.initialMessages).toHaveLength(0);
  });
});

// objectui#2627 — the same guard's other half. An EMPTY re-read of the held
// conversation is covered above; a FAILED one used to run into the blanket
// `catch { setConversationId(undefined) }`, and dropping the id is what the
// host turns into a pane remount (its ChatPane key is
// `${chatApi}:${conversationId ?? 'pending'}`), discarding the live thread.
// The failure that matters is the A1.b re-key's refetch, fired the instant a
// long build turn ends — precisely when the server is least likely to answer.
describe('useChatConversation — a FAILED same-conversation re-read keeps the conversation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the id AND the hydrated messages when the scope-change refetch 502s', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'conv-a',
        messages: [{ id: 'm1', role: 'user', content: 'build it' }],
      }),
    );

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope, activeId: 'conv-a' }),
      { initialProps: { scope: 'build' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));
    expect(result.current.initialMessages).toHaveLength(1);

    // The re-key flips the scope; the re-resolve of the SAME id hits a busy
    // server. `fetchConversation` throws on a non-404/403 !ok response.
    fetchMock.mockResolvedValueOnce(new Response('upstream busy', { status: 502 }));
    act(() => result.current.rekeyScope('app:crm:build'));
    rerender({ scope: 'app:crm:build' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-a');
    expect(result.current.initialMessages).toHaveLength(1);
  });

  it('survives a rejected (network-level) refetch of the held conversation too', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'conv-a', messages: [{ id: 'm1', role: 'user', content: 'build it' }] }),
    );
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope, activeId: 'conv-a' }),
      { initialProps: { scope: 'build' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => result.current.rekeyScope('app:crm:build'));
    rerender({ scope: 'app:crm:build' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBe('conv-a');
    expect(result.current.initialMessages).toHaveLength(1);
  });

  it('still clears when the FAILED resolve targeted a DIFFERENT conversation', async () => {
    // The negative half: a sidebar switch whose fetch fails must not leave the
    // previous thread on screen under a URL that now names another one.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'conv-a', messages: [{ id: 'm1', role: 'user', content: 'a' }] }),
    );
    const { result, rerender } = renderHook(
      ({ activeId }: { activeId: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope: 'build', activeId }),
      { initialProps: { activeId: 'conv-a' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));

    fetchMock.mockResolvedValueOnce(new Response('upstream busy', { status: 502 }));
    rerender({ activeId: 'conv-b' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.initialMessages).toHaveLength(0);
  });

  it('still clears when a FIRST resolve (nothing held yet) fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream busy', { status: 502 }));
    const { result } = renderHook(() =>
      useChatConversation({ userId: 'u1', apiBase: API_BASE, scope: 'build', activeId: 'conv-a' }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.initialMessages).toHaveLength(0);
  });

  it('still clears when the held conversation is GONE (404) and the replacing create fails', async () => {
    // The guard covers a transport failure re-reading a LIVE conversation. A
    // 404 is the server being definitive: the id is dead and its caches have
    // already been cleared, so a failing create must not resurrect it on screen.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'conv-a', messages: [{ id: 'm1', role: 'user', content: 'a' }] }),
    );
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useChatConversation({ userId: 'u1', apiBase: API_BASE, scope, activeId: 'conv-a' }),
      { initialProps: { scope: 'build' } },
    );
    await waitFor(() => expect(result.current.conversationId).toBe('conv-a'));

    fetchMock
      .mockResolvedValueOnce(new Response('gone', { status: 404 })) // GET conv-a
      .mockResolvedValueOnce(new Response('nope', { status: 500 })); // POST create
    act(() => result.current.rekeyScope('app:crm:build'));
    rerender({ scope: 'app:crm:build' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.initialMessages).toHaveLength(0);
  });
});

// Security — plaintext AI-chat cache (conversation-id pointers + message
// bodies) must be wiped on logout / user switch so a shared machine doesn't
// leak the prior user's threads.
describe('useChatConversation — clears chat cache on logout / user switch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seedChatCache(): void {
    localStorage.setItem(`${CACHE_PREFIX}:u1`, 'conv-1');
    localStorage.setItem(`${CACHE_PREFIX}:u1:app:crm:build`, 'conv-1');
    localStorage.setItem(`${MESSAGE_PREFIX}:conv-1`, JSON.stringify([{ id: 'm', role: 'user', parts: [] }]));
    localStorage.setItem('unrelated:key', 'keep-me');
  }

  it('purgeChatCaches removes only the ai-chat keys', () => {
    seedChatCache();
    purgeChatCaches();
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBeNull();
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1:app:crm:build`)).toBeNull();
    expect(localStorage.getItem(`${MESSAGE_PREFIX}:conv-1`)).toBeNull();
    expect(localStorage.getItem('unrelated:key')).toBe('keep-me');
  });

  it('does NOT purge on initial mount (no prior user)', async () => {
    seedChatCache();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-x', messages: [] }));
    const { result } = renderHook(() => useChatConversation({ userId: 'u1', apiBase: API_BASE }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The seeded cache survives a plain mount — only a user CHANGE purges.
    expect(localStorage.getItem(`${MESSAGE_PREFIX}:conv-1`)).not.toBeNull();
    expect(localStorage.getItem('unrelated:key')).toBe('keep-me');
  });

  it('purges when the user logs out (userId → undefined)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-x', messages: [] }));
    const { rerender } = renderHook(
      ({ userId }: { userId: string | undefined }) => useChatConversation({ userId, apiBase: API_BASE }),
      { initialProps: { userId: 'u1' as string | undefined } },
    );
    await waitFor(() => expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBe('conv-x'));
    localStorage.setItem(`${MESSAGE_PREFIX}:conv-x`, '[]');
    localStorage.setItem('unrelated:key', 'keep-me');

    act(() => rerender({ userId: undefined }));

    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBeNull();
    expect(localStorage.getItem(`${MESSAGE_PREFIX}:conv-x`)).toBeNull();
    expect(localStorage.getItem('unrelated:key')).toBe('keep-me');
  });

  it('purges when a different user signs in (u1 → u2)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'conv-x', messages: [] }));
    const { rerender } = renderHook(
      ({ userId }: { userId: string }) => useChatConversation({ userId, apiBase: API_BASE }),
      { initialProps: { userId: 'u1' } },
    );
    await waitFor(() => expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBe('conv-x'));

    act(() => rerender({ userId: 'u2' }));

    // u1's cached pointer is gone; the effect fired the purge on the switch.
    expect(localStorage.getItem(`${CACHE_PREFIX}:u1`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// objectui#9232 — the cache WRITE half of the approval round trip.
//
// objectui#8442 stopped `hydratedMessagesToChatMessages` dropping the approval
// envelope and `pendingActionId` on the way OUT of persisted history.
// `sanitizeChatMessagesForCache` is the way IN, and it rebuilt each tool part
// field by field without either key — while keeping `state`. So a cached
// `approval-requested` came back with the Approve / Reject affordance lit and
// nothing behind it: `useHitlInChat` indexes on `pendingActionId`, so `decide`
// could only answer "No pending-action id found for this tool call".
//
// These tests DRIVE the round trip rather than reading the call graph: live
// mapper → sanitize → real `writeConversationMessagesCache` → JSON in
// localStorage → back out → the hydration mapper → `useHitlInChat.decide()`,
// and the assertion is the REST call the operator's Approve actually makes.
// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizeChatMessagesForCache — a pending approval survives the cache round trip (objectui#9232)', () => {
  const PENDING_ACTION_ID = 'pa_9232';
  const CONVERSATION_ID = 'conv-hitl';

  /**
   * The framework HITL envelope as `action-tools.ts` really returns it — note
   * the operator-facing `message` and the proposed args, neither of which the
   * detector reads and neither of which the cache is asked to keep.
   */
  const pendingOutput = {
    status: 'pending_approval',
    pendingActionId: PENDING_ACTION_ID,
    message: 'Delete task “Q3 rollout”?',
    toolName: 'action_delete_task',
    args: { recordId: 'task_77', hard: true },
  };

  /** The AI SDK UI message the live stream produces for a HITL-gated tool. */
  const liveUiMessage = {
    id: 'a1',
    role: 'assistant' as const,
    parts: [
      { type: 'text', text: 'This needs your approval.' },
      {
        type: 'tool-action_delete_task',
        toolCallId: 'tc-approve',
        toolName: 'action_delete_task',
        state: 'approval-requested' as const,
        input: { recordId: 'task_77' },
        output: pendingOutput,
        approval: { id: 'req_1' },
      },
    ],
  };

  /** Write through the real cache helper and read back what localStorage holds. */
  function throughLocalStorage(cached: HydratedUIMessage[]): HydratedUIMessage[] {
    writeConversationMessagesCache(CONVERSATION_ID, cached);
    const raw = localStorage.getItem(`${MESSAGE_PREFIX}:${CONVERSATION_ID}`);
    expect(raw).toBeTruthy();
    return JSON.parse(raw as string) as HydratedUIMessage[];
  }

  /**
   * Mount `useHitlInChat` over restored messages and press Approve, exactly as
   * `<ChatbotEnhanced onToolApprove={hitl.decide}>` does. Returns the REST
   * calls the decision made — an empty list means the affordance was dead.
   */
  async function pressApprove(messages: ReturnType<typeof hydratedMessagesToChatMessages>) {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'executed' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useHitlInChat({ messages, apiBase: API_BASE }),
    );
    await act(async () => {
      await result.current.decide('tc-approve', true);
    });
    return {
      urls: fetchMock.mock.calls.map((c) => String(c[0])),
      decision: result.current.decisions['tc-approve'],
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  /** Live render → cache write → the bytes localStorage actually holds. */
  function cacheTheLiveApproval(): HydratedUIMessage[] {
    // Baseline / lit control: the LIVE render really does hold the id, so a
    // zero further down means the cache lost it — not that it never existed.
    const live = uiMessageToChatMessage(liveUiMessage);
    expect(live.toolInvocations?.[0]?.pendingActionId).toBe(PENDING_ACTION_ID);
    expect(live.toolInvocations?.[0]?.state).toBe('approval-requested');
    return throughLocalStorage(sanitizeChatMessagesForCache([live]));
  }

  it('re-mints the MINIMAL pending envelope into the cached tool part', () => {
    const toolPart = cacheTheLiveApproval()[0]?.parts.find(
      (p) => p.type === 'tool-action_delete_task',
    );
    expect(toolPart?.output).toEqual({
      status: 'pending_approval',
      pendingActionId: PENDING_ACTION_ID,
    });
    // Leanness, same bargain the draft/plan inverses strike: the operator-facing
    // prose and the proposed arguments are NOT re-serialized into the cache.
    expect(JSON.stringify(toolPart?.output)).not.toContain('Q3 rollout');
    expect(JSON.stringify(toolPart?.output)).not.toContain('task_77');
    // The state that makes the card render survived the rebuild all along.
    expect(toolPart?.state).toBe('approval-requested');
  });

  // THE load-bearing test. Deliberately holds ONE claim — that the restored
  // message is something `useHitlInChat` can index and decide on — so that the
  // assertion which fails when the fix is removed is the DRIVEN one (the REST
  // call the operator's Approve makes), not an earlier shape check standing in
  // front of it.
  it('restores a message useHitlInChat can index, and Approve reaches the pending action', async () => {
    const restored = hydratedMessagesToChatMessages(cacheTheLiveApproval());

    const { urls, decision } = await pressApprove(restored);
    expect(urls).toEqual([`${API_BASE}/pending-actions/${PENDING_ACTION_ID}/approve`]);
    expect(decision?.state).toBe('success');
  });

  it('writes the AI SDK approval envelope as a part key, where the hydration mapper reads it', () => {
    // The envelope rides the PART on both directions of the server path, so the
    // cache writes it as a part key too. The input shape here is the one
    // AiChatPage re-caches after a HYDRATED load (`hydratedMessagesToChatMessages`
    // lifts `approval`; the live `extractToolInvocations` does not) — which is
    // exactly the loop that would otherwise erase it on the next cache write.
    const cached = sanitizeChatMessagesForCache([
      {
        id: 'a1',
        role: 'assistant',
        content: 'This needs your approval.',
        toolInvocations: [
          {
            toolCallId: 'tc-approve',
            toolName: 'action_delete_task',
            state: 'approval-requested',
            approval: { id: 'req_1', reason: 'destructive' },
            pendingActionId: PENDING_ACTION_ID,
          },
        ],
      },
    ]);
    const persisted = throughLocalStorage(cached);
    const toolPart = persisted[0]?.parts.find((p) => p.type === 'tool-action_delete_task');
    expect(toolPart?.approval).toEqual({ id: 'req_1', reason: 'destructive' });

    const restored = hydratedMessagesToChatMessages(persisted);
    expect(restored[0]?.toolInvocations?.[0]?.approval).toEqual({
      id: 'req_1',
      reason: 'destructive',
    });
  });

  it('leaves a tool with no pending approval exactly as it was', () => {
    // The new arm is reachable only through `pendingActionId`; a plain tool must
    // not grow an `output` (and an `approval`-less part must not grow that key).
    const cached = sanitizeChatMessagesForCache([
      {
        id: 'a1',
        role: 'assistant',
        content: 'Counted.',
        toolInvocations: [
          { toolCallId: 'tc1', toolName: 'aggregate_data', state: 'output-available' },
        ],
      },
    ]);
    const toolPart = cached[0]?.parts.find((p) => p.type === 'tool-aggregate_data');
    expect('output' in (toolPart as object)).toBe(false);
    expect('approval' in (toolPart as object)).toBe(false);
  });

  // ── The both-at-once turn ────────────────────────────────────────────────
  //
  // objectui#9232 first shipped with the pending arm FIRST in the chain, on the
  // argument that the arms were "disjoint by construction, so the order is
  // unobservable". That argument was wrong, and a pre-existing pin
  // (`AiChatPage.runtimeMessageSeam.test.tsx`) caught it: the detectors are
  // disjoint over one RESULT, but `draftReview` and `pendingActionId` are
  // independent KEYS on an invocation and a turn can carry both. Pending-first
  // therefore stopped the draft envelope reaching the cache for such a turn —
  // the exact "Review N changes / Publish" loss the other arms exist to
  // prevent. The tests below pin both halves of the answer.
  describe('a turn carrying BOTH a draft envelope and a pending approval', () => {
    const both = [
      {
        id: 'a1',
        role: 'assistant' as const,
        content: 'Staged the changes; deleting the old object needs your approval.',
        toolInvocations: [
          {
            toolCallId: 'tc-approve',
            toolName: 'apply_blueprint',
            state: 'approval-requested',
            pendingActionId: PENDING_ACTION_ID,
            draftReview: { items: [{ type: 'object', name: 'lead' }], packageId: 'app.crm' },
          },
        ],
      },
    ];

    it('keeps BOTH: the draft card renders and Approve reaches the pending action', async () => {
      const persisted = throughLocalStorage(sanitizeChatMessagesForCache(both));

      // `output` is the DRAFT envelope — the richer affordance keeps the one
      // slot it can ride in, exactly as before objectui#9232.
      const toolPart = persisted[0]?.parts.find((p) => p.type === 'tool-apply_blueprint');
      expect(toolPart?.output).toMatchObject({
        status: 'drafted',
        packageId: 'app.crm',
        drafted: [{ type: 'object', name: 'lead' }],
      });
      // …and the id rides the part key, which is the carrier left over.
      expect(toolPart?.pendingActionId).toBe(PENDING_ACTION_ID);

      const restored = hydratedMessagesToChatMessages(persisted);
      const tool = restored[0]?.toolInvocations?.[0];

      // Half one: the draft card comes back.
      expect(tool?.draftReview).toEqual({
        items: [{ type: 'object', name: 'lead' }],
        packageId: 'app.crm',
      });
      // Half two: DRIVEN, not read off the call graph — the same drive the
      // pending-only round trip gets. Approve must reach the pending action.
      const { urls, decision } = await pressApprove(restored);
      expect(urls).toEqual([`${API_BASE}/pending-actions/${PENDING_ACTION_ID}/approve`]);
      expect(decision?.state).toBe('success');
    });
  });

  // The claim the first version of objectui#9232 asserted in prose and got
  // wrong by over-reaching. Pinned in the narrow form that is actually true,
  // because the arm ORDER now rests on it: over one RESULT the two envelopes
  // are mutually exclusive, which is why a pending-only turn (the shape API
  // mode can produce) still has `output` free to carry its id.
  it('a single tool result cannot yield both a draft and a pending approval', () => {
    const drafted = { status: 'drafted', drafted: [{ type: 'object', name: 'lead' }] };
    const pending = { status: 'pending_approval', pendingActionId: PENDING_ACTION_ID };

    // Lit controls first: each detector really does fire on its own envelope,
    // so the two zeros below are readings and not two dead detectors.
    expect(detectDraftResult(drafted)).toBeDefined();
    expect(detectPendingApproval(pending)).toBeDefined();

    expect(detectPendingApproval(drafted)).toBeUndefined();
    expect(detectDraftResult(pending)).toBeUndefined();
  });

  // ── Stale entries: the decision is READ-SIDE TOLERANCE, not a version bump ──
  //
  // Entries written by the OLD code are one format behind. They are kept and
  // read, because (1) nothing can break on them — both readers of the new keys
  // answer "absent" rather than throwing; (2) a `:v2` key or a discard would
  // blank the transcript, the draft card and the plan card that the old writer
  // DID keep, on the one path that renders when the server has nothing; and
  // (3) they self-heal on the next server-backed load, which rewrites the cache
  // through the new writer. See the block comment on `readMessageCache`.
  describe('an entry written by the OLD cache shape', () => {
    /** Byte-for-byte what the pre-objectui#9232 writer produced for this tool. */
    const staleEntry: HydratedUIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'This needs your approval.' },
          {
            type: 'tool-action_delete_task',
            toolCallId: 'tc-approve',
            toolName: 'action_delete_task',
            state: 'approval-requested',
          },
        ],
      },
    ];

    it('still restores, and never fabricates an id it does not have', () => {
      const restored = hydratedMessagesToChatMessages(throughLocalStorage(staleEntry));
      // Tolerated, not discarded: everything the old writer kept still renders.
      expect(restored).toHaveLength(1);
      expect(restored[0]?.content).toBe('This needs your approval.');
      const tool = restored[0]?.toolInvocations?.[0];
      expect(tool?.toolCallId).toBe('tc-approve');
      expect(tool?.state).toBe('approval-requested');
      // No invention: absent stays absent on both halves.
      expect(tool?.pendingActionId).toBeUndefined();
      expect(tool?.approval).toBeUndefined();
    });

    it('degrades to the pre-fix decision error, making no REST call', async () => {
      // The NEGATIVE half of the load-bearing assertion. Its lit control is the
      // first test in this block, which differs in exactly one way — whether the
      // cached part carries the re-minted envelope — and DOES reach
      // `/pending-actions/pa_9232/approve`. A zero here with that control dark
      // would be a void reading.
      const restored = hydratedMessagesToChatMessages(throughLocalStorage(staleEntry));
      const { urls, decision } = await pressApprove(restored);
      expect(urls).toEqual([]);
      expect(decision?.state).toBe('error');
    });
  });
});
