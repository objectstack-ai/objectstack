// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10926 — the console dock binds its BUILD thread to the current app
 * (ADR-0057, amended per the maintainer ruling 「绑定当前应用（推荐）」).
 *
 * Inside an authorable app (its package is not a `com.objectstack.*` built-in),
 * a dock whose agent resolves to `build` is keyed `app:PKG:build` — the key the
 * Studio copilot and `/ai/build?package=PKG` resolve — so the three show ONE
 * thread, and the chip, the empty state and the agent context name the app.
 * `ask` stays ambient; a built-in app and an app-less console keep the
 * product-only key, as before.
 *
 * ## Real subjects
 *
 * `ChatDockPanel` / `ChatDockMobileSheet` with their REAL default body, the REAL
 * `ChatPane`, the REAL `useChatConversation` (its per-`(user, scope)`
 * localStorage cache is the seam the surfaces share) and, for the sharing pin,
 * the REAL full-page `AiChatPage`. The stand-ins: the agent catalog, the
 * authoring capability, the metadata apps list, the chat transport
 * (`useObjectChat` records its options — the request `body` rides them) and
 * `ChatbotEnhanced` (renders the header slot and the empty-state title it is
 * handed). The conversation API is a `fetch` stub over an in-memory store.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

interface ChatOptions {
  conversationId?: string;
  body?: { context?: Record<string, unknown> };
}

const state = {
  agents: [] as Array<{ name: string; label: string }>,
  canAuthor: true,
  chat: undefined as ChatOptions | undefined,
  /** Every `(conversationId, context.packageId)` pair the transport was handed. */
  pairs: [] as Array<[string | undefined, unknown]>,
};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: (options: ChatOptions) => {
      state.chat = options;
      state.pairs.push([options.conversationId, options.body?.context?.packageId]);
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
    ChatbotEnhanced: (props: { headerSlot?: React.ReactNode; labels?: { emptyTitle?: string } }) => (
      <div data-testid="pane">
        {props.headerSlot}
        <span data-testid="pane-empty-title">{props.labels?.emptyTitle}</span>
      </div>
    ),
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: state.agents, isLoading: false, error: undefined, refetch: vi.fn() }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => state.canAuthor,
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

