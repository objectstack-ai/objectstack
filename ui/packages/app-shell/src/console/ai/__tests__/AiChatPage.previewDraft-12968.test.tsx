// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12968 (objectstack#24324 ruling A, preview-first) — the console
 * host wires the chat's any-draft Preview.
 *
 * `ChatPane` passes `onPreviewDraft` to the chat. A field, view or page
 * draft's Preview opens the Live Canvas on the surface the draft changes, at
 * the path `draftPreviewPath` builds (always `?preview=draft`); the app
 * draft's Preview (`onPreviewDraftApp`) opens the app as before, with no path.
 *
 * The chat is faked so the test drives the two callbacks the real
 * `ChatbotEnhanced` calls (its own Preview buttons are pinned in
 * `ChatbotEnhanced.draftPreviewAny-12968.test.tsx`); the Live Canvas is faked
 * so its props are readable. Same harness as
 * `AiChatPage.noNavigationAfterBuild-12724.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

type Items = Array<{ type: string; name: string }>;

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
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      const preview = props.onPreviewDraft as
        | ((items: Items, opts: { appSegment: string }) => void)
        | undefined;
      const previewApp = props.onPreviewDraftApp as
        | ((app: string, opts?: { appSegment?: string; materialized?: boolean }) => void)
        | undefined;
      return (
        <div data-testid="pane" data-has-preview-draft={String(typeof preview === 'function')}>
          <button
            type="button"
            data-testid="preview-field"
            onClick={() => preview?.([{ type: 'object', name: 'k9_task' }], { appSegment: 'app.k9' })}
          />
          <button
            type="button"
            data-testid="preview-view"
            onClick={() => preview?.([{ type: 'view', name: 'k9_task.board' }], { appSegment: 'app.k9' })}
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
vi.mock('../LiveCanvas', () => ({
  LiveCanvas: (props: { appName: string; appSegment?: string; materialized?: boolean; path?: string }) => (
    <div
      data-testid="live-canvas"
      data-app={props.appName}
      data-segment={props.appSegment ?? ''}
      data-materialized={String(props.materialized === true)}
      data-path={props.path ?? ''}
    />
  ),
}));

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
  return <div data-testid="where" data-path={location.pathname} />;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/ai/build/conv-1']}>
      <Routes>
        <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
        <Route path="/ai/:agent" element={<AiChatPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiChatPage — the any-draft Preview opens the drafted surface (objectui#12968)', () => {
  it('the console host hands the chat an onPreviewDraft door', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByTestId('pane')).toHaveAttribute('data-has-preview-draft', 'true');
  });

  it.each([
    ['a field draft → the object default list', 'preview-field', '/apps/app.k9/k9_task?preview=draft'],
    ['a view draft → the object list on that view', 'preview-view', '/apps/app.k9/k9_task/view/k9_task.board?preview=draft'],
    ['a page draft → that page', 'preview-page', '/apps/app.k9/page/k9_home?preview=draft'],
  ])('%s: the Live Canvas opens at the draftPreviewPath target, in draft preview', async (_label, button, path) => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByTestId('live-canvas')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(button));
    const canvas = await screen.findByTestId('live-canvas', {}, { timeout: 4000 });
    expect(canvas).toHaveAttribute('data-path', path);
    expect(canvas).toHaveAttribute('data-segment', 'app.k9');
    expect(canvas).toHaveAttribute('data-materialized', 'false');
    // The canvas opens beside the chat: the conversation stays where it is.
    expect(screen.getByTestId('where')).toHaveAttribute('data-path', '/ai/build/conv-1');
  });

  it('an app draft keeps the app preview: the canvas opens the app, with no surface path', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('preview-app'));
    const canvas = await screen.findByTestId('live-canvas', {}, { timeout: 4000 });
    expect(canvas).toHaveAttribute('data-app', 'k9_app');
    expect(canvas).toHaveAttribute('data-segment', 'app.k9');
    expect(canvas).toHaveAttribute('data-path', '');
  });
});
