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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => state.canAuthor,
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
vi.mock('../../console/ai/PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));
vi.mock('../../console/ai/ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));


import { I18nProvider } from '@object-ui/i18n';
import { ChatDockMobileSheet, ChatDockPanel, type ChatDockState } from '../ChatDock';
import { DOCK_TARGET_STORAGE_KEY, type ChatDockTarget } from '../chatDockTarget';
import { DOCK_EXPANDED_STORAGE_KEY } from '../chatDockState';
import { useConsoleChatDock } from '../useConsoleChatDock';
import type { ChatDockControl } from '../chatDockControl';
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
    // objectstack#32031 — opening the dock creates no conversation; the chip,
    // the empty state and the agent context already name the app.
    expect(await screen.findByTestId('ai-build-package-chip')).toHaveTextContent('Customer Desk');
    expect(screen.getByTestId('pane-empty-title')).toHaveTextContent('Customer Desk');
    expect(state.chat?.body?.context?.packageId).toBe('app.crm');
    expect(minted).toBe(0);
    await sendFirst();
    const id = await settledConversationId();
    expect(minted).toBe(1);

    expect(screen.getByTestId('ai-build-package-chip')).toHaveTextContent('Customer Desk');
    expect(screen.getByTestId('pane-empty-title')).toHaveTextContent('Customer Desk');
    expect(state.chat?.body?.context?.packageId).toBe('app.crm');
    // Keyed `app:X:build`, never the product-only key.
    expect(window.localStorage.getItem(cacheKey('app:app.crm:build'))).toBe(id);
    expect(window.localStorage.getItem(cacheKey('build'))).toBeNull();
  });

  it('the dock and /ai/build?package=X resolve the SAME thread', async () => {
    renderDock('app.crm');
    await sendFirst();
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
    await sendFirst();
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
    await sendFirst();
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

    await sendFirst();
    const id = await settledConversationId();
    expect(id).not.toBe('conv-legacy');
    expect(minted).toBe(1);
    expect(window.localStorage.getItem(cacheKey('build'))).toBe('conv-legacy');
  });

  it('moving to another app never pairs the previous app\'s thread with the new package', async () => {
    const dock = renderDock('app.crm');
    await sendFirst();
    const crmThread = await settledConversationId();
    state.chat = undefined;
    dock.switchApp('app.other');
    await sendFirst();
    const otherThread = await settledConversationId();

    expect(otherThread).not.toBe(crmThread);
    expect(window.localStorage.getItem(cacheKey('app:app.other:build'))).toBe(otherThread);
    const crmPairs = state.pairs.filter(([id]) => id === crmThread);
    expect(crmPairs.length).toBeGreaterThan(0);
    for (const [, pkg] of crmPairs) expect(pkg).toBe('app.crm');
  });

  // objectstack#34608 — the drawer has no page to hand a thread to any more:
  // an old `/ai/build?package=X` link (and the "Edit with AI" entries) open
  // the drawer on a TARGET naming the app, from wherever it is hosted (Home has
  // no app in view). It must land on the same thread the in-app dock bound.
  it('a build target naming app X, opened where no app is in view, resumes the thread the dock bound to X', async () => {
    renderDock('app.crm');
    await sendFirst();
    const dockThread = await settledConversationId();
    cleanup();
    state.chat = undefined;

    renderDock(undefined, { agent: 'build', packageId: 'app.crm' });
    expect(await settledConversationId()).toBe(dockThread);
    expect((state.chat as ChatOptions | undefined)?.body?.context?.packageId).toBe('app.crm');
    expect(await screen.findByTestId('ai-build-package-chip')).toHaveTextContent('Customer Desk');
    expect(minted).toBe(1);
  });

  it('a target naming a conversation shows that conversation (an old /ai/build/ID link)', async () => {
    renderDock('app.crm');
    await sendFirst();
    const dockThread = await settledConversationId();
    cleanup();
    state.chat = undefined;

    renderDock(undefined, { agent: 'build', conversationId: dockThread });
    expect(await settledConversationId()).toBe(dockThread);
    expect(minted).toBe(1);
  });

  it('the mobile sheet binds the same way', async () => {
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
          />
        </MemoryRouter>
      </I18nProvider>
    );
    render(sheet(true));
    await sendFirst();
    await settledConversationId();
    expect(state.chat?.body?.context?.packageId).toBe('app.crm');
  });
});

/**
 * objectstack#35014 — the drawer's conversation follows the app. The maintainer
 * ruled the switch automatic, with no "start a new conversation?" prompt.
 *
 * Real subject here: the console's drawer HOST, `useConsoleChatDock`, the hook
 * `ConsoleLayout` and `HomeLayout` call. It holds what the drawer shows (the
 * target) per tab, so the pins drive it through its own handle
 * (`control.open`, the call the history list, the app switcher and "Edit with
 * AI" make) and by moving the app the host is in. A remount reads the per-tab
 * storage again, which is what moving between Home and an app does.
 */
