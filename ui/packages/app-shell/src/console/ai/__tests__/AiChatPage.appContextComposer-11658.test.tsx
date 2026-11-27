// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11658 — what ChatPane hands the composer: the ask agent's own
 * placeholder, the "Ask {agent}…" template for any other agent, and
 * (objectui#12724) the composer footer's newline half of its key hint.
 *
 * The real pane under a real `I18nProvider`, with `ChatbotEnhanced` replaced
 * by a prop recorder.
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

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

const APPS = [{ name: 'customer_management', label: '客户管理', _packageId: 'app.crm' }];
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: APPS }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';

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

const AGENTS = [
  { name: 'ask', label: 'Ask' },
  { name: 'analyst', label: 'Analyst' },
] as unknown as AgentDescriptor[];

function renderPane(uiLocale: string, opts: { agent: 'ask' | 'analyst'; activeAppPackageId?: string }) {
  cleanup();
  captured = {};
  render(
    <I18nProvider config={{ defaultLanguage: uiLocale, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/ai/${opts.agent}/conv-1`]}>
        <ChatPane
          agents={AGENTS}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent={opts.agent}
          chatApi={`/api/v1/ai/agents/${opts.agent}/chat`}
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          activeAppPackageId={opts.activeAppPackageId}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  return captured;
}

beforeEach(() => {
  window.localStorage.clear();
  // Serve any probe from a double, never the network (objectui#6640).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#11658 — the composer placeholder and footer', () => {
  it('an agent other than ask keeps the "Ask {agent}…" template', () => {
    expect(renderPane('en', { agent: 'analyst' }).placeholder).toBe('Ask Analyst…');
  });

  it('objectui#12724: the composer footer reads「↵ 发送 · Shift+↵ 换行」', () => {
    const labels = renderPane('zh', { agent: 'ask' }).labels as Record<string, unknown>;
    expect(labels.sendHint).toBe('发送');
    expect(labels.newlineHint).toBe('换行');
  });

  it('the ask agent keeps its own placeholder, app or not', () => {
    expect(renderPane('en', { agent: 'ask' }).placeholder).toBe('Ask anything…');
    expect(renderPane('en', { agent: 'ask', activeAppPackageId: 'app.crm' }).placeholder).toBe('Ask anything…');
  });
});
