// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10926 — the console dock's thread is keyed on the product alone
 * (ADR-0057 A2, "ask stays ambient"): the same thread in every app, with the
 * app in view sent only as the turn's `context.activeApp` (objectstack#30043).
 * The per-app build thread this file used to pin left with the in-app build
 * entry (objectstack#37682).
 *
 * ## Real subjects
 *
 * `ChatDockPanel` and the console host (`useConsoleChatDock`) with their REAL
 * default body, the REAL `ChatPane` and the REAL `useChatConversation` (its
 * per-`(user, scope)` localStorage cache is the seam the surfaces share). The
 * stand-ins: the agent catalog, the metadata apps list, the chat transport
 * (`useObjectChat` records its options — the request `body` rides them) and
 * `ChatbotEnhanced` (renders the header slot and the empty-state title it is
 * handed). The conversation API is a `fetch` stub over an in-memory store.
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

interface ChatOptions {
  conversationId?: string;
  body?: { context?: Record<string, unknown> };
}

const state = {
  agents: [] as Array<{ name: string; label: string }>,
  chat: undefined as ChatOptions | undefined,
};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: (options: ChatOptions) => {
      state.chat = options;
      return {
        messages: [],
        isLoading: false,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
    ChatbotEnhanced: (props: {
      headerSlot?: React.ReactNode;
      labels?: { emptyTitle?: string };
      onSendMessage?: (text: string) => void;
    }) => (
      <div data-testid="pane">
        {props.headerSlot}
        <span data-testid="pane-empty-title">{props.labels?.emptyTitle}</span>
        <button data-testid="pane-send" onClick={() => props.onSendMessage?.('first message')}>
          send
        </button>
      </div>
    ),
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

const APPS = [
  { name: 'crm_app', label: 'Customer Desk', _packageId: 'app.crm' },
  { name: 'notes_app', label: 'Meeting Notes', _packageId: 'app.notes' },
  { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' },
];
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: APPS }),
}));
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../../console/ai/ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));


import { I18nProvider } from '@object-ui/i18n';
import { ChatDockPanel, type ChatDockState } from '../ChatDock';
// The dock body is a `lazy()` chunk carrying the whole chat UI. Loaded at module
// scope, so no test's send-wait spends its budget on the first cold import and
// the `lazy()` resolves from the module cache.
import '../ChatDockConversation';
import type { ChatDockTarget } from '../chatDockTarget';
import { DOCK_EXPANDED_STORAGE_KEY } from '../chatDockState';
import { useConsoleChatDock } from '../useConsoleChatDock';

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

const API = '/api/v1/ai';
const cacheKey = (scope: string) => `objectstack:ai-chat-conversation-id:u1:${scope}`;

/** In-memory conversation store behind the `fetch` stub. */
let server: Map<string, unknown[]>;
let minted: number;

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === `${API}/conversations` && method === 'POST') {
        minted += 1;
        const id = `conv-minted-${minted}`;
        server.set(id, []);
        return json({ id, messages: [] });
      }
      const one = url.match(/\/conversations\/([^/?]+)$/);
      if (one && method === 'GET') {
        const id = decodeURIComponent(one[1]);
        return server.has(id) ? json({ id, messages: server.get(id) }) : json({}, 404);
      }
      return json({ success: true, data: [] });
    }),
  );
}

function dockState(): ChatDockState {
  return {
    expanded: true,
    width: 420,
    dragging: false,
    fullWindow: false,
    setFullWindow: vi.fn(),
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    onResizePointerDown: vi.fn(),
  };
}

function renderDock(appPackageId: string | undefined, target?: ChatDockTarget) {
  const dock = dockState();
  const onTargetChange = vi.fn();
  const tree = (pkg: string | undefined) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app']}>
        <ChatDockPanel
          dock={dock}
          userId="u1"
          apiBase={API}
          appPackageId={pkg}
          target={target}
          onTargetChange={onTargetChange}
        />
      </MemoryRouter>
    </I18nProvider>
  );
  const { rerender } = render(tree(appPackageId));
  return { onTargetChange, switchApp: (pkg: string | undefined) => rerender(tree(pkg)) };
}