describe('the drawer follows the app (objectstack#35014)', () => {
  let control: ChatDockControl | null = null;

  function DockHost({ pkg }: { pkg: string | undefined }) {
    const dock = useConsoleChatDock({ enabled: true, userId: 'u1', appPackageId: pkg });
    control = dock.control;
    return <>{dock.rail}</>;
  }

  function renderHost(appPackageId: string | undefined) {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '1');
    const tree = (pkg: string | undefined) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <MemoryRouter initialEntries={['/apps/crm_app']}>
          <DockHost pkg={pkg} />
        </MemoryRouter>
      </I18nProvider>
    );
    const { rerender } = render(tree(appPackageId));
    return { switchApp: (pkg: string | undefined) => rerender(tree(pkg)) };
  }

  const open = (target: ChatDockTarget | null) =>
    act(() => {
      control?.open(target);
    });

  /** The pane is on no conversation yet, and the request context names `pkg`. */
  async function onBlankStartOf(pkg: string | undefined, chip: string): Promise<void> {
    await waitFor(() => expect(screen.getByTestId('ai-build-package-chip')).toHaveTextContent(chip));
    await waitFor(() => expect(state.chat?.body?.context?.packageId).toBe(pkg));
    expect(state.chat?.conversationId).toBeUndefined();
  }

  it("a thread opened in app A does not follow the user into app B: B shows its own start page, scoped to B", async () => {
    const host = renderHost('app.crm');
    await sendFirst();
    const crmThread = await settledConversationId();
    // What a picked history row or a minted "New chat" leaves the drawer on.
    await open({ agent: 'build', conversationId: crmThread, packageId: 'app.crm' });
    expect(await settledConversationId()).toBe(crmThread);

    state.chat = undefined;
    host.switchApp('app.notes');
    await onBlankStartOf('app.notes', 'Meeting Notes');
    expect(screen.getByTestId('pane-empty-title')).toHaveTextContent('Meeting Notes');
    for (const [id, pkg] of state.pairs) if (id === crmThread) expect(pkg).toBe('app.crm');

    // A send there lands in B's own thread.
    await sendFirst();
    const notesThread = await settledConversationId();
    expect(notesThread).not.toBe(crmThread);
    await waitFor(() => expect(state.chat?.body?.context?.packageId).toBe('app.notes'));
    expect(window.localStorage.getItem(cacheKey('app:app.notes:build'))).toBe(notesThread);
  });

  it("back in app A, A's thread is still there, on the key the Studio copilot reads", async () => {
    server.set('conv-crm', boundTurns('app.crm'));
    const host = renderHost('app.crm');
    await open({ agent: 'build', conversationId: 'conv-crm', packageId: 'app.crm' });
    expect(await settledConversationId()).toBe('conv-crm');

    host.switchApp('app.notes');
    await onBlankStartOf('app.notes', 'Meeting Notes');

    state.chat = undefined;
    host.switchApp('app.crm');
    expect(await settledConversationId()).toBe('conv-crm');
    expect(screen.getByTestId('ai-build-package-chip')).toHaveTextContent('Customer Desk');
    expect(window.localStorage.getItem(cacheKey('app:app.crm:build'))).toBe('conv-crm');
  });

  it("picking app B in the scope switcher switches to B's thread and never re-binds A's thread to B", async () => {
    server.set('conv-crm', boundTurns('app.crm'));
    window.localStorage.setItem(cacheKey('app:app.crm:build'), 'conv-crm');
    const host = renderHost('app.crm');
    expect(await settledConversationId()).toBe('conv-crm');

    // The switcher's own call (`openAssistant({ agent: 'build', packageId })`).
    state.chat = undefined;
    await open({ agent: 'build', packageId: 'app.notes' });
    await onBlankStartOf('app.notes', 'Meeting Notes');
    for (const [id, pkg] of state.pairs) if (id === 'conv-crm') expect(pkg).toBe('app.crm');
    expect(window.localStorage.getItem(cacheKey('app:app.crm:build'))).toBe('conv-crm');

    // Entering B keeps B's thread; the header and the content still agree.
    host.switchApp('app.notes');
    await onBlankStartOf('app.notes', 'Meeting Notes');
  });

  it("app A's thread is not shown at Home or in the built-in Setup app, nor in app B after a remount", async () => {
    server.set('conv-crm', boundTurns('app.crm'));
    renderHost('app.crm');
    await open({ agent: 'build', conversationId: 'conv-crm', packageId: 'app.crm' });
    expect(await settledConversationId()).toBe('conv-crm');

    for (const elsewhere of [undefined, 'com.objectstack.setup', 'app.notes']) {
      cleanup();
      state.chat = undefined;
      renderHost(elsewhere);
      if (elsewhere === 'app.notes') await onBlankStartOf('app.notes', 'Meeting Notes');
      else await onBlankStartOf(undefined, 'New app');
    }
  });

  it('a target that names app X ("Edit with AI" at Home) shows at Home, stays when entering X, and goes when entering Y', async () => {
    server.set('conv-crm', []);
    window.localStorage.setItem(cacheKey('app:app.crm:build'), 'conv-crm');
    const host = renderHost(undefined);
    await open({ agent: 'build', packageId: 'app.crm', fresh: true });
    await onBlankStartOf('app.crm', 'Customer Desk');

    // Entering X keeps the fresh X thread the user asked for (not X's cached one).
    host.switchApp('app.crm');
    await onBlankStartOf('app.crm', 'Customer Desk');

    host.switchApp('app.notes');
    await onBlankStartOf('app.notes', 'Meeting Notes');
  });

  it('an old /ai… link opens its conversation in the app it lands in, and that thread stays in that app', async () => {
    server.set('conv-old', []);
    // What `AiAddressRedirect` stores before replacing the visit by the landing.
    window.sessionStorage.setItem(
      DOCK_TARGET_STORAGE_KEY,
      JSON.stringify({ agent: 'build', conversationId: 'conv-old' }),
    );
    const host = renderHost('app.notes');
    expect(await settledConversationId()).toBe('conv-old');

    state.chat = undefined;
    host.switchApp('app.crm');
    await onBlankStartOf('app.crm', 'Customer Desk');
  });

  it('ask is not per app (ADR-0057 A2, "ask stays ambient"): the ask thread is the same in every app', async () => {
    state.canAuthor = false; // no maker convergence → the drawer resolves `ask`
    const host = renderHost('app.crm');
    await sendFirst();
    const askThread = await settledConversationId();

    state.chat = undefined;
    host.switchApp('app.notes');
    expect(await settledConversationId()).toBe(askThread);
    expect(window.localStorage.getItem(cacheKey('ask'))).toBe(askThread);
    expect(window.localStorage.getItem(cacheKey('app:app.notes:ask'))).toBeNull();
  });
});

