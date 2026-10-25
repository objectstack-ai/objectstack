// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12724 — a finished build STAYS on the conversation.
 *
 * The built-moment transition (objectui#5799) moved a conversation into the
 * Studio workbench the moment a whole-app build existed, and objectui#11658
 * pointed it at the running app. The maintainer's AiBuild ruling retires both:
 * the user stays on the conversation and picks a door on the result card. This
 * file replaces the two that pinned the transition
 * (`AiChatPage.builtTransition.test.tsx`, `AiChatPage.builtLandsRunning-11658.test.tsx`).
 *
 * The pins:
 *  1. Neither a REOPENED built conversation (either posture) nor a LIVE build
 *     completion navigates: the page stays on `/ai/build/conv-1`, the only
 *     router call is the A1.b binding's in-place `?package=` replace on the
 *     same conversation, and `location.assign` is never called.
 *  2. The binding still happens (the Studio dock resumes THIS thread through
 *     it), so pin 1 is not vacuous.
 *  3. The two doors are SPA navigations the user chooses: 打开应用 to
 *     `/apps/APP` (the app's first navigation item), 在 Studio 中查看 to
 *     `/studio/PKG/interfaces` with no landing state.
 *
 * Same faked-chat harness the retired files used: the hook instance owns the
 * thread; hydration (the REAL AiChatPage path) derives the envelopes.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

interface FakeMsg {
  id: string;
  role: string;
  content: string;
  toolInvocations?: unknown[];
}

const chat = {
  isLoading: false,
  append: undefined as ((m: FakeMsg) => void) | undefined,
};

/** Every call any `useNavigate()` result received, in order. */
const navigateCalls: unknown[][] = [];

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  const React2 = await import('react');
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return React2.useMemo(
        () =>
          ((...args: unknown[]) => {
            navigateCalls.push(args);
            return (navigate as (...a: unknown[]) => unknown)(...args);
          }) as typeof navigate,
        [navigate],
      );
    },
  };
});

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React2 = await import('react');
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: (opts: { initialMessages?: FakeMsg[] }) => {
      const [messages, setMessages] = React2.useState<FakeMsg[]>(
        () => (opts.initialMessages ?? []) as FakeMsg[],
      );
      chat.append = (m: FakeMsg) => setMessages((prev) => [...prev, m]);
      return {
        messages,
        isLoading: chat.isLoading,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      const msgs = (props.messages ?? []) as FakeMsg[];
      const open = props.onOpenBuiltApp as ((app: string, segment?: string) => void) | undefined;
      const design = props.onDesignBuiltApp as ((app: string, segment?: string) => void) | undefined;
      return (
        <div data-testid="pane">
          {msgs.map((m) => m.id).join(',')}
          <button type="button" data-testid="open-door" onClick={() => open?.('k9_app')} />
          <button type="button" data-testid="studio-door" onClick={() => design?.('k9_app', 'app.k9')} />
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
  LiveCanvas: () => <div data-testid="live-canvas" />,
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

/** A persisted thread whose build ALREADY finished (whole-app draft envelope). */
const builtTurns = (status: 'drafted' | 'published') => [
  { id: 'r1', role: 'user', content: [{ type: 'text', text: 'build me a CRM' }] },
  {
    id: 'r2',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Built it.' },
      { type: 'tool-call', toolCallId: 't1', toolName: 'apply_blueprint' },
    ],
  },
  {
    id: 'r3',
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'apply_blueprint',
        output: {
          type: 'text',
          value: JSON.stringify({
            status,
            packageId: 'app.k9',
            drafted: [
              { type: 'app', name: 'k9_app' },
              { type: 'object', name: 'k9_task' },
            ],
          }),
        },
      },
    ],
  },
];