const APPS = [
  { name: 'crm_app', label: 'Customer Desk', _packageId: 'app.crm' },
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
vi.mock('../../console/ai/PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));
vi.mock('../../console/ai/ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../../console/ai/LiveCanvas', () => ({ LiveCanvas: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { ChatDockMobileSheet, ChatDockPanel, type ChatDockState } from '../ChatDock';
import { AiChatPage } from '../../console/ai/AiChatPage';

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

/** A persisted build thread whose own history binds it to `packageId`. */
function boundTurns(packageId: string): unknown[] {
  return [
    { id: 'r1', role: 'user', content: [{ type: 'text', text: 'add a field' }] },
    {
      id: 'r2',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Staged.' },
        { type: 'tool-call', toolCallId: 't1', toolName: 'apply_edit' },
      ],
    },
    {
      id: 'r3',
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'apply_edit',
          output: {
            type: 'text',
            value: JSON.stringify({
              status: 'drafted',
              kind: 'edit',
              packageId,
              drafted: [{ type: 'field', name: 'x' }],
            }),
          },
        },
      ],
    },
  ];
}

function dockState(): ChatDockState {
  return {
    expanded: true,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    onResizePointerDown: vi.fn(),
  };
}

function renderDock(appPackageId: string | undefined, onMaximize = vi.fn()) {
  const dock = dockState();
  const tree = (pkg: string | undefined) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app']}>
        <ChatDockPanel
          dock={dock}
          userId="u1"
          apiBase={API}
          appPackageId={pkg}
          onMaximize={onMaximize}
        />
      </MemoryRouter>
    </I18nProvider>
  );
  const { rerender } = render(tree(appPackageId));
  return { onMaximize, switchApp: (pkg: string | undefined) => rerender(tree(pkg)) };
}

/** The conversation id the dock's pane settled on (the transport's options). */
async function settledConversationId(): Promise<string> {
  await waitFor(() => expect(state.chat?.conversationId).toBeTruthy(), { timeout: 4000 });
  return state.chat!.conversationId!;
}

const BUILD = { name: 'build', label: 'Build' };
const ASK = { name: 'ask', label: 'Ask' };

beforeEach(() => {
  state.agents = [BUILD, ASK];
  state.canAuthor = true;
  state.chat = undefined;
  state.pairs = [];
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

describe('console dock — build thread bound to the current authorable app (objectui#10926)', () => {
  it('inside app X the build chip names X, the empty state names X, and the request carries X', async () => {
    renderDock('app.crm');
    const id = await settledConversationId();

    expect(screen.getByTestId('ai-build-package-chip')).toHaveTextContent('Customer Desk');
    expect(screen.getByTestId('pane-empty-title')).toHaveTextContent('Customer Desk');
    expect(state.chat?.body?.context?.packageId).toBe('app.crm');
    // Keyed `app:X:build`, never the product-only key.
    expect(window.localStorage.getItem(cacheKey('app:app.crm:build'))).toBe(id);
    expect(window.localStorage.getItem(cacheKey('build'))).toBeNull();
  });

  it('the dock and /ai/build?package=X resolve the SAME thread', async () => {
    renderDock('app.crm');
    const dockThread = await settledConversationId();
    cleanup();
    state.chat = undefined;

    render(
      <MemoryRouter initialEntries={['/ai/build?package=app.crm']}>
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage apiBase={API} />} />
          <Route path="/ai/:agent" element={<AiChatPage apiBase={API} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await settledConversationId()).toBe(dockThread);
    expect(minted).toBe(1);
  });

  it('the dock resumes the thread another app:X:build surface (the Studio copilot) already keyed', async () => {
    server.set('conv-studio', []);
    window.localStorage.setItem(cacheKey('app:app.crm:build'), 'conv-studio');
    renderDock('app.crm');
    expect(await settledConversationId()).toBe('conv-studio');
    expect(minted).toBe(0);
  });

  it('ask stays ambient: product-only key, no package in the agent context, no chip', async () => {
    state.canAuthor = false; // no maker convergence → the dock resolves `ask`
    renderDock('app.crm');
    const id = await settledConversationId();

    expect(window.localStorage.getItem(cacheKey('ask'))).toBe(id);
    expect(window.localStorage.getItem(cacheKey('app:app.crm:ask'))).toBeNull();
    expect(state.chat?.body?.context).not.toHaveProperty('packageId');
    expect(screen.queryByTestId('ai-build-package-chip')).not.toBeInTheDocument();
  });

  it.each([
    ['a com.objectstack.* built-in app', 'com.objectstack.setup'],
    ['no app', undefined],
  ])('%s keeps the product-only build thread, unchanged', async (_label, appPackageId) => {
    renderDock(appPackageId);
    const id = await settledConversationId();

    expect(window.localStorage.getItem(cacheKey('build'))).toBe(id);
    expect(state.chat?.body?.context).not.toHaveProperty('packageId');
    expect(screen.getByTestId('ai-build-package-chip')).toHaveTextContent('New app');
  });

  it('adopts the product-only thread whose own history binds it to X, and leaves that key in place', async () => {
    server.set('conv-legacy', boundTurns('app.crm'));
    window.localStorage.setItem(cacheKey('build'), 'conv-legacy');
    renderDock('app.crm');

    expect(await settledConversationId()).toBe('conv-legacy');
    expect(window.localStorage.getItem(cacheKey('app:app.crm:build'))).toBe('conv-legacy');
    expect(window.localStorage.getItem(cacheKey('build'))).toBe('conv-legacy');
    expect(minted).toBe(0);
  });

  it('does not adopt a product-only thread bound to another app', async () => {
    server.set('conv-legacy', boundTurns('app.other'));
    window.localStorage.setItem(cacheKey('build'), 'conv-legacy');
    renderDock('app.crm');

    const id = await settledConversationId();
    expect(id).not.toBe('conv-legacy');
    expect(minted).toBe(1);
    expect(window.localStorage.getItem(cacheKey('build'))).toBe('conv-legacy');
  });

  it('moving to another app never pairs the previous app\'s thread with the new package', async () => {
    const dock = renderDock('app.crm');
    const crmThread = await settledConversationId();
    state.chat = undefined;
    dock.switchApp('app.other');
    const otherThread = await settledConversationId();

    expect(otherThread).not.toBe(crmThread);
    expect(window.localStorage.getItem(cacheKey('app:app.other:build'))).toBe(otherThread);
    const crmPairs = state.pairs.filter(([id]) => id === crmThread);
    expect(crmPairs.length).toBeGreaterThan(0);
    for (const [, pkg] of crmPairs) expect(pkg).toBe('app.crm');
  });

  it('maximize hands the bound package to the caller; an app-less thread hands none', async () => {
    const bound = renderDock('app.crm');
    await settledConversationId();
    fireEvent.click(screen.getByTestId('chat-dock-maximize'));
    expect(bound.onMaximize).toHaveBeenCalledWith('app.crm');

    cleanup();
    state.chat = undefined;
    state.canAuthor = false;
    const ambient = renderDock('app.crm');
    await settledConversationId();
    fireEvent.click(screen.getByTestId('chat-dock-maximize'));
    expect(ambient.onMaximize).toHaveBeenCalledWith(undefined);
  });

  it('the mobile sheet binds the same way and its deferred maximize carries the package', async () => {
    const onMaximize = vi.fn();
    const onOpenChange = vi.fn();
    const sheet = (open: boolean) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <MemoryRouter initialEntries={['/apps/crm_app']}>
          <ChatDockMobileSheet
            open={open}
            onOpenChange={onOpenChange}
            userId="u1"
            apiBase={API}
            appPackageId="app.crm"
            onMaximize={onMaximize}
          />
        </MemoryRouter>
      </I18nProvider>
    );
    const { rerender } = render(sheet(true));
    await settledConversationId();
    expect(state.chat?.body?.context?.packageId).toBe('app.crm');

    fireEvent.click(screen.getByTestId('chat-dock-mobile-maximize'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(sheet(false));
    expect(onMaximize).toHaveBeenCalledWith('app.crm');
  });
});
