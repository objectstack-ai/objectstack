// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34610 (ui ADR-0057 Amendment A3, ADR-0037 as amended) — under
 * the console's drawer host the build's app shows in the MAIN AREA: the pane
 * moves the router, it opens no nested preview.
 *
 *  - A draft card's Preview puts the main area on what it drafted, at the
 *    path `draftPreviewPath` builds (objectui#12968), in draft mode; the app
 *    draft's Preview opens the app; a materialized build opens the real app.
 *  - A turn this pane streams moves the main area to the app it drafted, and
 *    a move to another page waits for the turn to end.
 *  - Drafts the chat reports outside a live turn (a reopened conversation)
 *    move nothing.
 *  - Each drafted artifact refreshes the main area in place: one coalesced
 *    `emitCanvasInvalidate` per type (ADR-0037 Phase 2).
 *  - CONTROL: with no drawer host (the Studio copilot) nothing moves and the
 *    cards get no Preview door.
 *
 * The chat is faked so the test drives the callbacks the real
 * `ChatbotEnhanced` calls (its own Preview buttons are pinned in
 * `ChatbotEnhanced.draftPreviewAny-12968.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

type Items = Array<{ type: string; name: string }>;

const chatCtl = vi.hoisted(() => ({
  setLoading: null as null | ((v: boolean) => void),
  setMessages: null as null | ((v: unknown[]) => void),
}));

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const R = await import('react');
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: () => {
      const [isLoading, setLoading] = R.useState(false);
      const [messages, setMessages] = R.useState<unknown[]>([]);
      chatCtl.setLoading = setLoading;
      chatCtl.setMessages = setMessages;
      return {
        messages,
        isLoading,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      const preview = props.onPreviewDraft as ((items: Items, opts: { appSegment: string }) => void) | undefined;
      const previewApp = props.onPreviewDraftApp as
        | ((app: string, opts?: { appSegment?: string; materialized?: boolean }) => void)
        | undefined;
      const drafted = props.onDraftArtifacts as (artifacts: Items, appSegment?: string) => void;
      const materialized = props.onBuildMaterialized as (app: string, opts?: { appSegment?: string }) => void;
      return (
        <div
          data-testid="pane"
          data-has-preview-draft={String(typeof preview === 'function')}
          data-publish-from-shell-bar={String(props.publishFromShellBar === true)}
        >
          <button
            type="button"
            data-testid="preview-field"
            onClick={() => preview?.([{ type: 'object', name: 'k9_task' }], { appSegment: 'app.k9' })}
          />
          <button
            type="button"
            data-testid="preview-page"
            onClick={() => preview?.([{ type: 'page', name: 'k9_home' }], { appSegment: 'app.k9' })}
          />
          <button
            type="button"
            data-testid="preview-app"
            onClick={() => previewApp?.('k9_app', { appSegment: 'app.k9', materialized: false })}
          />
          <button
            type="button"
            data-testid="drafted"
            onClick={() =>
              drafted(
                [
                  { type: 'app', name: 'k9_app' },
                  { type: 'object', name: 'k9_task' },
                  { type: 'object', name: 'k9_owner' },
                ],
                'app.k9',
              )
            }
          />
          <button type="button" data-testid="materialized" onClick={() => materialized('k9_app', { appSegment: 'app.k9' })} />
        </div>
      );
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AiChatPage } from '../AiChatPage';
import { ChatDockControlProvider, type ChatDockControl } from '../../../layout/chatDockControl';
import { subscribeCanvasInvalidate, type CanvasInvalidation } from '../../../assistant/assistantBus';

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

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (/\/conversations\/conv-1$/.test(url) && method === 'GET') {
        return new Response(JSON.stringify({ id: 'conv-1', messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function Where() {
  const location = useLocation();
  return <div data-testid="where" data-at={`${location.pathname}${location.search}`} />;
}

const dockControl: ChatDockControl = { expanded: true, fullWindow: false, toggle: vi.fn(), open: vi.fn() };

function renderPage({ dockHost }: { dockHost: boolean }) {
  const page = (
    <MemoryRouter initialEntries={['/ai/build/conv-1']}>
      <Routes>
        <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
  render(dockHost ? <ChatDockControlProvider value={dockControl}>{page}</ChatDockControlProvider> : page);
}

const at = () => screen.getByTestId('where').getAttribute('data-at');

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function paneUp() {
  await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
}

describe('the build shows its app in the main area (objectstack#34610)', () => {
  it('the cards draw no Publish of their own: the shell bar is the one', async () => {
    renderPage({ dockHost: true });
    await paneUp();
    expect(screen.getByTestId('pane')).toHaveAttribute('data-publish-from-shell-bar', 'true');
  });

  it.each([
    ['a field draft → the object default list', 'preview-field', '/apps/app.k9/k9_task?preview=draft'],
    ['a page draft → that page', 'preview-page', '/apps/app.k9/page/k9_home?preview=draft'],
    ['the app draft → the app', 'preview-app', '/apps/app.k9?preview=draft'],
  ])("%s: a card's Preview moves the main area, in draft mode", async (_label, button, path) => {
    renderPage({ dockHost: true });
    await paneUp();
    expect(screen.getByTestId('pane')).toHaveAttribute('data-has-preview-draft', 'true');
    fireEvent.click(screen.getByTestId(button));
    await waitFor(() => expect(at()).toBe(path));
  });

  it('drafts reported outside a live turn (a reopened conversation) move nothing', async () => {
    renderPage({ dockHost: true });
    await paneUp();
    fireEvent.click(screen.getByTestId('drafted'));
    fireEvent.click(screen.getByTestId('materialized'));
    await new Promise((r) => setTimeout(r, 50));
    expect(at()).toBe('/ai/build/conv-1');
  });

  it('a live turn moves the main area to the app it drafted, once the turn ends', async () => {
    renderPage({ dockHost: true });
    await paneUp();
    act(() => chatCtl.setLoading?.(true));
    fireEvent.click(screen.getByTestId('drafted'));
    await new Promise((r) => setTimeout(r, 50));
    // Another page: the move waits, so the stream in flight is not cut.
    expect(at()).toBe('/ai/build/conv-1');
    act(() => chatCtl.setLoading?.(false));
    await waitFor(() => expect(at()).toBe('/apps/app.k9?preview=draft'));
  });

  // Read live: an edit re-drafting the object a build made never grows the
  // chat's drafted set, so `onDraftArtifacts` stays silent; the turn's own
  // draft review still moves the main area when the turn ends.
  const editTurn = (packageId: string) => [
    { id: 'u1', role: 'user', content: 'Add a priority field to tasks' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Done.',
      toolInvocations: [
        {
          toolCallId: 'call-edit',
          toolName: 'apply_edit',
          state: 'output-available',
          draftReview: { items: [{ type: 'object', name: 'k9_task' }], packageId, kind: 'edit' },
        },
      ],
    },
  ];

  it.each([
    ['in the app package', 'app.k9'],
    ["in the app's customization pair (ADR-0146)", 'app.k9.custom'],
  ])('a live turn whose drafts the chat reported before still moves at its end: drafted %s', async (_label, pkg) => {
    renderPage({ dockHost: true });
    await paneUp();
    act(() => chatCtl.setLoading?.(true));
    act(() => chatCtl.setMessages?.(editTurn(pkg)));
    act(() => chatCtl.setLoading?.(false));
    await waitFor(() => expect(at()).toMatch(/^\/apps\/app\.k9\?preview=draft/));
  });

  // The same turn end refreshes what the turn drafted in place. Read where the
  // pane stays mounted (no drawer host: nothing moves, so this route keeps it).
  it('…and refreshes what that turn drafted, once, at its end', async () => {
    const seen: CanvasInvalidation[] = [];
    const unsubscribe = subscribeCanvasInvalidate((inv) => seen.push(inv));
    try {
      renderPage({ dockHost: false });
      await paneUp();
      act(() => chatCtl.setLoading?.(true));
      act(() => chatCtl.setMessages?.(editTurn('app.k9')));
      act(() => chatCtl.setLoading?.(false));
      await waitFor(() => expect(seen.map((s) => s.type)).toEqual(['object']));
      // No main area moved: only the conversation's own binding (A1.b) touched the URL.
      expect(at()).toMatch(/^\/ai\/build\/conv-1(\?package=app\.k9)?$/);
    } finally {
      unsubscribe();
    }
  });

  it('CONTROL: a turn that drafted nothing moves nothing at its end', async () => {
    renderPage({ dockHost: true });
    await paneUp();
    act(() => chatCtl.setLoading?.(true));
    act(() =>
      chatCtl.setMessages?.([
        { id: 'u1', role: 'user', content: 'How many tasks are open?' },
        { id: 'a1', role: 'assistant', content: 'Three.' },
      ]),
    );
    act(() => chatCtl.setLoading?.(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(at()).toBe('/ai/build/conv-1');
  });

  it('a materialized build in a live turn opens the real app, no draft overlay (ADR-0045)', async () => {
    renderPage({ dockHost: true });
    await paneUp();
    act(() => chatCtl.setLoading?.(true));
    fireEvent.click(screen.getByTestId('materialized'));
    act(() => chatCtl.setLoading?.(false));
    await waitFor(() => expect(at()).toBe('/apps/app.k9'));
  });

  it('each drafted artifact refreshes the main area in place: one invalidation per type, coalesced', async () => {
    const seen: CanvasInvalidation[] = [];
    const unsubscribe = subscribeCanvasInvalidate((inv) => seen.push(inv));
    try {
      renderPage({ dockHost: true });
      await paneUp();
      fireEvent.click(screen.getByTestId('drafted'));
      fireEvent.click(screen.getByTestId('drafted'));
      expect(seen).toEqual([]);
      await waitFor(() => expect(seen.map((s) => s.type).sort()).toEqual(['app', 'object']));
    } finally {
      unsubscribe();
    }
  });

  it('CONTROL: with no drawer host (the Studio copilot) nothing moves and there is no Preview door', async () => {
    renderPage({ dockHost: false });
    await paneUp();
    expect(screen.getByTestId('pane')).toHaveAttribute('data-has-preview-draft', 'false');
    act(() => chatCtl.setLoading?.(true));
    fireEvent.click(screen.getByTestId('drafted'));
    act(() => chatCtl.setLoading?.(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(at()).toBe('/ai/build/conv-1');
  });
});
