// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27420 — a chat pane too narrow for the chat ↔ preview split
 * previews the way a phone does (#2481) instead of pushing the preview past
 * its edge.
 *
 * The split needs `CHAT_PANE_MIN_WIDTH + CHAT_PREVIEW_MIN_WIDTH` (780 px):
 * the chat column never shrinks below its minimum, so in the console dock at a
 * 1024 px window the preview was laid out beyond the dock and clipped. Below
 * that width the chat keeps the full width, the pill above the composer offers
 * the preview, and opening it shows the full-surface overlay; at or above it
 * the beside-chat split is unchanged.
 *
 * ## What is read here, and what is not
 *
 * This environment runs no layout, so the pane's own width is supplied: every
 * element answers `clientWidth` with `paneWidth`, and a recording
 * `ResizeObserver` lets a test move it. What is pinned is the presentation the
 * pane picks for that width. The clipped box itself was measured in Chromium,
 * before and after, and is recorded on this change's pull request.
 *
 * ## Real subjects
 *
 * The real full-page `AiChatPage`, the real `ChatDockConversation` (the body
 * the console dock mounts), the real `ChatPane` and the real `ChatbotEnhanced`.
 * The stand-ins are those of `AiChatPage.previewPillInFlow-13068.test.tsx`: a
 * handle beside the chat that calls the pane's `onPreviewDraftApp`, as a draft
 * card's Preview button does, and a Live Canvas reduced to its close button.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { ChatDockConversation } from '../../../layout/ChatDockConversation';
import { AiChatPage } from '../AiChatPage';

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
const realInnerWidth = window.innerWidth;
const realClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

/** The width every element reports: the pane the split is laid out in. */
let paneWidth = 0;
/** Callbacks of the `ResizeObserver`s the pane started, to replay a resize. */
let observers: Array<() => void> = [];

/** Move the pane to `px` and tell every live observer, as a resize does. */
function resizePane(px: number) {
  paneWidth = px;
  act(() => observers.forEach((notify) => notify()));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // A laptop window: `useIsMobile` reads `innerWidth` (under 768 is a phone).
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => paneWidth });
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: ResizeObserverCallback;
      private notify: () => void = () => {};
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        const entry = { target, contentRect: { width: paneWidth, height: 0 } } as unknown as ResizeObserverEntry;
        this.notify = () => this.cb([entry], this as unknown as ResizeObserver);
        observers.push(this.notify);
      }
      disconnect() {
        observers = observers.filter((n) => n !== this.notify);
      }
      unobserve() {}
    },
  );
  let minted = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/meta/_drafts')) return json({ drafts: [] });
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
  Object.defineProperty(window, 'innerWidth', { value: realInnerWidth, configurable: true, writable: true });
  if (realClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realClientWidth);
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

function renderDockBody() {
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/hcpl/hcpl_borrowing']}>
        <ChatDockConversation userId="u1" apiBase={API} appPackageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** What the pane shows for its preview: the split, the overlay, or the pill. */
function presentation() {
  return {
    split: screen.queryByTestId('ai-chat-split-handle') !== null,
    chatColumnSized: (document.querySelector('[data-chat-column]') as HTMLElement | null)?.style.width ?? '',
    overlay: screen.queryByTestId('ai-chat-mobile-canvas') !== null,
    pill: screen.queryByTestId('ai-chat-mobile-preview-open') !== null,
  };
}

const SPLIT = { split: true, chatColumnSized: '480px', overlay: false, pill: false };
const PILL = { split: false, chatColumnSized: '', overlay: false, pill: true };
const OVERLAY = { split: false, chatColumnSized: '', overlay: true, pill: false };

/**
 * Preview a built app once the chat has settled (the drafts ledger was read,
 * so the pane keyed on the conversation has stopped remounting), and wait for
 * the pane to show it, in `expected`.
 */
async function previewBuiltApp(expected: ReturnType<typeof presentation>) {
  await waitFor(
    () => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/meta/_drafts'))).toBe(true),
    { timeout: 4000 },
  );
  fireEvent.click(screen.getByTestId('preview-built-app'));
  await waitFor(() => expect(presentation()).toEqual(expected), { timeout: 4000 });
}

describe('objectstack#27420 — a pane too narrow for the split previews the way a phone does', () => {
  it.each([
    ['the console dock body', renderDockBody],
    ['the full-page chat', renderFullPage],
  ])('%s at 760 px (a 1024 px window): no split column; the overlay opens, and closing it offers the pill', async (_host, mount) => {
    paneWidth = 760;
    mount();
    await previewBuiltApp(OVERLAY);
    fireEvent.click(screen.getByTestId('live-canvas-close'));
    expect(presentation()).toEqual(PILL);
    fireEvent.click(screen.getByTestId('ai-chat-mobile-preview-open'));
    expect(presentation()).toEqual(OVERLAY);
  });

  it.each([
    ['the console dock body', renderDockBody],
    ['the full-page chat', renderFullPage],
  ])('%s at 780 px, the split minimum: the preview opens beside the chat as before', async (_host, mount) => {
    paneWidth = 780;
    mount();
    // 480 px is the default chat width; 780 − 420 caps it at 360 on a live resize.
    await previewBuiltApp(SPLIT);
  });

  it('a resize across the threshold switches presentation, and holding a width never flips it back', async () => {
    paneWidth = 1100;
    renderDockBody();
    await previewBuiltApp(SPLIT);

    resizePane(779);
    expect(presentation()).toEqual(PILL);
    // The width is read from the same element in both presentations, and
    // observing it again at the same width answers the same.
    resizePane(779);
    expect(presentation()).toEqual(PILL);

    resizePane(780);
    expect(presentation()).toEqual({ ...SPLIT, chatColumnSized: '360px' });
    resizePane(780);
    expect(presentation()).toEqual({ ...SPLIT, chatColumnSized: '360px' });
  });

  it('an unmeasured pane (width 0) keeps the split, as before', async () => {
    paneWidth = 0;
    renderFullPage();
    await previewBuiltApp(SPLIT);
  });
});
