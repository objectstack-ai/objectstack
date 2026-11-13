// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32994 — the model a user picks in the composer is the model the
 * chat request sends, on the first turn of a new conversation and after it.
 *
 * Every chat host keys `ChatPane` on the conversation id, and the first send
 * mints that id (objectstack#32031), so the pane remounts mid-send. A pick held
 * inside the pane died with it: the replayed first message went out with the
 * environment default and the picker snapped back to it.
 *
 * ## Real subjects
 *
 * The full-page build surface (`AiChatPage` at `/ai/build`) and the console
 * dock body (`ChatDockConversation`), each with the REAL `ChatPane`, the REAL
 * `useChatConversation` and the REAL `useObjectChat` transport. What is pinned
 * is the `model` of the JSON body of each POST to the agent's chat route
 * (captured off a `fetch` stub), and the `selectedModelId` the pane hands the
 * composer, which is the value its model picker shows. The stand-ins: the agent
 * catalog, the model allowlist (three models, Haiku the default), and
 * `ChatbotEnhanced` (a recorder exposing the composer's send and pick).
 *
 * Pins, on both surfaces:
 *  - a pick made before the first message rides that message, and the next one;
 *  - after each send the picker still shows the pick;
 *  - CONTROL: with no pick the default model is sent and shown, as before.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

const HAIKU = 'anthropic/claude-haiku-5.5';
const SONNET = 'anthropic/claude-sonnet-5.5';
const MODELS = [
  { id: 'openai/gpt-5.6-luna', label: 'Standard' },
  { id: HAIKU, label: 'Fast' },
  { id: SONNET, label: 'Advanced' },
];

const state = {
  /** The latest props `ChatPane` handed the composer. */
  pane: undefined as
    | {
        onSendMessage?: (text: string) => void;
        onModelChange?: (modelId: string) => void;
        selectedModelId?: string;
      }
    | undefined,
  /** The JSON body of every chat POST, in order. */
  sent: [] as Array<{ model?: string }>,
  minted: 0,
};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: MODELS, defaultModelId: HAIKU }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    ChatbotEnhanced: (props: typeof state.pane) => {
      state.pane = props;
      return <div data-testid="pane" />;
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'build', label: 'Build', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../ConversationsSidebar', () => ({ ConversationsSidebar: () => null }));
vi.mock('../LiveCanvas', () => ({ LiveCanvas: () => null }));
vi.mock('../PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { AiChatPage } from '../AiChatPage';
import { ChatDockConversation } from '../../../layout/ChatDockConversation';

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

/** A minimal, well-formed UI-message stream so a send completes. */
function dataStreamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (/\/agents\/[^/]+\/chat$/.test(url) && method === 'POST') {
        state.sent.push(JSON.parse(String(init?.body ?? '{}')));
        return dataStreamResponse();
      }
      if (/\/conversations$/.test(url) && method === 'POST') {
        state.minted += 1;
        return json({ id: `conv-${state.minted}`, messages: [] });
      }
      const one = /\/conversations\/([^/?]+)$/.exec(url);
      if (one && method === 'GET') return json({ id: decodeURIComponent(one[1]), messages: [] });
      return json({ success: true, data: [] });
    }),
  );
}

function mountPage(): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/ai/build']}>
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
          <Route path="/ai/:agent" element={<AiChatPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mountDock(): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app/account']}>
        <ChatDockConversation userId="u1" apiBase="/api/v1/ai" />
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function composerReady(): Promise<void> {
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
}

/** Picks a model in the composer, the way the picker's `onPick` does. */
function pick(modelId: string): void {
  act(() => state.pane!.onModelChange!(modelId));
}

/** Sends one message through the composer, and returns the request body that left. */
async function send(text: string): Promise<{ model?: string }> {
  const before = state.sent.length;
  await act(async () => {
    state.pane!.onSendMessage!(text);
  });
  await waitFor(() => expect(state.sent.length).toBe(before + 1), { timeout: 4000 });
  // Let the remount the first send causes, and the turn's stream, settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return state.sent[before];
}

beforeEach(() => {
  state.pane = undefined;
  state.sent = [];
  state.minted = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([
  ['the full-page build composer (/ai/build)', mountPage],
  ['the console dock', mountDock],
])('%s — the picked model is the model sent (objectstack#32994)', (_surface, mount) => {
  it('a pick before the first message rides it and the next turn, and the picker keeps showing it', async () => {
    mount();
    await composerReady();
    expect(state.pane?.selectedModelId).toBe(HAIKU);

    pick(SONNET);
    expect(state.pane?.selectedModelId).toBe(SONNET);

    expect((await send('first')).model).toBe(SONNET);
    // The first send minted the conversation and remounted the pane.
    expect(state.minted).toBe(1);
    expect(state.pane?.selectedModelId).toBe(SONNET);

    expect((await send('second')).model).toBe(SONNET);
    expect(state.pane?.selectedModelId).toBe(SONNET);
  });

  it('CONTROL: with no pick the default model is sent and shown', async () => {
    mount();
    await composerReady();

    expect((await send('first')).model).toBe(HAIKU);
    expect(state.minted).toBe(1);
    expect(state.pane?.selectedModelId).toBe(HAIKU);
    expect((await send('second')).model).toBe(HAIKU);
  });
});