/**
 * objectstack#32031 — the user's first send, which is what creates a surface's
 * conversation now (a mount creates none). Click the pane's composer once and
 * let the create land.
 */
async function sendFirst(): Promise<void> {
  fireEvent.click(await screen.findByTestId('pane-send'));
}

/** The conversation id the dock's pane settled on (the transport's options). */
async function settledConversationId(): Promise<string> {
  await waitFor(() => expect(state.chat?.conversationId).toBeTruthy(), { timeout: 4000 });
  return state.chat!.conversationId!;
}

const ASK = { name: 'ask', label: 'Ask' };

beforeEach(() => {
  state.agents = [ASK];
  state.chat = undefined;
  server = new Map();
  minted = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('console dock — one ambient thread, keyed on the product (objectui#10926)', () => {
  it('inside an app the thread is keyed on the product alone, and the app rides as context.activeApp', async () => {
    renderDock('app.crm');
    await sendFirst();
    const thread = await settledConversationId();
    expect(window.localStorage.getItem(cacheKey('ask'))).toBe(thread);
    expect(window.localStorage.getItem(cacheKey('app:app.crm:ask'))).toBeNull();
    expect(state.chat?.body?.context?.activeApp).toBe('app.crm');
    expect(state.chat?.body?.context).not.toHaveProperty('packageId');
  });

  it('ask is not per app (ADR-0057 A2): moving to another app keeps the same thread', async () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '1');
    function DockHost({ pkg }: { pkg: string | undefined }) {
      return <>{useConsoleChatDock({ enabled: true, userId: 'u1', appPackageId: pkg }).rail}</>;
    }
    const tree = (pkg: string | undefined) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <MemoryRouter initialEntries={['/apps/crm_app']}>
          <DockHost pkg={pkg} />
        </MemoryRouter>
      </I18nProvider>
    );
    const { rerender } = render(tree('app.crm'));
    await sendFirst();
    const askThread = await settledConversationId();

    state.chat = undefined;
    rerender(tree('app.notes'));
    expect(await settledConversationId()).toBe(askThread);
    expect(window.localStorage.getItem(cacheKey('ask'))).toBe(askThread);
    expect(window.localStorage.getItem(cacheKey('app:app.notes:ask'))).toBeNull();
  });

  it('a target naming a conversation shows that conversation (an old /ai/ask/ID link)', async () => {
    server.set('conv-old', []);
    renderDock('app.crm', { agent: 'ask', conversationId: 'conv-old' } satisfies ChatDockTarget);
    expect(await settledConversationId()).toBe('conv-old');
  });
});

describe('the drawer offers Share in its 「···」 menu (objectstack#35445)', () => {
  function openMenu(): HTMLElement {
    fireEvent.keyDown(screen.getByTestId('chat-dock-more'), { key: 'Enter' });
    return screen.getByTestId('chat-dock-menu');
  }

  it('the pane row under the title draws no Share of its own', async () => {
    renderDock('app.crm');
    await screen.findByTestId('pane');
    expect(screen.queryByTestId('ai-chat-share-button')).toBeNull();
  });

  it('Share waits for the thread to exist, and the menu lists no build tooling', async () => {
    renderDock('app.crm');
    await screen.findByTestId('pane');
    let menu = openMenu();
    expect(within(menu).getByTestId('chat-dock-share')).toHaveAttribute('data-disabled');
    expect(within(menu).queryByTestId('chat-dock-build-doctor')).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    await sendFirst();
    await settledConversationId();
    await waitFor(() => {
      menu = openMenu();
      expect(within(menu).getByTestId('chat-dock-share')).not.toHaveAttribute('data-disabled');
    });
  });
});
