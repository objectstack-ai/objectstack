// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12978 — with a draft pending, the pending-drafts bar
 * (`PendingDraftsBar`, objectui#5694) does not cover the composer's input, on
 * the full-page chat and in the console dock.
 *
 * The bar used to float (`absolute bottom-20`) as a sibling of the chat column,
 * and on the full-page chat that box sat over the input's first line, so the
 * placeholder and the first typed line were hidden. It is a row of the
 * composer's own area now, handed to `ChatbotEnhanced` through
 * `promptHeaderSlot`, laid out in flow above the input.
 *
 * ## What is read here, and what is not
 *
 * This environment runs no layout: every box reads as zeros, so a test that
 * compared the bar's box with the input's would pass whatever the layout was.
 * What is read instead is the structure that decides the boxes, and each
 * reading is one the old float fails:
 *
 * - the nearest element holding both the bar and the input is the composer's
 *   own area: it does not hold the conversation (`role="log"`). The float's
 *   nearest common element was the pane root, which holds the conversation;
 * - nothing between the bar and that element, nor between the input and it,
 *   is taken out of flow (`absolute`, `fixed`, `sticky`, by class or inline
 *   style). The float's wrapper was `absolute`;
 * - in that element the bar's row comes before the input's row, so in that
 *   flow it is the row above the input, and it sits outside the input's form,
 *   so its button can never submit the chat.
 *
 * The boxes themselves were measured in Chromium at 1010 and 1280 px, before
 * and after, and are recorded on this change's pull request.
 *
 * ## Real subjects
 *
 * The real full-page `AiChatPage`, the real `ChatDockPanel` with its real
 * default body (so the dock's own agent resolution decides that it hosts the
 * build agent here), the real `ChatPane`, the real `ChatbotEnhanced` and the
 * real `PendingDraftsBar`. The stand-ins: the agent catalog (one `build`
 * agent), the authoring capability, the signed-in user, the metadata apps
 * list, the chat transport (an idle, empty conversation) and the side panels
 * this reading does not need. The `fetch` stub answers the drafts ledger with
 * one draft for the bound package and the conversation API from memory.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: () => ({
      messages: [],
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'build', label: 'Build' }],
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => true,
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

const PKG = 'app.hcpl';
const APPS = [{ name: 'hcpl', label: 'Library', _packageId: PKG }];
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: APPS }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../LiveCanvas', () => ({ LiveCanvas: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { ChatDockPanel, type ChatDockState } from '../../../layout/ChatDock';
import { AiChatPage } from '../AiChatPage';
import { IN_FLOW_ABOVE, readPlacement } from './inFlowPlacement';

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
const DRAFT = { type: 'object', name: 'hcpl_borrowing', label: 'Borrowing', packageId: PKG };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  let minted = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/meta/_drafts')) return json({ drafts: [DRAFT] });
      if (url === `${API}/conversations` && method === 'POST') {
        minted += 1;
        return json({ id: `conv-${minted}`, messages: [] });
      }
      if (/\/conversations\/[^/?]+$/.test(url)) return json({ id: 'conv-1', messages: [] });
      return json({ success: true, data: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

function renderFullPage() {
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/ai/build?package=${PKG}`]}>
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage apiBase={API} />} />
          <Route path="/ai/:agent" element={<AiChatPage apiBase={API} />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

function renderDock() {
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/hcpl/hcpl_borrowing']}>
        <ChatDockPanel dock={dockState()} userId="u1" apiBase={API} appPackageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** How the bar sits against the composer's input, read from the DOM. */
async function readBarPlacement() {
  const bar = await screen.findByTestId('pending-drafts-bar', undefined, { timeout: 4000 });
  const input = document.querySelector('form textarea');
  expect(input).not.toBeNull();
  return readPlacement(bar, input!);
}

describe('objectui#12978 — the pending-drafts bar is a row above the composer, never over it', () => {
  it.each([
    ['the full-page chat', renderFullPage],
    ['the console dock, inside the running app', renderDock],
  ])('%s, with a draft pending: the bar is laid out in flow above the input', async (_host, mount) => {
    mount();
    expect(await readBarPlacement()).toEqual(IN_FLOW_ABOVE);
  });
});
