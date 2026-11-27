// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36969 — the full-page chat's addresses where the agent catalog
 * does not serve the build agent (in-app building closed: `build` persisted
 * inactive, `ask` still served), and where it does.
 *
 *  - `/ai/build/ID` lands on the default surface WITH the conversation:
 *    `/ai/ask/ID`, and that conversation is the one read, so an old build
 *    thread still opens. It used to land on `/ai/ask` and drop the id.
 *  - a maker's bare `/ai/ask` stays where it is: the cloud#1674 maker
 *    convergence left with the in-app build entry (objectstack#37682).
 *  - regression: where `build` is served, `/ai/build/ID` stays where it is,
 *    and a maker's bare `/ai/ask` still stays on ask.
 *
 * Real subjects: `AiChatPage` under a real router, its route canonicalization
 * and `useChatConversation`. Stand-ins: the agent catalog, the authoring
 * capability, the signed-in user, the apps list, the chat transport (idle and
 * empty) and the side panels; `fetch` answers the conversation API from memory.
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';

const state = vi.hoisted(() => ({
  agents: [] as Array<{ name: string; label?: string }>,
  canAuthor: false,
}));

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
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: state.agents, isLoading: false, error: undefined, refetch: vi.fn() }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => state.canAuthor,
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));

import { I18nProvider } from '@object-ui/i18n';
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
/** Every address the router showed, in order. */
const visited: string[] = [];
/** Every conversation id read by id. */
const readIds: string[] = [];

function LocationProbe() {
  const location = useLocation();
  React.useEffect(() => {
    visited.push(location.pathname);
  }, [location.pathname]);
  return <output data-testid="location">{location.pathname}</output>;
}

function visit(entry: string) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage apiBase={API} />} />
          <Route path="/ai/:agent" element={<AiChatPage apiBase={API} />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>,
  );
}

const ASK_ONLY = [{ name: 'ask', label: 'Ask' }];
const BOTH = [
  { name: 'build', label: 'Build' },
  { name: 'ask', label: 'Ask' },
];

beforeEach(() => {
  visited.length = 0;
  readIds.length = 0;
  state.agents = ASK_ONLY;
  state.canAuthor = false;
  window.localStorage.clear();
  window.sessionStorage.clear();
  let minted = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === `${API}/conversations` && method === 'POST') {
        minted += 1;
        return json({ id: `conv-${minted}`, messages: [] });
      }
      const byId = /\/conversations\/([^/?]+)$/.exec(url);
      if (byId && method === 'GET') {
        readIds.push(decodeURIComponent(byId[1]));
        return json({ id: byId[1], agentId: 'build', messages: [] });
      }
      return json({ success: true, data: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('in-app building closed: the catalog serves `ask`, not `build` (objectstack#36969)', () => {
  it('/ai/build/ID opens that conversation on the default surface: /ai/ask/ID', async () => {
    visit('/ai/build/c-42');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/ai\/ask\/c-42$/));
    await waitFor(() => expect(readIds).toContain('c-42'));
    expect(visited).not.toContain('/ai/ask');
  });

  it('a maker gets it too', async () => {
    state.canAuthor = true;
    visit('/ai/build/c-42');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/ai\/ask\/c-42$/));
    expect(visited.some((p) => p === '/ai/build' || p === '/ai/ask')).toBe(false);
  });

  it('a maker\'s bare /ai/ask is never sent to /ai/build', async () => {
    state.canAuthor = true;
    visit('/ai/ask');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/ai\/ask/);
    expect(visited.some((p) => p.startsWith('/ai/build'))).toBe(false);
  });
});

describe('regression: where the catalog serves `build`, the addresses are unchanged (objectstack#36969)', () => {
  beforeEach(() => {
    state.agents = BOTH;
  });

  it('/ai/build/ID stays on the build conversation', async () => {
    visit('/ai/build/c-42');
    await waitFor(() => expect(readIds).toContain('c-42'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/ai\/build\/c-42$/);
    expect(visited.every((p) => p === '/ai/build/c-42')).toBe(true);
  });

  it('a maker\'s bare /ai/ask stays on ask (objectstack#37682)', async () => {
    state.canAuthor = true;
    visit('/ai/ask');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/ai\/ask/);
    expect(visited.some((p) => p.startsWith('/ai/build'))).toBe(false);
  });
});
