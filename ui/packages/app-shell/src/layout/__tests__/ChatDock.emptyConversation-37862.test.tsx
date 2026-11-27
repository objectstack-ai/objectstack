// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37862 — the drawer's empty conversation: the layout the AI home
 * draws, large where the drawer fills the window and compact in the rail and
 * the phone sheet. The greeting names the user; the suggestions follow the
 * page in view (one about the record fills the composer, the rest send); 「最近
 * 会话」 lists the drawer agent's threads and opens one in the drawer.
 *
 * ## Real subjects
 *
 * The real `ChatDockConversation`, the real `ChatPane`, the real
 * `ChatbotEnhanced` with its composer, the real `useChatConversation` and
 * `useConversationList` over a `fetch` stub. Stand-ins: the agent catalog,
 * the signed-in user, and the chat transport (`useObjectChat`: no messages,
 * `sendMessage` recorded).
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const state = {
  agents: [{ name: 'ask', label: 'Ask' }] as Array<{ name: string; label: string }>,
  sendMessage: vi.fn(),
};

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
      sendMessage: state.sendMessage,
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: state.agents, isLoading: false, error: undefined, refetch: vi.fn() }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Dana' } }),
}));
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { ChatDockConversation } from '../ChatDockConversation';
import type { ChatSurfaceContext } from '../chatSurfaceContext';

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
let listRows: unknown[];
let creates: number;

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith(`${API}/conversations?`) && method === 'GET') return json({ conversations: listRows });
      if (url === `${API}/conversations` && method === 'POST') {
        creates += 1;
        return json({ id: `conv-new-${creates}`, messages: [] });
      }
      if (/\/conversations\/[^/?]+$/.test(url) && method === 'GET') return json({ messages: [] });
      return json({ success: true, data: [] });
    }),
  );
}

const RECORD: ChatSurfaceContext = { artifact: { type: 'object', name: 'deal' }, selection: { kind: 'record', id: 'd1' } };
const LIST: ChatSurfaceContext = { artifact: { type: 'object', name: 'deal' } };

function renderDrawer(options: {
  presentation?: 'rail' | 'full' | 'sheet';
  surface?: ChatSurfaceContext;
} = {}) {
  const onTargetChange = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app']}>
        <ChatDockConversation
          userId="u1"
          apiBase={API}
          presentation={options.presentation ?? 'rail'}
          surfaceContext={options.surface}
          onTargetChange={onTargetChange}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  return { onTargetChange };
}

const row = (id: string, title: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});

beforeEach(() => {
  state.agents = [{ name: 'ask', label: 'Ask' }];
  state.sendMessage = vi.fn();
  listRows = [];
  creates = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the drawer\'s empty conversation (objectstack#37862)', () => {
  it('compact in the rail and the sheet, large where the drawer fills the window', async () => {
    renderDrawer({ presentation: 'rail' });
    expect(await screen.findByTestId('empty-conversation')).toHaveAttribute('data-size', 'compact');
    cleanup();
    renderDrawer({ presentation: 'sheet' });
    expect(await screen.findByTestId('empty-conversation')).toHaveAttribute('data-size', 'compact');
    cleanup();
    renderDrawer({ presentation: 'full' });
    expect(await screen.findByTestId('empty-conversation')).toHaveAttribute('data-size', 'large');
  });

  it('greets the user by name, with the ask agent\'s line under it', async () => {
    renderDrawer();
    const heading = await screen.findByTestId('empty-conversation-heading');
    expect(heading.textContent).toMatch(/^(Good morning|Good afternoon|Good evening|Working late), Dana\.$/);
    expect(screen.getByTestId('empty-conversation-subtitle')).toHaveTextContent(/Ask questions about your records/);
  });

  it('on a record: its suggestions fill the composer and send nothing', async () => {
    renderDrawer({ surface: RECORD });
    const suggestion = await screen.findByRole('button', { name: 'Summarize this record' });
    expect(suggestion).toHaveAttribute('data-mode', 'fill');
    fireEvent.click(suggestion);
    const composer = within(screen.getByTestId('chat-dock-body')).getByRole('textbox') as HTMLTextAreaElement;
    expect(composer.value).toBe('Summarize this record');
    expect(document.activeElement).toBe(composer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(creates).toBe(0);
    expect(state.sendMessage).not.toHaveBeenCalled();
  });

  it('on a list: a suggestion sends, which creates the conversation', async () => {
    renderDrawer({ surface: LIST });
    const suggestion = await screen.findByRole('button', { name: 'Summarize the records in this list' });
    expect(suggestion).toHaveAttribute('data-mode', 'send');
    fireEvent.click(suggestion);
    await waitFor(() => expect(creates).toBe(1));
  });

  it('「最近会话」 lists the drawer agent\'s threads, not the AI home\'s, and opens one in the drawer', async () => {
    listRows = [
      row('a1', 'Pipeline question', '2026-11-26T10:00:00Z', { agentId: 'ask' }),
      row('h1', 'AI home thread', '2026-11-26T11:00:00Z', { agentId: 'ask', metadata: { activePackageId: 'app.crm' } }),
      row('b1', 'Build thread', '2026-11-26T12:00:00Z', { agentId: 'build' }),
      row('a2', 'Older question', '2026-11-20T10:00:00Z', { agentId: 'ask' }),
      row('a3', 'Third', '2026-11-19T10:00:00Z', { agentId: 'ask' }),
      row('a4', 'Fourth, beyond the compact three', '2026-11-18T10:00:00Z', { agentId: 'ask' }),
    ];
    const { onTargetChange } = renderDrawer();
    const items = await screen.findAllByTestId('empty-conversation-recent-item');
    expect(items.map((item) => item.getAttribute('data-conversation'))).toEqual(['a1', 'a2', 'a3']);
    fireEvent.click(items[0]);
    expect(onTargetChange).toHaveBeenCalledWith({ agent: 'ask', conversationId: 'a1' });
  });

  it('draws no 「最近会话」 when the user has none', async () => {
    renderDrawer();
    await screen.findByTestId('empty-conversation');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/conversations?'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId('empty-conversation-recent')).not.toBeInTheDocument();
  });
});
