// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37831 — the model a user picks in the console drawer's composer
 * stays picked after each answer, and the next request sends it.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its REAL dock host (`useConsoleChatDock`), the REAL
 * drawer chrome (`ChatDockPanel`) and its REAL lazy body
 * (`ChatDockConversation`), the REAL `ChatPane`, the REAL
 * `useChatConversation` and the REAL `useObjectChat` transport. What is pinned
 * is the `model` of the JSON body of each POST to the agent's chat route
 * (captured off a `fetch` stub), and the `selectedModelId` the pane hands the
 * composer, which is the value its model picker shows. The stand-ins: the agent
 * catalog, the model allowlist (three models, the fast one the default), the chrome
 * siblings this card does not touch, and `ChatbotEnhanced` (a recorder exposing
 * the composer's send and pick).
 *
 * Each turn is a whole answer: the stream carries text and finishes, so the
 * end-of-turn path (status back to ready, the history refresh, the usage
 * refresh) runs before the next assertion.
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

const DEFAULT_MODEL = 'vendor-a/fast';
const PICKED_MODEL = 'vendor-a/advanced';
const MODELS = [
  { id: 'vendor-b/standard', label: 'Standard' },
  { id: DEFAULT_MODEL, label: 'Fast' },
  { id: PICKED_MODEL, label: 'Advanced' },
];

const state = {
  isMobile: false,
  /** The latest props `ChatPane` handed `ChatbotEnhanced`. */
  pane: undefined as
    | {
        onSendMessage?: (text: string) => void;
        onModelChange?: (modelId: string) => void;
        selectedModelId?: string;
        isLoading?: boolean;
      }
    | undefined,
  /** The JSON body of every chat POST, in order. */
  sent: [] as Array<{ model?: string }>,
  minted: 0,
};

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => state.isMobile,
}));
vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: MODELS, defaultModelId: DEFAULT_MODEL }),
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
    agents: [{ name: 'ask', label: 'Ask' }],
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => false }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [CRM] }),
}));
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../UnifiedSidebar', () => ({ UnifiedSidebar: () => null }));
vi.mock('../AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';
import { armChatDockExpanded } from '../chatDockState';
// The dock body is a `lazy()` chunk carrying the whole chat UI. Loaded at module
// scope, so no test's send-wait spends its budget on the first cold import.
import '../ChatDockConversation';
// The layout reaches `@objectstack/lint` through a dynamic import (the draft
// preview bar's capability lint): pay that load during collection.
import '@objectstack/lint';

const CRM = { name: 'crm_app', label: 'Customer Desk', _packageId: 'app.crm' };
const OBJECTS = [{ name: 'account', label: 'Account' }];

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

/** A whole answer: a text part, then finish. */
function answerResponse(n: number): Response {
  const events = [
    { type: 'start', messageId: `answer-${n}` },
    { type: 'text-start', id: `t-${n}` },
    { type: 'text-delta', id: `t-${n}`, delta: `Answer ${n}.` },
    { type: 'text-end', id: `t-${n}` },
    { type: 'finish' },
  ];
  const body = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, {
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
        return answerResponse(state.sent.length);
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

function mount(path: string): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProvider>
          <Routes>
            <Route
              path="/apps/*"
              element={
                <ConsoleLayout
                  activeAppName={CRM.name}
                  activeApp={CRM}
                  onAppChange={vi.fn()}
                  objects={OBJECTS}
                  userId="u1"
                >
                  <div />
                </ConsoleLayout>
              }
            />
          </Routes>
        </NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/**
 * The composer is on screen: its recorder was rendered AND committed. A render
 * alone is not enough — the lazy body can render and suspend before it commits,
 * and a pick made through an uncommitted render's setter is dropped.
 */
async function composerReady(): Promise<void> {
  await waitFor(
    () => {
      expect(screen.getByTestId('pane')).toBeInTheDocument();
      expect(state.pane?.onSendMessage).toBeTypeOf('function');
    },
    { timeout: 4000 },
  );
}

/** Picks a model in the composer, the way the picker's `onPick` does. */
function pick(modelId: string): void {
  act(() => state.pane!.onModelChange!(modelId));
}

/** Sends one message and waits for its whole answer; returns the request body that left. */
async function ask(text: string): Promise<{ model?: string }> {
  const before = state.sent.length;
  await act(async () => {
    state.pane!.onSendMessage!(text);
  });
  await waitFor(() => expect(state.sent.length).toBe(before + 1), { timeout: 4000 });
  // The answer has finished: the composer is idle again.
  await waitFor(() => expect(state.pane?.isLoading).toBe(false), { timeout: 4000 });
  // Let the end-of-turn effects (history and usage refresh) settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return state.sent[before];
}

beforeEach(() => {
  state.isMobile = false;
  state.pane = undefined;
  state.sent = [];
  state.minted = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  armChatDockExpanded();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([
  ['an app page', '/apps/crm_app/page/home'],
  ['a record page', '/apps/crm_app/account/record/rec_1'],
])('console drawer on %s — the picked model survives each answer (objectstack#37831)', (_page, path) => {
  it('a pick stays shown after every answer and rides every next request', async () => {
    mount(path);
    await composerReady();
    expect(state.pane?.selectedModelId).toBe(DEFAULT_MODEL);

    pick(PICKED_MODEL);
    expect(state.pane?.selectedModelId).toBe(PICKED_MODEL);

    expect((await ask('first')).model).toBe(PICKED_MODEL);
    expect(state.minted).toBe(1);
    expect(state.pane?.selectedModelId).toBe(PICKED_MODEL);

    expect((await ask('second')).model).toBe(PICKED_MODEL);
    expect(state.pane?.selectedModelId).toBe(PICKED_MODEL);

    expect((await ask('third')).model).toBe(PICKED_MODEL);
    expect(state.pane?.selectedModelId).toBe(PICKED_MODEL);
  });

  it('CONTROL: with no pick the default model is sent and shown', async () => {
    mount(path);
    await composerReady();

    expect((await ask('first')).model).toBe(DEFAULT_MODEL);
    expect(state.pane?.selectedModelId).toBe(DEFAULT_MODEL);
    expect((await ask('second')).model).toBe(DEFAULT_MODEL);
  });
});
