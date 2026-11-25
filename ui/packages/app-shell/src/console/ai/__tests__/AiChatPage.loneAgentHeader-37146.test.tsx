// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37146 — the AI pane's header row with one launchable agent.
 *
 * Since the in-app build entry closed, the agent catalog usually offers only
 * the ask agent. The header row then had nothing to switch, and drew the lone
 * agent's name (「提问」 / "Ask") as plain text. In the right-side drawer the
 * host lifts Share and the Build Doctor into its own title bar
 * (`actionsInHost`, objectstack#35445), so that name was the row's only
 * content.
 *
 *  - one agent: no switcher and no agent name; in the drawer (actions lifted)
 *    no header row at all; on the full page the row stays for Share.
 *  - two agents: the switcher renders, in the drawer and on the full page.
 *  - one agent on the build surface: the row stays for the package chip.
 *
 * Real subjects: `ChatPane` and the real `ChatbotEnhanced` that draws its
 * `headerSlot`. Stand-ins: the chat transport (idle and empty), the models
 * list, the metadata and adapter providers.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
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
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
  };
});
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
// A user who may not author metadata: for a maker, a served build agent
// converges the catalog onto build alone (`makerVisibleAgents`), which would
// leave one launchable agent in the two-agent cases.
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => false,
}));

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

const ASK = { name: 'ask', label: 'Ask' } as unknown as AgentDescriptor;
const BUILD = { name: 'build', label: 'Build' } as unknown as AgentDescriptor;

function renderPane(opts: { agents: AgentDescriptor[]; activeAgent: string; actionsInHost: boolean }) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <ChatPane
          agents={opts.agents}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent={opts.activeAgent}
          chatApi={`/api/v1/ai/agents/${opts.activeAgent}/chat`}
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
          actionsInHost={opts.actionsInHost}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The pane's header row (`headerSlot`). */
const headerRow = () => screen.queryByTestId('ai-chat-header');

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe('AI pane header with one launchable agent (objectstack#37146)', () => {
  it('drawer (actions lifted), one agent: no switcher, no agent name, no header row', () => {
    renderPane({ agents: [ASK], activeAgent: 'ask', actionsInHost: true });
    expect(screen.queryByTestId('ai-chat-agent-picker')).not.toBeInTheDocument();
    expect(headerRow()).toBeNull();
    // The name is gone from the header; the composer still names the agent
    // in its placeholder, so the assertion is scoped to the absent row.
    expect(screen.queryByText('Ask', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('full page, one agent: no switcher and no agent name; the row stays for Share', () => {
    renderPane({ agents: [ASK], activeAgent: 'ask', actionsInHost: false });
    expect(screen.queryByTestId('ai-chat-agent-picker')).not.toBeInTheDocument();
    const row = headerRow();
    expect(row).not.toBeNull();
    expect(row).toContainElement(screen.getByTestId('ai-chat-share-button'));
    expect(row).not.toHaveTextContent('Ask');
  });

  it('drawer, two agents: the switcher renders', () => {
    renderPane({ agents: [BUILD, ASK], activeAgent: 'ask', actionsInHost: true });
    expect(headerRow()).not.toBeNull();
    expect(screen.getByTestId('ai-chat-agent-picker')).toBeInTheDocument();
  });

  it('full page, two agents: the switcher renders beside Share', () => {
    renderPane({ agents: [BUILD, ASK], activeAgent: 'ask', actionsInHost: false });
    expect(screen.getByTestId('ai-chat-agent-picker')).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-share-button')).toBeInTheDocument();
  });

  it('drawer, one agent on the build surface: the row stays for the package chip', () => {
    renderPane({ agents: [BUILD], activeAgent: 'build', actionsInHost: true });
    expect(screen.queryByTestId('ai-chat-agent-picker')).not.toBeInTheDocument();
    expect(headerRow()).not.toBeNull();
    expect(screen.getByTestId('ai-build-package-chip')).toBeInTheDocument();
  });
});
