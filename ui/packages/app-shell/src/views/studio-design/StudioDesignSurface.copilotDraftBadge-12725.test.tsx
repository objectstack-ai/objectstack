// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725, phase 5 (Target item 5) — the top bar's 变更 badge counts the
 * copilot's drafts the moment they land, with no reload and no navigation.
 *
 * The chain, end to end:
 *  - the copilot's tool stages the draft server-side and answers
 *    `status: 'drafted'` (objectstack-ai/cloud#2924; its envelope's own
 *    `draftState` is read through `listDrafts` AFTER the write);
 *  - the copilot's chat host, `ChatPane`, sees the result land in the stream
 *    and announces it on the assistant bus (`emitMetadataRefresh`);
 *  - the badge's source, `usePendingDrafts`, re-reads `_drafts` on that pulse.
 *
 * Before this phase the announcement waited for the turn to END: the badge
 * stayed on the old count for as long as the agent kept narrating after the
 * tool answered. These cases play the stream with the turn still running.
 *
 * Phase 6 adds the result phase 5 left out: a `status: 'published'` answer that
 * is not a confirm-replay (cloud's in-turn auto-publish, which promotes every
 * pending draft of the package) carries neither lifted field, and is announced
 * through the chat package's own reader of the envelope.
 *
 * Real: the surface, its top bar, `usePendingDrafts`, the right slot, the
 * Studio copilot (`StudioChatDock` → `StudioCopilotConversation` →
 * `ChatPane`), and the chat package's own mapping of a tool part
 * (`uiMessagesToChatMessages`), fed the producer's envelope shapes. Stubbed:
 * `globalThis.fetch` (the server), the chat transport (`useObjectChat` plays a
 * scripted stream), the agent catalog, the conversation lookup, and the chat
 * body (`ChatbotEnhanced`), which no assertion reads.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PACKAGE_ID = 'app.hcpl';
const DRAFTS = `/api/v1/meta/_drafts?packageId=${encodeURIComponent(PACKAGE_ID)}`;

/** The scripted chat stream the mocked transport serves. */
const chat = vi.hoisted(() => {
  type Snapshot = { messages: unknown[]; isLoading: boolean };
  let snapshot: Snapshot = { messages: [], isLoading: false };
  const listeners = new Set<() => void>();
  return {
    get: (): Snapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: Snapshot): void {
      snapshot = next;
      for (const l of listeners) l();
    },
  };
});

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    ChatbotEnhanced: () => <div data-testid="copilot-chat-body" />,
    useObjectChat: () => {
      const s = React.useSyncExternalStore(chat.subscribe, chat.get, chat.get);
      return {
        messages: s.messages,
        isLoading: s.isLoading,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../hooks/useChatConversation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatConversation: () => ({ conversationId: 'conv-hcpl', initialMessages: [] }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'hcpl' }]),
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { uiMessagesToChatMessages } from '@object-ui/plugin-chatbot';
import { StudioDesignSurface } from './StudioDesignSurface';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