describe('the drawer offers Share and the Build Doctor in its 「···」 menu (objectstack#35445)', () => {
  function openMenu(): HTMLElement {
    fireEvent.keyDown(screen.getByTestId('chat-dock-more'), { key: 'Enter' });
    return screen.getByTestId('chat-dock-menu');
  }

  it('the pane row under the title keeps the app chip and draws no Share or Build Doctor of its own', async () => {
    renderDock('app.crm');
    expect(await screen.findByTestId('ai-build-package-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-share-button')).toBeNull();
    expect(screen.queryByTestId('ai-chat-debug-button')).toBeNull();
  });

  it('a user who may build gets the Build Doctor; Share and the doctor wait for the thread to exist', async () => {
    renderDock('app.crm');
    await screen.findByTestId('ai-build-package-chip');
    let menu = openMenu();
    expect(within(menu).getByTestId('chat-dock-share')).toHaveAttribute('data-disabled');
    expect(within(menu).getByTestId('chat-dock-build-doctor')).toHaveAttribute('data-disabled');
    fireEvent.keyDown(menu, { key: 'Escape' });
    await sendFirst();
    await settledConversationId();
    await waitFor(() => {
      menu = openMenu();
      expect(within(menu).getByTestId('chat-dock-share')).not.toHaveAttribute('data-disabled');
    });
    expect(within(menu).getByTestId('chat-dock-build-doctor')).not.toHaveAttribute('data-disabled');
  });

  it('a user who may not build never sees the Build Doctor, even on a build thread', async () => {
    state.canAuthor = false;
    // A target naming the build agent puts the drawer on it without maker convergence.
    renderDock('app.crm', { agent: 'build' });
    await screen.findByTestId('ai-build-package-chip');
    const menu = openMenu();
    expect(within(menu).getByTestId('chat-dock-share')).toBeInTheDocument();
    expect(within(menu).queryByTestId('chat-dock-build-doctor')).toBeNull();
  });

  it('CONTROL: the same build thread for a user who may build lists it', async () => {
    renderDock('app.crm', { agent: 'build' });
    await screen.findByTestId('ai-build-package-chip');
    expect(within(openMenu()).getByTestId('chat-dock-build-doctor')).toBeInTheDocument();
  });
});
