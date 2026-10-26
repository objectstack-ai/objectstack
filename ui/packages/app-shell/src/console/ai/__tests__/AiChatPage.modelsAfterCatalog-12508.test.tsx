// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12508 — the chat pane asks for the AI-model allowlist only once the
 * agent catalog names an agent.
 *
 * Measured on the card's session: the Studio copilot and the console dock
 * mount `ChatPane` while the agent catalog is still loading, and the pane
 * asked `GET /api/v1/ai/models` straight away. A server without an AI service
 * answers the catalog empty and `/models` with 501, so every console load
 * logged a 501 before the empty catalog unmounted the pane. The catalog the
 * pane already holds is the answer: no agent, no model picker to fill.
 *
 * Pinned on the `enabled` the pane hands `useAiModels`:
 *  - while the catalog is loading (no agent yet): not enabled;
 *  - CONTROL: with an agent in the catalog: enabled, as before.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/** Every option set the pane handed `useAiModels`, in render order. */
const modelCalls: Array<{ apiBase?: string; enabled?: boolean }> = [];

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: () => null,
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
    useAiModels: (options: { apiBase?: string; enabled?: boolean }) => {
      modelCalls.push(options);
      return { models: [], defaultModelId: undefined };
    },
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

// jsdom has no matchMedia — `useIsMobile` (mobile canvas overlay) needs a stub.
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

function renderPane(agents: AgentDescriptor[], agentsLoading: boolean) {
  modelCalls.length = 0;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/ai']}>
        <ChatPane
          agents={agents}
          agentsLoading={agentsLoading}
          agentsError={undefined}
          activeAgent={agents[0]?.name}
          chatApi={agents[0] ? `/api/v1/ai/agents/${agents[0].name}/chat` : undefined}
          apiBase="/api/v1/ai"
          conversationId={undefined}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('ChatPane — no model read before the agent catalog names an agent (objectui#12508)', () => {
  it('while the catalog is loading, the model read is not enabled', () => {
    renderPane([], true);
    expect(modelCalls.length, 'the pane never read models: the harness is dead').toBeGreaterThan(0);
    expect(modelCalls.every((o) => o.enabled === false)).toBe(true);
  });

  it('CONTROL: with an agent in the catalog, the model read is enabled', () => {
    renderPane([{ name: 'build', label: 'Builder' } as unknown as AgentDescriptor], false);
    expect(modelCalls.at(-1)).toEqual({ apiBase: '/api/v1/ai', enabled: true });
  });
});