/** What `_drafts` answers: the package's pending drafts, server-side. */
let serverDrafts: Array<Record<string, unknown>> = [];
/** How many `_drafts` reads the page sent. */
let draftReads = 0;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  serverDrafts = [];
  draftReads = 0;
  chat.set({ messages: [], isLoading: false });
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === DRAFTS) {
        draftReads += 1;
        return json({ drafts: serverDrafts });
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── The producer's envelopes (objectstack-ai/cloud#2924, cloud `f9e45145`) ──

const DRAFTED_ROWS = [
  { type: 'object', name: 'hcpl_borrowing', label: '借阅记录', packageId: PACKAGE_ID, updatedAt: null, updatedBy: 'u1' },
  { type: 'view', name: 'hcpl_borrowing.board', label: '借阅看板', packageId: PACKAGE_ID, updatedAt: null, updatedBy: 'u1' },
];

/** `apply_edit` on a live app with records: saved as a draft, `kind: 'edit'`. */
const APPLY_EDIT_DRAFTED = {
  status: 'drafted',
  kind: 'edit',
  drafted: [
    { type: 'object', name: 'hcpl_borrowing' },
    { type: 'view', name: 'hcpl_borrowing.board' },
  ],
  failed: [],
  packageId: PACKAGE_ID,
  summary: 'Add 续借次数 to 借阅记录 and show it on the board cards',
  posture: { mode: 'draft', liveRecords: 12 },
  draftState: { pending: 2, items: [{ type: 'object', name: 'hcpl_borrowing' }, { type: 'view', name: 'hcpl_borrowing.board' }], others: 0 },
  note: 'SAVED AS A STUDIO DRAFT — NOT LIVE.',
};

/** A 确认修改 confirm-replay's result: the single-item draft envelope under a `replay_` id. */
const REPLAY_DRAFTED = {
  status: 'drafted',
  type: 'object',
  name: 'hcpl_borrowing',
  packageId: PACKAGE_ID,
  summary: 'Add 续借次数',
  changedKeys: ['fields.renew_count'],
  posture: { mode: 'draft', liveRecords: 12 },
  draftState: { pending: 1, items: [{ type: 'object', name: 'hcpl_borrowing' }], others: 0 },
};

/**
 * The same `apply_edit` where the environment publishes AI changes in the turn
 * (cloud `maybeAutoPublish`): the package's drafts are promoted, ALL of them,
 * and the envelope is rewritten to `status: 'published'`. Not a replay, so the
 * chat lifts neither `draftReview` nor `replayOutcome` from it.
 */
const APPLY_EDIT_PUBLISHED = {
  ...APPLY_EDIT_DRAFTED,
  status: 'published',
  note: 'LIVE. Published in-turn — the table/field/view now exists and is visible to users; no separate Publish step is needed. You may tell the user it is created and live.',
};

/** A read tool's answer: no authoring envelope. */
const READ_RESULT = { name: 'hcpl_borrowing', label: '借阅记录', fields: { title: { type: 'text' } } };

const USER_TURN = { id: 'm-user-1', role: 'user', parts: [{ type: 'text', text: '给借阅记录加一个续借次数字段' }] };

function toolPart(toolName: string, toolCallId: string, output: unknown) {
  return { type: `tool-${toolName}`, toolCallId, state: 'output-available', input: {}, output: JSON.stringify(output) };
}

/** Play the stream: the thread so far, mapped by the chat package's own reader. */
function play(uiMessages: unknown[], isLoading: boolean): void {
  act(() => {
    chat.set({
      messages: uiMessagesToChatMessages(uiMessages as never, { isStreaming: isLoading }),
      isLoading,
    });
  });
}

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/access`]}>
      <LocationProbe />
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Mount the surface with an empty ledger and the copilot's chat on screen. */
async function mountQuiet() {
  const view = renderStudio();
  await screen.findByTestId('copilot-chat-body');
  await act(drain);
  expect(screen.queryByTestId('studio-changes-count')).toBeNull();
  return view;
}

describe('the 变更 badge counts the copilot\'s drafts the moment they land (objectui#12725)', () => {
  it('a drafted apply_edit result re-reads the badge while the agent is still answering, in place', async () => {
    const view = await mountQuiet();
    const surfaceRoot = view.container.lastElementChild;
    const location = screen.getByTestId('location').textContent;

    // The turn starts: the agent is thinking, nothing is staged yet.
    play([USER_TURN, { id: 'm-asst-1', role: 'assistant', parts: [{ type: 'text', text: '好的，' }] }], true);
    await act(drain);
    const readsBeforeLanding = draftReads;

    // The tool stages both drafts server-side, then answers `drafted` — and the
    // agent goes on narrating: the turn is still running.
    serverDrafts = DRAFTED_ROWS;
    play(
      [
        USER_TURN,
        {
          id: 'm-asst-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: '好的，' },
            toolPart('apply_edit', 'call_apply_edit_1', APPLY_EDIT_DRAFTED),
            { type: 'text', text: '已存为草稿' },
          ],
        },
      ],
      true,
    );

    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('2'));
    expect(draftReads).toBeGreaterThan(readsBeforeLanding);
    // No reload: the same surface tree; no navigation: the same location.
    expect(view.container.lastElementChild).toBe(surfaceRoot);
    expect(screen.getByTestId('location').textContent).toBe(location);
  });

  it('a 确认修改 replay that saved the change as a draft re-reads the badge as it lands', async () => {
    await mountQuiet();
    serverDrafts = DRAFTED_ROWS.slice(0, 1);
    play(
      [
        USER_TURN,
        {
          id: 'm-asst-2',
          role: 'assistant',
          parts: [toolPart('apply_edit', 'replay_t2_0', REPLAY_DRAFTED), { type: 'text', text: '已存为草稿。' }],
        },
      ],
      true,
    );
    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('1'));
  });

  it('announces each result once: later chunks and the turn\'s end send no second pulse for it', async () => {
    await mountQuiet();
    let pulses = 0;
    const unsubscribe = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    try {
      serverDrafts = DRAFTED_ROWS;
      const landed = {
        id: 'm-asst-3',
        role: 'assistant',
        parts: [toolPart('apply_edit', 'call_apply_edit_3', APPLY_EDIT_DRAFTED)],
      };
      play([USER_TURN, landed], true);
      await act(drain);
      expect(pulses).toBe(1);

      // More narration streams in, then the turn ends.
      play([USER_TURN, { ...landed, parts: [...landed.parts, { type: 'text', text: '已存为草稿，' }] }], true);
      play([USER_TURN, { ...landed, parts: [...landed.parts, { type: 'text', text: '已存为草稿，请在「变更」里发布。' }] }], false);
      await act(drain);
      expect(pulses).toBe(1);
      await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('2'));
    } finally {
      unsubscribe();
    }
  });

  it('a published result that is not a replay (in-turn auto-publish) re-reads the badge as it lands', async () => {
    // Two drafts are pending when the turn starts.
    serverDrafts = DRAFTED_ROWS;
    renderStudio();
    await screen.findByTestId('copilot-chat-body');
    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('2'));
    let pulses = 0;
    const unsubscribe = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    try {
      // The tool publishes in the turn, which promotes every pending draft.
      serverDrafts = [];
      play(
        [USER_TURN, { id: 'm-asst-5', role: 'assistant', parts: [toolPart('apply_edit', 'call_apply_edit_5', APPLY_EDIT_PUBLISHED)] }],
        true,
      );
      await waitFor(() => expect(screen.queryByTestId('studio-changes-count')).toBeNull());
      expect(pulses).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('CONTROL: a tool result with no authoring envelope sends no pulse', async () => {
    await mountQuiet();
    let pulses = 0;
    const unsubscribe = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    try {
      play(
        [USER_TURN, { id: 'm-asst-4', role: 'assistant', parts: [toolPart('get_metadata', 'call_read_4', READ_RESULT)] }],
        true,
      );
      play(
        [
          USER_TURN,
          {
            id: 'm-asst-4',
            role: 'assistant',
            parts: [toolPart('get_metadata', 'call_read_4', READ_RESULT), { type: 'text', text: '它有一个标题字段。' }],
          },
        ],
        false,
      );
      await act(drain);
      // (The chat's own pending-drafts bar re-reads on the turn's idle edge, as
      // it always has; that read is its own, not an announcement.)
      expect(pulses).toBe(0);
      expect(screen.queryByTestId('studio-changes-count')).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('a drafted result already in the thread when the copilot mounts is history, not a landing', async () => {
    chat.set({
      messages: uiMessagesToChatMessages(
        [USER_TURN, { id: 'm-asst-old', role: 'assistant', parts: [toolPart('apply_edit', 'call_old', APPLY_EDIT_DRAFTED)] }] as never,
        { isStreaming: false },
      ),
      isLoading: false,
    });
    let pulses = 0;
    const unsubscribe = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    try {
      serverDrafts = DRAFTED_ROWS;
      renderStudio();
      await screen.findByTestId('copilot-chat-body');
      await act(drain);
      expect(pulses).toBe(0);
      // The badge reads the ledger on its own mount, as it always has.
      await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('2'));
    } finally {
      unsubscribe();
    }
  });
});
