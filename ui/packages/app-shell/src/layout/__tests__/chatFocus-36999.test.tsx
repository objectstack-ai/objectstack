// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36999 — conversation focus: a record pinned to the chat is sent
 * as `context.focus` on every turn, shown as a chip in the composer, and kept
 * across navigation; only where the agent's catalog row declares
 * `capabilities.focus`.
 *
 * ## Real subjects
 *
 * The console dock body (`ChatDockConversation`) and the full-page chat
 * (`AiChatPage` at `/ai/ask`), each with the REAL `ChatPane`, the REAL
 * `useChatConversation`, the REAL `useObjectChat` transport, the REAL focus
 * state (`useConversationFocus`, `setChatFocus`) and the REAL composer row
 * (`ChatFocusRow`). What is pinned is the JSON body of each POST to the
 * agent's chat route (captured off a `fetch` stub) and the row the pane hands
 * the composer. The stand-ins: the agent catalog, the model allowlist, and
 * `ChatbotEnhanced` (a recorder that renders the composer row it is handed and
 * exposes the send).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

const CAPS = { authoring: false, canvas: false, debug: false, resume: false };

const state = {
  agents: [] as Array<{ name: string; label: string; capabilities?: Record<string, boolean> }>,
  /** The latest props `ChatPane` handed the composer. */
  pane: undefined as
    | {
        onSendMessage?: (text: string) => void;
        surfaceContextLabel?: string;
        promptHeaderSlot?: React.ReactNode;
      }
    | undefined,
  /** The JSON body of every chat POST, in order. */
  sent: [] as Array<{ context?: Record<string, unknown> }>,
  minted: 0,
};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    ChatbotEnhanced: (props: NonNullable<typeof state.pane>) => {
      state.pane = props;
      return (
        <div data-testid="pane">
          {props.surfaceContextLabel ? <span data-testid="frame-chip">{props.surfaceContextLabel}</span> : null}
          {props.promptHeaderSlot}
        </div>
      );
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: state.agents, isLoading: false, error: undefined, refetch: vi.fn() }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => false }));
vi.mock('../../console/ai/ConversationsSidebar', () => ({ ConversationsSidebar: () => null }));
vi.mock('../../console/ai/PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { AiChatPage } from '../../console/ai/AiChatPage';
import { ChatDockConversation } from '../ChatDockConversation';
import {
  buildFocusContext,
  readStoredChatFocus,
  resetChatFocusForTests,
  setChatFocus,
  type ChatFocus,
} from '../chatFocus';
import type { ChatSurfaceContext } from '../chatSurfaceContext';
import type { ChatDockTarget } from '../chatDockTarget';

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

const record = (id: string): ChatSurfaceContext => ({
  artifact: { type: 'object', name: 'account' },
  selection: { kind: 'record', id },
});

/** The dock's page in view, moved the way a navigation moves it. */
const page: {
  go: (surface: ChatSurfaceContext | undefined) => void;
  /** Opens a conversation in the drawer, the way a history row does. */
  open: (target: ChatDockTarget | undefined) => void;
} = { go: () => {}, open: () => {} };
function Dock({ initial }: { initial?: ChatSurfaceContext }) {
  const [surface, setSurface] = React.useState<ChatSurfaceContext | undefined>(initial);
  const [target, setTarget] = React.useState<ChatDockTarget | undefined>(undefined);
  page.go = (next) => act(() => setSurface(next));
  page.open = (next) => act(() => setTarget(next));
  return (
    <ChatDockConversation
      userId="u1"
      apiBase="/api/v1/ai"
      surfaceContext={surface}
      surfaceArtifactLabel="Account"
      target={target}
      onTargetChange={setTarget}
    />
  );
}

function mountDock(initial: ChatSurfaceContext | undefined = record('rec_1')): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app/account']}>
        <Dock initial={initial} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mountPage(): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/ai/ask']}>
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
          <Route path="/ai/:agent" element={<AiChatPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function composerReady(): Promise<void> {
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
}

/** Sends one message, and returns the `context` of the request that left. */
async function send(text: string): Promise<Record<string, unknown>> {
  const before = state.sent.length;
  await act(async () => {
    state.pane!.onSendMessage!(text);
  });
  await waitFor(() => expect(state.sent.length).toBe(before + 1), { timeout: 4000 });
  // Let the remount the first send causes, and the turn's stream, settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return state.sent[before].context ?? {};
}

const ACCOUNT_1: ChatFocus = { object: 'account', id: 'rec_1' };

beforeEach(() => {
  state.agents = [{ name: 'ask', label: 'Ask', capabilities: { ...CAPS, focus: true } }];
  state.pane = undefined;
  state.sent = [];
  state.minted = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetChatFocusForTests();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('buildFocusContext — the one shape both chat hosts send (objectstack#36999)', () => {
  it('one pinned record, honoured → `focus` is a one-entry array; anything else adds no key', () => {
    expect(buildFocusContext(ACCOUNT_1, true)).toEqual({ focus: [ACCOUNT_1] });
    expect(buildFocusContext(ACCOUNT_1, false)).toEqual({});
    expect(buildFocusContext(null, true)).toEqual({});
    expect(buildFocusContext(undefined, true)).toEqual({});
  });
});

describe('setChatFocus — the setter every entry point calls (objectstack#36999)', () => {
  it('with no chat mounted it waits, and the chat that mounts next takes it', async () => {
    setChatFocus(ACCOUNT_1);
    mountDock(undefined);
    await composerReady();
    await waitFor(() => expect(screen.getByTestId('chat-focus-chip')).toHaveTextContent('Asking about: account · rec_1'));
    expect((await send('first')).focus).toEqual([ACCOUNT_1]);
  });
});

describe('the console dock — conversation focus (objectstack#36999)', () => {
  it('the pin on the page chip pins the record; every turn carries it, the first included, across navigation', async () => {
    mountDock();
    await composerReady();
    // The page chip moved into the composer row, with its pin; the frame draws none.
    expect(screen.getByTestId('surface-context-chip')).toHaveTextContent('Viewing: Account');
    expect(screen.queryByTestId('frame-chip')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-focus-pin'));
    expect(screen.getByTestId('chat-focus-chip')).toHaveTextContent('account · rec_1');

    // The first turn creates the conversation (and remounts the pane): it carries the focus.
    const first = await send('who owns this?');
    expect(state.minted).toBe(1);
    expect(first.focus).toEqual([ACCOUNT_1]);
    expect(first.surface).toEqual(record('rec_1'));

    // Navigating to a list page keeps the focus; the surface moves.
    page.go({ artifact: { type: 'object', name: 'account' } });
    const second = await send('and its last order?');
    expect(second.focus).toEqual([ACCOUNT_1]);
    expect(second.surface).toEqual({ artifact: { type: 'object', name: 'account' } });
    // The stored copy is the chip's, under the minted conversation.
    expect(readStoredChatFocus('conv-1').focus).toEqual(ACCOUNT_1);
  });

  it('opening another record asks once; a decline is remembered for the conversation', async () => {
    mountDock();
    await composerReady();
    fireEvent.click(screen.getByTestId('chat-focus-pin'));

    page.go(record('rec_2'));
    expect(screen.getByTestId('chat-focus-switch')).toHaveTextContent('Ask about "account · rec_2" instead?');
    fireEvent.click(screen.getByTestId('chat-focus-switch-decline'));
    expect(screen.queryByTestId('chat-focus-switch')).toBeNull();

    page.go(record('rec_3'));
    expect(screen.queryByTestId('chat-focus-switch')).toBeNull();
    expect((await send('still the first one?')).focus).toEqual([ACCOUNT_1]);
  });

  it('accepting the offer moves the focus to the record in view', async () => {
    mountDock();
    await composerReady();
    fireEvent.click(screen.getByTestId('chat-focus-pin'));

    page.go(record('rec_2'));
    fireEvent.click(screen.getByTestId('chat-focus-switch-accept'));
    expect(screen.queryByTestId('chat-focus-switch')).toBeNull();
    expect((await send('this one')).focus).toEqual([{ object: 'account', id: 'rec_2' }]);
  });

  it('removing the focus stops it: the next turn has no `focus` key, and the page chip comes back', async () => {
    mountDock();
    await composerReady();
    fireEvent.click(screen.getByTestId('chat-focus-pin'));
    expect((await send('first')).focus).toEqual([ACCOUNT_1]);

    fireEvent.click(screen.getByTestId('chat-focus-remove'));
    expect(screen.queryByTestId('chat-focus-chip')).toBeNull();
    expect(screen.getByTestId('chat-focus-pin')).toBeInTheDocument();
    expect(await send('second')).not.toHaveProperty('focus');
  });

  it('a focus pinned on an unsent conversation does not follow the user into an existing one', async () => {
    // conv-old was pinned to rec_9 earlier in this tab; conv-bare to nothing.
    window.sessionStorage.setItem(
      'ai-chat-focus:conv-old',
      JSON.stringify({ focus: { object: 'account', id: 'rec_9' }, declined: false }),
    );
    mountDock();
    await composerReady();
    fireEvent.click(screen.getByTestId('chat-focus-pin'));
    expect(screen.getByTestId('chat-focus-chip')).toHaveTextContent('account · rec_1');

    // Opened from the history without a send: conv-old shows ITS focus, and sends it.
    page.open({ agent: 'ask', conversationId: 'conv-old' });
    await waitFor(() => expect(screen.getByTestId('chat-focus-chip')).toHaveTextContent('account · rec_9'));
    await composerReady();
    expect((await send('and now?')).focus).toEqual([{ object: 'account', id: 'rec_9' }]);
    expect(readStoredChatFocus('conv-old').focus).toEqual({ object: 'account', id: 'rec_9' });

    // A conversation with no focus of its own shows none and sends no key.
    page.open({ agent: 'ask', conversationId: 'conv-bare' });
    await waitFor(() => expect(screen.queryByTestId('chat-focus-chip')).toBeNull());
    await composerReady();
    expect(await send('anything?')).not.toHaveProperty('focus');
    expect(state.minted).toBe(0);
  });

  it('a page that shows no one record offers no pin', async () => {
    mountDock({ artifact: { type: 'object', name: 'account' } });
    await composerReady();
    expect(screen.getByTestId('surface-context-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-focus-pin')).toBeNull();
  });
});

describe('the full-page chat — conversation focus behaves as in the dock (objectstack#36999)', () => {
  it('a focus pinned through the setter rides the first turn and the next; removing it stops it', async () => {
    mountPage();
    await composerReady();
    act(() => setChatFocus(ACCOUNT_1));
    expect(screen.getByTestId('chat-focus-chip')).toHaveTextContent('account · rec_1');

    expect((await send('first')).focus).toEqual([ACCOUNT_1]);
    expect(state.minted).toBe(1);
    expect((await send('second')).focus).toEqual([ACCOUNT_1]);

    fireEvent.click(screen.getByTestId('chat-focus-remove'));
    expect(await send('third')).not.toHaveProperty('focus');
  });
});

describe.each([
  ['the console dock', () => mountDock()],
  ['the full-page chat', mountPage],
])('%s — an agent that does not declare `capabilities.focus` (objectstack#36999)', (_surface, mount) => {
  it('draws no pin and no chip, and sends no `focus` key even after a pin request', async () => {
    state.agents = [{ name: 'ask', label: 'Ask', capabilities: { ...CAPS } }];
    mount();
    await composerReady();
    act(() => setChatFocus(ACCOUNT_1));

    expect(screen.queryByTestId('chat-focus-row')).toBeNull();
    expect(screen.queryByTestId('chat-focus-pin')).toBeNull();
    expect(state.pane?.promptHeaderSlot).toBeUndefined();
    expect(await send('first')).not.toHaveProperty('focus');
  });
});

describe('the console dock — no flag leaves the page chip where it was (objectstack#36999)', () => {
  it('the composer frame draws the page chip, as before', async () => {
    state.agents = [{ name: 'ask', label: 'Ask' }];
    mountDock();
    await composerReady();
    expect(screen.getByTestId('frame-chip')).toHaveTextContent('Viewing: Account');
    expect(screen.queryByTestId('chat-focus-row')).toBeNull();
  });
});
