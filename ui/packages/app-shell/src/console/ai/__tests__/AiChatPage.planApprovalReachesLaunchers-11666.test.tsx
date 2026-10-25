// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11666 — a proposed plan awaiting approval reaches the launcher the
 * user returns to, and survives the chat closing.
 *
 * The launchers are on screen only while the chat is closed, so the reading
 * must leave the chat: `ChatbotEnhanced` reports it (pinned in plugin-chatbot's
 * `ChatbotEnhanced.planApprovalPending-11666.test.tsx`), `ChatPane` publishes it
 * on the assistant bus, and the FAB reads the bus. This file pins the middle
 * hop end to end — the REAL `ChatPane` and the REAL FAB, with `ChatbotEnhanced`
 * replaced by a prop recorder so the case can play the chat's reading.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/** Props of the last `ChatbotEnhanced` render. */
let captured: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      captured = props;
      return null;
    },
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
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
  };
});

vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';
import { ConsoleChatbotFab } from '../../../layout/ConsoleChatbotFab';
import { useConversationList } from '../../../hooks/useConversationList';
import { publishPlanApprovalPending } from '../../../assistant/assistantBus';

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

const MARKER = 'console-chatbot-fab-plan-pending';

function renderPane(conversationId: string) {
  captured = {};
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/ai/build/${conversationId}`]}>
        <ChatPane
          agents={[{ name: 'build', label: 'Builder' } as unknown as AgentDescriptor]}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="build"
          chatApi="/api/v1/ai/agents/build/chat"
          apiBase="/api/v1/ai"
          conversationId={conversationId}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function renderFab() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ConsoleChatbotFab appLabel="Workspace" onOpenDock={() => {}} />
    </I18nProvider>,
  );
}

/** Play the chat's own reading, as `ChatbotEnhanced` reports it. */
function chatReports(pending: boolean) {
  const report = captured.onPlanApprovalPendingChange as (p: boolean) => void;
  expect(typeof report).toBe('function');
  act(() => report(pending));
}

afterEach(() => {
  for (const id of ['conv-1', 'conv-2']) {
    act(() => publishPlanApprovalPending({ userId: undefined, conversationId: id, pending: false }));
  }
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('ChatPane → assistant bus → FAB (objectui#11666)', () => {
  it('the chat reading a waiting plan lights the FAB, and the marker outlives the chat closing', () => {
    renderFab();
    const pane = renderPane('conv-1');
    expect(screen.queryByTestId(MARKER)).not.toBeInTheDocument();

    chatReports(true);
    expect(screen.getByTestId(MARKER)).toBeInTheDocument();

    // The chat closes (the dock collapses, the pane unmounts): nothing clears.
    pane.unmount();
    expect(screen.getByTestId(MARKER)).toBeInTheDocument();
  });

  it('reopening the chat clears nothing by itself; the plan leaving "awaiting" does', () => {
    renderFab();
    const first = renderPane('conv-1');
    chatReports(true);
    first.unmount();

    // Reopen on the same thread: mounting announces nothing until the chat reads.
    renderPane('conv-1');
    expect(screen.getByTestId(MARKER)).toBeInTheDocument();
    chatReports(true);
    expect(screen.getByTestId(MARKER)).toBeInTheDocument();

    // The user approves (or the build runs): the chat reads false.
    chatReports(false);
    expect(screen.queryByTestId(MARKER)).not.toBeInTheDocument();
  });

  it('a chat on another thread reporting no plan does not clear the waiting one', () => {
    renderFab();
    const first = renderPane('conv-1');
    chatReports(true);
    first.unmount();

    renderPane('conv-2');
    chatReports(false);
    expect(screen.getByTestId(MARKER)).toBeInTheDocument();
  });

  it('deleting the thread drops its reading (the /ai sidebar delete)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    renderFab();
    const pane = renderPane('conv-1');
    chatReports(true);
    pane.unmount();
    expect(screen.getByTestId(MARKER)).toBeInTheDocument();

    const { result } = renderHook(() => useConversationList({ userId: undefined, apiBase: '/api/v1/ai' }));
    await act(async () => {
      await result.current.remove('conv-1');
    });
    expect(screen.queryByTestId(MARKER)).not.toBeInTheDocument();
  });
});
