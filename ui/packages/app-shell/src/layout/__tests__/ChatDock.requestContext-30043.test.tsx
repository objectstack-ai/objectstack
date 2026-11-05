// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30043 — the console dock's chat REQUEST names the app the user
 * has selected (`context.activeApp`, never the constant `'AI'`) and the page in
 * view (`context.surface`, cloud#1610's shape), read again on every send.
 *
 * Measured before the fix by scripting the dock's own body on an object list
 * page: `{activeApp:"AI", agentName:"build", autoPublishAiBuilds:true,
 * packageId:"app.jpph"}` — no surface, and an app the user was not in.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` (it reads the page off the URL) with its REAL dock — the
 * desktop rail and the phone sheet, each with its REAL lazy body
 * `ChatDockConversation`, the REAL `ChatPane` and the REAL `useObjectChat`
 * transport. What is pinned is the JSON body of the POST that leaves for the
 * agent's chat route, captured off a `fetch` stub. The stand-ins: the agent
 * catalog, the chrome siblings this card does not touch, `ChatbotEnhanced`
 * (a recorder that exposes the pane's send) and the conversation API.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import React from 'react';

const state = {
  isMobile: false,
  canAuthor: false,
  agents: [{ name: 'ask', label: 'Ask' }] as Array<{ name: string; label: string }>,
  /** The latest props `ChatPane` handed `ChatbotEnhanced`. */
  pane: undefined as
    | { onSendMessage?: (text: string) => void; surfaceContextLabel?: string }
    | undefined,
  /** The JSON body of every chat POST, in order. */
  sent: [] as Array<{ context?: Record<string, unknown> }>,
};

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => state.isMobile,
}));
vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    ChatbotEnhanced: (props: typeof state.pane) => {
      state.pane = props;
      return <div data-testid="pane" />;
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: state.agents, isLoading: false, error: undefined, refetch: vi.fn() }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => state.canAuthor }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: true, isLoading: false }),
}));
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
vi.mock('../../console/ai/PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));
vi.mock('../../console/ai/LiveCanvas', () => ({ LiveCanvas: () => null }));
vi.mock('../UnifiedSidebar', () => ({ UnifiedSidebar: () => null }));
vi.mock('../AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../ConsoleChatbotFab', () => ({ ConsoleChatbotFab: () => null }));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';
import { armChatDockExpanded } from '../chatDockState';
// The dock body is a `lazy()` chunk carrying the whole chat UI. Loaded at module
// scope, so no test's send-wait spends its budget on the first cold import and
// the `lazy()` resolves from the module cache.
import '../ChatDockConversation';

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

/** A minimal, well-formed UI-message stream so a send completes. */
function dataStreamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

function installFetch(): void {
  let minted = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (/\/agents\/[^/]+\/chat$/.test(url) && method === 'POST') {
        state.sent.push(JSON.parse(String(init?.body ?? '{}')));
        return dataStreamResponse();
      }
      if (/\/conversations$/.test(url) && method === 'POST') {
        minted += 1;
        return json({ id: `conv-${minted}`, messages: [] });
      }
      if (/\/conversations\/[^/?]+$/.test(url) && method === 'GET') return json({ id: 'conv-1', messages: [] });
      return json({ success: true, data: [] });
    }),
  );
}

/** Lets the test navigate the way a link click does, with the dock open. */
const nav: { go: (to: string) => void } = { go: () => {} };
function Navigator() {
  const navigate = useNavigate();
  React.useEffect(() => {
    nav.go = (to) => navigate(to);
  }, [navigate]);
  return null;
}

function mount(path: string, activeApp: Record<string, unknown> = CRM) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProvider>
          <Routes>
            <Route
              path="/apps/*"
              element={
                <ConsoleLayout
                  activeAppName={String(activeApp.name)}
                  activeApp={activeApp}
                  onAppChange={vi.fn()}
                  objects={OBJECTS}
                  userId="u1"
                >
                  <Navigator />
                </ConsoleLayout>
              }
            />
          </Routes>
        </NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Sends one message through the pane, and returns the request body that left. */
async function send(text: string): Promise<Record<string, unknown>> {
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
  const before = state.sent.length;
  await act(async () => {
    state.pane!.onSendMessage!(text);
  });
  await waitFor(() => expect(state.sent.length).toBe(before + 1), { timeout: 4000 });
  return state.sent[before].context ?? {};
}

beforeEach(() => {
  state.isMobile = false;
  state.canAuthor = false;
  state.agents = [{ name: 'ask', label: 'Ask' }];
  state.pane = undefined;
  state.sent = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  armChatDockExpanded();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('console dock — the request names the selected app and the page in view (objectstack#30043)', () => {
  it('on a record page the body carries the selected app and the object + record id', async () => {
    mount('/apps/crm_app/account/record/rec_1');
    const context = await send('who owns this record?');

    expect(context.activeApp).toBe('app.crm');
    expect(context.surface).toEqual({
      artifact: { type: 'object', name: 'account' },
      selection: { kind: 'record', id: 'rec_1' },
    });
    // The chip names the object by its label; the internal pair stays off it.
    expect(state.pane?.surfaceContextLabel).toContain('Account');
  });

  it('on an object list page — the page the defect was measured on — the body carries the object', async () => {
    mount('/apps/crm_app/account');
    const context = await send('how many accounts?');

    expect(context.activeApp).toBe('app.crm');
    expect(context.surface).toEqual({ artifact: { type: 'object', name: 'account' } });
  });

  it('the build agent bound to the app sends the same app as activeApp and packageId', async () => {
    state.agents = [{ name: 'build', label: 'Build' }];
    state.canAuthor = true;
    mount('/apps/crm_app/dashboard/pipeline');
    const context = await send('add a chart');

    expect(context.activeApp).toBe('app.crm');
    expect(context.packageId).toBe('app.crm');
    expect(context.surface).toEqual({ artifact: { type: 'dashboard', name: 'pipeline' } });
  });

  it('the value is read per send: navigating with the dock open moves the next turn', async () => {
    mount('/apps/crm_app/account');
    expect((await send('first')).surface).toEqual({ artifact: { type: 'object', name: 'account' } });

    act(() => nav.go('/apps/crm_app/account/record/rec_9'));
    expect((await send('second')).surface).toEqual({
      artifact: { type: 'object', name: 'account' },
      selection: { kind: 'record', id: 'rec_9' },
    });

    // A page that shows no one artifact drops the key rather than keeping the last one.
    act(() => nav.go('/apps/crm_app/search'));
    expect(await send('third')).not.toHaveProperty('surface');
  });

  it('with no app selected there is no activeApp at all — never the constant "AI"', async () => {
    mount('/apps/scratch/account', { name: 'scratch', label: 'Scratch' });
    const context = await send('hello');

    expect(context).not.toHaveProperty('activeApp');
    expect(Object.values(context)).not.toContain('AI');
    expect(context.surface).toEqual({ artifact: { type: 'object', name: 'account' } });
  });

  it('the phone sheet sends the same body as the desktop rail', async () => {
    state.isMobile = true;
    mount('/apps/crm_app/account/record/rec_1');
    const context = await send('who owns this record?');

    expect(context.activeApp).toBe('app.crm');
    expect(context.surface).toEqual({
      artifact: { type: 'object', name: 'account' },
      selection: { kind: 'record', id: 'rec_1' },
    });
  });
});
