// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26469 — the Live Canvas header reads the chat's build card.
 *
 * The header named the app by its machine name and said 「未发布 · 仅自己可见」
 * for a build the card beside it called 「已搭建并上线」, and it never
 * changed. The console host now hands the canvas the card's own answer,
 * reported through `onBuildResult`: the label the card names the app by and
 * whether the card says it is live — and follows it when that changes.
 *
 * The chat is faked so the test drives the two callbacks the real
 * `ChatbotEnhanced` calls (the card's report is pinned in
 * `ChatbotEnhanced.buildResultHeader-26469.test.tsx`); the Live Canvas is
 * faked so its props are readable. Same harness as
 * `AiChatPage.previewDraft-12968.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

type Report = (result: { appName: string; label?: string; live: boolean }) => void;
const APP = 'home_renovation_management';

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
      const materialized = props.onBuildMaterialized as ((app: string) => void) | undefined;
      const report = props.onBuildResult as Report | undefined;
      return (
        <div data-testid="pane">
          <button type="button" data-testid="materialize" onClick={() => materialized?.(APP)} />
          <button
            type="button"
            data-testid="report-built"
            onClick={() => report?.({ appName: APP, label: '家装项目管理', live: false })}
          />
          <button
            type="button"
            data-testid="report-live"
            onClick={() => report?.({ appName: APP, label: '家装项目管理', live: true })}
          />
          <button
            type="button"
            data-testid="report-other"
            onClick={() => report?.({ appName: 'other_app', label: '别的应用', live: true })}
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
  LiveCanvas: (props: { appName: string; appLabel?: string; live?: boolean; materialized?: boolean }) => (
    <div
      data-testid="live-canvas"
      data-app={props.appName}
      data-label={props.appLabel ?? ''}
      data-live={String(props.live === true)}
      data-materialized={String(props.materialized === true)}
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

async function openPane() {
  renderPage();
  await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
}

describe('AiChatPage — the canvas header follows the build card (objectstack#26469)', () => {
  it('a materialized build the card calls built (not live) keeps the unlisted header, by label', async () => {
    await openPane();
    fireEvent.click(screen.getByTestId('materialize'));
    fireEvent.click(screen.getByTestId('report-built'));
    const canvas = await screen.findByTestId('live-canvas');
    expect(canvas).toHaveAttribute('data-app', APP);
    expect(canvas).toHaveAttribute('data-label', '家装项目管理');
    expect(canvas).toHaveAttribute('data-materialized', 'true');
    expect(canvas).toHaveAttribute('data-live', 'false');
  });

  it('the header turns live when the card does — it updates on publish', async () => {
    await openPane();
    fireEvent.click(screen.getByTestId('materialize'));
    fireEvent.click(screen.getByTestId('report-built'));
    expect(await screen.findByTestId('live-canvas')).toHaveAttribute('data-live', 'false');
    fireEvent.click(screen.getByTestId('report-live'));
    expect(screen.getByTestId('live-canvas')).toHaveAttribute('data-live', 'true');
  });

  it('a report that arrives before the canvas opens still reaches the header', async () => {
    await openPane();
    // The card's effect runs before its host's (children first), so on a
    // reopened conversation the report precedes the materialized signal.
    fireEvent.click(screen.getByTestId('report-live'));
    fireEvent.click(screen.getByTestId('materialize'));
    const canvas = await screen.findByTestId('live-canvas');
    expect(canvas).toHaveAttribute('data-live', 'true');
    expect(canvas).toHaveAttribute('data-label', '家装项目管理');
  });

  it("another app's report leaves this canvas alone", async () => {
    await openPane();
    fireEvent.click(screen.getByTestId('materialize'));
    fireEvent.click(screen.getByTestId('report-other'));
    const canvas = await screen.findByTestId('live-canvas');
    expect(canvas).toHaveAttribute('data-label', '');
    expect(canvas).toHaveAttribute('data-live', 'false');
  });
});