const UNBUILT_TURNS = [
  { id: 'r1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
  { id: 'r2', role: 'assistant', content: [{ type: 'text', text: 'hi — what shall we build?' }] },
];

let serverTurns: unknown[] = [];

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (/\/conversations\/conv-1$/.test(url) && method === 'GET') {
        return new Response(JSON.stringify({ id: 'conv-1', messages: serverTurns }), {
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

/** Where the router is, and with what state. */
function Where() {
  const location = useLocation();
  return (
    <div
      data-testid="where"
      data-path={location.pathname}
      data-search={location.search}
      data-state={JSON.stringify(location.state ?? null)}
    />
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/ai/build/conv-1']}>
      <Routes>
        <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
        <Route path="/ai/:agent" element={<AiChatPage />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="studio-page" />} />
        <Route path="/apps/:appName" element={<div data-testid="app-page" />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

let assignSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  chat.isLoading = false;
  serverTurns = [];
  navigateCalls.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
  // `location.assign` is the full navigation a page reload into Studio would take.
  assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  assignSpy.mockRestore();
});

/** The ONLY router calls a finished build may make: the binding's in-place replace. */
function expectOnlyTheBinding(): void {
  for (const [to, opts] of navigateCalls) {
    expect(to).toBe('/ai/build/conv-1?package=app.k9');
    expect(opts).toEqual({ replace: true });
  }
  expect(screen.getByTestId('where')).toHaveAttribute('data-path', '/ai/build/conv-1');
  expect(screen.queryByTestId('studio-page')).not.toBeInTheDocument();
  expect(screen.queryByTestId('app-page')).not.toBeInTheDocument();
  expect(assignSpy).not.toHaveBeenCalled();
}

describe('AiChatPage — no automatic navigation after a build (objectui#12724)', () => {
  it.each(['drafted', 'published'] as const)(
    'reopening a conversation that built an app (%s posture) stays on the conversation',
    async (status) => {
      serverTurns = builtTurns(status);
      renderPage();
      await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('r'), { timeout: 4000 });
      // The binding lands (not vacuous: the build WAS seen) …
      await waitFor(
        () => expect(screen.getByTestId('where')).toHaveAttribute('data-search', '?package=app.k9'),
        { timeout: 4000 },
      );
      await new Promise((r) => setTimeout(r, 300));
      // … and nothing else moved.
      expectOnlyTheBinding();
    },
  );

  it('a LIVE build completion stays on the conversation', async () => {
    serverTurns = UNBUILT_TURNS;
    chat.isLoading = true;
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
    act(() => {
      chat.append?.({
        id: 'live-1',
        role: 'assistant',
        content: 'built',
        toolInvocations: [
          {
            toolCallId: 't9',
            toolName: 'apply_blueprint',
            state: 'output-available',
            draftReview: {
              packageId: 'app.k9',
              items: [
                { type: 'app', name: 'k9_app' },
                { type: 'object', name: 'k9_task' },
              ],
            },
          },
        ],
      });
      chat.isLoading = false;
    });
    // one more render so the faked hook reports the settled isLoading
    act(() => {
      chat.append?.({ id: 'live-2', role: 'assistant', content: 'done' });
    });
    await waitFor(
      () => expect(screen.getByTestId('where')).toHaveAttribute('data-search', '?package=app.k9'),
      { timeout: 4000 },
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId('pane')).toHaveTextContent('live-2');
    expectOnlyTheBinding();
  });

  it('打开应用 is an SPA navigation to the built app (its first navigation item)', async () => {
    serverTurns = UNBUILT_TURNS;
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('open-door'));
    expect(await screen.findByTestId('app-page', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveAttribute('data-path', '/apps/k9_app');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('在 Studio 中查看 is an SPA navigation to the Interfaces pillar with no landing state', async () => {
    serverTurns = UNBUILT_TURNS;
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('studio-door'));
    expect(await screen.findByTestId('studio-page', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveAttribute('data-path', '/studio/app.k9/interfaces');
    expect(screen.getByTestId('where')).toHaveAttribute('data-state', 'null');
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
