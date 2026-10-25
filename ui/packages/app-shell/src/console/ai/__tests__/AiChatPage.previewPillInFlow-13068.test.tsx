// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13068 — on a phone, the preview pill (`ai-chat-mobile-preview-open`,
 * #2481) does not cover the composer's input.
 *
 * The pill used to float (`absolute bottom-24`) as a sibling of the chat
 * column, and at 390 px that box sat on the input's first line. It is a row of
 * the composer's own area now, handed to `ChatbotEnhanced` through
 * `promptHeaderSlot` together with the pending-drafts bar (objectui#12978),
 * pill above bar, both in flow above the input.
 *
 * ## What is read here, and what is not
 *
 * This environment runs no layout, so the readings are the structure that
 * decides the boxes (`inFlowPlacement.ts` says which, and why the float fails
 * each): the pill against the input, the bar against the input, and the pill
 * against the bar. The boxes themselves were measured in Chromium at 390 px,
 * before and after, and are recorded on this change's pull request.
 *
 * Also pinned: the pill stays one tap from the preview, and opening and
 * closing the preview never remounts the bar; at a desktop width there is no
 * pill and the slot holds the bar alone, as objectui#12978 left it.
 *
 * ## Real subjects
 *
 * The real full-page `AiChatPage`, the real `ChatDockMobileSheet` (the dock's
 * phone presentation) with its real default body, the real `ChatPane`, the
 * real `ChatbotEnhanced` and the real `PendingDraftsBar`. The stand-ins are
 * those of `AiChatPage.draftsBarInFlow-12978.test.tsx`, plus: a handle beside
 * the chat that calls the `onPreviewDraftApp` the pane hands the chat, as a
 * draft card's Preview button does (that button is pinned in plugin-chatbot),
 * and a Live Canvas reduced to its close button.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const RealChatbot = actual.ChatbotEnhanced as React.ComponentType<Record<string, unknown>>;
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
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      const previewApp = props.onPreviewDraftApp as
        | ((app: string, opts?: { appSegment?: string; materialized?: boolean }) => void)
        | undefined;
      return (
        <>
          <button
            type="button"
            data-testid="preview-built-app"
            onClick={() => previewApp?.('hcpl', { appSegment: 'app.hcpl', materialized: false })}
          />
          <RealChatbot {...props} />
        </>
      );
    },
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
vi.mock('../LiveCanvas', () => ({
  LiveCanvas: (props: { onClose?: () => void }) => (
    <button type="button" data-testid="live-canvas-close" onClick={() => props.onClose?.()} />
  ),
}));

import { I18nProvider } from '@object-ui/i18n';
import { ChatDockMobileSheet } from '../../../layout/ChatDock';
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
const realInnerWidth = window.innerWidth;
let drafts: unknown[] = [DRAFT];

/** `useIsMobile` reads `innerWidth` (under 768 is a phone) on mount. */
function viewportWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  drafts = [DRAFT];
  let minted = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/meta/_drafts')) return json({ drafts });
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
  viewportWidth(realInnerWidth);
});

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

function renderMobileSheet() {
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/hcpl/hcpl_borrowing']}>
        <ChatDockMobileSheet open onOpenChange={vi.fn()} userId="u1" apiBase={API} appPackageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function composerInput(): Element {
  const input = document.querySelector('form textarea');
  expect(input).not.toBeNull();
  return input!;
}

/**
 * The card's state: the chat has settled (the bar is up, or the drafts ledger
 * was read), a built app was previewed, and the preview was closed.
 */
async function previewThenClose(withDraft: boolean) {
  if (withDraft) await screen.findByTestId('pending-drafts-bar', undefined, { timeout: 4000 });
  else
    await waitFor(
      () => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/meta/_drafts'))).toBe(true),
      { timeout: 4000 },
    );
  fireEvent.click(screen.getByTestId('preview-built-app'));
  fireEvent.click(await screen.findByTestId('live-canvas-close', undefined, { timeout: 4000 }));
  return screen.findByTestId('ai-chat-mobile-preview-open', undefined, { timeout: 4000 });
}

describe('objectui#13068 — on a phone the preview pill is a row above the composer, never over it', () => {
  it.each([
    ['the full-page chat', renderFullPage],
    ['the dock sheet, inside the running app', renderMobileSheet],
  ])('%s, with a draft pending: the pill and the bar are laid out in flow above the input, pill first', async (_host, mount) => {
    viewportWidth(390);
    mount();
    const pill = await previewThenClose(true);
    const bar = screen.getByTestId('pending-drafts-bar');
    expect({
      pillAgainstInput: readPlacement(pill, composerInput()),
      barAgainstInput: readPlacement(bar, composerInput()),
      pillAgainstBar: readPlacement(pill, bar),
    }).toEqual({
      pillAgainstInput: IN_FLOW_ABOVE,
      barAgainstInput: IN_FLOW_ABOVE,
      pillAgainstBar: IN_FLOW_ABOVE,
    });
  });

  it('the full-page chat, with nothing pending: the pill alone is laid out in flow above the input', async () => {
    drafts = [];
    viewportWidth(390);
    renderFullPage();
    const pill = await previewThenClose(false);
    expect(screen.queryByTestId('pending-drafts-bar')).toBeNull();
    expect(readPlacement(pill, composerInput())).toEqual(IN_FLOW_ABOVE);
  });

  it('the pill is one tap from the preview, and opening and closing it never remounts the bar', async () => {
    viewportWidth(390);
    renderFullPage();
    const pill = await previewThenClose(true);
    const bar = screen.getByTestId('pending-drafts-bar');
    fireEvent.click(pill);
    expect(screen.getByTestId('ai-chat-mobile-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-mobile-preview-open')).toBeNull();
    fireEvent.click(screen.getByTestId('live-canvas-close'));
    expect(screen.queryByTestId('ai-chat-mobile-canvas')).toBeNull();
    expect(screen.getByTestId('ai-chat-mobile-preview-open')).toBeInTheDocument();
    expect(screen.getByTestId('pending-drafts-bar')).toBe(bar);
  });

  it('at a desktop width the preview opens beside the chat: no pill, and the slot holds the bar alone', async () => {
    viewportWidth(1280);
    renderFullPage();
    const bar = await screen.findByTestId('pending-drafts-bar', undefined, { timeout: 4000 });
    fireEvent.click(screen.getByTestId('preview-built-app'));
    await screen.findByTestId('ai-chat-split-handle', undefined, { timeout: 4000 });
    expect(screen.queryByTestId('ai-chat-mobile-preview-open')).toBeNull();
    expect(bar.parentElement).toHaveAttribute('data-testid', 'prompt-header-slot');
    expect(readPlacement(bar, composerInput())).toEqual(IN_FLOW_ABOVE);
  });
});
